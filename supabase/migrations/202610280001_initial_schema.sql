-- Initial schema for the 22-unit condominium vehicle registry.
-- Apply in Supabase SQL Editor or with Supabase CLI migrations.
create extension if not exists pgcrypto;

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_code_format check (code ~ '^(10[1-2]|[2-9][0-9]{2}|10[0-9]{2}|11(0[1-2]))$')
);

-- Users are managed by Supabase Auth. A profile is created only after an administrator
-- or a controlled onboarding workflow approves the user's phone number.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.unit_phone_access (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  phone_e164 text not null,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (unit_id, phone_e164),
  constraint phone_e164_format check (left(phone_e164, 1) = '+' and substring(phone_e164 from 2) ~ '^[1-9][0-9]{7,14}$')
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'manager')),
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  plate text not null,
  brand text not null,
  model text not null,
  color text,
  category text not null default 'Carro' check (category in ('Carro','Motocicleta','Utilitário','Outro')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_plate_format check (plate = upper(regexp_replace(plate, '[^A-Z0-9]', '', 'g')) and plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$')
);

create unique index if not exists vehicles_plate_unique on public.vehicles (plate);
create index if not exists vehicles_unit_id_idx on public.vehicles (unit_id);
create index if not exists unit_phone_access_phone_idx on public.unit_phone_access (phone_e164) where is_active;
create index if not exists unit_phone_access_unit_idx on public.unit_phone_access (unit_id) where is_active;

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

-- Generate unit codes 101/102 through 1101/1102.
insert into public.units (code)
select floor_no::text || side
from generate_series(1, 11) as floor_no
cross join (values ('01'), ('02')) as sides(side)
on conflict (code) do nothing;

-- Authorization helpers. SECURITY DEFINER is limited to these read-only checks.
create or replace function public.current_phone()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'phone', '');
$$;

create or replace function public.has_unit_access(target_unit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.unit_phone_access a
    where a.unit_id = target_unit
      and a.phone_e164 = public.current_phone()
      and a.is_active = true
  )
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid()
      and r.role = 'admin'
      and p.is_active = true
  );
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid()
      and r.role in ('admin', 'manager')
      and p.is_active = true
  );
$$;

revoke all on function public.has_unit_access(uuid) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_manager() from public;
grant execute on function public.has_unit_access(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_manager() to authenticated;

alter table public.units enable row level security;
alter table public.profiles enable row level security;
alter table public.unit_phone_access enable row level security;
alter table public.user_roles enable row level security;
alter table public.vehicles enable row level security;
alter table public.audit_log enable row level security;

-- All approved, active users can see unit codes and all vehicle records.
create policy "authenticated users read units"
on public.units for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active));

create policy "users read own profile or admins read all"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

create policy "admins manage profiles"
on public.profiles for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users read own phone links or admins manage"
on public.unit_phone_access for select to authenticated
using (phone_e164 = public.current_phone() or public.is_admin());

create policy "admins manage phone access"
on public.unit_phone_access for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users read own role or admins read roles"
on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "admins manage roles"
on public.user_roles for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "active users can read all vehicles"
on public.vehicles for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active));

create policy "unit members or admins insert vehicles"
on public.vehicles for insert to authenticated
with check (public.is_admin() or public.has_unit_access(unit_id));

create policy "unit members or admins update vehicles"
on public.vehicles for update to authenticated
using (public.is_admin() or public.has_unit_access(unit_id))
with check (public.is_admin() or public.has_unit_access(unit_id));

create policy "unit members or admins delete vehicles"
on public.vehicles for delete to authenticated
using (public.is_admin() or public.has_unit_access(unit_id));

create policy "admins read audit log"
on public.audit_log for select to authenticated
using (public.is_admin());

-- Audit records are written by triggers, not by the client.
create or replace function public.log_vehicle_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_id uuid;
  action_name text;
  actor uuid;
begin
  actor := auth.uid();
  if TG_OP = 'DELETE' then
    record_id := OLD.id;
    action_name := 'delete';
  elsif TG_OP = 'INSERT' then
    record_id := NEW.id;
    action_name := 'insert';
  else
    record_id := NEW.id;
    action_name := 'update';
  end if;

  insert into public.audit_log(actor_user_id, entity_type, entity_id, action, metadata)
  values (actor, 'vehicle', record_id, action_name, jsonb_build_object('source', 'database_trigger'));

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

create trigger vehicles_audit_trigger
after insert or update or delete on public.vehicles
for each row execute function public.log_vehicle_change();

-- Keep updated_at consistent.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger units_updated_at before update on public.units
for each row execute function public.set_updated_at();

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create trigger vehicles_updated_at before update on public.vehicles
for each row execute function public.set_updated_at();

-- IMPORTANT INITIAL ADMIN SETUP:
-- 1) Have the chosen administrator sign in once via the configured Supabase phone OTP.
-- 2) In Supabase SQL Editor, look up their auth.users.id and verify the phone.
-- 3) Insert a profile row and a user_roles row with role='admin'.
-- See README.md. Never grant admin based only on a phone number entered in the browser.
