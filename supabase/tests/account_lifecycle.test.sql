begin;
set local search_path = public, extensions;

select plan(24);

select ok(to_regprocedure('public.complete_password_change(uuid)') is not null, 'server password completion RPC exists');
select ok(to_regprocedure('public.resolve_account_identity(uuid)') is not null, 'private account identity resolution RPC exists');
select ok(to_regprocedure('public.provision_student_account(uuid,text,text)') is not null, 'staff student provisioning RPC exists');
select ok(to_regprocedure('public.force_password_change_for_account(text)') is not null, 'staff recovery RPC exists');
select ok(to_regprocedure('public.suspend_student_account(text)') is not null, 'staff suspension RPC exists');
select ok(has_function_privilege('service_role', 'public.complete_password_change(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_password_change(uuid)', 'execute'),
  'only the server can clear mandatory password-change state');
select ok(has_function_privilege('service_role', 'public.resolve_account_identity(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.resolve_account_identity(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.resolve_account_identity(uuid)', 'execute'),
  'private account mappings resolve only inside the server boundary');
select ok(has_function_privilege('authenticated', 'public.provision_student_account(uuid,text,text)', 'execute'), 'staff provisioning RPC is reachable through user JWT authorization');
select ok(has_function_privilege('authenticated', 'public.force_password_change_for_account(text)', 'execute'), 'staff recovery RPC is reachable through user JWT authorization');
select ok(has_function_privilege('authenticated', 'public.suspend_student_account(text)', 'execute'), 'staff suspension RPC is reachable through user JWT authorization');
select ok(not has_function_privilege('anon', 'public.provision_student_account(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.force_password_change_for_account(text)', 'execute')
  and not has_function_privilege('anon', 'public.suspend_student_account(text)', 'execute'),
  'anonymous visitors cannot invoke account lifecycle RPCs');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('10000000-0000-4000-8000-000000000031', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'forced@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000032', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false);
insert into app_private.accounts (id, provider_user_id, status, force_password_change) values
  ('20000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000031', 'active', true),
  ('20000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000032', 'active', false);
insert into app_private.identity_mappings (account_id, username_normalized, provider_email) values
  ('20000000-0000-4000-8000-000000000031', 'forced.student', 'forced@academic-arena.test');
insert into app_private.account_role_grants (account_id, role_name) values
  ('20000000-0000-4000-8000-000000000031', 'student'),
  ('20000000-0000-4000-8000-000000000032', 'admin');
insert into public.student_avatar_configs (account_id, character_key, family, tone, badge)
values ('20000000-0000-4000-8000-000000000031', 'amara', 'ink', 'mint', '✦');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000031', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000031","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::integer from public.student_avatar_configs), 0, 'forced-change student cannot read account-owned data');
select throws_ok(
  $$insert into public.student_avatar_configs (character_key, family, tone, badge) values ('omar', 'ink', 'coral', '⚡')$$,
  '42501', null, 'forced-change student cannot write account-owned data'
);
reset role;
set local role service_role;
select ok(public.complete_password_change('20000000-0000-4000-8000-000000000031'), 'server can complete the password update and revoke prior BFF sessions');
reset role;
set local role authenticated;
select is((select count(*)::integer from public.student_avatar_configs), 1, 'account-owned data becomes available after password completion');
select throws_ok($$select public.suspend_student_account('forced.student')$$, '42501', null, 'student cannot suspend an account');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000031","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.provision_student_account('10000000-0000-4000-8000-000000000099', 'forged.student', 'forged@academic-arena.test')$$,
  '42501', null, 'student cannot gain account-provisioning permission even with an AAL2 claim'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000032', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000032","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.suspend_student_account('forced.student')$$, '42501', null, 'staff at AAL1 cannot suspend accounts');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000032","role":"authenticated","aal":"aal2"}', true);
select ok(public.force_password_change_for_account('forced.student'), 'AAL2 admin can initiate credential recovery');
reset role;
select ok((select force_password_change from app_private.accounts where id = '20000000-0000-4000-8000-000000000031'), 'recovery sets mandatory password change');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000031', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000031","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::integer from public.student_avatar_configs), 0, 'recovered account loses protected data access until password changes');
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000032', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000032","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(public.suspend_student_account('forced.student'), 'AAL2 admin can suspend an account');
reset role;
select is((select status from app_private.accounts where id = '20000000-0000-4000-8000-000000000031'), 'suspended', 'suspension state is committed in the private account record');
select is((select count(*)::integer from app_private.audit_events where target_account_id = '20000000-0000-4000-8000-000000000031'), 3, 'password change, recovery, and suspension are audited');
reset role;

select * from finish();
rollback;
