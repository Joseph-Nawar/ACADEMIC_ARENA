begin;
set local search_path = public, extensions;

select plan(35);

-- Operator functions are unreachable from every API role.
select ok(not has_function_privilege('anon', 'app_private.operator_bootstrap_initial_admin(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.operator_bootstrap_initial_admin(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.operator_bootstrap_initial_admin(uuid,text)', 'execute'),
  'admin bootstrap is executable only by the database owner');
select ok(not has_function_privilege('anon', 'app_private.operator_recover_staff_mfa(text)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.operator_recover_staff_mfa(text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.operator_recover_staff_mfa(text)', 'execute'),
  'break-glass staff MFA recovery is executable only by the database owner');
select has_column('app_private', 'credential_sync_operations', 'leased_at', 'provider claims record when they were taken');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('10000000-0000-4000-8000-000000000071', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Boot.Admin@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
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

-- Fixtures for reconciliation and break-glass recovery.
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
select ok(public.reset_staff_mfa_for_account('stuck.staff'), 'admin starts a staff MFA reset');
reset role;
set local role service_role;
select is((select count(*)::integer from public.claim_credential_sync_operation(
  '20000000-0000-4000-8000-000000000073', 'student_password_recovery', repeat('1', 64))), 1,
  'a provider request claims the recovery');
select is((select count(*)::integer from public.claim_credential_sync_operation(
  '20000000-0000-4000-8000-000000000074', 'staff_mfa_reset', repeat('2', 64))), 1,
  'a provider request claims the MFA reset');
reset role;
select ok((select leased_at is not null from app_private.credential_sync_operations
  where account_id = '20000000-0000-4000-8000-000000000073'), 'the database stamps the claim time');

-- A recent ambiguous claim still blocks a new generation.
set local role authenticated;
select ok(public.force_password_change_for_account('stuck.student', repeat('b', 64)), 'retry during a fresh claim reports pending');
reset role;
select is((select credential_epoch from app_private.accounts where id = '20000000-0000-4000-8000-000000000073'), 1::bigint,
  'a fresh unresolved claim cannot be raced by a new credential generation');
select is((select password_jwe from app_private.credential_sync_operations where account_id = '20000000-0000-4000-8000-000000000073'),
  repeat('a', 64), 'the in-flight encrypted credential is preserved');

-- Age both claims past expiry but inside the quiescence window: still blocked and retained.
update app_private.credential_sync_operations
set created_at = now() - interval '20 minutes', expires_at = now() - interval '1 minute', leased_at = now() - interval '14 minutes';
select is((select leased_at > now() - interval '1 minute' from app_private.credential_sync_operations
  where account_id = '20000000-0000-4000-8000-000000000073'), false,
  'test fixture can age a claim without changing its token');
set local role service_role;
select is(public.prune_expired_credential_sync_operations(), 0, 'cleanup keeps payloads whose claim may still resolve');
reset role;

-- Past the quiescence window: explicit staff retry reconciles the student; cleanup removes the staff row.
update app_private.credential_sync_operations set leased_at = now() - interval '16 minutes';
set local role authenticated;
select ok(public.force_password_change_for_account('stuck.student', repeat('c', 64)), 'staff retry after the quiescence window reconciles');
reset role;
select is((select credential_epoch from app_private.accounts where id = '20000000-0000-4000-8000-000000000073'), 2::bigint,
  'reconciliation starts a new credential generation');
select is((select row(password_jwe, lease_token_hash, leased_at)::text from app_private.credential_sync_operations
  where account_id = '20000000-0000-4000-8000-000000000073'), row(repeat('c', 64), null::bytea, null::timestamptz)::text,
  'reconciliation replaces the stale payload and clears the stale claim');
select is((select count(*)::integer from app_private.audit_events
  where target_account_id = '20000000-0000-4000-8000-000000000073' and action_key = 'account.credential_sync_reconciled'), 1,
  'reconciliation is audited');
set local role service_role;
select is(public.release_credential_sync_operation('20000000-0000-4000-8000-000000000073', 'student_password_recovery', null, repeat('1', 64)),
  false, 'the superseded claim token cannot release the new generation');
select is(public.prune_expired_credential_sync_operations(), 1, 'cleanup removes an expired payload once its claim is stale');
reset role;
select is((select count(*)::integer from app_private.credential_sync_operations
  where account_id = '20000000-0000-4000-8000-000000000074'), 0, 'stale expired MFA-reset claim is removed');
select ok((select credential_update_pending from app_private.accounts where id = '20000000-0000-4000-8000-000000000074'),
  'cleanup alone does not unblock the account');

-- Break-glass staff MFA recovery by the database owner.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('30000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071', 'lost', 'totp', 'verified', now(), now(), 'fictional');
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('40000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071', now(), now());
update auth.users set encrypted_password = 'old-hash' where id = '10000000-0000-4000-8000-000000000071';
select ok(app_private.operator_recover_staff_mfa('boot.admin'), 'database owner can recover a sole administrator''s lost factor');
select ok((select encrypted_password <> 'old-hash' and encrypted_password like '$2%' from auth.users
  where id = '10000000-0000-4000-8000-000000000071'), 'break-glass recovery replaces the possibly compromised password');
select is((select count(*)::integer from auth.mfa_factors where user_id = '10000000-0000-4000-8000-000000000071')
  + (select count(*)::integer from auth.sessions where user_id = '10000000-0000-4000-8000-000000000071'), 0,
  'break-glass recovery removes provider factors and provider sessions');
select ok((select force_password_change and not credential_update_pending from app_private.accounts
  where provider_user_id = '10000000-0000-4000-8000-000000000071'),
  'break-glass recovery forces a password change and leaves no pending provider sync');
select throws_ok($$select app_private.operator_recover_staff_mfa('stuck.student')$$, '22023', null,
  'break-glass recovery applies only to staff accounts');
select ok(provolatile = 'v', 'quiescence check is declared volatile') from pg_catalog.pg_proc
  where oid = 'app_private.credential_sync_lease_is_stale(timestamptz)'::regprocedure;

select * from finish();
rollback;
