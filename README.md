# Veículos do Condomínio

Aplicação para cadastro e consulta de veículos de um condomínio com 22 unidades.

## Stack

- React + TypeScript + Vite
- Material UI
- Supabase Auth por e-mail e senha
- Supabase PostgreSQL com Row Level Security (RLS)
- Vercel para hospedagem do frontend

## Regras implementadas

- As 22 unidades são criadas pela migration: 101/102, 201/202, ... 1101/1102. A lista de códigos é pública (usada no formulário de cadastro).
- Qualquer pessoa pode criar a própria conta (e-mail/senha) pela tela "Criar conta". O cadastro gera automaticamente um perfil `pending` e uma solicitação de acesso (`access_requests`).
- Enquanto o perfil não estiver `approved`, o usuário só vê a tela de status e a edição do próprio perfil — não acessa veículos.
  - **Recusado** (`rejected`): pode corrigir os dados e reenviar a solicitação (`submit_access_request`).
  - **Pendente sem solicitação** (ex.: unidade inválida no cadastro): também pode enviar a solicitação pela tela de status.
  - **Revogado** (`revoked`): precisa falar com o administrador.
- Usuários com perfil `approved` consultam os veículos de todas as unidades.
- Cadastrar/editar/excluir veículo exige vínculo ativo em `unit_members` com a unidade do veículo (ou papel `admin`). Qualquer morador vinculado à unidade pode editar, não só quem cadastrou.
- Cada veículo tem um responsável (`owner_user_id`), definido como quem o cadastrou. Um morador da unidade pode assumir a responsabilidade para si, mas não pode atribuí-la a outra pessoa (só o admin).
- **Contatos do veículo** (`get_vehicle_contacts`): o detalhe do veículo mostra o responsável em destaque e, abaixo, os demais moradores aprovados com vínculo ativo na unidade. Quem foi revogado ou mudou de unidade deixa de aparecer.
- **Telefone e consentimento (LGPD):** o telefone (DDD + número, sem DDI) só é exibido a outros moradores se a pessoa autorizar (`profiles.show_phone`). No cadastro há um checkbox de consentimento, desmarcado por padrão; a opção pode ser alterada em "Meu perfil". O botão de WhatsApp usa `wa.me/55<telefone>`.
- Uma conta fica vinculada a uma unidade por vez; cada unidade pode ter vários moradores. A troca de unidade é feita por solicitação (`request_unit_change`), e o vínculo anterior só é encerrado quando o administrador aprova (`decide_access_request`).
- Administradores aprovam/recusam solicitações e revogam acessos pelo painel de administração (ícone de escudo no topo). Não podem revogar o próprio acesso nem o último administrador aprovado — bloqueado no banco (`revoke_access`). Revogar um acesso também recusa as solicitações pendentes daquela conta.
- `profiles.is_active` é sempre derivado de `profiles.status` por trigger; altere sempre o `status`.
- Mudanças em veículos, perfis, vínculos de unidade, papéis e solicitações ficam registradas em `audit_log` (leitura só para administradores; nome e telefone não são gravados no log).
- O papel opcional `manager` existe no banco, mas ainda não concede permissões extras.
- A tabela `unit_phone_access` e a função `current_phone()` do desenho antigo (telefone/SMS) são obsoletas e não são usadas por nenhuma policy; foram mantidas apenas como histórico.

## Pré-requisitos

- Node.js LTS (20.19+ ou 22.13+)
- npm
- Projeto Supabase com o provedor **Email** habilitado em Authentication > Providers

## Rodar localmente

```bash
npm install
cp .env.example .env   # preencha a URL e a chave pública do Supabase
npm run dev
```

Outros comandos:

```bash
npm run build   # typecheck + build de produção
npm run lint    # ESLint
npm test        # testes unitários (Vitest)
```

## Configuração do Supabase

1. Em Authentication > Providers, mantenha **Email** habilitado e **Phone** desabilitado.
2. Em Authentication > Emails, revise os templates de "Reset Password" e "Confirm signup".
3. Em Authentication > URL Configuration, configure a **Site URL** e as **Redirect URLs** (ex.: `http://localhost:5173` e o domínio da Vercel) — `resetPasswordForEmail` usa essa lista.
4. Aplique as migrations, em ordem, no SQL Editor ou via Supabase CLI (`supabase db push`):

   | Migration | Situação no projeto real |
   | --- | --- |
   | `202610280001_initial_schema.sql` | já aplicada |
   | `202610290001_email_auth_authorization.sql` | coberta pela `202610300001`; em banco novo pode ser aplicada normalmente (é compatível) |
   | `202610300001_access_requests_and_contacts.sql` | aplicada manualmente em 2026-10-30 |
   | `202610300002_phone_display_default_on.sql` | verificar |
   | `202610300003_national_phone_format.sql` | verificar |
   | `202611030001_access_fixes_and_unit_contacts.sql` | **pendente** — ver abaixo |

5. Copie a Project URL e a chave pública/publishable key para `.env` (veja `.env.example`).

### Migration `202611030001` (obrigatório publicar junto com o frontend)

Esta migration renomeia a coluna `phone_e164` para `phone` (em `profiles` e `access_requests`) e troca RPCs usadas pelo frontend (`update_my_profile` com `p_phone`, `get_vehicle_contacts` no lugar de `get_vehicle_owner_contact`, nova `submit_access_request`). **Aplique a migration e publique esta versão do frontend em seguida**; a versão anterior do frontend deixa de funcionar após a migration.

Ela não altera o `show_phone` dos perfis existentes; só o padrão de novos perfis passa a ser `false`.

## Primeiro administrador

Não há credenciais administrativas embutidas no projeto.

1. O futuro administrador cria a conta pela tela "Criar conta" (ou recebe convite em Authentication > Users).
2. No SQL Editor (que roda como `postgres`), descubra o UUID em Authentication > Users, ou com `select id from auth.users where email = 'email@exemplo.com';`.
3. Aprove o perfil e atribua o papel:

```sql
-- Substitua o UUID e o nome por valores verificados.
-- Use sempre "status": is_active é derivado dele por trigger.
insert into public.profiles (id, full_name, status)
values ('UUID-DO-USUARIO', 'Administrador do condomínio', 'approved')
on conflict (id) do update set status = 'approved';

insert into public.user_roles (user_id, role)
values ('UUID-DO-USUARIO', 'admin')
on conflict (user_id) do update set role = 'admin';

-- Se a conta tiver uma solicitação pendente do cadastro, marque-a como aprovada.
update public.access_requests
set status = 'approved', decided_at = now()
where user_id = 'UUID-DO-USUARIO' and status = 'pending';
```

4. Se o administrador também for morador, vincule a unidade:

```sql
insert into public.unit_members (unit_id, user_id, label)
select id, 'UUID-DO-USUARIO', 'Morador'
from public.units where code = '101'
on conflict (unit_id, user_id) do update set is_active = true, ended_at = null;
```

Depois disso, os demais moradores são aprovados pelo painel de administração do app. Nenhum usuário consegue atribuir a si mesmo o papel `admin`.

## Testes do banco (RLS)

`supabase/tests/database/access_control.test.sql` contém testes pgTAP das policies e RPCs: pendente não vê dados, morador não edita veículo de outra unidade, não atribui veículo a terceiros, contatos respeitam o consentimento, recusa/reenvio e revogação. Para rodar, com Docker e Supabase CLI:

```bash
supabase start
supabase test db
```

## Configurar o frontend

O frontend lê `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (chave pública/publishable). Nunca configure `service_role`, segredo privado ou senha do banco em variáveis `VITE_*` — elas são expostas ao navegador.

## Publicar na Vercel

1. Importe o repositório na Vercel.
2. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Build: `npm run build`; diretório de saída: `dist`.

## Antes de produção

- Rodar `supabase test db` contra um banco local com todas as migrations.
- Testar ponta a ponta no projeto real: cadastro, confirmação de e-mail, aprovação, recusa/reenvio, troca de unidade, revogação e redefinição de senha.
- Decidir se o cadastro público fica habilitado (Authentication > Providers > Email) e configurar CAPTCHA/antiabuso para login, cadastro e redefinição de senha.
- Publicar uma política de privacidade (nome, unidade e telefone de moradores são exibidos a outros moradores aprovados) e definir retenção de dados e `audit_log`.
- Configurar backup e testar a recuperação.
