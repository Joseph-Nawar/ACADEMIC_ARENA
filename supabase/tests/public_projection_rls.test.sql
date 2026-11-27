begin;
set local search_path = public, extensions;

select plan(22);

select has_table('public', 'published_leaderboard_snapshots', 'versioned public leaderboard snapshots exist');
select has_table('public', 'published_leaderboard_rows', 'public leaderboard rows exist');
select has_table('public', 'campus_wins_public', 'approved public Campus Wins projection exists');
select has_table('app_private', 'campus_wins_submissions', 'private Campus Wins submission state exists');
select has_table('app_private', 'campus_wins_reactions', 'private Campus Wins reaction ownership exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.published_leaderboard_snapshots'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.published_leaderboard_rows'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.campus_wins_public'::regclass),
  'all public projection tables have enabled and forced RLS'
);
select ok(
  has_column_privilege('anon', 'public.published_leaderboard_snapshots', 'version_number', 'select')
  and has_column_privilege('anon', 'public.published_leaderboard_snapshots', 'published_at', 'select')
  and has_table_privilege('anon', 'public.published_leaderboard_rows', 'select')
  -- Release B2 (issue #25): Campus Wins is public only through the consent-aware function.
  and has_function_privilege('anon', 'public.public_campus_wins_v2(text[])', 'execute')
  and not has_table_privilege('anon', 'public.campus_wins_public', 'select')
  and not has_table_privilege('authenticated', 'public.campus_wins_public', 'select'),
  'anonymous users can read the three allowlisted public projections (Campus Wins only through its consent-aware function)'
);
select ok(
  not has_table_privilege('anon', 'public.published_leaderboard_snapshots', 'insert')
  and not has_table_privilege('authenticated', 'public.published_leaderboard_snapshots', 'insert')
  and not has_table_privilege('anon', 'public.published_leaderboard_rows', 'update')
  and not has_table_privilege('authenticated', 'public.published_leaderboard_rows', 'delete')
  and not has_table_privilege('anon', 'public.campus_wins_public', 'insert')
  and not has_table_privilege('authenticated', 'public.campus_wins_public', 'update'),
  'browser roles cannot change rankings or approved Campus Wins projection rows'
);
select ok(
  not has_table_privilege('anon', 'app_private.campus_wins_submissions', 'select')
  and not has_table_privilege('authenticated', 'app_private.campus_wins_submissions', 'select')
  and not has_table_privilege('anon', 'app_private.campus_wins_reactions', 'select')
  and not has_table_privilege('authenticated', 'app_private.campus_wins_reactions', 'select'),
  'draft ownership, moderation, and reaction identities remain private'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('published_leaderboard_snapshots', 'published_leaderboard_rows', 'campus_wins_public')
      and column_name in (
        'account_id', 'provider_user_id', 'student_id', 'university_id',
        'provider_email', 'username', 'grade', 'academic_score', 'score',
        'attendance', 'attendance_history', 'draft_status', 'moderator_id', 'reaction_owner_id'
      )
  ),
  'public projections contain no private IDs, credentials, scores, grades, attendance, or moderation identities'
);
select ok(
  (select count(*) = 9 from information_schema.columns
   where table_schema = 'public' and table_name = 'published_leaderboard_rows'
     and column_name = any(array['level', 'semester', 'cohort_key', 'board_kind', 'module_key', 'position', 'public_name', 'avatar_key', 'avatar_family'])),
  'public board projection preserves the approved competition keys and display fields'
);
select ok(
  (select count(*) = 4 from information_schema.columns
   where table_schema = 'public' and table_name = 'campus_wins_public'
     and column_name = any(array['template_key', 'heart_count', 'clap_count', 'fire_count']))
  and not exists (select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'campus_wins_public'
     and column_name = any(array['body', 'external_url'])),
  'Campus Wins projection exposes templates and aggregate reactions without arbitrary content'
);

insert into public.published_leaderboard_snapshots (version_number, academic_year, published_at, first_published_at, is_current)
values
  (100, 'fictional-2026', now(), now(), true),
  (99, 'fictional-2025', now() - interval '1 year', now() - interval '1 year', false);
insert into public.published_leaderboard_rows (
  snapshot_id, level, semester, cohort_key, cohort_label, board_kind, module_key,
  position, public_name, avatar_key, avatar_family
)
select id, 5, 1, 'core', 'Core', 'semester', null, 1, 'Fictional Current', 'amara', 'ink'
from public.published_leaderboard_snapshots where version_number = 100;
insert into public.published_leaderboard_rows (
  snapshot_id, level, semester, cohort_key, cohort_label, board_kind, module_key,
  position, public_name, avatar_key, avatar_family
)
select id, 5, 1, 'core', 'Core', 'semester', null, 1, 'Fictional Retired', 'omar', 'cartoon3d'
from public.published_leaderboard_snapshots where version_number = 99;
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values (
  '10000000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'pg-campus-win@academic-arena.test', '', now(), '{}', '{}', now(), now(), false, false
);
insert into app_private.accounts (id, provider_user_id, status, force_password_change)
values ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000010', 'active', false);
insert into app_private.campus_wins_submissions (
  id, owner_account_id, template_key, status, public_author_name, approved_avatar_key,
  approved_avatar_family, moderated_at
)
values (
  '30000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000010',
  'workshop', 'approved', 'Fictional Current', 'amara', 'ink', now()
);
insert into public.campus_wins_public (
  post_id, template_key, public_author_name, avatar_key, avatar_family,
  published_at, heart_count, clap_count, fire_count
)
values ('30000000-0000-4000-8000-000000000010', 'workshop', 'Fictional Current', 'amara', 'ink', now(), 1, 2, 0);
insert into app_private.campus_wins_submissions (
  id, owner_account_id, template_key, status
)
values (
  '30000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000010', 'project', 'pending'
);

set local role anon;
select is((select count(*)::integer from public.published_leaderboard_rows), 1, 'anonymous readers cannot see retired board snapshots');
select is((select public_name from public.published_leaderboard_rows limit 1), 'Fictional Current', 'anonymous projection includes only current, approved public names');
select is((select count(*)::integer from public.published_leaderboard_snapshots), 1, 'anonymous readers see only the current snapshot version');
select is((select count(*)::integer from public.public_campus_wins_v2(array['workshop'])), 1, 'anonymous readers see the approved template projection');
select throws_ok('select count(*) from public.campus_wins_public', '42501', null, 'the legacy table is not directly readable');
select throws_ok(
  $$insert into public.published_leaderboard_snapshots (version_number, academic_year, published_at, is_current) values (101, 'fictional-invalid', now(), true)$$,
  '42501', null,
  'anonymous users cannot publish a leaderboard snapshot'
);
reset role;

select throws_ok(
  $$insert into public.campus_wins_public (post_id, template_key, public_author_name, avatar_key, avatar_family, published_at) values ('30000000-0000-4000-8000-000000000011', 'project', 'Fictional Current', 'amara', 'ink', now())$$,
  '23514', null,
  'pending Campus Wins submissions cannot enter the public projection'
);
select throws_ok(
  $$insert into public.campus_wins_public (post_id, template_key, public_author_name, avatar_key, avatar_family, published_at) values ('30000000-0000-4000-8000-000000000010', 'workshop', 'Unapproved Name', 'amara', 'ink', now())$$,
  '23514', null,
  'public Campus Wins fields must match the approved submission snapshot'
);

select throws_ok(
  $$insert into public.published_leaderboard_rows (snapshot_id, level, semester, cohort_key, cohort_label, board_kind, module_key, position, public_name, avatar_key, avatar_family) select id, 3, 1, 'core', 'Core', 'semester', null, 1, 'Invalid Level', 'amara', 'ink' from public.published_leaderboard_snapshots where version_number = 100$$,
  '23514', null,
  'leaderboard constraints reject levels outside 4, 5, and 6'
);
select throws_ok(
  $$insert into public.published_leaderboard_rows (snapshot_id, level, semester, cohort_key, cohort_label, board_kind, module_key, position, public_name, avatar_key, avatar_family) select id, 5, 1, 'core', 'Core', 'semester', 'module-x', 2, 'Invalid Module Shape', 'amara', 'ink' from public.published_leaderboard_snapshots where version_number = 100$$,
  '23514', null,
  'semester boards cannot carry a module key'
);

select * from finish();
rollback;
