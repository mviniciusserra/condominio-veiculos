# Veículos do Condomínio

Aplicação inicial para o cadastro e consulta de veículos de um condomínio com 22 unidades.

## Stack

- React + TypeScript + Vite
- Material UI
- Supabase Auth por e-mail e senha
- Supabase PostgreSQL com Row Level Security (RLS)
- Vercel para hospedagem do frontend

## Regras implementadas no desenho atual

- As 22 unidades são criadas pela migration: 101/102, 201/202, ... 1101/1102.
- Qualquer pessoa pode criar a própria conta (e-mail/senha) pela tela "Criar conta". O cadastro gera automaticamente um perfil `pending` e uma solicitação de acesso (`access_requests`), sem qualquer ação prévia do administrador.
- Enquanto o perfil não estiver com status `approved`, o usuário só enxerga a tela de status (pendente/recusado/revogado) e a edição do próprio perfil — não acessa veículos nem unidades restritas.
- Todos os usuários autenticados **e com perfil `approved`** podem consultar os veículos de todas as unidades.
- A edição/cadastro/exclusão de veículo depende de uma associação ativa em `unit_members` (usuário ↔ unidade) para a unidade do veículo. Qualquer morador vinculado à unidade pode editar, não só quem cadastrou.
- Cada veículo tem um `owner_user_id` (responsável pelo cadastro). O modal de detalhes do veículo mostra nome, unidade e, se o responsável tiver autorizado (`profiles.show_phone`), o telefone com botão para abrir o WhatsApp (`wa.me`).
- Troca de unidade é feita via solicitação (`request_unit_change`); o vínculo anterior só é encerrado quando o administrador aprova a nova solicitação (`decide_access_request`), na mesma transação.
- Cada unidade pode ter vários usuários associados.
- O síndico pode receber o papel opcional `manager`; o administrador principal usa `admin`.
- Administradores não podem revogar o próprio acesso nem o último administrador `approved` — bloqueado no banco (`revoke_access`).
- As migrations criam o schema e as políticas RLS.
- A tabela `unit_phone_access` e a função `current_phone()` do desenho anterior (telefone/SMS) permanecem no banco, mas não são mais usadas por nenhuma política — nada foi apagado.

## Pré-requisitos

- Node.js LTS
- npm
- Projeto Supabase com o provedor **Email** habilitado em Authentication > Providers
- Git (opcional, recomendado para publicar na Vercel)

## Rodar localmente

1. Instale dependências:

   ```bash
   npm install
   ```

2. Copie `.env.example` para `.env` e preencha a URL e a chave pública do projeto Supabase:

   ```bash
   cp .env.example .env
   ```

3. Inicie o frontend:

   ```bash
   npm run dev
   ```

4. Abra a URL informada pelo Vite.

## Configuração do Supabase

1. Use o projeto Supabase já existente (não crie outro).
2. Em Authentication > Providers, mantenha o provedor **Email** habilitado e o provedor **Phone** desabilitado.
3. Em Authentication > Emails, revise os templates de "Reset Password" e "Confirm signup" (texto em português, se desejar).
4. Em Authentication > URL Configuration, configure a **Site URL** e as **Redirect URLs** (ex.: `http://localhost:5173` em desenvolvimento e o domínio da Vercel em produção) — `resetPasswordForEmail` usa essa lista para validar o link de redefinição.
5. Decida se o cadastro público (sign-up) deve ficar habilitado. Como o acesso real é controlado por `profiles`/`unit_members`, deixar o sign-up aberto só cria contas autenticadas sem autorização; para um controle mais estrito, desabilite sign-up público em Authentication > Providers > Email e crie os usuários manualmente em Authentication > Users (ou via convite), ou mantenha habilitado e trate todo novo usuário como "pendente" (é o que o frontend já faz quando não há perfil ativo).
6. Aplique as migrations, nesta ordem, no SQL Editor do Supabase ou via Supabase CLI:
   - `supabase/migrations/202610280001_initial_schema.sql` (já aplicada, se o projeto já existe — não reaplique se já existir).
   - `supabase/migrations/202610300001_access_requests_and_contacts.sql` (cadastro/aprovação/perfil/contato — já aplicada manualmente no projeto real em 2026-10-30; idempotente, pode ser reaplicada em ambientes novos). Este arquivo já inclui tudo que `202610290001_email_auth_authorization.sql` propunha (que nunca chegou a ser aplicado); não é necessário aplicar esse arquivo intermediário.
7. Copie a Project URL e a chave pública/publishable key para `.env` (veja `.env.example`).

### Por que a nova migration é necessária

A função `has_unit_access()` original decidia quem pode inserir/editar/excluir um veículo comparando `unit_phone_access.phone_e164` com `auth.jwt() ->> 'phone'`. Usuários autenticados por e-mail não têm `phone` no JWT, então, sem essa migration, **nenhum morador conseguiria cadastrar ou editar veículos** mesmo logado corretamente — apenas administradores (via `is_admin()`) teriam acesso de escrita.

A migration `202610290001_email_auth_authorization.sql`:
- Cria a tabela `unit_members` (unidade ↔ `auth.users.id`), que substitui `unit_phone_access` para fins de autorização.
- Recria `has_unit_access()` com a mesma assinatura, agora consultando `unit_members` em vez de telefone — as políticas de `vehicles` que já chamam essa função continuam funcionando sem alteração.
- Cria `admin_lookup_user_by_email(email)`, uma função restrita a administradores para resolver o UUID de um usuário pelo e-mail sem dar acesso direto à tabela `auth.users`.
- **Não remove** `unit_phone_access` nem `current_phone()` — eles ficam no banco, sem uso, para preservar o histórico.

### Autorizar um e-mail em uma unidade

1. O morador precisa ter feito login ao menos uma vez (ou ter sido criado em Authentication > Users) para existir em `auth.users`.
2. No SQL Editor, descubra o UUID pelo e-mail usando a função criada na migration (só funciona logado como admin):

```sql
select * from public.admin_lookup_user_by_email('morador@exemplo.com');
```

3. Crie (ou ative) o perfil e associe à(s) unidade(s):

```sql
-- Substitua o UUID pelo retornado acima.
insert into public.profiles (id, full_name, is_active)
values ('UUID-DO-USUARIO', 'Nome do morador', true)
on conflict (id) do update set is_active = true;

insert into public.unit_members (unit_id, user_id, label)
select id, 'UUID-DO-USUARIO', 'Morador principal'
from public.units
where code = '101'
on conflict (unit_id, user_id) do update set is_active = true;
```

Esse comando deve ser executado por um administrador confiável no SQL Editor, nunca exposto ao cliente.

### Primeiro administrador (configuração manual necessária)

Não há credenciais administrativas embutidas no projeto. Se você já tem o usuário `admin` configurado em `user_roles`/`profiles`, nenhuma ação é necessária — isso é preservado pela migration. Para um **novo** administrador:

1. O futuro administrador faz login uma vez por e-mail e senha (ou recebe um convite em Authentication > Users).
2. No SQL Editor, identifique o UUID com `admin_lookup_user_by_email('email@exemplo.com')` (requer já ser admin) ou via Authentication > Users no painel.
3. Insira um perfil ativo e atribua o papel administrativo:

```sql
-- Substitua o UUID e o nome por valores verificados.
insert into public.profiles (id, full_name, is_active)
values ('UUID-DO-USUARIO-AUTORIZADO', 'Administrador do condomínio', true)
on conflict (id) do update set is_active = true;

insert into public.user_roles (user_id, role)
values ('UUID-DO-USUARIO-AUTORIZADO', 'admin')
on conflict (user_id) do update set role = 'admin';
```

4. Associe o e-mail às unidades pertinentes na tabela `unit_members`, se também for morador.

**Atenção:** o frontend atual ainda não contém a tela administrativa para gerenciar unidades, usuários e papéis. Use somente o SQL Editor para a configuração inicial, por um operador confiável. Implemente e teste a área administrativa antes de delegar essa função a moradores ou ao síndico. Nenhum usuário pode atribuir a si mesmo o papel `admin`: isso só acontece via SQL Editor por quem já tem acesso de administrador no banco.

## Configurar o frontend

O frontend lê:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (use a chave pública/publishable key apropriada ao projeto)

Nunca configure `service_role`, segredo privado ou senha do banco em variáveis `VITE_*`. Elas são expostas ao navegador.

## Publicar na Vercel

1. Envie o projeto a um repositório GitHub.
2. Importe o repositório na Vercel.
3. Configure as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. Use `npm run build` como comando de build e `dist` como diretório de saída.
5. Publique e teste com contas separadas.

## Antes de produção: itens obrigatórios

Este projeto é um scaffold inicial e precisa de revisão e testes antes de uso real:

- Aplicar a migration `202610290001_email_auth_authorization.sql` no projeto Supabase real (não foi aplicada automaticamente por esta mudança).
- Implementar a área administrativa segura para gerenciar perfis, associações de unidade (`unit_members`) e papéis.
- Testar o login por e-mail/senha e o fluxo de redefinição de senha de ponta a ponta contra o projeto Supabase real.
- Decidir e configurar a política de cadastro (sign-up público habilitado ou não) em Authentication > Providers > Email.
- Adicionar teste de integração com usuários de duas unidades, provando que um usuário não consegue editar ou excluir veículos de outra unidade, e que um usuário sem perfil ativo não acessa nenhum dado.
- Revisar as políticas RLS com testes reais. A segurança não deve depender apenas da interface.
- Configurar CAPTCHA/antiabuso para login e redefinição de senha, conforme necessário.
- Definir política de privacidade, retenção de dados e procedimento de revogação de acesso.
- Fazer backup e testar recuperação.
- Revisar a restrição de formato de unidade se a numeração real do condomínio divergir do padrão fornecido.

## Limitações conhecidas desta versão

- A tela principal e CRUD de veículos estão implementados.
- O login é por e-mail e senha via Supabase Auth, com fluxo de redefinição de senha (`resetPasswordForEmail`/`updateUser`).
- A interface administrativa ainda não foi implementada; autorização de unidades é feita via SQL Editor.
- O procedimento de primeiro administrador é manual.
- O login/fluxo de autorização por e-mail descrito aqui **não foi testado contra um projeto Supabase real** nesta mudança (apenas `npm run build`); não declare o sistema pronto para produção antes de testar login, redefinição de senha e as permissões de cada papel.
