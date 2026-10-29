# Veículos do Condomínio

Aplicação inicial para o cadastro e consulta de veículos de um condomínio com 22 unidades.

## Stack

- React + TypeScript + Vite
- Material UI
- Supabase Auth por telefone/SMS OTP
- Supabase PostgreSQL com Row Level Security (RLS)
- Vercel para hospedagem do frontend

## Regras implementadas no desenho inicial

- As 22 unidades são criadas pela migration: 101/102, 201/202, ... 1101/1102.
- Todos os usuários autenticados e ativos podem consultar os veículos.
- A edição depende de um telefone autorizado em `unit_phone_access` para a unidade do veículo.
- Cada unidade pode ter vários telefones autorizados.
- O síndico pode receber o papel opcional `manager`; o administrador principal usa `admin`.
- A migration cria o schema e as políticas RLS iniciais.

## Pré-requisitos

- Node.js LTS
- npm
- Projeto Supabase
- Provedor de SMS habilitado no Supabase Auth
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

1. Crie um projeto Supabase.
2. Configure Phone Auth e um provedor de SMS em Authentication > Providers / Phone, conforme as opções atuais do painel.
3. Aplique `supabase/migrations/202610280001_initial_schema.sql` no SQL Editor do Supabase ou via Supabase CLI.
4. Em Authentication, configure limites de envio e regras antiabuso adequadas.
5. Configure as URLs permitidas de redirecionamento.
6. Copie a Project URL e a chave pública/publishable key para `.env`.

### Autorizar um telefone e unidade

Os telefones precisam estar em formato E.164, por exemplo `+5541999999999`.

A autorização deve ser realizada por um administrador por meio de uma futura tela administrativa ou de uma operação segura no SQL Editor. Exemplo de inserção, depois de identificar o UUID da unidade:

```sql
insert into public.unit_phone_access (unit_id, phone_e164, label)
select id, '+5541999999999', 'Morador principal'
from public.units
where code = '101';
```

Esse comando deve ser executado por um administrador confiável no SQL Editor, nunca exposto ao cliente.

### Primeiro administrador (configuração manual necessária)

Não há credenciais administrativas embutidas no projeto.

1. Configure e teste o login por SMS no Supabase.
2. O futuro administrador faz login uma vez com seu telefone.
3. No SQL Editor, identifique o registro verificado em `auth.users` e confirme o número por um canal independente.
4. Insira um perfil ativo e atribua o papel administrativo:

```sql
-- Substitua o UUID e o nome por valores verificados.
insert into public.profiles (id, full_name, is_active)
values ('UUID-DO-USUARIO-AUTORIZADO', 'Administrador do condomínio', true)
on conflict (id) do update set is_active = true;

insert into public.user_roles (user_id, role)
values ('UUID-DO-USUARIO-AUTORIZADO', 'admin')
on conflict (user_id) do update set role = 'admin';
```

5. Autorize o telefone às unidades pertinentes na tabela `unit_phone_access`.

**Atenção:** o frontend atual ainda não contém a tela administrativa para gerenciar unidades, telefones e papéis. Use somente o SQL Editor para a configuração inicial, por um operador confiável. Implemente e teste a área administrativa antes de delegar essa função a moradores ou ao síndico.

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

- Implementar a área administrativa segura para gerenciar perfis, telefones autorizados, unidades e papéis.
- Confirmar o comportamento do fluxo de cadastro/login por telefone no projeto Supabase e garantir que telefones não autorizados não recebam acesso a dados.
- Adicionar teste de integração com usuários de duas unidades, provando que um usuário não consegue editar ou excluir veículos de outra unidade.
- Revisar as políticas RLS com testes reais. A segurança não deve depender apenas da interface.
- Configurar limites de SMS, CAPTCHA/antiabuso conforme necessário e monitorar custos do provedor.
- Definir política de privacidade, retenção de dados e procedimento de revogação de acesso.
- Fazer backup e testar recuperação.
- Revisar a restrição de formato de unidade se a numeração real do condomínio divergir do padrão fornecido.

## Limitações conhecidas desta primeira versão

- A tela principal e CRUD de veículos estão implementados.
- O fluxo de OTP por SMS está conectado ao Supabase Auth, mas depende da configuração externa de Phone Auth/SMS.
- A interface administrativa ainda não foi implementada.
- O procedimento de primeiro administrador é manual.
- Não foi executado contra um projeto Supabase real; não declare o sistema pronto para produção antes dos testes e da revisão de segurança.
