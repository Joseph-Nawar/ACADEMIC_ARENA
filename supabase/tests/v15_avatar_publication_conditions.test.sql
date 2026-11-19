-- V1.5: every condition a student's own character needs before it replaces
-- the staff-reviewed default on the public V3 board. Mirrors the pilot case
-- where a student saved a character but was neither linked nor opted in.
begin;
set local search_path = public, extensions;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}', '{}', now(), now(), false, false
from (values
  ('10000000-0000-4000-8000-0000000000c1', 'v15.saved-only@academic-arena.test'),
  ('10000000-0000-4000-8000-0000000000c2', 'v15.linked-off@academic-arena.test'),
  ('10000000-0000-4000-8000-0000000000c3', 'v15.linked-on@academic-arena.test'),
  ('10000000-0000-4000-8000-0000000000c4', 'v15.suspended@academic-arena.test')
) as fixture(id, email);
insert into app_private.accounts (id, provider_user_id, status, force_password_change)
select ('20000000-0000-4000-8000-0000000000c' || n)::uuid, ('10000000-0000-4000-8000-0000000000c' || n)::uuid,
       case when n = 4 then 'suspended' else 'active' end, false
from generate_series(1, 4) as n;
insert into app_private.account_role_grants (account_id, role_name)
select ('20000000-0000-4000-8000-0000000000c' || n)::uuid, 'student' from generate_series(1, 4) as n;
-- All four saved a character; only 1, 3 and 4 switched public display on.
insert into public.student_avatar_configs (account_id, character_key, family, tone, badge, show_on_leaderboard) values
  ('20000000-0000-4000-8000-0000000000c1', 'zein', 'ink', 'mint', '✦', true),
  ('20000000-0000-4000-8000-0000000000c2', 'nour2', 'ink', 'mint', '✦', false),
  ('20000000-0000-4000-8000-0000000000c3', 'tariq', 'cartoon3d', 'gold', '★', true),
  ('20000000-0000-4000-8000-0000000000c4', 'malek', 'ink', 'mint', '✦', true);

insert into public.published_leaderboard_snapshots (id, version_number, academic_year, release_label, board_format, published_at, first_published_at, is_current, board_count, row_count)
values ('30000000-0000-4000-8000-0000000000c1', 9201, '2026-27', 'Week 5', 'level_only', now(), now(), false, 3, 30);
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000c1';
insert into public.published_level_rows (snapshot_id, level, position, public_name)
select '30000000-0000-4000-8000-0000000000c1', lvl, pos, 'Fictional V15 ' || chr(64 + lvl) || chr(64 + pos)
from generate_series(4, 6) as lvl, generate_series(1, 10) as pos;
-- Every row has a reviewed default; links exist for rows 2-4 only (row 1's student is unlinked).
insert into app_private.published_level_row_artwork (snapshot_id, level, position, character_key)
select '30000000-0000-4000-8000-0000000000c1', lvl, pos, 'omar' from generate_series(4, 6) as lvl, generate_series(1, 10) as pos;
insert into app_private.published_level_row_links (snapshot_id, level, position, account_id) values
  ('30000000-0000-4000-8000-0000000000c1', 4, 2, '20000000-0000-4000-8000-0000000000c2'),
  ('30000000-0000-4000-8000-0000000000c1', 4, 3, '20000000-0000-4000-8000-0000000000c3'),
  ('30000000-0000-4000-8000-0000000000c1', 4, 4, '20000000-0000-4000-8000-0000000000c4');

update app_private.student_feature_controls set student_sign_in = true, avatar_personalization = false;
set local role anon;
select is((select count(avatar_key)::int from public.public_level_leaderboard_v3(4::smallint)), 0,
  'with avatar_personalization off, no student character is public even when linked and opted in');
select is((select count(default_avatar_key)::int from public.public_level_leaderboard_v3(4::smallint)), 10,
  'every row keeps its reviewed default while personalization is off');
reset role;

update app_private.student_feature_controls set avatar_personalization = true;
set local role anon;
select is((select avatar_key from public.public_level_leaderboard_v3(4::smallint) where position = 1), null,
  'a saved, opted-in character is not shown without a verified link to that row');
select is((select avatar_key from public.public_level_leaderboard_v3(4::smallint) where position = 2), null,
  'a linked student who has not opted in keeps the reviewed default');
select is((select avatar_key || '/' || avatar_family || '/' || default_avatar_key from public.public_level_leaderboard_v3(4::smallint) where position = 3),
  'tariq/cartoon3d/omar', 'linked + opted in + switch on: the student''s own character is returned alongside the default it replaces');
select is((select avatar_key from public.public_level_leaderboard_v3(4::smallint) where position = 4), null,
  'a suspended account''s character is never public');
select is((select string_agg(public_name, '|' order by position) from public.public_level_leaderboard_v3(4::smallint)),
  (select string_agg(public_name, '|' order by position) from public.published_level_rows
   where snapshot_id = '30000000-0000-4000-8000-0000000000c1' and level = 4),
  'names and positions are unchanged by any avatar condition');
reset role;

-- The link belongs to one publication: a new week does not carry it over.
insert into public.published_leaderboard_snapshots (id, version_number, academic_year, release_label, board_format, published_at, first_published_at, is_current, board_count, row_count)
values ('30000000-0000-4000-8000-0000000000c2', 9202, '2026-27', 'Week 6', 'level_only', now(), now(), false, 3, 30);
insert into public.published_level_rows (snapshot_id, level, position, public_name)
select '30000000-0000-4000-8000-0000000000c2', lvl, pos, 'Fictional V15 Six ' || chr(64 + lvl) || chr(64 + pos)
from generate_series(4, 6) as lvl, generate_series(1, 10) as pos;
update public.published_leaderboard_snapshots set is_current = false where id = '30000000-0000-4000-8000-0000000000c1';
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000c2';
set local role anon;
select is((select count(avatar_key)::int from public.public_level_leaderboard_v3(4::smallint)), 0,
  'a new publication needs its own verified links');

select * from finish();
rollback;
