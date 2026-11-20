begin;
set local search_path = public, extensions;

select plan(21);

select has_table('app_private', 'auth_diagnostic_events', 'private sign-in diagnostics exist');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'app_private.auth_diagnostic_events'::regclass),
  'diagnostics have forced row-level security');
select ok(not has_table_privilege('anon', 'app_private.auth_diagnostic_events', 'select')
  and not has_table_privilege('authenticated', 'app_private.auth_diagnostic_events', 'select'),
  'browser roles cannot read diagnostics');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'app_private' and table_name = 'auth_diagnostic_events'),
  array['id', 'occurred_at', 'correlation_id', 'flow', 'stage', 'outcome', 'account_id', 'temporary_password', 'credential_epoch'],
  'diagnostics store no username, email, IP, password or token');

select ok(has_function_privilege('service_role', 'public.release_login_attempt(bytea,bytea)', 'execute')
  and not has_function_privilege('anon', 'public.release_login_attempt(bytea,bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.release_login_attempt(bytea,bytea)', 'execute'),
  'only the BFF can give back a limiter attempt');
select ok(has_function_privilege('service_role', 'public.record_auth_diagnostic(uuid,text,text,text,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.record_auth_diagnostic(uuid,text,text,text,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_auth_diagnostic(uuid,text,text,text,uuid,text)', 'execute'),
  'only the BFF can record diagnostics');
select ok(has_function_privilege('service_role', 'public.consume_login_rate_limit(bytea,bytea)', 'execute')
  and not has_function_privilege('anon', 'public.consume_login_rate_limit(bytea,bytea)', 'execute'),
  'the limiter stays service-only');

-- Per-username limit: 8 failures, unchanged.
select is((select count(*)::integer from generate_series(1, 10) as n
  where public.consume_login_rate_limit(decode(repeat('a1', 32), 'hex'), decode(repeat('b1', 32), 'hex'))), 8,
  'a username is limited to 8 counted attempts');
-- A success gives back exactly one attempt.
select lives_ok($$select public.release_login_attempt(decode(repeat('a2', 32), 'hex'), decode(repeat('b2', 32), 'hex'))$$,
  'releasing with no bucket is a no-op');
select is((select count(*)::integer from generate_series(1, 8) as n
  where public.consume_login_rate_limit(decode(repeat('a2', 32), 'hex'), decode(repeat('b2', 32), 'hex'))), 8, 'eight attempts used');
select lives_ok($$select public.release_login_attempt(decode(repeat('a2', 32), 'hex'), decode(repeat('b2', 32), 'hex'))$$,
  'a success gives back one attempt');
select is(public.consume_login_rate_limit(decode(repeat('a2', 32), 'hex'), decode(repeat('b2', 32), 'hex')), true,
  'one released attempt can be used again');
select is(public.consume_login_rate_limit(decode(repeat('a2', 32), 'hex'), decode(repeat('b2', 32), 'hex')), false,
  'but no more than that');

-- Per-IP limit: 100 counted attempts across distinct usernames.
select is((select count(*)::integer from generate_series(1, 105) as n
  where public.consume_login_rate_limit(extensions.digest('u' || n, 'sha256'), decode(repeat('c3', 32), 'hex'))), 100,
  'one client IP is limited to 100 counted attempts');

-- Diagnostics: allowlisted stages only; the username is never stored.
select lives_ok($$select public.record_auth_diagnostic(gen_random_uuid(), 'login', 'unknown_username', 'rejected', null, 'nobody-here')$$,
  'an unknown username is recorded without an account');
select throws_ok($$insert into app_private.auth_diagnostic_events (correlation_id, flow, stage, outcome)
  values (gen_random_uuid(), 'login', 'password=hunter2', 'rejected')$$, '23514', null,
  'free-text stages are refused');
select is((select count(*)::integer from app_private.auth_diagnostic_events
  where stage = 'unknown_username' and account_id is null), 1, 'the unknown-username event has no account');

select lives_ok($$select public.record_auth_diagnostic(gen_random_uuid(), 'login', 'invalid_request', 'rejected', null, null)$$,
  'malformed requests are accepted by the recorder');
select is((select count(*)::integer from app_private.auth_diagnostic_events where stage = 'invalid_request'), 0,
  'malformed requests are never stored (console only)');
-- A throttled account is stored once per 15-minute window, whatever the volume.
insert into auth.users (id, email) values ('16000000-0000-4000-8000-000000000001', 'v16-pgtap@academic-arena.test');
insert into app_private.accounts (id, provider_user_id) values ('16000000-0000-4000-8000-0000000000a1', '16000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from (
  select public.record_auth_diagnostic(gen_random_uuid(), 'login', 'rate_limited', 'rejected', '16000000-0000-4000-8000-0000000000a1', null)
  from generate_series(1, 5)) as submitted), 5, 'five throttled attempts are submitted');
select is((select count(*)::integer from app_private.auth_diagnostic_events
  where account_id = '16000000-0000-4000-8000-0000000000a1' and stage = 'rate_limited'), 1,
  'throttled attempts cannot flood the diagnostics');

select * from finish();
rollback;
