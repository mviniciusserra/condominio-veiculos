-- Testes de RLS e das RPCs de acesso (pgTAP). Rodar com: supabase test db
-- Tudo roda dentro de uma transação desfeita no final; nenhum dado permanece.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ---------------------------------------------------------------------------
-- Cenário
--   a1: administrador
--   r1, r2: moradores aprovados da unidade 101 (r1 autoriza exibir telefone)
--   r3: morador aprovado da unidade 201
--   p1: cadastro pendente para a unidade 301
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@teste.test',
   jsonb_build_object('full_name', 'Admin', 'unit_id', (select id from public.units where code = '1101'))),
  ('00000000-0000-0000-0000-0000000000b1', 'r1@teste.test',
   jsonb_build_object('full_name', 'Morador 1', 'phone', '+55 (11) 98888-7777', 'show_phone', true,
                      'unit_id', (select id from public.units where code = '101'))),
  ('00000000-0000-0000-0000-0000000000b2', 'r2@teste.test',
   jsonb_build_object('full_name', 'Morador 2', 'phone', '21977776666',
                      'unit_id', (select id from public.units where code = '101'))),
  ('00000000-0000-0000-0000-0000000000b3', 'r3@teste.test',
   jsonb_build_object('full_name', 'Morador 3', 'unit_id', (select id from public.units where code = '201'))),
  ('00000000-0000-0000-0000-0000000000c1', 'p1@teste.test',
   jsonb_build_object('full_name', 'Pendente', 'unit_id', (select id from public.units where code = '301')));

select is(
  (select phone from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  '11988887777',
  'cadastro normaliza o telefone para DDD + número'
);
select is(
  (select show_phone from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  false,
  'sem consentimento no cadastro, o telefone não é exibido'
);

-- Aprovação manual (como o administrador faria no SQL Editor).
update public.profiles set status = 'approved'
where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
             '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3');
update public.access_requests set status = 'approved', decided_at = now()
where user_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
                  '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin');
insert into public.unit_members (unit_id, user_id)
select id, '00000000-0000-0000-0000-0000000000b1' from public.units where code = '101'
union all
select id, '00000000-0000-0000-0000-0000000000b2' from public.units where code = '101'
union all
select id, '00000000-0000-0000-0000-0000000000b3' from public.units where code = '201';

insert into public.vehicles (unit_id, owner_user_id, plate, brand, model)
select id, '00000000-0000-0000-0000-0000000000b1', 'ABC1D23', 'Fiat', 'Uno' from public.units where code = '101';

-- is_active é sempre derivado de status, mesmo num update direto.
update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select is_active from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  false,
  'is_active não fica true enquanto o status for pending'
);

-- ---------------------------------------------------------------------------
-- Pendente
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select is((select count(*)::int from public.vehicles), 0, 'pendente não vê veículos');
select is((select count(*)::int from public.get_vehicle_contacts((select id from public.vehicles limit 1))), 0,
          'pendente não recebe contatos');

-- ---------------------------------------------------------------------------
-- Morador de outra unidade
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';

select is((select count(*)::int from public.vehicles), 1, 'aprovado vê veículos de todas as unidades');

with changed as (update public.vehicles set notes = 'x' where plate = 'ABC1D23' returning 1)
select is((select count(*)::int from changed), 0, 'morador de outra unidade não edita o veículo');

with removed as (delete from public.vehicles where plate = 'ABC1D23' returning 1)
select is((select count(*)::int from removed), 0, 'morador de outra unidade não exclui o veículo');

with changed as (update public.profiles set status = 'approved' where id = '00000000-0000-0000-0000-0000000000c1' returning 1)
select is((select count(*)::int from changed), 0, 'morador não altera perfil de outra pessoa');

-- ---------------------------------------------------------------------------
-- Responsável pelo veículo
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select throws_ok(
  $$ update public.vehicles set owner_user_id = '00000000-0000-0000-0000-0000000000b3' where plate = 'ABC1D23' $$,
  'P0001', null,
  'morador não atribui o veículo a outra pessoa'
);
select lives_ok(
  $$ update public.vehicles set owner_user_id = '00000000-0000-0000-0000-0000000000b2' where plate = 'ABC1D23' $$,
  'morador da unidade pode assumir o veículo para si'
);

-- ---------------------------------------------------------------------------
-- Contatos: responsável primeiro, depois os demais moradores da unidade
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';

select is(
  (select count(*)::int from public.get_vehicle_contacts((select id from public.vehicles where plate = 'ABC1D23'))),
  2, 'lista os dois moradores da unidade 101'
);
select is(
  (select full_name from public.get_vehicle_contacts((select id from public.vehicles where plate = 'ABC1D23')) limit 1),
  'Morador 2', 'o responsável vem primeiro'
);
select is(
  (select phone from public.get_vehicle_contacts((select id from public.vehicles where plate = 'ABC1D23')) where is_owner),
  null, 'telefone sem consentimento não é exibido'
);
select is(
  (select phone from public.get_vehicle_contacts((select id from public.vehicles where plate = 'ABC1D23')) where not is_owner),
  '11988887777', 'telefone com consentimento é exibido'
);

-- ---------------------------------------------------------------------------
-- Recusa e reenvio
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select public.decide_access_request(
       (select id from public.access_requests where user_id = '00000000-0000-0000-0000-0000000000c1' and status = 'pending'),
       false, 'Unidade errada') $$,
  'admin recusa o cadastro'
);

reset role;
select is((select status from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'rejected',
          'recusar o cadastro marca a conta como recusada');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok(
  $$ select public.submit_access_request((select id from public.units where code = '302')) $$,
  'conta recusada pode reenviar a solicitação'
);

reset role;
select is((select status from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'pending',
          'reenvio volta a conta para pendente');

-- ---------------------------------------------------------------------------
-- Revogação cancela solicitações pendentes
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select public.request_unit_change((select id from public.units where code = '202'));

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.revoke_access('00000000-0000-0000-0000-0000000000b3');

select throws_ok(
  $$ select public.decide_access_request(
       (select id from public.access_requests where user_id = '00000000-0000-0000-0000-0000000000b3' and kind = 'unit_change'),
       true) $$,
  'P0001', 'Esta solicitação já foi decidida.',
  'solicitação antiga não devolve o acesso de quem foi revogado'
);

reset role;
select is((select status from public.profiles where id = '00000000-0000-0000-0000-0000000000b3'), 'revoked',
          'conta revogada continua revogada');

select ok(
  (select count(*) from public.audit_log where entity_type = 'access_request') > 0,
  'decisões de acesso ficam no audit_log'
);

select * from finish();
rollback;
