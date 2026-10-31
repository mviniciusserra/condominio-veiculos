-- Fluxo de autocadastro, aprovação administrativa, perfil editável e contato do
-- proprietário do veículo. Idempotente e não destrutivo: não remove dados nem
-- tabelas existentes. Superset do arquivo 202610290001 (nunca aplicado em produção);
-- não é necessário aplicar aquele arquivo separadamente.
--
-- Já aplicada manualmente no projeto Supabase real em 2026-10-30. Mantida aqui para
-- manter o repositório em sincronia com o banco e permitir reaplicação idempotente
-- (ex.: em um ambiente novo).

-- ============================================================================
-- 1) unit_members: vínculo autorizado usuário (auth.users) <-> unidade
-- ============================================================================
create table if not exists public.unit_members (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  is_active boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (unit_id, user_id)
);

create index if not exists unit_members_user_idx on public.unit_members (user_id) where is_active;
create index if not exists unit_members_unit_idx on public.unit_members (unit_id) where is_active;

alter table public.unit_members enable row level security;

drop policy if exists "users read own unit memberships or admins manage" on public.unit_members;
create policy "users read own unit memberships or admins manage"
on public.unit_members for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admins manage unit memberships" on public.unit_members;
create policy "admins manage unit memberships"
on public.unit_members for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Redefine has_unit_access() para usar unit_members em vez de unit_phone_access.
-- Mesma assinatura: as policies de vehicles que já chamam essa função continuam
-- funcionando sem alteração. unit_phone_access/current_phone() permanecem intactos,
-- só deixam de ser referenciados por qualquer policy.
create or replace function public.has_unit_access(target_unit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.unit_members m
    where m.unit_id = target_unit
      and m.user_id = auth.uid()
      and m.is_active = true
  )
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true
  );
$$;

-- ============================================================================
-- 2) profiles: telefone, preferência de exibição e status de aprovação granular
-- ============================================================================
alter table public.profiles add column if not exists phone_e164 text;
alter table public.profiles add column if not exists show_phone boolean not null default false;
alter table public.profiles add column if not exists status text;

-- Perfis existentes continuam aprovados (preserva o acesso de quem já usa o app hoje).
update public.profiles
set status = case when is_active then 'approved' else 'revoked' end
where status is null;

alter table public.profiles alter column status set not null;
alter table public.profiles alter column status set default 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_status_check
      check (status in ('pending', 'approved', 'rejected', 'revoked'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_phone_e164_format'
  ) then
    alter table public.profiles
      add constraint profiles_phone_e164_format
      check (
        phone_e164 is null
        or (left(phone_e164, 1) = '+' and substring(phone_e164 from 2) ~ '^[1-9][0-9]{7,14}$')
      );
  end if;
end $$;

-- Mantém is_active sincronizado com status, para que is_admin()/is_manager()/
-- has_unit_access() (que checam p.is_active) continuem funcionando sem alteração.
create or replace function public.sync_profile_is_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_active := (new.status = 'approved');
  return new;
end;
$$;

drop trigger if exists profiles_sync_is_active on public.profiles;
create trigger profiles_sync_is_active
before insert or update of status on public.profiles
for each row execute function public.sync_profile_is_active();

-- ============================================================================
-- 3) access_requests: histórico de solicitações de acesso (cadastro e troca de unidade)
-- ============================================================================
create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete restrict,
  full_name text,
  phone_e164 text,
  kind text not null default 'signup' check (kind in ('signup', 'unit_change')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decision_note text
);

create unique index if not exists access_requests_one_pending_per_user
  on public.access_requests (user_id) where status = 'pending';
create index if not exists access_requests_status_idx on public.access_requests (status);

alter table public.access_requests enable row level security;

drop policy if exists "users read own requests or admins read all" on public.access_requests;
create policy "users read own requests or admins read all"
on public.access_requests for select to authenticated
using (user_id = auth.uid() or public.is_admin());

-- Sem policies de insert/update/delete para o papel authenticated: toda mutação
-- passa pelas funções SECURITY DEFINER abaixo, que validam as regras de negócio.

-- ============================================================================
-- 4) units: liberar leitura do código (não sensível) mesmo antes do login,
--    necessário para o formulário de cadastro mostrar a lista de unidades.
-- ============================================================================
drop policy if exists "authenticated users read units" on public.units;
drop policy if exists "anyone can read unit codes" on public.units;
create policy "anyone can read unit codes"
on public.units for select to anon, authenticated
using (true);

-- ============================================================================
-- 5) vehicles: responsável pelo cadastro (owner_user_id)
-- ============================================================================
alter table public.vehicles add column if not exists owner_user_id uuid references auth.users(id) on delete set null;
create index if not exists vehicles_owner_user_id_idx on public.vehicles (owner_user_id);

drop policy if exists "unit members or admins insert vehicles" on public.vehicles;
create policy "unit members or admins insert vehicles"
on public.vehicles for insert to authenticated
with check (
  public.is_admin()
  or (public.has_unit_access(unit_id) and owner_user_id = auth.uid())
);

-- Mantida: edição/exclusão por qualquer morador vinculado à unidade (não só o dono),
-- conforme a regra original de autorização por unidade.
drop policy if exists "unit members or admins update vehicles" on public.vehicles;
create policy "unit members or admins update vehicles"
on public.vehicles for update to authenticated
using (public.is_admin() or public.has_unit_access(unit_id))
with check (public.is_admin() or public.has_unit_access(unit_id));

-- ============================================================================
-- 6) Autocadastro: trigger em auth.users lê metadados do signUp() e cria o
--    perfil pendente + a solicitação de acesso automaticamente.
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
begin
  v_unit_id := nullif(new.raw_user_meta_data ->> 'unit_id', '')::uuid;
  v_full_name := nullif(new.raw_user_meta_data ->> 'full_name', '');
  v_phone := nullif(new.raw_user_meta_data ->> 'phone_e164', '');

  insert into public.profiles (id, full_name, phone_e164, status)
  values (new.id, v_full_name, v_phone, 'pending')
  on conflict (id) do nothing;

  if v_unit_id is not null and exists (select 1 from public.units where id = v_unit_id) then
    insert into public.access_requests (user_id, unit_id, full_name, phone_e164, kind, status)
    values (new.id, v_unit_id, v_full_name, v_phone, 'signup', 'pending');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_signup();

-- ============================================================================
-- 7) RPCs de uso pelo frontend
-- ============================================================================

-- Usuário edita o próprio nome/telefone/preferência, mesmo com status pendente.
-- Não permite alterar status, papel ou vínculo de unidade.
create or replace function public.update_my_profile(p_full_name text, p_phone_e164 text, p_show_phone boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Informe o nome completo.';
  end if;
  if p_phone_e164 is not null and p_phone_e164 <> '' and not (
    left(p_phone_e164, 1) = '+' and substring(p_phone_e164 from 2) ~ '^[1-9][0-9]{7,14}$'
  ) then
    raise exception 'Telefone inválido. Use o formato internacional, ex.: +5511999999999.';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone_e164 = nullif(p_phone_e164, ''),
      show_phone = p_show_phone
  where id = auth.uid();
end;
$$;

-- Morador aprovado solicita troca de unidade (não altera o vínculo até aprovação).
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

  insert into public.access_requests (user_id, unit_id, full_name, phone_e164, kind, status)
  values (auth.uid(), p_unit_id, v_profile.full_name, v_profile.phone_e164, 'unit_change', 'pending')
  returning id into v_request_id;

  return v_request_id;
end;
$$;

-- Admin aprova ou recusa uma solicitação. Em caso de aprovação: encerra o vínculo
-- anterior (se houver outro) e cria o novo vínculo na mesma transação.
create or replace function public.decide_access_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.access_requests%rowtype;
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

  if p_approve then
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
    update public.access_requests
    set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = p_note
    where id = p_request_id;
  end if;
end;
$$;

-- Admin revoga acesso. Bloqueia auto-revogação e revogação do último admin ativo.
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
end;
$$;

-- Contato do proprietário do veículo: só retorna telefone se o próprio dono
-- autorizou a exibição; exige que o solicitante tenha perfil aprovado.
create or replace function public.get_vehicle_owner_contact(p_vehicle_id uuid)
returns table(full_name text, unit_code text, phone_e164 text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved') then
    return;
  end if;

  return query
  select p.full_name, u.code,
         case when p.show_phone then p.phone_e164 else null end
  from public.vehicles v
  join public.units u on u.id = v.unit_id
  join public.profiles p on p.id = v.owner_user_id
  where v.id = p_vehicle_id
    and v.owner_user_id is not null;
end;
$$;

revoke all on function public.update_my_profile(text, text, boolean) from public;
revoke all on function public.request_unit_change(uuid) from public;
revoke all on function public.decide_access_request(uuid, boolean, text) from public;
revoke all on function public.revoke_access(uuid) from public;
revoke all on function public.get_vehicle_owner_contact(uuid) from public;

grant execute on function public.update_my_profile(text, text, boolean) to authenticated;
grant execute on function public.request_unit_change(uuid) to authenticated;
grant execute on function public.decide_access_request(uuid, boolean, text) to authenticated;
grant execute on function public.revoke_access(uuid) to authenticated;
grant execute on function public.get_vehicle_owner_contact(uuid) to authenticated;
