begin;
set local search_path = public, extensions;

select plan(39);

create function pg_temp.as_user(p_uid text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, true);
  select set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
-- 30 fictional rows: Levels 4-6, ranks 1-10. p_tag varies names between versions.
create function pg_temp.rows(p_tag text) returns jsonb language sql as $$
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'level', lvl, 'position', pos, 'public_name', 'Fictional ' || p_tag || ' ' || chr(64 + lvl) || chr(64 + pos)))
  from generate_series(4, 6) as lvl, generate_series(1, 10) as pos;
$$;
grant execute on function pg_temp.rows(text) to authenticated;

select ok(not has_function_privilege('anon', 'public.create_level_leaderboard_draft(text,text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.publish_level_leaderboard_snapshot(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.list_level_leaderboard_publications()', 'execute')
  and not has_function_privilege('service_role', 'public.create_level_leaderboard_draft(text,text,jsonb)', 'execute'),
  'level-only mutations are not callable by anonymous visitors or the service role');
select ok(has_function_privilege('anon', 'public.public_level_leaderboard(smallint)', 'execute'), 'public level read is available');
select ok(not has_table_privilege('anon', 'public.published_level_rows', 'insert')
  and not has_table_privilege('authenticated', 'public.published_level_rows', 'update')
  and not has_table_privilege('authenticated', 'public.published_level_rows', 'delete'),
  'browser roles cannot write level rows');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'published_level_rows'),
  array['level', 'position', 'public_name', 'snapshot_id'], 'level rows store only snapshot, level, position, and name');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}', '{}', now(), now(), false, false
from (values
  ('10000000-0000-4000-8000-000000000091', 'level.publisher@academic-arena.test'),
  ('10000000-0000-4000-8000-000000000092', 'level.student@academic-arena.test'),
  ('10000000-0000-4000-8000-000000000093', 'level.moderator@academic-arena.test')
) as fixture(id, email);
insert into app_private.accounts (id, provider_user_id, status, force_password_change) values
  ('20000000-0000-4000-8000-000000000091', '10000000-0000-4000-8000-000000000091', 'active', false),
  ('20000000-0000-4000-8000-000000000092', '10000000-0000-4000-8000-000000000092', 'active', false),
  ('20000000-0000-4000-8000-000000000093', '10000000-0000-4000-8000-000000000093', 'active', false);
insert into app_private.account_role_grants (account_id, role_name) values
  ('20000000-0000-4000-8000-000000000091', 'publisher'),
  ('20000000-0000-4000-8000-000000000092', 'student'),
  ('20000000-0000-4000-8000-000000000093', 'moderator');

-- Authorization.
select pg_temp.as_user('10000000-0000-4000-8000-000000000091', 'aal1');
set local role authenticated;
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5', pg_temp.rows('a'))$$, '42501', null,
  'a publisher at AAL1 cannot create a level draft');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000092', 'aal2');
set local role authenticated;
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5', pg_temp.rows('a'))$$, '42501', null,
  'a student cannot create a level draft');
select throws_ok($$select * from public.list_level_leaderboard_publications()$$, '42501', null, 'a student cannot read history');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000093', 'aal2');
set local role authenticated;
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5', pg_temp.rows('a'))$$, '42501', null,
  'a moderator cannot publish rankings');
reset role;

-- Validation.
select pg_temp.as_user('10000000-0000-4000-8000-000000000091', 'aal2');
set local role authenticated;
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5', pg_temp.rows('a') - 0)$$, '22023', null,
  '29 rows are rejected');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5', pg_temp.rows('a') || '[{"level":4,"position":1,"public_name":"Extra Person"}]')$$,
  '22023', null, '31 rows are rejected');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5',
  (select jsonb_agg(case when (r->>'level')::int = 6 then jsonb_set(r, '{level}', '5') else r end) from jsonb_array_elements(pg_temp.rows('a')) r))$$,
  '23505', null, 'a missing level (duplicate ranks elsewhere) is rejected');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5',
  (select jsonb_agg(case when (r->>'level')::int = 4 and (r->>'position')::int = 10 then jsonb_set(r, '{position}', '1') else r end) from jsonb_array_elements(pg_temp.rows('a')) r))$$,
  '23505', null, 'a duplicate rank is rejected');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5',
  (select jsonb_agg(case when (r->>'level')::int = 4 and (r->>'position')::int = 2 then jsonb_set(r, '{public_name}', '"fictional a da"') else r end) from jsonb_array_elements(pg_temp.rows('a')) r))$$,
  '23505', null, 'a duplicate name within a level (case-insensitive) is rejected');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5',
  (select jsonb_agg(case when (r->>'position')::int = 3 then jsonb_set(r, '{public_name}', '"<img src=x onerror=alert(1)>"') else r end) from jsonb_array_elements(pg_temp.rows('a')) r))$$,
  '23514', null, 'markup in a name is rejected');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5',
  (select jsonb_agg(case when (r->>'position')::int = 3 and (r->>'level')::int = 4 then jsonb_set(r, '{public_name}', '"=HYPERLINK(1)"') else r end) from jsonb_array_elements(pg_temp.rows('a')) r))$$,
  '23514', null, 'a formula-prefixed name is rejected');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5',
  (select jsonb_agg(case when (r->>'position')::int = 3 and (r->>'level')::int = 4 then jsonb_set(r, '{position}', '11') else r end) from jsonb_array_elements(pg_temp.rows('a')) r))$$,
  '23514', null, 'rank 11 is rejected');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5',
  (select jsonb_agg(case when (r->>'position')::int = 3 and (r->>'level')::int = 4 then jsonb_set(r, '{public_name}', to_jsonb(U&'\3164\3164'::text)) else r end) from jsonb_array_elements(pg_temp.rows('a')) r))$$,
  '23514', null, 'an invisible filler-character name is rejected by the database');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', 'Week 5',
  (select jsonb_agg(case when (r->>'position')::int = 3 and (r->>'level')::int = 4 then jsonb_set(r, '{public_name}', to_jsonb(U&'\FF2E\FF41\FF4D\FF45'::text)) else r end) from jsonb_array_elements(pg_temp.rows('a')) r))$$,
  '23514', null, 'a fullwidth (non-NFKC) name is rejected by the database');
select throws_ok($$select * from public.create_level_leaderboard_draft('2026-27', '<b>Week</b>', pg_temp.rows('a'))$$, '22023', null,
  'release label is validated');
select throws_ok($$select * from public.create_level_leaderboard_draft('Week 5', 'Week 5', pg_temp.rows('a'))$$, '22023', null,
  'academic year is validated');
select is((select count(*)::integer from public.published_leaderboard_snapshots), 0, 'failed drafts leave nothing behind');

create temp table v1 as select * from public.create_level_leaderboard_draft('2026-27', 'Week 5', pg_temp.rows('a'));
select is((select row_count from v1), 30, 'a complete draft stores 30 rows');
reset role;
set local role anon;
select is((select count(*)::integer from public.public_level_leaderboard(4::smallint)), 0, 'a draft is not public');
select is((select count(*)::integer from public.published_level_rows), 0, 'draft rows are not readable directly');
reset role;

-- Publish.
select pg_temp.as_user('10000000-0000-4000-8000-000000000091', 'aal2');
set local role authenticated;
select is(public.publish_level_leaderboard_snapshot((select draft_id from v1)), 1::bigint, 'publisher publishes version 1');
reset role;
set local role anon;
select is((select array_agg(position order by position) from public.public_level_leaderboard(5::smallint)),
  array[1,2,3,4,5,6,7,8,9,10]::smallint[], 'Level 5 shows ten ranks in order');
select is((select public_name from public.public_level_leaderboard(6::smallint) where position = 1), 'Fictional a FA',
  'each level shows its own names');
select is((select count(*)::integer from public.public_level_leaderboard(4::smallint)) + (select count(*)::integer from public.public_level_leaderboard(5::smallint))
  + (select count(*)::integer from public.public_level_leaderboard(6::smallint)), 30, 'all three boards are live together');
select is((select distinct release_label from public.public_level_leaderboard(4::smallint)), 'Week 5', 'release label is public');
select is((select count(*)::integer from public.public_level_leaderboard(7::smallint)), 0, 'unknown level returns nothing');
reset role;

-- A legacy semester/module snapshot cannot be published through the level workflow.
insert into public.published_leaderboard_snapshots (version_number, academic_year, published_at, is_current, row_count, board_count)
values (99, '2026-27', null, false, 1, 1);
select pg_temp.as_user('10000000-0000-4000-8000-000000000091', 'aal2');
set local role authenticated;
select throws_ok($$select public.publish_level_leaderboard_snapshot((select id from public.published_leaderboard_snapshots where version_number = 99))$$,
  '22023', null, 'legacy snapshots are refused by the level-only publisher');

-- Version 2, rollback, withdraw.
create temp table v2 as select * from public.create_level_leaderboard_draft('2026-27', 'Week 6', pg_temp.rows('b'));
select is(public.publish_level_leaderboard_snapshot((select draft_id from v2)), (select version_number from v2), 'version 2 goes live');
reset role;
set local role anon;
select is((select public_name from public.public_level_leaderboard(4::smallint) where position = 1), 'Fictional b DA',
  'all boards switch to version 2 together');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000091', 'aal2');
set local role authenticated;
select is(public.publish_level_leaderboard_snapshot((select draft_id from v1)), 1::bigint, 'rollback to version 1');
reset role;
set local role anon;
select is((select public_name from public.public_level_leaderboard(4::smallint) where position = 1), 'Fictional a DA',
  'rollback restores every level consistently');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000091', 'aal2');
set local role authenticated;
select is((select array_agg(state order by version_number) filter (where board_format = 'level_only') from public.list_level_leaderboard_publications()),
  array['live', 'previous'], 'history shows level versions and states');
select ok(public.withdraw_current_leaderboard(), 'publisher withdraws the live rankings');
reset role;
set local role anon;
select is((select count(*)::integer from public.public_level_leaderboard(4::smallint)) + (select count(*)::integer from public.published_level_rows), 0,
  'withdrawn rankings are not readable in any way');
reset role;
select is((select count(*)::integer from public.published_leaderboard_snapshots where is_current), 0, 'nothing is current after withdrawal');

select * from finish();
rollback;
