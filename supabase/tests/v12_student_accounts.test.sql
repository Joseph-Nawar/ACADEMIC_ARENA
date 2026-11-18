begin;
set local search_path = public, extensions;

select plan(30);

create function pg_temp.as_user(p_uid text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, true);
  select set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Grants: private tables and operator functions are unreachable from browser roles and the service role.
select ok(not has_table_privilege('anon', 'app_private.published_level_row_links', 'select')
  and not has_table_privilege('authenticated', 'app_private.published_level_row_links', 'select')
  and not has_table_privilege('service_role', 'app_private.published_level_row_links', 'select'),
  'private ranking links are not selectable by anon, authenticated, or service_role');
select ok(not has_table_privilege('authenticated', 'app_private.student_feature_controls', 'update')
  and not has_table_privilege('service_role', 'app_private.student_feature_controls', 'update'),
  'rollout switches cannot be changed through PostgREST roles');
select ok((select relforcerowsecurity from pg_class where oid = 'app_private.published_level_row_links'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'app_private.student_feature_controls'::regclass),
  'RLS is forced on the new private tables');
select ok(not has_function_privilege('authenticated', 'app_private.operator_provision_student(uuid,text,text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.operator_provision_student(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'app_private.operator_begin_student_recovery(text,text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.operator_begin_student_recovery(text,text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.operator_set_student_feature(text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.operator_set_student_status(text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.operator_student_provisioning_state(text[])', 'execute'),
  'provisioning, recovery, status, and switch functions are owner-only');
select ok(not has_function_privilege('anon', 'public.preview_level_row_links(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.approve_level_row_links(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.list_level_row_links(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.approve_level_row_links(uuid,jsonb)', 'execute'),
  'link review functions are not callable anonymously or by the service role');
select ok(has_function_privilege('anon', 'public.public_level_leaderboard_v2(smallint)', 'execute')
  and has_function_privilege('anon', 'public.public_feature_state()', 'execute'),
  'the public projection and feature state are readable anonymously');
select is((select array_agg(parameter_name::text order by ordinal_position) from information_schema.parameters
  where specific_schema = 'public' and parameter_mode = 'OUT'
    and specific_name = (select specific_name from information_schema.routines
      where routine_schema = 'public' and routine_name = 'public_level_leaderboard_v2')),
  array['position', 'public_name', 'release_label', 'published_at', 'avatar_key', 'avatar_family', 'avatar_tone', 'avatar_badge'],
  'the public projection returns only rank, name, publication metadata, and allowlisted artwork');

select is((select array_agg(role_name) from app_private.role_permissions where permission_key = 'leaderboards.link'),
  array['admin'], 'only administrators (at AAL2) may review or approve private links');

-- Defaults on a fresh database are all off.
create temporary table defaults as
select student_sign_in, student_provisioning, avatar_personalization, welcome_dialog from app_private.student_feature_controls;
update app_private.student_feature_controls set student_sign_in = false, student_provisioning = false,
  avatar_personalization = false, welcome_dialog = false;
select is((select pg_catalog.count(*)::int from information_schema.columns
  where table_schema = 'app_private' and table_name = 'student_feature_controls' and column_default = 'false'), 4,
  'every rollout switch defaults to off');
select is((select row(student_sign_in, avatar_personalization, welcome_dialog)::text from public.public_feature_state()),
  '(f,f,f)', 'public feature state reports off');

-- Fixtures: one student, one admin, a published level-only snapshot.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}', '{}', now(), now(), false, false
from (values
  ('10000000-0000-4000-8000-0000000000a1', 'v12.student@academic-arena.test'),
  ('10000000-0000-4000-8000-0000000000a2', 'v12.admin@academic-arena.test'),
  ('10000000-0000-4000-8000-0000000000a3', 'v12.newcomer@academic-arena.test')
) as fixture(id, email);
insert into app_private.accounts (id, provider_user_id, status, force_password_change) values
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'active', false),
  ('20000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a2', 'active', false);
insert into app_private.identity_mappings (account_id, username_normalized, provider_email) values
  ('20000000-0000-4000-8000-0000000000a1', 'v12-student', 'v12.student@academic-arena.test'),
  ('20000000-0000-4000-8000-0000000000a2', 'v12-admin', 'v12.admin@academic-arena.test');
insert into app_private.account_role_grants (account_id, role_name) values
  ('20000000-0000-4000-8000-0000000000a1', 'student'), ('20000000-0000-4000-8000-0000000000a2', 'admin');
insert into public.published_leaderboard_snapshots (id, version_number, academic_year, release_label, board_format, published_at, first_published_at, is_current, board_count, row_count)
values ('30000000-0000-4000-8000-0000000000a1', 9001, '2026-27', 'Week 5', 'level_only', now(), now(), false, 3, 30);
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000a1';
insert into public.published_level_rows (snapshot_id, level, position, public_name)
select '30000000-0000-4000-8000-0000000000a1', lvl, pos, 'Fictional V12 ' || chr(64 + lvl) || chr(64 + pos)
from generate_series(4, 6) as lvl, generate_series(1, 10) as pos;

-- Student permissions follow the sign-in switch; staff permissions do not.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000a1', 'aal1');
select ok(not app_private.has_permission('avatar.write'), 'students have no permissions while sign-in is off');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000a2', 'aal2');
select ok(app_private.has_permission('leaderboards.link'), 'AAL2 administrators keep staff permissions while student sign-in is off');
update app_private.student_feature_controls set student_sign_in = true;
select pg_temp.as_user('10000000-0000-4000-8000-0000000000a1', 'aal1');
select ok(app_private.has_permission('avatar.write'), 'students regain permissions when sign-in is on');
select ok(not app_private.has_permission('leaderboards.link'), 'students never get the link permission');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000a2', 'aal1');
select ok(not app_private.has_permission('leaderboards.link'), 'linking needs AAL2');

-- Provisioning gate and identity checks.
select throws_ok($$select app_private.operator_provision_student('10000000-0000-4000-8000-0000000000a3', 'v12-new', 'v12.newcomer@academic-arena.test')$$,
  '42501', 'student provisioning is disabled', 'provisioning refuses while its switch is off');
update app_private.student_feature_controls set student_provisioning = true;
select throws_ok($$select app_private.operator_provision_student('10000000-0000-4000-8000-0000000000a3', 'v12-new', 'other@academic-arena.test')$$,
  '23503', 'provider identity does not match', 'provider email must match the Auth user');
select is(app_private.operator_provision_student('10000000-0000-4000-8000-0000000000a3', 'v12-new', 'v12.newcomer@academic-arena.test'),
  'created', 'a matching confirmed Auth user becomes a student');
select is(app_private.operator_provision_student('10000000-0000-4000-8000-0000000000a3', 'v12-new', 'v12.newcomer@academic-arena.test'),
  'exists', 'provisioning is idempotent');
select is((select array_agg(role_grant.role_name) from app_private.account_role_grants as role_grant
  join app_private.accounts as account on account.id = role_grant.account_id
  where account.provider_user_id = '10000000-0000-4000-8000-0000000000a3'), array['student'], 'only the student role is granted');

-- Operator recovery: locked first, bound to its epoch, never unlocked by a superseded run.
create temporary table first_reset as select * from app_private.operator_begin_student_recovery('v12-new', 'ticket-a');
create temporary table second_reset as select * from app_private.operator_begin_student_recovery('v12-new', 'ticket-b');
select throws_ok($$select app_private.operator_finish_student_recovery('v12-new', (select credential_epoch from first_reset))$$,
  '22023', 'no matching operator recovery in progress', 'an overlapping earlier reset cannot unlock the account');
select ok(app_private.operator_finish_student_recovery('v12-new', (select credential_epoch from second_reset)), 'the latest reset unlocks');
select is((select row(force_password_change, credential_update_pending)::text from app_private.accounts
  where provider_user_id = '10000000-0000-4000-8000-0000000000a3'), '(t,f)', 'a new password is still required after recovery');
select throws_ok($$select app_private.operator_finish_student_recovery('v12-new', (select credential_epoch from second_reset))$$,
  '22023', 'no matching operator recovery in progress', 'finishing twice is refused');

-- Links: AAL2 admin only, usernames only, student-only accounts.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000a2', 'aal2');
select throws_ok($$select public.approve_level_row_links('30000000-0000-4000-8000-0000000000a1', '[{"level":4,"rank":1,"username":"v12-admin"}]')$$,
  '22023', 'unknown or ineligible student username', 'staff accounts cannot be linked');
select throws_ok($$select public.approve_level_row_links('30000000-0000-4000-8000-0000000000a1', '[{"level":4,"rank":1,"public_name":"Fictional V12 DA"}]')$$,
  '22023', 'each link needs exactly level, rank, and username', 'names are not accepted for linking');
select is(public.approve_level_row_links('30000000-0000-4000-8000-0000000000a1', '[{"level":4,"rank":1,"username":"v12-student"}]'), 1,
  'an AAL2 administrator approves a username link');

-- Public projection: artwork only for linked + opted-in + switch on.
reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
update app_private.student_feature_controls set avatar_personalization = true;
insert into public.student_avatar_configs (account_id, character_key, family, tone, badge, show_on_leaderboard)
values ('20000000-0000-4000-8000-0000000000a1', 'zein', 'ink', 'lilac', '⚡', false);
set local role anon;
select is((select avatar_key from public.public_level_leaderboard_v2(4::smallint) where position = 1), null,
  'no personal artwork before the student opts in');
reset role;
update public.student_avatar_configs set show_on_leaderboard = true where account_id = '20000000-0000-4000-8000-0000000000a1';
set local role anon;
select is((select avatar_key || '/' || avatar_family from public.public_level_leaderboard_v2(4::smallint) where position = 1), 'zein/ink',
  'opted-in linked student shows their own character');
reset role;
update app_private.student_feature_controls set avatar_personalization = false;
set local role anon;
select is((select avatar_key from public.public_level_leaderboard_v2(4::smallint) where position = 1), null,
  'the personalization switch hides personal artwork without touching rankings');

select * from finish();
rollback;
