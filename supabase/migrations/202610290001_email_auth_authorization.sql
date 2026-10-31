-- Adds email-based unit authorization to replace phone-based access control.
-- Non-destructive: does not drop unit_phone_access, current_phone(), or any data/policies.
-- Apply in Supabase SQL Editor or with Supabase CLI migrations, after the initial schema.

-- Authentication no longer uses phone/SMS; auth.jwt()->>'phone' is empty for email users,
-- so has_unit_access() (which relied on current_phone()) would always return false.
-- This introduces a user_id-based membership table and redefines has_unit_access()
-- to use it, keeping the same function signature so existing RLS policies on
-- public.vehicles continue to work unchanged.

create table if not exists public.unit_members (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (unit_id, user_id)
);

create index if not exists unit_members_user_idx on public.unit_members (user_id) where is_active;
create index if not exists unit_members_unit_idx on public.unit_members (unit_id) where is_active;

alter table public.unit_members enable row level security;

create policy "users read own unit memberships or admins manage"
on public.unit_members for select to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "admins manage unit memberships"
on public.unit_members for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Redefine has_unit_access() to check unit_members(user_id) instead of
-- unit_phone_access(phone_e164). Same signature as before, so the policies
-- "unit members or admins insert/update/delete vehicles" need no changes.
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

-- Lets an admin resolve a user's UUID by email without granting direct access
-- to auth.users, so unit_members rows can be created safely from the SQL Editor.
create or replace function public.admin_lookup_user_by_email(target_email text)
returns table(id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email
  from auth.users u
  where public.is_admin() and lower(u.email) = lower(target_email)
  limit 1;
$$;

revoke all on function public.admin_lookup_user_by_email(text) from public;
grant execute on function public.admin_lookup_user_by_email(text) to authenticated;

-- unit_phone_access and current_phone() are intentionally left in place
-- (unused, harmless) for backward compatibility and audit history.
-- They are no longer referenced by any policy after this migration.
