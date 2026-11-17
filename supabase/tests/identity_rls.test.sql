begin;
set local search_path = public, extensions;

select plan(40);

select has_schema('app_private', 'private identity schema exists');
select has_table('app_private', 'accounts', 'private accounts exist');
select has_table('app_private', 'identity_mappings', 'private username mapping exists');
select has_table('app_private', 'account_role_grants', 'private role grants exist');
select has_table('app_private', 'role_permissions', 'private permission map exists');
select has_table('app_private', 'bff_sessions', 'opaque BFF session store exists');
select has_table('app_private', 'login_rate_limit_buckets', 'persistent login rate limit buckets exist');
select has_table('app_private', 'audit_events', 'private audit log exists');
select has_table('public', 'student_avatar_configs', 'student avatar configuration exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.student_avatar_configs'::regclass),
  'avatar table has enabled and forced RLS'
);
select ok(
  not has_table_privilege('anon', 'public.student_avatar_configs', 'select')
  and not has_table_privilege('anon', 'public.student_avatar_configs', 'insert')
  and not has_table_privilege('anon', 'public.student_avatar_configs', 'update')
  and not has_table_privilege('anon', 'public.student_avatar_configs', 'delete'),
  'anonymous role cannot read or write private avatar rows'
);
select ok(
  has_column_privilege('authenticated', 'public.student_avatar_configs', 'character_key', 'select')
  and has_column_privilege('authenticated', 'public.student_avatar_configs', 'family', 'select')
  and has_column_privilege('authenticated', 'public.student_avatar_configs', 'tone', 'select')
  and has_column_privilege('authenticated', 'public.student_avatar_configs', 'badge', 'select')
  and not has_table_privilege('authenticated', 'public.student_avatar_configs', 'insert')
  and not has_table_privilege('authenticated', 'public.student_avatar_configs', 'update')
  and not has_column_privilege('authenticated', 'public.student_avatar_configs', 'account_id', 'select')
  and not has_table_privilege('authenticated', 'public.student_avatar_configs', 'delete'),
  'authenticated role can read only avatar fields and must use the owner-derived write RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.save_own_avatar_config(text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.save_own_avatar_config(text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.save_own_avatar_config(text,text,text,text)', 'execute'),
  'only authenticated users can call the owner-derived avatar write RPC'
);
select ok(
  not has_schema_privilege('anon', 'app_private', 'usage')
  and not has_table_privilege('anon', 'app_private.accounts', 'select'),
  'anonymous role cannot access the private schema or account table'
);
select ok(
  not has_table_privilege('authenticated', 'app_private.accounts', 'select')
  and not has_table_privilege('authenticated', 'app_private.accounts', 'insert')
  and not has_table_privilege('authenticated', 'app_private.accounts', 'update')
  and not has_table_privilege('authenticated', 'app_private.accounts', 'delete')
  and not has_table_privilege('authenticated', 'app_private.identity_mappings', 'select')
  and not has_table_privilege('authenticated', 'app_private.identity_mappings', 'insert')
  and not has_table_privilege('authenticated', 'app_private.identity_mappings', 'update')
  and not has_table_privilege('authenticated', 'app_private.identity_mappings', 'delete')
  and not has_table_privilege('authenticated', 'app_private.account_role_grants', 'select')
  and not has_table_privilege('authenticated', 'app_private.account_role_grants', 'insert')
  and not has_table_privilege('authenticated', 'app_private.account_role_grants', 'update')
  and not has_table_privilege('authenticated', 'app_private.account_role_grants', 'delete')
  and not has_table_privilege('authenticated', 'app_private.bff_sessions', 'select')
  and not has_table_privilege('authenticated', 'app_private.bff_sessions', 'insert')
  and not has_table_privilege('authenticated', 'app_private.bff_sessions', 'update')
  and not has_table_privilege('authenticated', 'app_private.bff_sessions', 'delete'),
  'authenticated role cannot read or mutate private identity, role, or session tables'
);
select is(to_regprocedure('public.provision_account(uuid,text,text)')::text, null, 'legacy account-ID-returning provisioning RPC is removed');
select ok(
  has_function_privilege('service_role', 'public.consume_login_rate_limit(bytea,bytea)', 'execute')
  and not has_function_privilege('anon', 'public.consume_login_rate_limit(bytea,bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.consume_login_rate_limit(bytea,bytea)', 'execute'),
  'only the server service role can consume login rate limit buckets'
);
select has_column('app_private', 'bff_sessions', 'csrf_token_jwe', 'server-encrypted CSRF token is stored with its session');
select has_column('app_private', 'bff_sessions', 'provider_refresh_token_jwe', 'provider refresh credential is encrypted while temporarily retained');
select ok(
  has_function_privilege('service_role', 'public.resolve_login_identity(text)', 'execute')
  and not has_function_privilege('anon', 'public.resolve_login_identity(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.resolve_login_identity(text)', 'execute'),
  'username mapping lookup is server-only'
);
select ok(
  has_function_privilege('service_role', 'public.create_bff_session(bytea,bytea,text,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone)', 'execute')
  and not has_function_privilege('anon', 'public.create_bff_session(bytea,bytea,text,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_bff_session(bytea,bytea,text,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone)', 'execute'),
  'only the server can create an opaque BFF session'
);
select ok(
  has_function_privilege('service_role', 'public.resolve_bff_session(bytea)', 'execute')
  and not has_function_privilege('anon', 'public.resolve_bff_session(bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.resolve_bff_session(bytea)', 'execute'),
  'only the server can resolve opaque BFF sessions'
);
select ok(
  has_function_privilege('service_role', 'public.revoke_bff_session(bytea,text)', 'execute')
  and not has_function_privilege('anon', 'public.revoke_bff_session(bytea,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.revoke_bff_session(bytea,text)', 'execute'),
  'only the server can revoke opaque BFF sessions'
);
select ok(
  (select count(distinct role_name) = 4 from app_private.role_permissions),
  'permission catalog is present and has the four intended role families'
);

-- Fixtures exist only inside this rolled-back database test transaction.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pg-student-one@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pg-student-two@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pg-moderator@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pg-publisher@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pg-suspended@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false);

insert into app_private.accounts (id, provider_user_id, status, force_password_change)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'active', false),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'active', false),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'active', false),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'active', false),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 'suspended', false);

insert into app_private.identity_mappings (account_id, username_normalized, provider_email)
values
  ('20000000-0000-4000-8000-000000000001', 'student.one', 'pg-student-one@academic-arena.test'),
  ('20000000-0000-4000-8000-000000000002', 'student.two', 'pg-student-two@academic-arena.test'),
  ('20000000-0000-4000-8000-000000000003', 'moderator.one', 'pg-moderator@academic-arena.test'),
  ('20000000-0000-4000-8000-000000000004', 'publisher.one', 'pg-publisher@academic-arena.test'),
  ('20000000-0000-4000-8000-000000000005', 'student.suspended', 'pg-suspended@academic-arena.test');

insert into app_private.account_role_grants (account_id, role_name)
values
  ('20000000-0000-4000-8000-000000000001', 'student'),
  ('20000000-0000-4000-8000-000000000002', 'student'),
  ('20000000-0000-4000-8000-000000000003', 'moderator'),
  ('20000000-0000-4000-8000-000000000004', 'publisher'),
  ('20000000-0000-4000-8000-000000000005', 'student');

insert into public.student_avatar_configs (account_id, character_key, family, tone, badge)
values
  ('20000000-0000-4000-8000-000000000001', 'amara', 'ink', 'mint', '✦'),
  ('20000000-0000-4000-8000-000000000002', 'omar', 'cartoon3d', 'coral', '⚡'),
  ('20000000-0000-4000-8000-000000000005', 'zein', 'ink', 'blue', '★');

insert into public.published_leaderboard_snapshots (version_number, academic_year, published_at, is_current)
values (10, 'fictional-2026', now(), true);
insert into public.published_leaderboard_rows (
  snapshot_id, level, semester, cohort_key, board_kind, module_key,
  position, public_name, avatar_key, avatar_family
)
select id, 5, 1, 'core', 'semester', null, 1, 'Fictional Learner', 'amara', 'ink'
from public.published_leaderboard_snapshots where version_number = 10;
insert into app_private.campus_wins_submissions (
  id, owner_account_id, template_key, status, public_author_name, approved_avatar_key,
  approved_avatar_family, moderated_by, moderated_at
)
values (
  '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'workshop', 'approved', 'Fictional Learner', 'amara', 'ink',
  '20000000-0000-4000-8000-000000000003', now()
);
insert into public.campus_wins_public (
  post_id, template_key, public_author_name, avatar_key, avatar_family,
  published_at, heart_count, clap_count, fire_count
)
values ('30000000-0000-4000-8000-000000000001', 'workshop', 'Fictional Learner', 'amara', 'ink', now(), 0, 1, 0);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::integer from public.student_avatar_configs), 1, 'student sees only the owned avatar row');
select is((select count(*)::integer from public.student_avatar_configs where character_key = 'amara'), 1, 'student sees own avatar details');
select throws_ok(
  $$insert into public.student_avatar_configs (account_id, character_key, family, tone, badge) values ('20000000-0000-4000-8000-000000000002', 'omar', 'ink', 'coral', '⚡')$$,
  '42501', null, 'student cannot directly choose or write an avatar owner'
);
select ok(public.save_own_avatar_config('nour2', 'cartoon3d', 'lilac', '✦'), 'student can save through the authenticated owner-derived RPC');
select is((select character_key from public.student_avatar_configs), 'nour2', 'owner-derived RPC updates only the caller avatar');
select ok(not app_private.has_permission('accounts.provision'), 'student cannot obtain a staff permission');
select ok(not app_private.has_permission('leaderboards.publish'), 'AAL1 student cannot obtain publisher permission');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select ok(not app_private.has_permission('campus_wins.moderate'), 'staff at AAL1 is not authorized for privileged actions');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
select ok(app_private.has_permission('campus_wins.moderate'), 'moderator receives only the permitted role capability at AAL2');
select ok(not app_private.has_permission('leaderboards.publish'), 'moderator cannot publish leaderboards');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(app_private.has_permission('leaderboards.publish'), 'publisher receives the publication capability at AAL2');
select ok(not app_private.has_permission('campus_wins.moderate'), 'publisher cannot moderate Campus Wins');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::integer from public.student_avatar_configs), 0, 'suspended student cannot access an existing avatar');
select ok(not app_private.has_permission('accounts.provision'), 'suspended staff-like context cannot gain permission');
reset role;

set local role anon;
select is((select count(*)::integer from public.published_leaderboard_rows), 1, 'anonymous user reads the current public leaderboard');
select is((select count(*)::integer from public.campus_wins_public), 1, 'anonymous user reads only approved public Campus Wins projection');
reset role;

select * from finish();
rollback;
