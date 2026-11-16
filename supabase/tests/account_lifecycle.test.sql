begin;
set local search_path = public, extensions;

select plan(67);

select ok(to_regprocedure('public.complete_password_change(uuid,bigint)') is not null, 'server password completion RPC uses a credential version');
select ok(to_regprocedure('public.complete_student_password_recovery(uuid,bigint,text)') is not null, 'server recovery finalization RPC requires a claim token');
select ok(to_regprocedure('public.claim_credential_sync_operation(uuid,text,text)') is not null, 'provider sync operations have an atomic server claim RPC');
select ok(to_regprocedure('public.resolve_credential_sync_operation(uuid,text)') is null, 'unclaimed provider sync resolution is removed');
select ok(to_regprocedure('public.resolve_account_identity(uuid)') is not null, 'private account identity resolution RPC exists');
select has_column('app_private', 'accounts', 'credential_epoch', 'private accounts track credential changes');
select has_column('app_private', 'accounts', 'credential_update_pending', 'private accounts block login while provider recovery is in progress');
select has_table('app_private', 'credential_sync_operations', 'encrypted credential sync intent supports provider retry');
select has_column('app_private', 'credential_sync_operations', 'lease_token_hash', 'provider retries store only a hash of the claim token');
select ok(to_regprocedure('public.prune_expired_credential_sync_operations()') is not null, 'expired encrypted retry payloads have a cleanup RPC');
select has_table('app_private', 'runtime_controls', 'private runtime controls gate local-only staff lifecycle RPCs');
select is((select allow_fictional_account_lifecycle from app_private.runtime_controls where singleton), true, 'local fictional seed enables lifecycle tests');
select ok(to_regprocedure('public.provision_student_account(uuid,text,text)') is not null, 'staff student provisioning RPC exists');
select is(pg_get_function_result('public.provision_student_account(uuid,text,text)'::regprocedure), 'boolean', 'staff provisioning RPC does not return a private account ID');
select ok(to_regprocedure('public.force_password_change_for_account(text,text)') is not null, 'staff recovery RPC accepts only a server-encrypted retry credential');
select ok(has_function_privilege('service_role', 'public.claim_credential_sync_operation(uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_credential_sync_operation(uuid,text,text)', 'execute'),
  'only the server can claim encrypted provider-sync intent');
select ok(not has_table_privilege('authenticated', 'app_private.credential_sync_operations', 'select')
  and not has_table_privilege('service_role', 'app_private.credential_sync_operations', 'select'),
  'provider retry credentials are accessible only through the narrow server RPC');
select ok(has_function_privilege('service_role', 'public.prune_expired_credential_sync_operations()', 'execute')
  and not has_function_privilege('anon', 'public.prune_expired_credential_sync_operations()', 'execute')
  and not has_function_privilege('authenticated', 'public.prune_expired_credential_sync_operations()', 'execute'),
  'only the server can prune expired provider retry records');
select ok(has_function_privilege('service_role', 'public.release_credential_sync_operation(uuid,text,bigint,text)', 'execute')
  and not has_function_privilege('anon', 'public.release_credential_sync_operation(uuid,text,bigint,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.release_credential_sync_operation(uuid,text,bigint,text)', 'execute'),
  'only the server can release a provider-operation claim');
select ok(to_regprocedure('public.suspend_student_account(text)') is not null, 'staff suspension RPC exists');
select ok(has_function_privilege('service_role', 'public.complete_password_change(uuid,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_password_change(uuid,bigint)', 'execute'),
  'only the server can clear mandatory password-change state');
select ok(has_function_privilege('service_role', 'public.complete_student_password_recovery(uuid,bigint,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_student_password_recovery(uuid,bigint,text)', 'execute'),
  'only the server can finish a provider password recovery');
select ok(has_function_privilege('service_role', 'public.resolve_account_identity(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.resolve_account_identity(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.resolve_account_identity(uuid)', 'execute'),
  'private account mappings resolve only inside the server boundary');
select ok(has_function_privilege('authenticated', 'public.provision_student_account(uuid,text,text)', 'execute'), 'staff provisioning RPC is reachable through user JWT authorization and DB gate');
select ok(has_function_privilege('authenticated', 'public.force_password_change_for_account(text,text)', 'execute'), 'staff recovery RPC is reachable through user JWT authorization and DB gate');
select ok(has_function_privilege('authenticated', 'public.suspend_student_account(text)', 'execute'), 'staff suspension RPC is reachable through user JWT authorization and DB gate');
select ok(not has_function_privilege('anon', 'public.provision_student_account(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.force_password_change_for_account(text,text)', 'execute')
  and not has_function_privilege('anon', 'public.suspend_student_account(text)', 'execute'),
  'anonymous visitors cannot invoke account lifecycle RPCs');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('10000000-0000-4000-8000-000000000031', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'forced@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000032', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000033', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fictional@outside.invalid', '', now(), '{}', '{}', now(), now(), false, false);
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
select ok(public.complete_password_change('20000000-0000-4000-8000-000000000031', 0), 'server can complete the password update and revoke prior BFF sessions');
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
select ok(public.force_password_change_for_account('forced.student', repeat('a', 64)), 'AAL2 admin can initiate credential recovery');
select is(public.force_password_change_for_account('forced.student', repeat('b', 64)), true, 'a retry can resume the same provider recovery operation');
reset role;
set local role service_role;
select is((select count(*)::integer from public.claim_credential_sync_operation(
  '20000000-0000-4000-8000-000000000031', 'student_password_recovery', repeat('a', 64)
)), 1, 'first provider recovery request atomically claims the operation');
select is((select count(*)::integer from public.claim_credential_sync_operation(
  '20000000-0000-4000-8000-000000000031', 'student_password_recovery', repeat('b', 64)
)), 0, 'overlapping provider recovery request cannot claim the active operation');
select is((select count(*)::integer from public.claim_credential_sync_operation(
  '20000000-0000-4000-8000-000000000031', 'student_password_recovery', null
)), 0, 'malformed provider claim token fails closed without updating operation state');
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000032', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000032","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(public.force_password_change_for_account('forced.student', repeat('c', 64)), true, 'recovery retry during provider sync reuses the active generation');
reset role;
select is((select credential_epoch from app_private.accounts where id = '20000000-0000-4000-8000-000000000031'), 2::bigint, 'recovery retry preserves its credential generation');
select is((select password_jwe from app_private.credential_sync_operations where account_id = '20000000-0000-4000-8000-000000000031'), repeat('a', 64), 'recovery retry reuses the original encrypted temporary password');
select ok((select force_password_change from app_private.accounts where id = '20000000-0000-4000-8000-000000000031'), 'recovery sets mandatory password change');
select ok((select credential_update_pending from app_private.accounts where id = '20000000-0000-4000-8000-000000000031'), 'recovery blocks sign-in until the provider reset finishes');
reset role;
update app_private.credential_sync_operations
set created_at = now() - interval '2 minutes', expires_at = now() - interval '1 second'
where account_id = '20000000-0000-4000-8000-000000000031' and operation_kind = 'student_password_recovery';
set local role service_role;
select is((select count(*)::integer from public.claim_credential_sync_operation(
  '20000000-0000-4000-8000-000000000031', 'student_password_recovery', repeat('c', 64)
)), 0, 'a held provider claim cannot be reclaimed by an overlapping operation');
select is(public.prune_expired_credential_sync_operations(), 0, 'cleanup preserves an expired retry payload while its provider claim is held');
reset role;
update app_private.credential_sync_operations
set expires_at = now() + interval '10 minutes'
where account_id = '20000000-0000-4000-8000-000000000031' and operation_kind = 'student_password_recovery';
set local role service_role;
select is(public.release_credential_sync_operation(
  '20000000-0000-4000-8000-000000000031', 'student_password_recovery', 2, repeat('b', 64)
), false, 'a mismatched provider claim token cannot release the operation');
select is(public.release_credential_sync_operation(
  '20000000-0000-4000-8000-000000000031', 'student_password_recovery', 2, repeat('a', 64)
), true, 'server can release the exact claim after receiving a provider response');
select is((select count(*)::integer from public.claim_credential_sync_operation(
  '20000000-0000-4000-8000-000000000031', 'student_password_recovery', repeat('c', 64)
)), 1, 'a later operation can claim only after explicit release of the prior request');
select is(public.complete_password_change('20000000-0000-4000-8000-000000000031', 1), false, 'stale password completion cannot clear a newer staff recovery');
select is(public.complete_password_change('20000000-0000-4000-8000-000000000031', 2), false, 'password completion cannot clear an active provider recovery');
select is(public.complete_student_password_recovery('20000000-0000-4000-8000-000000000031', 2, repeat('b', 64)), false, 'a different claim token cannot finalize provider recovery');
select ok(public.complete_student_password_recovery('20000000-0000-4000-8000-000000000031', 2, repeat('c', 64)), 'server finalizes only the matching provider recovery claim');
select is(public.complete_student_password_recovery('20000000-0000-4000-8000-000000000031', 2, repeat('c', 64)), false, 'a completed claim cannot be replayed');
reset role;
select is((select password_jwe from app_private.credential_sync_operations where account_id = '20000000-0000-4000-8000-000000000031'), null, 'successful provider sync erases the encrypted temporary password');
select is((select credential_update_pending from app_private.accounts where id = '20000000-0000-4000-8000-000000000031'), false, 'provider recovery completion reopens the forced password-change flow');
select ok((select force_password_change from app_private.accounts where id = '20000000-0000-4000-8000-000000000031'), 'stale completion leaves the recovery password-change gate active');
update app_private.credential_sync_operations
set credential_epoch = 3, password_jwe = repeat('d', 64), completed_at = null,
  created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
where account_id = '20000000-0000-4000-8000-000000000031' and operation_kind = 'student_password_recovery';
set local role service_role;
select is(public.prune_expired_credential_sync_operations(), 1, 'expired recovery payload is deleted by the server cleanup RPC');
reset role;
select is((select count(*)::integer from app_private.credential_sync_operations where account_id = '20000000-0000-4000-8000-000000000031'), 0, 'expired encrypted recovery payload is removed from the private table');

update app_private.runtime_controls set allow_fictional_account_lifecycle = false where singleton;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000032', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000032","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.provision_student_account('10000000-0000-4000-8000-000000000099', 'disabled.student', 'disabled@academic-arena.test')$$,
  '42501', null, 'direct authenticated provisioning RPC is blocked when the local-only database gate is off'
);
select throws_ok($$select public.force_password_change_for_account('forced.student', repeat('c', 64))$$, '42501', null, 'direct authenticated recovery RPC is blocked when the local-only database gate is off');
select throws_ok($$select public.suspend_student_account('forced.student')$$, '42501', null, 'direct authenticated suspension RPC is blocked when the local-only database gate is off');
reset role;
update app_private.runtime_controls set allow_fictional_account_lifecycle = true where singleton;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000031', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000031","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::integer from public.student_avatar_configs), 0, 'recovered account loses protected data access until password changes');
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000032', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000032","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.provision_student_account('10000000-0000-4000-8000-000000000033', 'outside.email', 'fictional@outside.invalid')$$,
  '22023', null, 'database provisioning rejects non-fictional provider email domains even when called directly'
);
select ok(public.suspend_student_account('forced.student'), 'AAL2 admin can suspend an account');
reset role;
select is((select status from app_private.accounts where id = '20000000-0000-4000-8000-000000000031'), 'suspended', 'suspension state is committed in the private account record');
select is((select count(*)::integer from app_private.audit_events where target_account_id = '20000000-0000-4000-8000-000000000031'), 4, 'password change, recovery, recovery completion, and suspension are audited');
reset role;

select * from finish();
rollback;
