begin;
set local search_path = public, extensions;

select plan(71);

create function pg_temp.as_user(p_uid text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, true);
  select set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Grants.
select ok(not has_function_privilege('anon', 'public.create_leaderboard_draft(text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.publish_leaderboard_snapshot(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.moderate_campus_win(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.set_campus_win_reaction(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.submit_campus_win(text)', 'execute'),
  'anonymous visitors cannot call any M3 mutation');
select ok(has_function_privilege('anon', 'public.public_leaderboard_board(smallint,smallint,text,text,text)', 'execute')
  and has_function_privilege('anon', 'public.public_leaderboard_catalog(smallint,smallint)', 'execute'),
  'public read RPCs are available to anonymous visitors');
select ok(not has_column_privilege('anon', 'public.published_leaderboard_snapshots', 'row_count', 'select')
  and not has_column_privilege('anon', 'public.published_leaderboard_snapshots', 'first_published_at', 'select'),
  'anonymous visitors see only public snapshot columns');
select ok(not has_table_privilege('authenticated', 'app_private.campus_wins_submissions', 'select')
  and not has_table_privilege('authenticated', 'app_private.campus_wins_reactions', 'select')
  and not has_table_privilege('authenticated', 'public.campus_wins_public', 'insert')
  and not has_table_privilege('authenticated', 'public.published_leaderboard_rows', 'insert'),
  'browser roles cannot read private Campus Wins tables or write public projections');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}', '{}', now(), now(), false, false
from (values
  ('10000000-0000-4000-8000-000000000081', 'publisher@academic-arena.test'),
  ('10000000-0000-4000-8000-000000000082', 'moderator@academic-arena.test'),
  ('10000000-0000-4000-8000-000000000083', 'student.one@academic-arena.test'),
  ('10000000-0000-4000-8000-000000000084', 'student.two@academic-arena.test'),
  ('10000000-0000-4000-8000-000000000085', 'student.noname@academic-arena.test')
) as fixture(id, email);
insert into app_private.accounts (id, provider_user_id, status, force_password_change, public_display_name) values
  ('20000000-0000-4000-8000-000000000081', '10000000-0000-4000-8000-000000000081', 'active', false, null),
  ('20000000-0000-4000-8000-000000000082', '10000000-0000-4000-8000-000000000082', 'active', false, null),
  ('20000000-0000-4000-8000-000000000083', '10000000-0000-4000-8000-000000000083', 'active', false, 'Laila H.'),
  ('20000000-0000-4000-8000-000000000084', '10000000-0000-4000-8000-000000000084', 'active', false, 'Karim S.'),
  ('20000000-0000-4000-8000-000000000085', '10000000-0000-4000-8000-000000000085', 'active', false, null);
insert into app_private.identity_mappings (account_id, username_normalized, provider_email) values
  ('20000000-0000-4000-8000-000000000083', 'student.one', 'student.one@academic-arena.test'),
  ('20000000-0000-4000-8000-000000000084', 'student.two', 'student.two@academic-arena.test'),
  ('20000000-0000-4000-8000-000000000085', 'student.noname', 'student.noname@academic-arena.test');
insert into app_private.account_role_grants (account_id, role_name) values
  ('20000000-0000-4000-8000-000000000081', 'publisher'),
  ('20000000-0000-4000-8000-000000000082', 'moderator'),
  ('20000000-0000-4000-8000-000000000083', 'student'),
  ('20000000-0000-4000-8000-000000000084', 'student'),
  ('20000000-0000-4000-8000-000000000085', 'student');
insert into public.student_avatar_configs (account_id, character_key, family, tone, badge)
values ('20000000-0000-4000-8000-000000000083', 'amara', 'cartoon3d', 'mint', '✦');

create temp table fixture_rows (v jsonb);
insert into fixture_rows values ($$[
  {"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core cohort","board_kind":"semester","module_key":null,"module_label":null,"position":1,"public_name":"Mariam A.","avatar_key":"mariam","avatar_family":"ink"},
  {"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core cohort","board_kind":"semester","module_key":null,"module_label":null,"position":2,"public_name":"Omar B.","avatar_key":"omar","avatar_family":"cartoon3d"},
  {"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core cohort","board_kind":"module","module_key":"cm2005","module_label":"Object-oriented programming","position":1,"public_name":"Omar B.","avatar_key":"omar","avatar_family":"ink"}
]$$);
grant select on fixture_rows to authenticated;

-- Authorization.
select pg_temp.as_user('10000000-0000-4000-8000-000000000081', 'aal1');
set local role authenticated;
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', (select v from fixture_rows))$$, '42501', null,
  'a publisher at AAL1 cannot create a draft');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000083', 'aal2');
set local role authenticated;
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', (select v from fixture_rows))$$, '42501', null,
  'a student cannot create a draft even with an AAL2 claim');
select throws_ok($$select public.withdraw_current_leaderboard()$$, '42501', null, 'a student cannot withdraw rankings');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000082', 'aal2');
set local role authenticated;
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', (select v from fixture_rows))$$, '42501', null,
  'a moderator cannot publish rankings');
reset role;

-- Draft validation and privacy.
select pg_temp.as_user('10000000-0000-4000-8000-000000000081', 'aal2');
set local role authenticated;
select throws_ok($$select * from public.create_leaderboard_draft('2026', (select v from fixture_rows))$$, '22023', null,
  'academic year format is enforced');
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', '[{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core","board_kind":"semester","position":2,"public_name":"A","avatar_key":"omar","avatar_family":"ink"}]')$$,
  '22023', null, 'positions must start at 1 and be contiguous');
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', '[{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core","board_kind":"semester","position":1,"public_name":"A","avatar_key":"omar","avatar_family":"ink"},{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core","board_kind":"semester","position":1,"public_name":"B","avatar_key":"omar","avatar_family":"ink"}]')$$,
  '23505', null, 'duplicate rank within a board is rejected');
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', '[{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core","board_kind":"semester","position":1,"public_name":"Same","avatar_key":"omar","avatar_family":"ink"},{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core","board_kind":"semester","position":2,"public_name":"same ","avatar_key":"omar","avatar_family":"ink"}]')$$,
  '22023', null, 'duplicate student within a board is rejected');
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', '[{"level":5,"semester":1,"cohort_key":"core","cohort_label":"=cmd()","board_kind":"semester","position":1,"public_name":"A","avatar_key":"omar","avatar_family":"ink"}]')$$,
  '23514', null, 'formula-prefixed labels are rejected by the database');
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', '[{"level":7,"semester":1,"cohort_key":"core","cohort_label":"Core","board_kind":"semester","position":1,"public_name":"A","avatar_key":"omar","avatar_family":"ink"}]')$$,
  '23514', null, 'unsupported level is rejected');
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', '[{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core","board_kind":"semester","position":1,"public_name":"<script>","avatar_key":"omar","avatar_family":"ink"}]')$$,
  '23514', null, 'markup in a public name is rejected by the database');
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', '[{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core","board_kind":"semester","position":1,"public_name":"A","avatar_key":"hacker","avatar_family":"ink"}]')$$,
  '23514', null, 'unknown avatar is rejected');
select throws_ok($$select * from public.create_leaderboard_draft('2026-27', '[{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core","board_kind":"semester","position":1,"public_name":"A","avatar_key":"omar","avatar_family":"ink"},{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Other","board_kind":"module","module_key":"m1","module_label":"M","position":1,"public_name":"A","avatar_key":"omar","avatar_family":"ink"}]')$$,
  '22023', null, 'inconsistent cohort labels are rejected');
select is((select count(*)::integer from public.published_leaderboard_snapshots), 0, 'failed drafts leave nothing behind');

create temp table draft_one as select * from public.create_leaderboard_draft('2026-27', (select v from fixture_rows));
select is((select row(version_number, row_count, board_count)::text from draft_one), row(1::bigint, 3, 2)::text,
  'a valid draft records its version and size');
reset role;
set local role anon;
select is((select count(*)::integer from public.public_leaderboard_board(5::smallint, 1::smallint, 'core', 'semester', null)), 0,
  'an unpublished draft is not public');
reset role;

-- Publish.
select pg_temp.as_user('10000000-0000-4000-8000-000000000081', 'aal2');
set local role authenticated;
select is(public.publish_leaderboard_snapshot((select draft_id from draft_one)), 1::bigint, 'publisher publishes the draft');
reset role;
set local role anon;
select is((select array_agg(public_name order by position) from public.public_leaderboard_board(5::smallint, 1::smallint, 'core', 'semester', null)),
  array['Mariam A.', 'Omar B.'], 'the published semester board is public');
select is((select count(*)::integer from public.public_leaderboard_board(5::smallint, 1::smallint, 'core', 'module', 'cm2005')), 1,
  'the published module board is public');
select is((select count(*)::integer from public.public_leaderboard_catalog(5::smallint, 1::smallint)), 2, 'catalog lists both boards');
select is((select count(*)::integer from public.public_leaderboard_catalog(4::smallint, 1::smallint)), 0, 'empty level has an empty catalog');
reset role;

-- A second publication that omits the module board retires it.
select pg_temp.as_user('10000000-0000-4000-8000-000000000081', 'aal2');
set local role authenticated;
create temp table draft_two as select * from public.create_leaderboard_draft('2026-27',
  '[{"level":5,"semester":1,"cohort_key":"core","cohort_label":"Core cohort","board_kind":"semester","position":1,"public_name":"Omar B.","avatar_key":"omar","avatar_family":"ink"}]');
select is(public.publish_leaderboard_snapshot((select draft_id from draft_two)), 2::bigint, 'second publication goes live');
reset role;
set local role anon;
select is((select count(*)::integer from public.public_leaderboard_board(5::smallint, 1::smallint, 'core', 'module', 'cm2005')), 0,
  'an omitted board disappears with the new publication');
select is((select array_agg(public_name) from public.public_leaderboard_board(5::smallint, 1::smallint, 'core', 'semester', null)),
  array['Omar B.'], 'the replacement board is shown');
reset role;
select is((select count(*)::integer from public.published_leaderboard_snapshots where is_current), 1, 'exactly one snapshot is current');

-- Rollback, withdraw, history.
select pg_temp.as_user('10000000-0000-4000-8000-000000000081', 'aal2');
set local role authenticated;
select is(public.publish_leaderboard_snapshot((select draft_id from draft_one)), 1::bigint, 'rollback republishes version 1');
reset role;
set local role anon;
select is((select count(*)::integer from public.public_leaderboard_board(5::smallint, 1::smallint, 'core', 'module', 'cm2005')), 1,
  'rollback restores the complete earlier publication');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000081', 'aal2');
set local role authenticated;
select is((select array_agg(state order by version_number) from public.list_leaderboard_publications()), array['live', 'previous'],
  'history shows live and previous publications');
select ok(public.withdraw_current_leaderboard(), 'publisher withdraws the live rankings');
select is(public.withdraw_current_leaderboard(), false, 'withdraw is a no-op when nothing is live');
reset role;
set local role anon;
select is((select count(*)::integer from public.public_leaderboard_catalog(5::smallint, 1::smallint)), 0, 'withdrawn rankings are not public');
reset role;
select is((select count(*)::integer from app_private.audit_events where action_key like 'leaderboard.%'), 6,
  'publication actions are audited (2 drafts, publish, publish, rollback, withdraw)');
select throws_ok($$update public.published_leaderboard_snapshots set is_current = true, revoked_at = null, published_at = now(), first_published_at = now()$$, '23505', null,
  'the database rejects two current snapshots');

-- Campus Wins submissions.
select pg_temp.as_user('10000000-0000-4000-8000-000000000085', 'aal1');
set local role authenticated;
select throws_ok($$select public.submit_campus_win('top3')$$, 'AAW03', null, 'a student without an approved public name cannot submit');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000083', 'aal1');
set local role authenticated;
select throws_ok($$select public.submit_campus_win('free text')$$, '22023', null, 'only predefined templates are accepted');
create temp table post_one as select public.submit_campus_win('top3') as id;
select throws_ok($$select public.submit_campus_win('helped')$$, 'AAW01', null, 'only one pending submission per student');
select is((select status from public.my_campus_wins()), 'pending', 'student sees own submission status');
reset role;
set local role anon;
select is((select count(*)::integer from public.public_campus_wins_v2(array['top3','workshop','project','helped'])), 0, 'pending submissions are not public');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000084', 'aal1');
set local role authenticated;
select is((select count(*)::integer from public.my_campus_wins()), 0, 'students cannot see each other''s submissions');
select throws_ok($$select public.moderate_campus_win((select id from post_one), 'approved')$$, '42501', null,
  'a student cannot moderate');
reset role;

-- Moderation.
select pg_temp.as_user('10000000-0000-4000-8000-000000000082', 'aal1');
set local role authenticated;
select throws_ok($$select public.moderate_campus_win((select id from post_one), 'approved')$$, '42501', null,
  'a moderator at AAL1 cannot moderate');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000081', 'aal2');
set local role authenticated;
select throws_ok($$select public.moderate_campus_win((select id from post_one), 'approved')$$, '42501', null,
  'a publisher without moderation permission cannot moderate');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000082', 'aal2');
set local role authenticated;
select is((select author_name from public.list_campus_win_moderation('pending')), 'Laila H.', 'moderator sees the canonical name in the queue');
select throws_ok($$select public.moderate_campus_win((select id from post_one), 'hidden')$$, 'AAW04', null,
  'a pending post cannot be hidden before approval');
select is(public.moderate_campus_win((select id from post_one), 'approved'), 'approved', 'moderator approves');
reset role;
-- The approval still records the canonical name (and, for rollback only, the
-- legacy look snapshot); the public read path shows the name and, without the
-- separate Campus Wins consent (Release B2, issue #25), no character.
select is((select row(public_author_name, avatar_key, avatar_family)::text from public.campus_wins_public),
  row('Laila H.', 'amara', 'cartoon3d')::text, 'approved post records the canonical name');
set local role anon;
select is((select row(public_author_name, avatar_key, character_v2)::text from public.public_campus_wins_v2(array['top3','workshop','project','helped'])),
  row('Laila H.', null::text, null::jsonb)::text, 'the public projection shows the canonical name and no unconsented character');
select throws_ok('select count(*) from public.campus_wins_public', '42501', null, 'the legacy table and its snapshot are not directly readable');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000083', 'aal1');
set local role authenticated;
select throws_ok($$select public.submit_campus_win('helped')$$, 'AAW02', null, 'one new submission per seven days');
reset role;

-- Reactions.
select pg_temp.as_user('10000000-0000-4000-8000-000000000084', 'aal1');
set local role authenticated;
select is(public.set_campus_win_reaction((select id from post_one), 'heart'), 'heart', 'student reacts');
select is(public.set_campus_win_reaction((select id from post_one), 'fire'), 'fire', 'student changes reaction');
select throws_ok($$select public.set_campus_win_reaction((select id from post_one), 'angry')$$, '22023', null, 'only three reactions exist');
select throws_ok($$select public.set_campus_win_reaction(gen_random_uuid(), 'heart')$$, 'AAW05', null, 'cannot react to a non-public post');
select is((select array_agg(reaction_key) from public.my_campus_win_reactions()), array['fire'], 'student sees own reaction privately');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000083', 'aal1');
set local role authenticated;
select throws_ok($$select public.set_campus_win_reaction((select id from post_one), 'fire')$$, 'AAW06', null,
  'a student cannot react to their own post');
reset role;
insert into app_private.campus_wins_reactions (post_id, owner_account_id, reaction_key)
select id, '20000000-0000-4000-8000-000000000085', 'fire' from post_one;
update public.campus_wins_public set fire_count = fire_count + 1;
select is((select array[heart_count, clap_count, fire_count] from public.campus_wins_public), array[0, 0, 2],
  'aggregate counts follow changes exactly');
select pg_temp.as_user('10000000-0000-4000-8000-000000000084', 'aal1');
set local role authenticated;
select is(public.set_campus_win_reaction((select id from post_one), 'fire'), null, 'same reaction again removes it');
reset role;
select is((select fire_count from public.campus_wins_public), 1, 'removing a reaction decrements the count');
select pg_temp.as_user('10000000-0000-4000-8000-000000000082', 'aal2');
set local role authenticated;
select throws_ok($$select public.set_campus_win_reaction((select id from post_one), 'heart')$$, '42501', null, 'staff cannot react');

-- Hide and remove.
select is(public.moderate_campus_win((select id from post_one), 'hidden'), 'hidden', 'moderator hides an approved post');
reset role;
select is((select count(*)::integer from public.campus_wins_public), 0, 'hidden post leaves the public feed');
select is((select count(*)::integer from app_private.campus_wins_reactions), 1, 'hiding keeps reactions');
select pg_temp.as_user('10000000-0000-4000-8000-000000000082', 'aal2');
set local role authenticated;
select is(public.moderate_campus_win((select id from post_one), 'approved'), 'approved', 'hidden post can be restored');
reset role;
select is((select fire_count from public.campus_wins_public), 1, 'restored post recomputes counts from reactions');
select pg_temp.as_user('10000000-0000-4000-8000-000000000082', 'aal2');
set local role authenticated;
select is(public.moderate_campus_win((select id from post_one), 'removed'), 'removed', 'moderator removes the post');
reset role;
select is((select count(*)::integer from app_private.campus_wins_reactions), 0, 'removal deletes reactions');
select pg_temp.as_user('10000000-0000-4000-8000-000000000083', 'aal1');
set local role authenticated;
select is((select status from public.my_campus_wins()), 'not_shown', 'owner sees no moderation detail for removed posts');
reset role;

select * from finish();
rollback;
