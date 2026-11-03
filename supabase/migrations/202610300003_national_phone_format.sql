-- Troca o formato de telefone exigido de internacional (+55...) para nacional
-- (DDD + número, só dígitos), já que todos os moradores são do Brasil. O link do
-- WhatsApp (wa.me) passa a prefixar "55" no frontend.

-- Normaliza valores já gravados no formato antigo (+55DDDNÚMERO ou +DDDNÚMERO)
-- para o novo formato (só dígitos, sem DDI), antes de trocar a constraint.
update public.profiles
set phone_e164 = regexp_replace(phone_e164, '\D', '', 'g')
where phone_e164 is not null;

update public.profiles
set phone_e164 = substring(phone_e164 from 3)
where phone_e164 is not null
  and length(phone_e164) > 11
  and left(phone_e164, 2) = '55';

alter table public.profiles drop constraint if exists profiles_phone_e164_format;
alter table public.profiles
  add constraint profiles_phone_e164_format
  check (phone_e164 is null or phone_e164 ~ '^[1-9]{2}[0-9]{8,9}$');

-- Mesma normalização e validação dentro da RPC usada pelo frontend para editar o perfil.
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
  if p_phone_e164 is not null and p_phone_e164 <> '' and p_phone_e164 !~ '^[1-9]{2}[0-9]{8,9}$' then
    raise exception 'Telefone inválido. Informe DDD + número, ex.: 11988887777.';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone_e164 = nullif(p_phone_e164, ''),
      show_phone = p_show_phone
  where id = auth.uid();
end;
$$;
