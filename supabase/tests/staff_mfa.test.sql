begin;
select plan(29);

select ok(to_regprocedure('public.record_staff_mfa_event(uuid,text)') is not null, 'server audit RPC exists');
select ok(to_regprocedure('public.complete_staff_mfa_step_up(bytea,uuid,uuid,text,text,timestamptz,text)') is not null, 'MFA step-up stores provider tokens and audit atomically');
select ok(to_regprocedure('public.complete_staff_mfa_reset(uuid,bigint)') is not null, 'server finalizes provider MFA removal');
select ok(to_regprocedure('public.reset_staff_mfa_for_account(text)') is not null, 'staff MFA recovery RPC exists');
select ok(has_function_privilege('service_role', 'public.record_staff_mfa_event(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_staff_mfa_event(uuid,text)', 'execute'),
  'only the server can record provider MFA events');
select ok(has_function_privilege('service_role', 'public.complete_staff_mfa_step_up(bytea,uuid,uuid,text,text,timestamptz,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_staff_mfa_step_up(bytea,uuid,uuid,text,text,timestamptz,text)', 'execute'),
  'only the server can atomically complete staff MFA step-up');
select ok(has_function_privilege('service_role', 'public.complete_staff_mfa_reset(uuid,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_staff_mfa_reset(uuid,bigint)', 'execute'),
  'only the server can finalize provider MFA removal');
select ok(has_function_privilege('authenticated', 'public.reset_staff_mfa_for_account(text)', 'execute')
  and not has_function_privilege('anon', 'public.reset_staff_mfa_for_account(text)', 'execute'),
  'MFA recovery RPC requires an authenticated caller');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('10000000-0000-4000-8000-000000000041', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mfa-admin@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000042', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mfa-target@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false);
insert into app_private.accounts (id, provider_user_id, status, force_password_change) values
  ('20000000-0000-4000-8000-000000000041', '10000000-0000-4000-8000-000000000041', 'active', false),
  ('20000000-0000-4000-8000-000000000042', '10000000-0000-4000-8000-000000000042', 'active', false);
insert into app_private.identity_mappings (account_id, username_normalized, provider_email) values
  ('20000000-0000-4000-8000-000000000041', 'mfa.admin', 'mfa-admin@academic-arena.test'),
  ('20000000-0000-4000-8000-000000000042', 'mfa.target', 'mfa-target@academic-arena.test');
insert into app_private.account_role_grants (account_id, role_name) values
  ('20000000-0000-4000-8000-000000000041', 'admin'),
  ('20000000-0000-4000-8000-000000000042', 'publisher');
insert into app_private.bff_sessions (
  session_token_hash, csrf_token_hash, csrf_token_jwe, account_id,
  provider_session_id, provider_access_token_jwe, provider_refresh_token_jwe,
  provider_access_expires_at, expires_at
) values (
  decode(repeat('41', 32), 'hex'), decode(repeat('42', 32), 'hex'), repeat('c', 64),
  '20000000-0000-4000-8000-000000000042', '30000000-0000-4000-8000-000000000042',
  repeat('a', 64), repeat('b', 64), now() + interval '1 hour', now() + interval '1 hour'
), (
  decode(repeat('43', 32), 'hex'), decode(repeat('44', 32), 'hex'), repeat('f', 64),
  '20000000-0000-4000-8000-000000000041', '30000000-0000-4000-8000-000000000041',
  repeat('g', 64), repeat('h', 64), now() + interval '1 hour', now() + interval '1 hour'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000041', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000041","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.reset_staff_mfa_for_account('mfa.target')$$, '42501', null, 'AAL1 staff cannot reset another staff member MFA');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000041","role":"authenticated","aal":"aal2"}', true);
select is(public.reset_staff_mfa_for_account('mfa.admin'), false, 'administrator cannot use recovery to remove their own MFA');
select ok(public.reset_staff_mfa_for_account('mfa.target'), 'AAL2 administrator can reset a different staff member MFA');
select ok(public.reset_staff_mfa_for_account('mfa.target'), 'AAL2 administrator can retry a pending provider MFA reset');
reset role;
select is((select credential_epoch from app_private.accounts where id = '20000000-0000-4000-8000-000000000042'), 1::bigint, 'MFA reset retry preserves its credential generation');

select ok((select force_password_change from app_private.accounts where id = '20000000-0000-4000-8000-000000000042'), 'MFA recovery requires a fresh password change');
select ok((select credential_update_pending from app_private.accounts where id = '20000000-0000-4000-8000-000000000042'), 'MFA recovery blocks login until provider factors are removed');
select ok((select revoked_at is not null and provider_access_token_jwe is null and provider_refresh_token_jwe is null
  from app_private.bff_sessions where account_id = '20000000-0000-4000-8000-000000000042'), 'MFA recovery revokes BFF sessions and clears encrypted provider material');
select is((select count(*)::integer from app_private.audit_events where target_account_id = '20000000-0000-4000-8000-000000000042' and action_key = 'staff.mfa_reset'), 1, 'staff MFA reset is audited');
set local role service_role;
select ok(public.complete_staff_mfa_reset('20000000-0000-4000-8000-000000000042', 1), 'server finalizes the matching provider factor removal');
select ok(public.complete_staff_mfa_reset('20000000-0000-4000-8000-000000000042', 1), 'MFA reset finalization safely accepts a retry for the same generation');
select ok(public.complete_staff_mfa_step_up(
  decode(repeat('43', 32), 'hex'),
  '20000000-0000-4000-8000-000000000041',
  '30000000-0000-4000-8000-000000000041',
  repeat('d', 64), repeat('e', 64), now() + interval '1 hour', 'staff.mfa_verified'
), 'server atomically updates an AAL2 session and writes its audit event');
select ok(public.record_staff_mfa_event('20000000-0000-4000-8000-000000000042', 'staff.mfa_enrolled'), 'server records successful staff MFA enrollment without factor material');
select is(public.record_staff_mfa_event('20000000-0000-4000-8000-000000000042', 'staff.mfa_secret'), false, 'server audit rejects unapproved MFA event keys');
select is(public.record_staff_mfa_event('20000000-0000-4000-8000-000000000099', 'staff.mfa_enrolled'), false, 'server audit returns false when actor is no longer an active staff account');
reset role;
select is((select credential_update_pending from app_private.accounts where id = '20000000-0000-4000-8000-000000000042'), false, 'MFA reset completion reopens the forced password-change flow');
select is((select count(*)::integer from app_private.audit_events where target_account_id = '20000000-0000-4000-8000-000000000042' and action_key = 'staff.mfa_reset_completed'), 1, 'provider MFA removal completion is audited');
select ok((select completed_at is not null from app_private.credential_sync_operations where account_id = '20000000-0000-4000-8000-000000000042' and operation_kind = 'staff_mfa_reset'), 'completed MFA reset remains idempotent for a short retry window');
select is((select count(*)::integer from app_private.audit_events where target_account_id = '20000000-0000-4000-8000-000000000041' and action_key = 'staff.mfa_verified'), 1, 'atomic MFA step-up commits the audit event with the token update');
select is((select count(*)::integer from app_private.audit_events where target_account_id = '20000000-0000-4000-8000-000000000042' and action_key = 'staff.mfa_enrolled'), 1, 'MFA audit stores an action key and no authenticator secret');

update app_private.runtime_controls set allow_fictional_account_lifecycle = false where singleton;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000041', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000041","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.reset_staff_mfa_for_account('mfa.target')$$, '42501', null, 'direct authenticated staff MFA reset RPC is blocked when the local-only database gate is off');
reset role;
update app_private.runtime_controls set allow_fictional_account_lifecycle = true where singleton;

select * from finish();
rollback;
