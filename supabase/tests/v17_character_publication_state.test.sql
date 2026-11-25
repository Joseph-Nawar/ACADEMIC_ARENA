-- Release A: a student's character publication state, and the public board,
-- across the whole lifecycle: save, opt in, verified link, re-save after
-- linking, opt-out, suspension, publication replacement, withdrawal and
-- rollback. The state must always agree with what anonymous visitors see.
begin;
set local search_path = public, extensions;
select plan(30);

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, true);
  select set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
$$;

-- Six fictional students (d1..d6).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select ('10000000-0000-4000-8000-0000000000d' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', 'v17.s' || n || '@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false
from generate_series(1, 6) as n;
insert into app_private.accounts (id, provider_user_id, status, force_password_change)
select ('20000000-0000-4000-8000-0000000000d' || n)::uuid, ('10000000-0000-4000-8000-0000000000d' || n)::uuid, 'active', false
from generate_series(1, 6) as n;
insert into app_private.account_role_grants (account_id, role_name)
select ('20000000-0000-4000-8000-0000000000d' || n)::uuid, 'student' from generate_series(1, 6) as n;

-- Two level-only publications (Week 5, Week 6) with reviewed defaults.
insert into public.published_leaderboard_snapshots (id, version_number, academic_year, release_label, board_format, published_at, first_published_at, is_current, board_count, row_count)
values ('30000000-0000-4000-8000-0000000000d5', 9301, '2026-27', 'Week 5', 'level_only', now(), now(), false, 3, 30),
       ('30000000-0000-4000-8000-0000000000d6', 9302, '2026-27', 'Week 6', 'level_only', now(), now(), false, 3, 30);
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000d5';
insert into public.published_level_rows (snapshot_id, level, position, public_name)
select snapshot_id::uuid, lvl, pos, 'Fictional V17 ' || tag || ' ' || chr(64 + lvl) || chr(64 + pos)
from (values ('30000000-0000-4000-8000-0000000000d5', 'Five'), ('30000000-0000-4000-8000-0000000000d6', 'Six')) as v(snapshot_id, tag),
     generate_series(4, 6) as lvl, generate_series(1, 10) as pos;
insert into app_private.published_level_row_artwork (snapshot_id, level, position, character_key)
select snapshot_id::uuid, lvl, pos, 'omar'
from (values ('30000000-0000-4000-8000-0000000000d5'), ('30000000-0000-4000-8000-0000000000d6')) as v(snapshot_id),
     generate_series(4, 6) as lvl, generate_series(1, 10) as pos;
-- Week 5 verified links: d1 -> L4 #1 (podium), d2 -> L5 #6 (ranks 4-10), d6 -> L6 #2.
-- d5 is outside the top 10 (never linked). Week 6 links only d1, at L4 #3.
insert into app_private.published_level_row_links (snapshot_id, level, position, account_id) values
  ('30000000-0000-4000-8000-0000000000d5', 4, 1, '20000000-0000-4000-8000-0000000000d1'),
  ('30000000-0000-4000-8000-0000000000d5', 5, 6, '20000000-0000-4000-8000-0000000000d2'),
  ('30000000-0000-4000-8000-0000000000d5', 6, 2, '20000000-0000-4000-8000-0000000000d6'),
  ('30000000-0000-4000-8000-0000000000d6', 4, 3, '20000000-0000-4000-8000-0000000000d1');
update app_private.student_feature_controls set student_sign_in = true, avatar_personalization = false;

-- Privileges: students only; nothing for anonymous visitors or service_role.
select ok(has_function_privilege('authenticated', 'public.my_character_publication_state()', 'execute')
  and not has_function_privilege('anon', 'public.my_character_publication_state()', 'execute')
  and not has_function_privilege('service_role', 'public.my_character_publication_state()', 'execute'),
  'only authenticated sessions may ask for their own publication state');
set local role anon;
select throws_ok('select public.my_character_publication_state()', '42501', null, 'anonymous visitors cannot call it');
reset role;

-- 1. Nothing saved yet.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d1');
set local role authenticated;
select is(public.my_character_publication_state(), 'not_saved', 'a student with no saved character');
-- 2. Saved while public characters are switched off for everyone.
select ok(public.save_own_avatar_preferences('tariq', 'ink', 'coral', '⚡', true), 'linked student saves and opts in');
select is(public.my_character_publication_state(), 'saved_private', 'switch off: saved privately, even when linked and opted in');
reset role;
update app_private.student_feature_controls set avatar_personalization = true;

-- 3. Linked + opted in + switch on: public, and the board shows every chosen field.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d1');
set local role authenticated;
select is(public.my_character_publication_state(), 'public', 'linked, opted in, switch on: public');
set local role anon;
select is((select avatar_key || '/' || avatar_family || '/' || avatar_tone || '/' || avatar_badge
           from public.public_level_leaderboard_v3(4::smallint) where position = 1),
  'tariq/ink/coral/⚡', 'podium row carries the chosen character, style, backdrop and sticker');

-- 4. Re-save after linking: the next anonymous read shows it, no new approval.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d1');
set local role authenticated;
select ok(public.save_own_avatar_preferences('zein', 'cartoon3d', 'lilac', '★', true), 'linked student re-saves a new look');
set local role anon;
select is((select avatar_key || '/' || avatar_family || '/' || avatar_tone || '/' || avatar_badge
           from public.public_level_leaderboard_v3(4::smallint) where position = 1),
  'zein/cartoon3d/lilac/★', 'the re-saved look is public at once, without another staff approval');
reset role;
select is((select count(*)::int from app_private.audit_events where action_key = 'leaderboard.links_approved'
           and reason_code like 'v930%'), 0, 'no link approval was needed for the change');

-- 5. Ranks 4-10 work the same way.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d2');
set local role authenticated;
select ok(public.save_own_avatar_preferences('mariam', 'ink', 'gold', '♥', true), 'rank-6 student saves and opts in');
select is(public.my_character_publication_state(), 'public', 'a linked rank 4-10 student is public');
set local role anon;
select is((select avatar_key || '/' || avatar_family || '/' || avatar_tone || '/' || avatar_badge
           from public.public_level_leaderboard_v3(5::smallint) where position = 6),
  'mariam/ink/gold/♥', 'rank 6 carries every chosen field');

-- 6. Opt-out falls back to the reviewed default at once; opting back in restores it.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d2');
set local role authenticated;
select ok(public.save_own_avatar_preferences('mariam', 'ink', 'gold', '♥', false), 'rank-6 student opts out');
select is(public.my_character_publication_state(), 'display_off', 'opted out: public display off');
set local role anon;
select is((select coalesce(avatar_key, 'none') || '/' || default_avatar_key from public.public_level_leaderboard_v3(5::smallint) where position = 6),
  'none/omar', 'opted out: the board shows the reviewed default');

-- 7. Saved and opted in but not in a published top 10 (never linked).
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d5');
set local role authenticated;
select ok(public.save_own_avatar_preferences('amara', 'ink', 'mint', '✦', true), 'a student outside the top 10 can still save');
select is(public.my_character_publication_state(), 'awaiting_link', 'opted in without a verified link: awaiting link');
-- 8. Another student's state is never readable: the call only answers for the caller.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d3');
set local role authenticated;
select is(public.my_character_publication_state(), 'not_saved', 'each student only ever sees their own state');
reset role;

-- 9. Suspension: the board drops the character immediately.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d6');
set local role authenticated;
select ok(public.save_own_avatar_preferences('malek', 'cartoon3d', 'blue', '★', true), 'linked L6 student saves and opts in');
reset role;
update app_private.accounts set status = 'suspended' where id = '20000000-0000-4000-8000-0000000000d6';
set local role anon;
select is((select coalesce(avatar_key, 'none') from public.public_level_leaderboard_v3(6::smallint) where position = 2),
  'none', 'a suspended student''s character leaves the board');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d6');
set local role authenticated;
select throws_ok('select public.my_character_publication_state()', '42501', null, 'a suspended student cannot query a state');
reset role;

-- 10. Publication replacement: Week 6 links d1 at L4 #3 only.
update public.published_leaderboard_snapshots set is_current = false where id = '30000000-0000-4000-8000-0000000000d5';
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000d6';
set local role anon;
select is((select string_agg(position::text, ',') from public.public_level_leaderboard_v3(4::smallint) where avatar_key is not null),
  '3', 'Week 6 shows d1 only at their Week 6 row');
select is((select count(avatar_key)::int from public.public_level_leaderboard_v3(5::smallint)), 0,
  'Week 5 links do not carry over to Week 6');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d2');
set local role authenticated;
select ok(public.save_own_avatar_preferences('mariam', 'ink', 'gold', '♥', true), 'd2 opts back in');
select is(public.my_character_publication_state(), 'awaiting_link', 'not linked in the new publication: awaiting link');
reset role;

-- 11. Withdrawal: no current publication, so nobody is public.
update public.published_leaderboard_snapshots set is_current = false, revoked_at = now() where id = '30000000-0000-4000-8000-0000000000d6';
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d1');
set local role authenticated;
select is(public.my_character_publication_state(), 'awaiting_link', 'withdrawn publication: nothing is public');
reset role;

-- 12. Rollback to Week 5 restores that version's links, with the latest saved looks.
-- (Week 6 is already withdrawn.)
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000d5';
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d2');
set local role authenticated;
select is(public.my_character_publication_state(), 'public', 'rollback: the Week 5 link applies again');
set local role anon;
select is((select string_agg(position::text || ':' || avatar_key, ',' order by position)
           from public.public_level_leaderboard_v3(4::smallint) where avatar_key is not null),
  '1:zein', 'rollback: d1 is back at Week 5 rank 1 with the latest saved look');

-- 13. Switching personalization off hides everything and says so.
reset role;
update app_private.student_feature_controls set avatar_personalization = false;
select pg_temp.as_user('10000000-0000-4000-8000-0000000000d1');
set local role authenticated;
select is(public.my_character_publication_state(), 'saved_private', 'switch off again: saved privately');

select * from finish();
rollback;
