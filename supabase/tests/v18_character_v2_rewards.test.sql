-- Release B2: V2 character storage, database-enforced ownership, verified
-- rank rewards (idempotent, period-keyed, revocable), the V2 public
-- projection and the consent-aware Campus Wins feed. Fictional records only.
begin;
set local search_path = public, extensions;
select plan(114);

create function pg_temp.as_user(p_uid text, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, true);
  select set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Fictional students e1..e6 and one admin (e9).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select ('10000000-0000-4000-8000-0000000000e' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', 'v18.s' || n || '@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false
from generate_series(1, 9) as n;
insert into app_private.accounts (id, provider_user_id, status, force_password_change, public_display_name)
select ('20000000-0000-4000-8000-0000000000e' || n)::uuid, ('10000000-0000-4000-8000-0000000000e' || n)::uuid, 'active', false,
       'Fictional V18 ' || n
from generate_series(1, 9) as n;
insert into app_private.account_role_grants (account_id, role_name)
select ('20000000-0000-4000-8000-0000000000e' || n)::uuid, 'student' from generate_series(1, 6) as n;
insert into app_private.account_role_grants (account_id, role_name) values ('20000000-0000-4000-8000-0000000000e9', 'admin');
insert into app_private.identity_mappings (account_id, username_normalized, provider_email)
select ('20000000-0000-4000-8000-0000000000e' || n)::uuid, 'v18-student' || n, 'v18.s' || n || '@academic-arena.test'
from generate_series(1, 6) as n;

-- Level-only publications: Week 5 (v9401); its correction (v9402); Week 6
-- (v9403); a draft (v9404); a re-publication of Week 5 under another label
-- with identical links (v9405); and a Week 5 version with incomplete links (v9406).
insert into public.published_leaderboard_snapshots (id, version_number, academic_year, release_label, board_format, published_at, first_published_at, is_current, board_count, row_count)
values ('30000000-0000-4000-8000-0000000000e1', 9401, '2026-27', 'Week 5', 'level_only', now(), now(), false, 3, 30),
       ('30000000-0000-4000-8000-0000000000e2', 9402, '2026-27', 'Week 5', 'level_only', now(), now(), false, 3, 30),
       ('30000000-0000-4000-8000-0000000000e3', 9403, '2026-27', 'Week 6', 'level_only', now(), now(), false, 3, 30),
       ('30000000-0000-4000-8000-0000000000e4', 9404, '2026-27', 'Draft', 'level_only', now(), null, false, 3, 30),
       ('30000000-0000-4000-8000-0000000000e5', 9405, '2026-27', 'Week 5 republished', 'level_only', now(), now(), false, 3, 30),
       ('30000000-0000-4000-8000-0000000000e6', 9406, '2026-27', 'Week 5', 'level_only', now(), now(), false, 3, 30);
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000e1';
insert into public.published_level_rows (snapshot_id, level, position, public_name)
select ('30000000-0000-4000-8000-0000000000e' || s)::uuid, lvl, pos, 'Fictional V18 ' || s || ' ' || chr(64 + lvl) || chr(64 + pos)
from generate_series(1, 6) as s, generate_series(4, 6) as lvl, generate_series(1, 10) as pos;
-- Week 5: e1 L4 #1, e2 L4 #2, e3 L5 #7, e4 (suspended later) L6 #1; e5 never linked.
-- Correction: e2 was really first and e1 second. Week 6: e1 at L4 #9.
insert into app_private.published_level_row_links (snapshot_id, level, position, account_id) values
  ('30000000-0000-4000-8000-0000000000e1', 4, 1, '20000000-0000-4000-8000-0000000000e1'),
  ('30000000-0000-4000-8000-0000000000e1', 4, 2, '20000000-0000-4000-8000-0000000000e2'),
  ('30000000-0000-4000-8000-0000000000e1', 5, 7, '20000000-0000-4000-8000-0000000000e3'),
  ('30000000-0000-4000-8000-0000000000e1', 6, 1, '20000000-0000-4000-8000-0000000000e4'),
  ('30000000-0000-4000-8000-0000000000e2', 4, 1, '20000000-0000-4000-8000-0000000000e2'),
  ('30000000-0000-4000-8000-0000000000e2', 4, 2, '20000000-0000-4000-8000-0000000000e1'),
  ('30000000-0000-4000-8000-0000000000e2', 5, 7, '20000000-0000-4000-8000-0000000000e3'),
  ('30000000-0000-4000-8000-0000000000e2', 6, 1, '20000000-0000-4000-8000-0000000000e4'),
  ('30000000-0000-4000-8000-0000000000e3', 4, 9, '20000000-0000-4000-8000-0000000000e1'),
  ('30000000-0000-4000-8000-0000000000e5', 4, 1, '20000000-0000-4000-8000-0000000000e1'),
  ('30000000-0000-4000-8000-0000000000e5', 4, 2, '20000000-0000-4000-8000-0000000000e2'),
  ('30000000-0000-4000-8000-0000000000e5', 5, 7, '20000000-0000-4000-8000-0000000000e3'),
  ('30000000-0000-4000-8000-0000000000e5', 6, 1, '20000000-0000-4000-8000-0000000000e4'),
  ('30000000-0000-4000-8000-0000000000e6', 4, 1, '20000000-0000-4000-8000-0000000000e2'),
  ('30000000-0000-4000-8000-0000000000e6', 4, 2, '20000000-0000-4000-8000-0000000000e1');
update app_private.student_feature_controls set student_sign_in = true, avatar_personalization = true,
  character_studio_v2 = false, cosmetic_rewards = false;

-- Config fixtures, readable by the test's authenticated role.
create temporary table cfg as
select app_private.character_v2_default() as base,
       jsonb_set(app_private.character_v2_default(), '{top}', '"varsity"') as varsity,
       jsonb_set(app_private.character_v2_default(), '{back}', '"cape"') as cape,
       jsonb_set(jsonb_set(app_private.character_v2_default(), '{hair}', '"afro"'), '{headwear}', '"wrap"') as afro_wrap;
grant select on cfg to authenticated;

-- 1. Privileges and private tables.
select ok(not has_function_privilege('anon', 'public.save_own_character_v2(bigint, jsonb, text, boolean, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.my_character_v2()', 'execute')
  and not has_function_privilege('anon', 'public.process_rank_rewards(uuid, text, text, text, integer)', 'execute')
  and not has_function_privilege('service_role', 'public.process_rank_rewards(uuid, text, text, text, integer)', 'execute'),
  'student and staff V2 RPCs are not callable by anonymous visitors or service_role');
select ok(has_function_privilege('anon', 'public.public_level_leaderboard_v4(smallint)', 'execute')
  and has_function_privilege('anon', 'public.public_campus_wins_v2(text[])', 'execute'),
  'the two public projections are callable anonymously');
select ok(not has_table_privilege('authenticated', 'app_private.cosmetic_entitlements', 'select')
  and not has_table_privilege('authenticated', 'app_private.cosmetic_entitlements', 'insert')
  and not has_table_privilege('authenticated', 'app_private.reward_events', 'select')
  and not has_table_privilege('anon', 'app_private.reward_periods', 'select'),
  'entitlements, periods and reward history are private');
select ok(not has_column_privilege('authenticated', 'public.student_avatar_configs', 'v2_config', 'update')
  and not has_column_privilege('authenticated', 'public.student_avatar_configs', 'v2_config', 'insert')
  and not has_column_privilege('authenticated', 'public.student_avatar_configs', 'active_look', 'update')
  and not has_column_privilege('authenticated', 'public.student_avatar_configs', 'revision', 'update'),
  'browser roles cannot write V2 columns directly');

-- 2. An existing classic look is kept exactly; nothing is converted.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e1');
set local role authenticated;
select ok(public.save_own_avatar_preferences('tariq', 'ink', 'coral', '⚡', true), 'e1 has a classic look, opted in');
select is(public.my_character_v2() ->> 'activeLook', 'classic', 'existing students stay on their classic look');
select is(public.my_character_v2() -> 'v2', 'null'::jsonb, 'no V2 look is invented for them');
select is(public.my_character_v2() ->> 'showOnCampusWins', 'false', 'Campus Wins consent is separate and starts off');
select is((public.my_character_v2() ->> 'revision')::int, 1, 'a revision is tracked');

-- 3. V2 saving needs the switch.
select throws_ok($$select public.save_own_character_v2(1, (select base from cfg), 'v2', true, false)$$,
  'AAC03', null, 'V2 cannot be saved while the studio switch is off');
reset role;
update app_private.student_feature_controls set character_studio_v2 = true;

select pg_temp.as_user('10000000-0000-4000-8000-0000000000e1');
set local role authenticated;
select is(public.save_own_character_v2(1, (select base from cfg), 'v2', true, false), 2::bigint, 'e1 saves a V2 look and shows it');
select is(public.my_character_v2() ->> 'activeLook', 'v2', 'V2 is now the shown look');
select is(public.my_character_v2() #>> '{classic,base}', 'tariq', 'the classic look is still stored');
select is((select character_key from public.student_avatar_configs), 'tariq', 'classic columns untouched');

-- 4. Stale and concurrent saves are refused, never silently overwrite.
select throws_ok($$select public.save_own_character_v2(1, (select afro_wrap from cfg), 'v2', true, false)$$,
  'AAC09', null, 'a save based on an old revision is refused');
-- 5. Locked items cannot be saved, through any path.
select throws_ok($$select public.save_own_character_v2(2, (select varsity from cfg), 'v2', true, false)$$,
  'AAC01', null, 'an unowned reward item cannot be saved by RPC');
select throws_ok($$update public.student_avatar_configs set v2_config = (select varsity from cfg)$$,
  '42501', null, 'nor by a direct table update');
reset role;
select throws_ok($$update public.student_avatar_configs set v2_config = (select varsity from cfg)
  where account_id = '20000000-0000-4000-8000-0000000000e1'$$,
  '22023', null, 'the table trigger refuses an unowned item even for a privileged writer');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e1');
set local role authenticated;

-- 6. Shape and compatibility checks.
select throws_ok($$select public.save_own_character_v2(2, (select base from cfg) || '{"extra":"x"}', 'v2', true, false)$$,
  '22023', null, 'unknown fields are refused');
select throws_ok($$select public.save_own_character_v2(2, (select base from cfg) - 'skin', 'v2', true, false)$$,
  '22023', null, 'missing fields are refused');
select throws_ok($$select public.save_own_character_v2(2, jsonb_set((select base from cfg), '{details}', '["freckles","dimples","lashes","rosy"]'), 'v2', true, false)$$,
  '22023', null, 'more than three details are refused');
select throws_ok($$select public.save_own_character_v2(2, jsonb_set((select base from cfg), '{details}', '["freckles","freckles"]'), 'v2', true, false)$$,
  '22023', null, 'duplicate details are refused');
select throws_ok($$select public.save_own_character_v2(2, jsonb_set((select base from cfg), '{skin}', '"#ff0000"'), 'v2', true, false)$$,
  '22023', null, 'raw colours (or any non-catalogue value) are refused');
select throws_ok($$select public.save_own_character_v2(2, jsonb_set((select afro_wrap from cfg), '{headwear}', '"beanie"'), 'v2', true, false)$$,
  '22023', null, 'a fitted hat over big hair is refused');
select throws_ok($$select public.save_own_character_v2(2, jsonb_set((select base from cfg), '{v}', '3'), 'v2', true, false)$$,
  '22023', null, 'an unknown schema version is refused');
select is(public.save_own_character_v2(2, (select afro_wrap from cfg), 'v2', true, false), 3::bigint, 'a head covering over big hair is fine');

-- 7. The public board shows the complete V2 look; v3 (rollback) shows the classic one.
set local role anon;
select is((select character_v2 ->> 'hair' || '/' || (character_v2 ->> 'headwear') from public.public_level_leaderboard_v4(4::smallint) where position = 1),
  'afro/wrap', 'v4 carries the complete saved V2 look');
select ok((select avatar_key is null from public.public_level_leaderboard_v4(4::smallint) where position = 1),
  'a V2 row carries no classic fields');
select is((select avatar_key from public.public_level_leaderboard_v3(4::smallint) where position = 1),
  'tariq', 'the Release A projection still shows the classic look (safe rollback)');
reset role;

-- 8. A V2-only student (never saved a classic look).
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e2');
set local role authenticated;
select is(public.save_own_character_v2(0, (select base from cfg), 'v2', false, false), 1::bigint, 'e2 saves only a V2 look, display off');
select throws_ok($$select public.save_own_character_v2(1, null, 'classic', false, false)$$,
  '22023', null, 'cannot show a classic look that does not exist');
select is(public.my_character_publication_state(), 'display_off', 'publication state follows the V2 look');
select is(public.save_own_character_v2(1, null, 'v2', true, false), 2::bigint, 'e2 turns public display on without resending the look');
select is(public.my_character_publication_state(), 'public', 'a linked V2-only student is public');
set local role anon;
select ok((select avatar_key is null and default_avatar_key is null
           from public.public_level_leaderboard_v3(4::smallint) where position = 2),
  'v3 shows the neutral fallback for a V2-only student (never a guessed character)');
select is((select character_v2 ->> 'top' from public.public_level_leaderboard_v4(4::smallint) where position = 2), 'hoodie', 'v4 shows their V2 look');
reset role;
-- Switch off: V2 looks leave the board (classic shown if present).
update app_private.student_feature_controls set character_studio_v2 = false;
set local role anon;
select is((select coalesce(avatar_key, '-') || '/' || coalesce(character_v2::text, '-') from public.public_level_leaderboard_v4(4::smallint) where position = 1),
  'tariq/-', 'with V2 switched off the board falls back to the saved classic look');
select is((select coalesce(character_v2::text, '-') from public.public_level_leaderboard_v4(4::smallint) where position = 2),
  '-', 'and shows no V2 look');
reset role;
update app_private.student_feature_controls set character_studio_v2 = true;

-- 9. Reward preview: aggregates only, no names; works with the switch off.
select is(app_private.canonical_period_key('2026-27', ' Week 05 '), '2026-27:week-5', 'period keys ignore case, spacing and leading zeros');
select is(app_private.canonical_period_key('2026-27', 'WEEK-5'), '2026-27:week-5', 'and punctuation');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e1');
set local role authenticated;
select throws_ok($$select public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5')$$, '42501', null, 'students cannot preview rewards');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal1');
select throws_ok($$select public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5')$$, '42501', null, 'staff need AAL2');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
create temporary table preview_one as select public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5') as p;
select is((select (p #>> '{collections,elite,newGrants}')::int from preview_one), 4, 'preview: 4 linked students earn Elite');
select is((select (p #>> '{collections,podium,newGrants}')::int from preview_one), 3, 'preview: 3 earn Podium');
select is((select (p #>> '{collections,champion,newGrants}')::int from preview_one), 2, 'preview: 2 level winners earn Champion');
select is((select (p #>> '{expectedChanges,grant}')::int from preview_one), 9, 'preview: 9 grants in total');
select is((select (p #>> '{exclusions,unlinked}')::int from preview_one), 26, 'preview: unverified rows are excluded and counted');
select is((select p ->> 'canonicalKey' from preview_one), '2026-27:week-5', 'preview: the canonical period key');
select is((select p -> 'blockers' from preview_one), '[]'::jsonb, 'preview: nothing blocks the live publication');
select ok((select p::text !~ 'V18 [0-9]|v18-student|academic-arena\.test' from preview_one), 'preview contains no names, usernames or emails');
select throws_ok($$select public.process_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5', 'Week 5', 'grant', 9)$$, 'AAR01', null, 'nothing is granted while the rewards switch is off');
select throws_ok($$select public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e4', 'draft-period')$$, '22023', null, 'a never-published draft cannot earn rewards');
reset role;
update app_private.accounts set status = 'suspended' where id = '20000000-0000-4000-8000-0000000000e4';
update app_private.student_feature_controls set cosmetic_rewards = true;

-- 10. Processing: typo-proof periods, live publication only, exact confirmation, idempotent.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
select throws_ok($$select public.process_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:weak-5', 'Week 5', 'grant', 9)$$, 'AAR08', null, 'a typo cannot open a new earning period');
select throws_ok($$select public.process_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-05', 'Week 5', 'grant', 9)$$, 'AAR08', null, 'nor can a formatting variant');
select throws_ok($$select public.process_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5', 'Week 5', 'grant', 8)$$, 'AAR06', null, 'a confirmation that does not match the preview changes nothing');
select is((public.process_rank_rewards('30000000-0000-4000-8000-0000000000e1', ' 2026-27:WEEK-5 ', 'Week 5', 'grant', 9) ->> 'granted')::int,
  9, 'Week 5 grants e1 3, e2 2, e3 1 and the suspended e4 3 (status does not cancel verified results)');
reset role;
select is((select count(*)::int from app_private.cosmetic_entitlements), 9, 'nine entitlements, one period');
select is((select count(*)::int from app_private.reward_periods), 1, 'the normalized key opened exactly one period');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
select is((public.process_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5', 'Week 5', 'grant', (public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5') #>> '{expectedChanges,grant}')::int) ->> 'granted')::int, 0, 'a retry grants nothing');
select throws_ok($$select public.process_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5-again', 'Week 5', 'grant', 0)$$, 'AAR02', null, 'the same publication cannot be re-keyed into another period');
select throws_ok($$select public.process_rank_rewards('30000000-0000-4000-8000-0000000000e2', '2026-27:week-5', 'Week 5', 'grant', 1)$$, 'AAR04', null, 'a historical (non-live) publication cannot be processed');
reset role;
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000e5';
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
select is((select public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e5', '2026-27:week-5-republished') #>> '{conflicts,likelyReplacementOf}'), '2026-27:week-5',
  'a re-publication under another label is recognised as a replacement');
select throws_ok($$select public.process_rank_rewards('30000000-0000-4000-8000-0000000000e5', '2026-27:week-5-republished', 'Week 5 republished', 'grant', 0)$$, 'AAR02', null,
  'a replacement publication cannot open a second period for the same competition');
select is((public.process_rank_rewards('30000000-0000-4000-8000-0000000000e5', '2026-27:week-5', 'Week 5', 'grant', (public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e5', '2026-27:week-5') #>> '{expectedChanges,grant}')::int) ->> 'granted')::int, 0, 'processed under its real period it grants nothing new');
reset role;
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000e2';
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
select is((public.process_rank_rewards('30000000-0000-4000-8000-0000000000e2', '2026-27:week-5', 'Week 5', 'grant', (public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e2', '2026-27:week-5') #>> '{expectedChanges,grant}')::int) ->> 'granted')::int, 1, 'the corrected Week 5 publication (grant mode) adds only e2''s Champion');
reset role;
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000e1';
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
select is((public.process_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5', 'Week 5', 'grant', (public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e1', '2026-27:week-5') #>> '{expectedChanges,grant}')::int) ->> 'granted')::int, 0, 'rolling back to the first version grants nothing new');
reset role;
select is((select count(*)::int from app_private.cosmetic_entitlements), 10, 'no duplicates after retries, replacement, correction and rollback');
select is((select count(*)::int from app_private.reward_periods), 1, 'still exactly one Week 5 period');
select is((select count(*)::int from app_private.cosmetic_entitlements where account_id = '20000000-0000-4000-8000-0000000000e3'), 1,
  'e3 earned Elite although their character is not public (consent is independent)');

-- 11. Owned items can be equipped and are public at once.
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e1');
set local role authenticated;
select ok(public.my_character_v2() -> 'owned' ? 'champion', 'e1 owns Champion');
select is(jsonb_array_length(public.my_character_v2() -> 'grants'), 3, 'e1 sees their three grants');
select is(public.save_own_character_v2(3, (select cape from cfg), 'v2', true, false), 4::bigint, 'e1 equips the Champion cape');
set local role anon;
select is((select character_v2 ->> 'back' from public.public_level_leaderboard_v4(4::smallint) where position = 1), 'cape',
  'another visitor sees the cape on the next load');
reset role;

-- 12. Dropping in rank later keeps earned items (Week 6 is a separate period).
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000e3';
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
select is((public.process_rank_rewards('30000000-0000-4000-8000-0000000000e3', '2026-27:week-6', 'Week 6', 'grant', (public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e3', '2026-27:week-6') #>> '{expectedChanges,grant}')::int) ->> 'granted')::int, 1, 'Week 6: e1 (now #9) earns Elite for that period');
reset role;
select is((select count(*)::int from app_private.cosmetic_entitlements where account_id = '20000000-0000-4000-8000-0000000000e1' and revoked_at is null),
  4, 'e1 keeps everything from Week 5 after dropping to #9');

-- 13. Reconciliation after a correction: guarded, confirmed, audited, with equipped fallback.
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000e6';
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
select ok((select (public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e6', '2026-27:week-5') #>> '{conflicts,incompleteLinks}')::boolean),
  'preview flags a version with fewer verified links than earlier versions of the period');
select throws_ok($$select public.process_rank_rewards('30000000-0000-4000-8000-0000000000e6', '2026-27:week-5', 'Week 5', 'reconcile', (public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e6', '2026-27:week-5') #>> '{expectedChanges,reconcile}')::int)$$, 'AAR05', null, 'incomplete links cannot trigger a mass revocation');
reset role;
update public.published_leaderboard_snapshots set is_current = false where is_current;
update public.published_leaderboard_snapshots set is_current = true where id = '30000000-0000-4000-8000-0000000000e2';
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
create temporary table preview_two as select public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e2', '2026-27:week-5') as p;
select is((select (p #>> '{collections,champion,wouldRevoke}')::int from preview_two), 1, 'preview shows the one Champion the correction would revoke');
select is((select (p #>> '{revocation,students}')::int from preview_two), 1, 'one student affected');
select is((select (p #>> '{revocation,equippedFallbacks}')::int from preview_two), 1, 'who is wearing an item that will fall back');
select is((select (p #>> '{expectedChanges,reconcile}')::int from preview_two), 1, 'one change to confirm');
select throws_ok($$select public.process_rank_rewards('30000000-0000-4000-8000-0000000000e2', '2026-27:week-5', 'Week 5', 'reconcile', 0)$$, 'AAR06', null, 'reconcile needs the exact previewed count');
select is((public.process_rank_rewards('30000000-0000-4000-8000-0000000000e2', '2026-27:week-5', 'Week 5', 'reconcile', (public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e2', '2026-27:week-5') #>> '{expectedChanges,reconcile}')::int) ->> 'revoked')::int, 1, 'reconcile revokes e1''s Week 5 Champion');
reset role;
select is((select count(*)::int from app_private.cosmetic_entitlements where account_id = '20000000-0000-4000-8000-0000000000e4' and revoked_at is null),
  3, 'the suspended e4 keeps everything their verified results earned');
select is((select revoke_reason from app_private.cosmetic_entitlements where account_id = '20000000-0000-4000-8000-0000000000e1'
  and collection_key = 'champion'), 'result_corrected', 'the revocation records its reason');
select is((select v2_config ->> 'back' from public.student_avatar_configs where account_id = '20000000-0000-4000-8000-0000000000e1'),
  'none', 'the equipped cape falls back to the free default');
select is((select count(*)::int from public.student_avatar_configs where account_id = '20000000-0000-4000-8000-0000000000e9'), 0,
  'a staff-side fallback never moves the row to the staff account');
select is((select count(*)::int from app_private.reward_events where target_account_id = '20000000-0000-4000-8000-0000000000e1'
  and event_kind in ('revoked', 'equipped_fallback')), 2, 'both are in the append-only history');
set local role anon;
select is((select character_v2 ->> 'back' from public.public_level_leaderboard_v4(4::smallint) where position = 2), 'none',
  'the public board no longer shows the revoked item');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e1');
set local role authenticated;
select throws_ok($$select public.save_own_character_v2(4, (select cape from cfg), 'v2', true, false)$$,
  'AAC09', null, 'a tab holding the pre-fallback revision cannot re-save the cape');
select throws_ok($$select public.save_own_character_v2(5, (select cape from cfg), 'v2', true, false)$$,
  'AAC01', null, 'and the current revision cannot equip it either');
reset role;
select throws_ok($$update app_private.reward_events set reason_code = 'x'$$, '42501', null, 'reward history cannot be edited');
select throws_ok($$delete from app_private.reward_events$$, '42501', null, 'reward history cannot be deleted');
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e9', 'aal2');
set local role authenticated;
select is((public.process_rank_rewards('30000000-0000-4000-8000-0000000000e2', '2026-27:week-5', 'Week 5', 'reconcile', (public.preview_rank_rewards('30000000-0000-4000-8000-0000000000e2', '2026-27:week-5') #>> '{expectedChanges,reconcile}')::int) ->> 'revoked')::int, 0, 'a reconcile retry revokes nothing more');
select ok(public.revoke_cosmetic_entitlement('v18-student3', 'elite', '2026-27:week-5', 'link_corrected'), 'staff revoke one grant with a reason');
select throws_ok($$select public.revoke_cosmetic_entitlement('v18-student3', 'elite', '2026-27:week-5', 'because')$$,
  '22023', null, 'free-text reasons are refused');
reset role;
select is((select count(*)::int from app_private.audit_events where action_key in ('rewards.processed', 'rewards.revoked')), 9,
  'every processing run and revocation is audited');

-- 14. Campus Wins (issue #25): separate consent, latest look, lifecycle.
insert into app_private.campus_wins_submissions (id, owner_account_id, template_key, status, public_author_name, approved_avatar_key, approved_avatar_family, moderated_at)
values ('40000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'workshop', 'approved', 'Fictional V18 1', 'omar', 'ink', now()),
       ('40000000-0000-4000-8000-0000000000e3', '20000000-0000-4000-8000-0000000000e3', 'project', 'approved', 'Fictional V18 3', 'omar', 'ink', now());
insert into public.campus_wins_public (post_id, template_key, public_author_name, avatar_key, avatar_family, published_at)
values ('40000000-0000-4000-8000-0000000000e1', 'workshop', 'Fictional V18 1', 'omar', 'ink', now()),
       ('40000000-0000-4000-8000-0000000000e3', 'project', 'Fictional V18 3', 'omar', 'ink', now() - interval '1 minute');
set local role anon;
select ok((select avatar_key is null and character_v2 is null from public.public_campus_wins_v2(array['workshop'])),
  'leaderboard consent alone shows only the neutral figure on Campus Wins');
select is((select count(*)::int from public.public_campus_wins_v2(array['project'])), 1, 'a win without any saved character still appears');
select ok((select avatar_key is null from public.public_campus_wins_v2(array['project'])), 'with the neutral figure, never the omar default');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e1');
set local role authenticated;
select is(public.save_own_character_v2(5, jsonb_set((select base from cfg), '{hair}', '"locs"'), 'v2', true, true), 6::bigint,
  'e1 consents to Campus Wins and changes their hair');
set local role anon;
select is((select character_v2 ->> 'hair' from public.public_campus_wins_v2(array['workshop'])), 'locs', 'the win shows the latest saved look');
reset role;
update app_private.accounts set status = 'suspended' where id = '20000000-0000-4000-8000-0000000000e1';
set local role anon;
select is((select count(*)::int from public.public_campus_wins_v2(array['workshop'])), 0, 'a suspended author''s win leaves the feed');
select is((select count(*)::int from public.public_campus_wins_v2(array['workshop'])), 0, 'a suspended author''s wins disappear');
select is((select count(*)::int from public.public_level_leaderboard_v4(4::smallint) where position = 1 and character_v2 is not null), 1,
  'others are unaffected');
select is((select count(*)::int from public.public_level_leaderboard_v4(4::smallint) where position = 2 and (character_v2 is not null or avatar_key is not null)), 0,
  'the suspended student leaves the board too');
reset role;
update app_private.accounts set status = 'active' where id = '20000000-0000-4000-8000-0000000000e1';
update app_private.campus_wins_submissions set status = 'hidden' where id = '40000000-0000-4000-8000-0000000000e1';
set local role anon;
select is((select count(*)::int from public.public_campus_wins_v2(array['workshop'])), 0, 'a hidden win disappears even if its row lingers');
reset role;
update app_private.campus_wins_submissions set status = 'approved' where id = '40000000-0000-4000-8000-0000000000e1';
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e1');
set local role authenticated;
select is(public.save_own_character_v2(6, null, 'v2', true, false), 7::bigint, 'e1 withdraws Campus Wins consent only');
set local role anon;
select ok((select character_v2 is null from public.public_campus_wins_v2(array['workshop'])), 'withdrawal takes effect on the next read');
select is((select character_v2 ->> 'hair' from public.public_level_leaderboard_v4(4::smallint) where position = 2), 'locs',
  'the leaderboard consent is unaffected');
-- Direct database access cannot bypass consent, suspension or moderation.
select throws_ok('select count(*) from public.campus_wins_public', '42501', null, 'anonymous REST cannot read the legacy table');
select throws_ok('select avatar_key from public.campus_wins_public', '42501', null, 'nor its snapshotted look');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-0000000000e3');
set local role authenticated;
select throws_ok('select count(*) from public.campus_wins_public', '42501', null, 'signed-in students cannot read it either');
select throws_ok('select count(*) from app_private.campus_wins_submissions', '42501', null, 'nor the private submissions');
reset role;

select * from finish();
rollback;
