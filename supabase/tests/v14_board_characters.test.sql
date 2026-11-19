begin;
set local search_path = public, extensions;
select plan(12);

create function pg_temp.as_user(p_uid text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, true);
  select set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

select ok(not has_table_privilege('anon', 'app_private.published_level_row_artwork', 'select')
  and not has_table_privilege('authenticated', 'app_private.published_level_row_artwork', 'select')
  and not has_table_privilege('service_role', 'app_private.published_level_row_artwork', 'insert')
  and (select relforcerowsecurity from pg_class where oid = 'app_private.published_level_row_artwork'::regclass),
  'reviewed characters are private with forced RLS');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'app_private' and table_name = 'published_level_row_artwork'),
  array['approved_at', 'approved_by', 'character_key', 'level', 'position', 'snapshot_id'],
  'only position, the character key, and approval metadata are stored (no name or demographic field)');
select ok(not has_function_privilege('anon', 'public.approve_level_row_artwork(uuid,jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.approve_level_row_artwork(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.list_level_row_artwork(uuid)', 'execute')
  and has_function_privilege('anon', 'public.public_level_leaderboard_v3(smallint)', 'execute'),
  'approval is staff-only; the public projection is readable');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
values ('10000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'v14.publisher@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false);
insert into app_private.accounts (id, provider_user_id, status, force_password_change)
values ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'active', false);
insert into app_private.account_role_grants (account_id, role_name) values ('20000000-0000-4000-8000-0000000000b1', 'publisher');
insert into public.published_leaderboard_snapshots (id, version_number, academic_year, release_label, board_format, published_at, first_published_at, is_current, board_count, row_count)
values ('30000000-0000-4000-8000-0000000000b1', 9101, '2026-27', 'Week 5', 'level_only', now(), now(), false, 3, 30),
       ('30000000-0000-4000-8000-0000000000b2', 9102, '2026-27', 'Week 6', 'level_only', now(), now(), false, 3, 30);
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000b1';
insert into public.published_level_rows (snapshot_id, level, position, public_name)
select snapshot_id::uuid, lvl, pos, 'Fictional V14 ' || chr(64 + lvl) || chr(64 + pos) || suffix
from (values ('30000000-0000-4000-8000-0000000000b1', ''), ('30000000-0000-4000-8000-0000000000b2', ' Two')) as s(snapshot_id, suffix),
     generate_series(4, 6) as lvl, generate_series(1, 10) as pos;

select pg_temp.as_user('10000000-0000-4000-8000-0000000000b1', 'aal1');
select throws_ok($$select public.approve_level_row_artwork('30000000-0000-4000-8000-0000000000b1', '[]')$$,
  '42501', 'authorized AAL2 publisher required', 'approval needs AAL2');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000b1', 'aal2');
select throws_ok($$select public.approve_level_row_artwork('30000000-0000-4000-8000-0000000000b1', '[{"level":4,"rank":1,"character":"assets/evil.png"}]')$$,
  '22023', 'unknown ranking position or character', 'only allowlisted characters');
select throws_ok($$select public.approve_level_row_artwork('30000000-0000-4000-8000-0000000000b1', '[{"level":4,"rank":1,"character":"omar","gender":"x"}]')$$,
  '22023', 'each row needs exactly level, rank, and character', 'no extra attributes are accepted');
select throws_ok($$select public.approve_level_row_artwork('30000000-0000-4000-8000-0000000000b1', '[{"level":4,"rank":11,"character":"omar"}]')$$,
  '22023', 'unknown ranking position or character', 'positions must exist in that publication');
select is(public.approve_level_row_artwork('30000000-0000-4000-8000-0000000000b1',
  '[{"level":4,"rank":1,"character":"youssef"},{"level":4,"rank":2,"character":"mariam"}]'), 2, 'AAL2 publisher approves characters');

set local role anon;
select is((select string_agg(coalesce(default_avatar_key, '-'), ',' order by position) from public.public_level_leaderboard_v3(4::smallint) where position <= 3),
  'youssef,mariam,-', 'the public projection shows approved defaults; unreviewed rows have none');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-0000000000b1', 'aal2');
update public.published_leaderboard_snapshots set is_current = false where id = '30000000-0000-4000-8000-0000000000b1';
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000b2';
set local role anon;
select is((select count(default_avatar_key)::int from public.public_level_leaderboard_v3(4::smallint)), 0,
  'a new publication never inherits characters by rank position');
reset role;
update public.published_leaderboard_snapshots set is_current = false where id = '30000000-0000-4000-8000-0000000000b2';
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000b1';
set local role anon;
select is((select default_avatar_key from public.public_level_leaderboard_v3(4::smallint) where position = 1), 'youssef',
  'rolling back restores that publication''s approved characters');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-0000000000b1', 'aal2');
select is(public.approve_level_row_artwork('30000000-0000-4000-8000-0000000000b1', '[]'), 0, 'an empty approval clears the publication''s characters');

select * from finish();
rollback;
