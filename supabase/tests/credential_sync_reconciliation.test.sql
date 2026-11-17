begin;
set local search_path = public, extensions;

select plan(42);

-- Operator functions are unreachable from every API role.
select ok(not has_function_privilege('anon', 'app_private.operator_bootstrap_initial_admin(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.operator_bootstrap_initial_admin(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.operator_bootstrap_initial_admin(uuid,text)', 'execute'),
  'admin bootstrap is executable only by the database owner');
select ok(not has_function_privilege('anon', 'app_private.operator_release_stuck_credential_sync(text,text)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.operator_release_stuck_credential_sync(text,text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.operator_release_stuck_credential_sync(text,text)', 'execute'),
  'stuck-claim release is executable only by the database owner');
select ok(not has_function_privilege('anon', 'app_private.operator_lock_staff_for_mfa_recovery(text)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.operator_lock_staff_for_mfa_recovery(text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.operator_lock_staff_for_mfa_recovery(text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.operator_finish_staff_mfa_recovery(text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.operator_finish_staff_mfa_recovery(text,bigint)', 'execute'),
  'break-glass lock/finish is executable only by the database owner');
select is((select count(*)::integer from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
  where ns.nspname = 'app_private' and proc.proname like 'operator\_%'
    and proc.prosrc ~* '(insert\s+into|update|delete\s+from)\s+auth\.'), 0,
  'operator functions never write provider-managed auth tables');
select is((select count(*)::integer from cron.job
  where jobname = 'academic-arena-prune-credential-sync' and command like '%prune_expired_credential_sync_operations%'), 1,
  'expired encrypted payloads are pruned by a database schedule');
select has_column('app_private', 'credential_sync_operations', 'leased_at', 'provider claims record when they were taken');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('10000000-0000-4000-8000-000000000071', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Boot.Admin@academic-arena.test', 'unchanged', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000072', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'second.admin@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000073', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stuck@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000074', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stuck.staff@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false);

-- Initial administrator bootstrap.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('30000000-0000-4000-8000-000000000070', '10000000-0000-4000-8000-000000000071', 'preexisting', 'totp', 'verified', now(), now(), 'fictional');
select throws_ok($$select app_private.operator_bootstrap_initial_admin('10000000-0000-4000-8000-000000000071', 'boot.admin')$$,
  '22023', null, 'bootstrap refuses a provider user that already enrolled an MFA factor');
delete from auth.mfa_factors where id = '30000000-0000-4000-8000-000000000070';
update auth.users set banned_until = now() + interval '1 day' where id = '10000000-0000-4000-8000-000000000071';
select throws_ok($$select app_private.operator_bootstrap_initial_admin('10000000-0000-4000-8000-000000000071', 'boot.admin')$$,
  '22023', null, 'bootstrap refuses a banned provider user');
update auth.users set banned_until = null where id = '10000000-0000-4000-8000-000000000071';
select ok(app_private.operator_bootstrap_initial_admin('10000000-0000-4000-8000-000000000071', ' Boot.Admin '),
  'database owner can bootstrap the first administrator');
select is((select mapping.provider_email from app_private.identity_mappings as mapping
  join app_private.accounts as account on account.id = mapping.account_id
  where account.provider_user_id = '10000000-0000-4000-8000-000000000071'),
  'boot.admin@academic-arena.test', 'bootstrap maps the provider email from Auth, not caller input');
select ok((select account.force_password_change from app_private.accounts as account
  where account.provider_user_id = '10000000-0000-4000-8000-000000000071'),
  'bootstrapped administrator must change the password before privileged use');
select is((select pg_catalog.array_agg(grant_row.role_name) from app_private.account_role_grants as grant_row
  join app_private.accounts as account on account.id = grant_row.account_id
  where account.provider_user_id = '10000000-0000-4000-8000-000000000071'), array['admin'],
  'bootstrap grants only the administrator role');
select throws_ok($$select app_private.operator_bootstrap_initial_admin('10000000-0000-4000-8000-000000000072', 'second.admin')$$,
  '42501', null, 'bootstrap refuses once an active administrator exists');
select is((select count(*)::integer from app_private.audit_events where action_key = 'staff.admin_bootstrapped'), 1,
  'administrator bootstrap is audited');

-- Fixtures for held-claim and break-glass behaviour.
update app_private.accounts set force_password_change = false
where provider_user_id = '10000000-0000-4000-8000-000000000071';
insert into app_private.accounts (id, provider_user_id, status, force_password_change) values
  ('20000000-0000-4000-8000-000000000073', '10000000-0000-4000-8000-000000000073', 'active', false),
  ('20000000-0000-4000-8000-000000000074', '10000000-0000-4000-8000-000000000074', 'active', false);
insert into app_private.identity_mappings (account_id, username_normalized, provider_email) values
  ('20000000-0000-4000-8000-000000000073', 'stuck.student', 'stuck@academic-arena.test'),
  ('20000000-0000-4000-8000-000000000074', 'stuck.staff', 'stuck.staff@academic-arena.test');
insert into app_private.account_role_grants (account_id, role_name) values
  ('20000000-0000-4000-8000-000000000073', 'student'),
  ('20000000-0000-4000-8000-000000000074', 'moderator');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000071', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(public.force_password_change_for_account('stuck.student', repeat('a', 64)), 'admin starts a student recovery');
reset role;
set local role service_role;
select is((select count(*)::integer from public.claim_credential_sync_operation(
  '20000000-0000-4000-8000-000000000073', 'student_password_recovery', repeat('1', 64))), 1,
  'a provider request claims the recovery');
reset role;
select ok((select leased_at is not null from app_private.credential_sync_operations
  where account_id = '20000000-0000-4000-8000-000000000073'), 'the database stamps the claim time');

-- A held claim stays fail-closed no matter how much time has passed.
update app_private.credential_sync_operations
set created_at = now() - interval '3 days', expires_at = now() - interval '2 days 23 hours',
    leased_at = now() - interval '3 days'
where account_id = '20000000-0000-4000-8000-000000000073';
set local role authenticated;
select ok(public.force_password_change_for_account('stuck.student', repeat('b', 64)), 'staff retry on a held claim reports pending');
reset role;
select is((select credential_epoch from app_private.accounts where id = '20000000-0000-4000-8000-000000000073'), 1::bigint,
  'elapsed time never lets a new credential generation race a held provider claim');
select ok((select credential_update_pending and force_password_change from app_private.accounts
  where id = '20000000-0000-4000-8000-000000000073'), 'the account stays blocked while the claim is held');
set local role service_role;
select is((select count(*)::integer from public.claim_credential_sync_operation(
  '20000000-0000-4000-8000-000000000073', 'student_password_recovery', repeat('2', 64))), 0,
  'an old held claim cannot be taken over by a later request');

-- Retention: an expired held payload is erased, but the blocking row remains.
select is(public.prune_expired_credential_sync_operations(), 1, 'cleanup erases the expired payload of a held claim');
reset role;
select is((select row(password_jwe is null, lease_token_hash is not null)::text from app_private.credential_sync_operations
  where account_id = '20000000-0000-4000-8000-000000000073'), row(true, true)::text,
  'the held claim still blocks after its encrypted payload is erased');

-- Explicit operator release.
select throws_ok($$select app_private.operator_release_stuck_credential_sync('stuck.staff', 'staff_mfa_reset')$$,
  '22023', null, 'operator release refuses when no claim is held');
select throws_ok($$select app_private.operator_release_stuck_credential_sync('stuck.student', 'bogus')$$,
  '22023', null, 'operator release rejects unknown operation kinds');
select ok(app_private.operator_release_stuck_credential_sync(' Stuck.Student ', 'student_password_recovery'),
  'database owner can release a held claim');
select is((select count(*)::integer from app_private.credential_sync_operations
  where account_id = '20000000-0000-4000-8000-000000000073'), 0, 'release destroys the stale payload and claim');
select ok((select credential_update_pending and force_password_change from app_private.accounts
  where id = '20000000-0000-4000-8000-000000000073'), 'release alone does not unblock the account');
set local role service_role;
select is(public.release_credential_sync_operation('20000000-0000-4000-8000-000000000073', 'student_password_recovery', null, repeat('1', 64)),
  false, 'the original holder cannot act after an operator release');
select is(public.complete_student_password_recovery('20000000-0000-4000-8000-000000000073', 1, repeat('1', 64)),
  false, 'the original holder cannot finalize after an operator release');
reset role;
set local role authenticated;
select ok(public.force_password_change_for_account('stuck.student', repeat('c', 64)), 'staff then start a fresh recovery');
reset role;
select is((select row(credential_epoch, (select password_jwe from app_private.credential_sync_operations
  where account_id = '20000000-0000-4000-8000-000000000073'))::text
  from app_private.accounts where id = '20000000-0000-4000-8000-000000000073'),
  row(2::bigint, repeat('c', 64))::text, 'the fresh recovery is a new credential generation with a new payload');
select is((select count(*)::integer from app_private.audit_events
  where target_account_id = '20000000-0000-4000-8000-000000000073' and action_key = 'account.credential_sync_operator_released'), 1,
  'operator release is audited');

-- Break-glass staff MFA recovery: application state only.
select is(app_private.operator_lock_staff_for_mfa_recovery('stuck.staff'), 1::bigint, 'operator locks the staff account first');
select ok((select force_password_change and credential_update_pending from app_private.accounts
  where id = '20000000-0000-4000-8000-000000000074'), 'locked staff account cannot sign in or use data');
select throws_ok($$select app_private.operator_finish_staff_mfa_recovery('stuck.staff', 0)$$, '22023', null,
  'finish requires the epoch returned by the lock step');
select ok(app_private.operator_finish_staff_mfa_recovery('stuck.staff', 1), 'operator finishes after provider-side steps');
select ok((select force_password_change and not credential_update_pending from app_private.accounts
  where id = '20000000-0000-4000-8000-000000000074'), 'finished recovery still forces a password change');
select throws_ok($$select app_private.operator_finish_staff_mfa_recovery('stuck.staff', 1)$$, '22023', null,
  'finish cannot be replayed');
select throws_ok($$select app_private.operator_lock_staff_for_mfa_recovery('stuck.student')$$, '22023', null,
  'break-glass applies only to staff accounts');
select is((select encrypted_password from auth.users where id = '10000000-0000-4000-8000-000000000071'), 'unchanged',
  'operator functions leave provider credentials to the Auth Admin API');
select is((select count(*)::integer from app_private.audit_events
  where target_account_id = '20000000-0000-4000-8000-000000000074' and action_key like 'staff.mfa_operator_recovery_%'), 2,
  'break-glass start and finish are audited');

select * from finish();
rollback;
