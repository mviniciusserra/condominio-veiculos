-- Correções do fluxo de acesso, privacidade e contatos por unidade.
-- Idempotente e não destrutivo (nenhuma tabela ou dado é removido).
--
-- ATENÇÃO: renomeia profiles.phone_e164/access_requests.phone_e164 para "phone" e
-- troca a assinatura de RPCs usadas pelo frontend. Publique o frontend desta mesma
-- versão logo após aplicar esta migration.
--
-- Resumo:
--  1) Coluna de telefone renomeada para "phone" (guarda DDD + número, sem DDI).
--  2) show_phone volta a ter padrão false; o consentimento vem do cadastro (checkbox).
--     Perfis existentes não são alterados.
--  3) is_active é sempre derivado de status (inclusive em updates diretos via SQL).
--  4) Recusa de cadastro marca o perfil como "rejected"; o usuário pode reenviar a
--     solicitação (submit_access_request).
--  5) Aprovação valida o status atual da conta (revogado não volta por solicitação antiga);
--     revogar acesso também recusa solicitações pendentes.
--  6) Moradores só podem trocar o responsável (owner_user_id) de um veículo para si mesmos.
--  7) get_vehicle_contacts() substitui get_vehicle_owner_contact(): lista o responsável e
--     os demais moradores aprovados da unidade (telefone só com consentimento).
--  8) Auditoria de perfis, vínculos de unidade, papéis e solicitações.

-- Em um banco novo, a migration 202610290001 cria unit_members sem estas colunas e o
-- "create table if not exists" da 202610300001 não as adiciona.
alter table public.unit_members add column if not exists started_at timestamptz not null default now();
alter table public.unit_members add column if not exists ended_at timestamptz;

-- ============================================================================
-- 1) Renomeia a coluna de telefone
-- ============================================================================
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone_e164') then
    alter table public.profiles rename column phone_e164 to phone;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'access_requests' and column_name = 'phone_e164') then
    alter table public.access_requests rename column phone_e164 to phone;
  end if;
  if exists (select 1 from pg_constraint where conname = 'profiles_phone_e164_format') then
    alter table public.profiles rename constraint profiles_phone_e164_format to profiles_phone_format;
  end if;
end $$;

-- access_requests não foi normalizada pela migration 202610300003; aplica a mesma regra.
update public.access_requests
set phone = regexp_replace(phone, '\D', '', 'g')
where phone is not null;

update public.access_requests
set phone = substring(phone from 3)
where phone is not null and length(phone) > 11 and left(phone, 2) = '55';

update public.access_requests
set phone = null
where phone is not null and phone !~ '^[1-9]{2}[0-9]{8,9}$';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'access_requests_phone_format') then
    alter table public.access_requests
      add constraint access_requests_phone_format
      check (phone is null or phone ~ '^[1-9]{2}[0-9]{8,9}$');
  end if;
end $$;

-- Normaliza um telefone vindo do cliente: só dígitos, sem DDI 55. Retorna null se vazio
-- ou inválido.
create or replace function public.normalize_phone(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  with digits as (select regexp_replace(coalesce(p_raw, ''), '\D', '', 'g') as d),
       national as (
         select case when length(d) > 11 and left(d, 2) = '55' then substring(d from 3) else d end as n
         from digits
       )
  select case when n ~ '^[1-9]{2}[0-9]{8,9}$' then n else null end from national;
$$;

-- ============================================================================
-- 2) Consentimento para exibir telefone
-- ============================================================================
alter table public.profiles alter column show_phone set default false;

-- ============================================================================
-- 3) is_active sempre derivado de status
-- ============================================================================
-- Antes o trigger só disparava em "update of status", então um update direto de
-- is_active (como o SQL antigo do README) deixava os dois campos inconsistentes.
drop trigger if exists profiles_sync_is_active on public.profiles;
create trigger profiles_sync_is_active
before insert or update on public.profiles
for each row execute function public.sync_profile_is_active();

update public.profiles set is_active = (status = 'approved') where is_active <> (status = 'approved');

-- ============================================================================
-- Auditoria (usada pelas seções seguintes)
-- ============================================================================
create or replace function public.log_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_meta jsonb;
  v_changes jsonb;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_meta := jsonb_build_object('source', 'database_trigger', 'table', TG_TABLE_NAME);

  if TG_OP = 'UPDATE' then
    -- Registra só os campos alterados; dados de contato ficam fora do log.
    select jsonb_object_agg(n.key, jsonb_build_array(to_jsonb(old) -> n.key, n.value))
    into v_changes
    from jsonb_each(to_jsonb(new)) n
    where to_jsonb(old) -> n.key is distinct from n.value
      and n.key not in ('updated_at', 'phone', 'full_name');
    if v_changes is null then
      return new;
    end if;
    v_meta := v_meta || jsonb_build_object('changes', v_changes);
  end if;

  insert into public.audit_log (actor_user_id, entity_type, entity_id, action, metadata)
  values (
    auth.uid(),
    TG_ARGV[0],
    coalesce((v_row ->> 'id')::uuid, (v_row ->> 'user_id')::uuid),
    lower(TG_OP),
    v_meta
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists profiles_audit_trigger on public.profiles;
create trigger profiles_audit_trigger
after insert or update or delete on public.profiles
for each row execute function public.log_row_change('profile');

drop trigger if exists unit_members_audit_trigger on public.unit_members;
create trigger unit_members_audit_trigger
after insert or update or delete on public.unit_members
for each row execute function public.log_row_change('unit_member');

drop trigger if exists user_roles_audit_trigger on public.user_roles;
create trigger user_roles_audit_trigger
after insert or update or delete on public.user_roles
for each row execute function public.log_row_change('user_role');

drop trigger if exists access_requests_audit_trigger on public.access_requests;
create trigger access_requests_audit_trigger
after insert or update or delete on public.access_requests
for each row execute function public.log_row_change('access_request');

-- ============================================================================
-- 4) Autocadastro: lê "phone" (ou "phone_e164", de versões antigas do frontend)
--    e o consentimento "show_phone" dos metadados do signUp().
-- ============================================================================
create or replace function public.handle_new_user_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_id uuid;
  v_full_name text;
  v_phone text;
  v_show_phone boolean;
begin
  begin
    v_unit_id := nullif(new.raw_user_meta_data ->> 'unit_id', '')::uuid;
  exception when invalid_text_representation then
    v_unit_id := null;
  end;
  v_full_name := left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 120);
  -- Telefone inválido vira null em vez de impedir a criação da conta.
  v_phone := public.normalize_phone(coalesce(new.raw_user_meta_data ->> 'phone', new.raw_user_meta_data ->> 'phone_e164'));
  v_show_phone := coalesce((new.raw_user_meta_data ->> 'show_phone')::boolean, false);

  insert into public.profiles (id, full_name, phone, show_phone, status)
  values (new.id, v_full_name, v_phone, v_show_phone and v_phone is not null, 'pending')
  on conflict (id) do nothing;

  if v_unit_id is not null and exists (select 1 from public.units where id = v_unit_id) then
    insert into public.access_requests (user_id, unit_id, full_name, phone, kind, status)
    values (new.id, v_unit_id, v_full_name, v_phone, 'signup', 'pending');
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 5) RPCs de perfil e solicitações
-- ============================================================================
drop function if exists public.update_my_profile(text, text, boolean);
create or replace function public.update_my_profile(p_full_name text, p_phone text, p_show_phone boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Informe o nome completo.';
  end if;
  if length(trim(p_full_name)) > 120 then
    raise exception 'O nome pode ter no máximo 120 caracteres.';
  end if;
  v_phone := public.normalize_phone(p_phone);
  if coalesce(p_phone, '') <> '' and v_phone is null then
    raise exception 'Telefone inválido. Informe DDD + número, ex.: 11988887777.';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone = v_phone,
      show_phone = coalesce(p_show_phone, false) and v_phone is not null
  where id = auth.uid();
end;
$$;

create or replace function public.request_unit_change(p_unit_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found or v_profile.status <> 'approved' then
    raise exception 'Apenas contas aprovadas podem solicitar troca de unidade.';
  end if;
  if not exists (select 1 from public.units where id = p_unit_id) then
    raise exception 'Unidade inválida.';
  end if;
  if exists (select 1 from public.access_requests where user_id = auth.uid() and status = 'pending') then
    raise exception 'Já existe uma solicitação pendente para esta conta.';
  end if;

  insert into public.access_requests (user_id, unit_id, full_name, phone, kind, status)
  values (auth.uid(), p_unit_id, v_profile.full_name, v_profile.phone, 'unit_change', 'pending')
  returning id into v_request_id;

  return v_request_id;
end;
$$;

-- Conta pendente sem solicitação (ex.: unidade inválida no cadastro) ou recusada:
-- (re)envia a solicitação de acesso. Contas revogadas precisam falar com o administrador.
create or replace function public.submit_access_request(p_unit_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  select * into v_profile from public.profiles where id = auth.uid() for update;
  if not found then
    raise exception 'Perfil não encontrado.';
  end if;
  if v_profile.status = 'approved' then
    raise exception 'Sua conta já está aprovada. Para mudar de unidade, use a troca de unidade.';
  end if;
  if v_profile.status = 'revoked' then
    raise exception 'Seu acesso foi revogado. Fale com o administrador.';
  end if;
  if v_profile.full_name is null then
    raise exception 'Informe o nome completo em "Meu perfil" antes de enviar a solicitação.';
  end if;
  if not exists (select 1 from public.units where id = p_unit_id) then
    raise exception 'Unidade inválida.';
  end if;
  if exists (select 1 from public.access_requests where user_id = auth.uid() and status = 'pending') then
    raise exception 'Já existe uma solicitação pendente para esta conta.';
  end if;

  update public.profiles set status = 'pending' where id = auth.uid() and status <> 'pending';

  insert into public.access_requests (user_id, unit_id, full_name, phone, kind, status)
  values (auth.uid(), p_unit_id, v_profile.full_name, v_profile.phone, 'signup', 'pending')
  returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.decide_access_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.access_requests%rowtype;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem decidir solicitações de acesso.';
  end if;

  select * into v_request from public.access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Esta solicitação já foi decidida.';
  end if;

  select status into v_status from public.profiles where id = v_request.user_id for update;
  if v_status is null then
    raise exception 'Perfil do solicitante não encontrado.';
  end if;

  if p_approve then
    if v_request.kind = 'signup' and v_status not in ('pending', 'rejected') then
      raise exception 'A conta está com status "%" e não pode ser aprovada por esta solicitação.', v_status;
    end if;
    if v_request.kind = 'unit_change' and v_status is distinct from 'approved' then
      raise exception 'A conta não está mais aprovada; a troca de unidade não pode ser aprovada.';
    end if;

    update public.profiles set status = 'approved' where id = v_request.user_id;

    update public.unit_members
    set is_active = false, ended_at = now()
    where user_id = v_request.user_id and is_active = true and unit_id <> v_request.unit_id;

    insert into public.unit_members (unit_id, user_id, created_by)
    values (v_request.unit_id, v_request.user_id, auth.uid())
    on conflict (unit_id, user_id) do update set is_active = true, ended_at = null;

    update public.access_requests
    set status = 'approved', decided_at = now(), decided_by = auth.uid(), decision_note = p_note
    where id = p_request_id;
  else
    -- Recusar um cadastro marca a conta como recusada; recusar uma troca de unidade
    -- mantém a conta aprovada na unidade atual.
    if v_request.kind = 'signup' then
      update public.profiles set status = 'rejected' where id = v_request.user_id and status = 'pending';
    end if;

    update public.access_requests
    set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = p_note
    where id = p_request_id;
  end if;
end;
$$;

create or replace function public.revoke_access(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining_admins int;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem revogar acesso.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não pode revogar seu próprio acesso.';
  end if;

  if exists (select 1 from public.user_roles where user_id = p_user_id and role = 'admin') then
    select count(*) into v_remaining_admins
    from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.role = 'admin' and p.status = 'approved' and r.user_id <> p_user_id;

    if v_remaining_admins = 0 then
      raise exception 'Não é possível revogar o último administrador ativo.';
    end if;
  end if;

  update public.profiles set status = 'revoked' where id = p_user_id;
  update public.unit_members set is_active = false, ended_at = now() where user_id = p_user_id and is_active = true;
  -- Evita que uma solicitação antiga, aprovada depois, devolva o acesso.
  update public.access_requests
  set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = 'Acesso revogado.'
  where user_id = p_user_id and status = 'pending';
end;
$$;

-- ============================================================================
-- 6) Responsável pelo veículo
-- ============================================================================
-- A policy de UPDATE não restringe colunas; este trigger impede que um morador
-- atribua o veículo a outra pessoa. Ele pode assumir a responsabilidade para si.
-- Sem auth.uid() (SQL Editor, service role, "on delete set null") não há restrição.
create or replace function public.guard_vehicle_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if new.owner_user_id is distinct from old.owner_user_id
       and new.owner_user_id is distinct from auth.uid()
       and not public.is_admin() then
      raise exception 'Você só pode definir a si mesmo como responsável pelo veículo.';
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists vehicles_guard_owner on public.vehicles;
create trigger vehicles_guard_owner
before update on public.vehicles
for each row execute function public.guard_vehicle_owner();

-- ============================================================================
-- 7) Contatos do veículo: responsável + demais moradores aprovados da unidade
-- ============================================================================
drop function if exists public.get_vehicle_owner_contact(uuid);

create or replace function public.get_vehicle_contacts(p_vehicle_id uuid)
returns table(full_name text, unit_code text, phone text, is_owner boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved') then
    return;
  end if;

  -- Só aparecem moradores com vínculo ativo na unidade do veículo e conta aprovada:
  -- quem foi revogado ou mudou de unidade deixa de ser listado.
  return query
  select p.full_name, u.code,
         case when p.show_phone then p.phone else null end,
         (p.id = v.owner_user_id)
  from public.vehicles v
  join public.units u on u.id = v.unit_id
  join public.unit_members m on m.unit_id = v.unit_id and m.is_active = true
  join public.profiles p on p.id = m.user_id and p.status = 'approved'
  where v.id = p_vehicle_id
  order by (p.id = v.owner_user_id) desc, p.full_name;
end;
$$;

-- ============================================================================
-- Permissões
-- ============================================================================
-- O Supabase concede execute a anon/authenticated por padrão em funções novas do
-- schema public; "from public" sozinho não remove esse grant explícito.
revoke all on function public.normalize_phone(text) from public, anon;
revoke all on function public.update_my_profile(text, text, boolean) from public, anon;
revoke all on function public.request_unit_change(uuid) from public, anon;
revoke all on function public.submit_access_request(uuid) from public, anon;
revoke all on function public.decide_access_request(uuid, boolean, text) from public, anon;
revoke all on function public.revoke_access(uuid) from public, anon;
revoke all on function public.get_vehicle_contacts(uuid) from public, anon;
revoke all on function public.log_row_change() from public, anon, authenticated;
revoke all on function public.guard_vehicle_owner() from public, anon, authenticated;

grant execute on function public.normalize_phone(text) to authenticated;
grant execute on function public.update_my_profile(text, text, boolean) to authenticated;
grant execute on function public.request_unit_change(uuid) to authenticated;
grant execute on function public.submit_access_request(uuid) to authenticated;
grant execute on function public.decide_access_request(uuid, boolean, text) to authenticated;
grant execute on function public.revoke_access(uuid) to authenticated;
grant execute on function public.get_vehicle_contacts(uuid) to authenticated;

-- unit_phone_access e current_phone() são legados (autenticação por telefone) e não
-- são usados por nenhuma policy. Mantidos para preservar o histórico.
comment on table public.unit_phone_access is 'OBSOLETO: autorização por telefone substituída por unit_members. Mantida só como histórico.';
comment on function public.current_phone() is 'OBSOLETO: não usada por nenhuma policy desde a autenticação por e-mail.';
