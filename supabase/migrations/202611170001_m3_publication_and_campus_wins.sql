-- M3: versioned leaderboard publication, public read RPCs, Campus Wins
-- submissions, moderation, and reactions.
--
-- Every mutating function is SECURITY DEFINER, derives the caller from the
-- verified JWT, and checks app_private.has_permission (role + AAL2 for staff,
-- active account, no forced password change). Public read functions are
-- SECURITY INVOKER so the existing RLS policies still apply.

------------------------------------------------------------------------------
-- Leaderboard publication
------------------------------------------------------------------------------

-- published_at now records the most recent time a snapshot became current;
-- first_published_at is null for a draft that was never published.
alter table public.published_leaderboard_snapshots
  alter column published_at drop not null,
  add column first_published_at timestamptz,
  add column row_count integer not null default 0 check (row_count between 0 and 2000),
  add column board_count integer not null default 0 check (board_count between 0 and 2000),
  add constraint published_leaderboard_snapshots_current_published_check
    check (not is_current or (published_at is not null and first_published_at is not null));

alter table public.published_leaderboard_rows
  add column cohort_label text not null
    check (pg_catalog.length(pg_catalog.btrim(cohort_label)) between 1 and 80 and cohort_label !~ '[[:cntrl:]<>"`\\]' and cohort_label !~ '^[=+@-]'),
  add column module_label text
    check (module_label is null or (pg_catalog.length(pg_catalog.btrim(module_label)) between 1 and 80 and module_label !~ '[[:cntrl:]<>"`\\]' and module_label !~ '^[=+@-]')),
  add constraint published_leaderboard_rows_module_label_kind_check
    check ((board_kind = 'semester' and module_label is null) or (board_kind = 'module' and module_label is not null)),
  add constraint published_leaderboard_rows_public_name_chars_check
    check (public_name !~ '[<>"`\\]' and public_name !~ '^[=+@-]');

-- Only the database owner can see draft or superseded rows; RLS already limits
-- anon/authenticated to the current, non-withdrawn snapshot.
revoke select on table public.published_leaderboard_snapshots from anon, authenticated;
grant select (id, version_number, academic_year, published_at, is_current, revoked_at)
  on table public.published_leaderboard_snapshots to anon, authenticated;

create function app_private.lock_leaderboard_publication()
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('academic_arena.leaderboard_publication'));
$$;
revoke all on function app_private.lock_leaderboard_publication() from public;

create function public.create_leaderboard_draft(p_academic_year text, p_rows jsonb)
returns table (draft_id uuid, version_number bigint, row_count integer, board_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  new_id uuid;
  new_version bigint;
  inserted_rows integer;
  boards integer;
begin
  if not app_private.has_permission('leaderboards.publish') then
    raise exception using errcode = '42501', message = 'authorized AAL2 publisher required';
  end if;
  actor_account_id := app_private.current_account_id();
  if p_academic_year is null or p_academic_year !~ '^20[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'invalid academic year';
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array'
    or pg_catalog.jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'invalid ranking rows';
  end if;

  perform app_private.lock_leaderboard_publication();

  -- Only one unpublished draft exists at a time; keep the 20 newest published.
  delete from public.published_leaderboard_snapshots as snapshot
  where snapshot.first_published_at is null;
  delete from public.published_leaderboard_snapshots as snapshot
  where snapshot.first_published_at is not null and not snapshot.is_current
    and snapshot.id not in (
      select recent.id from public.published_leaderboard_snapshots as recent
      where recent.first_published_at is not null
      order by recent.version_number desc
      limit 20
    );

  select coalesce(pg_catalog.max(snapshot.version_number), 0) + 1 into new_version
  from public.published_leaderboard_snapshots as snapshot;
  insert into public.published_leaderboard_snapshots (version_number, academic_year, published_at, is_current)
  values (new_version, p_academic_year, null, false)
  returning id into new_id;

  insert into public.published_leaderboard_rows (
    snapshot_id, level, semester, cohort_key, cohort_label, board_kind, module_key, module_label,
    position, public_name, avatar_key, avatar_family
  )
  select new_id, row_data.level, row_data.semester, row_data.cohort_key, row_data.cohort_label,
    row_data.board_kind, row_data.module_key, row_data.module_label, row_data.position,
    row_data.public_name, row_data.avatar_key, row_data.avatar_family
  from pg_catalog.jsonb_to_recordset(p_rows) as row_data(
    level smallint, semester smallint, cohort_key text, cohort_label text, board_kind text,
    module_key text, module_label text, position smallint, public_name text,
    avatar_key text, avatar_family text
  );
  get diagnostics inserted_rows = row_count;

  -- Positions on every board must be exactly 1..n.
  if exists (
    select 1 from public.published_leaderboard_rows as board_row
    where board_row.snapshot_id = new_id
    group by board_row.level, board_row.semester, board_row.cohort_key, board_row.board_kind, board_row.module_key
    having pg_catalog.max(board_row.position) <> pg_catalog.count(*)
  ) then
    raise exception using errcode = '22023', message = 'board positions must be contiguous from 1';
  end if;
  -- A student appears at most once per board.
  if exists (
    select 1 from public.published_leaderboard_rows as board_row
    where board_row.snapshot_id = new_id
    group by board_row.level, board_row.semester, board_row.cohort_key, board_row.board_kind, board_row.module_key,
      pg_catalog.lower(pg_catalog.btrim(board_row.public_name))
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'duplicate student on a board';
  end if;
  -- Labels must be consistent for each cohort and module.
  if exists (
    select 1 from public.published_leaderboard_rows as board_row
    where board_row.snapshot_id = new_id
    group by board_row.level, board_row.semester, board_row.cohort_key
    having pg_catalog.count(distinct board_row.cohort_label) > 1
  ) or exists (
    select 1 from public.published_leaderboard_rows as board_row
    where board_row.snapshot_id = new_id and board_row.board_kind = 'module'
    group by board_row.level, board_row.semester, board_row.cohort_key, board_row.module_key
    having pg_catalog.count(distinct board_row.module_label) > 1
  ) then
    raise exception using errcode = '22023', message = 'inconsistent cohort or module label';
  end if;

  select pg_catalog.count(*)::integer into boards from (
    select distinct board_row.level, board_row.semester, board_row.cohort_key, board_row.board_kind, board_row.module_key
    from public.published_leaderboard_rows as board_row where board_row.snapshot_id = new_id
  ) as distinct_boards;
  update public.published_leaderboard_snapshots as snapshot
  set row_count = inserted_rows, board_count = boards
  where snapshot.id = new_id;

  insert into app_private.audit_events (actor_account_id, action_key, reason_code)
  values (actor_account_id, 'leaderboard.draft_created', 'v' || new_version::text);
  return query select new_id, new_version, inserted_rows, boards;
end
$$;

create function public.publish_leaderboard_snapshot(p_snapshot_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  target public.published_leaderboard_snapshots%rowtype;
begin
  if not app_private.has_permission('leaderboards.publish') then
    raise exception using errcode = '42501', message = 'authorized AAL2 publisher required';
  end if;
  actor_account_id := app_private.current_account_id();
  perform app_private.lock_leaderboard_publication();

  select snapshot.* into target
  from public.published_leaderboard_snapshots as snapshot
  where snapshot.id = p_snapshot_id
  for update;
  if not found or target.row_count < 1 then
    raise exception using errcode = '22023', message = 'publication not found';
  end if;
  if target.is_current then
    return target.version_number;
  end if;

  update public.published_leaderboard_snapshots as snapshot
  set is_current = false
  where snapshot.is_current;
  update public.published_leaderboard_snapshots as snapshot
  set is_current = true,
      revoked_at = null,
      published_at = pg_catalog.clock_timestamp(),
      first_published_at = coalesce(snapshot.first_published_at, pg_catalog.clock_timestamp())
  where snapshot.id = p_snapshot_id;

  insert into app_private.audit_events (actor_account_id, action_key, reason_code)
  values (
    actor_account_id,
    case when target.first_published_at is null then 'leaderboard.published' else 'leaderboard.rolled_back' end,
    'v' || target.version_number::text
  );
  return target.version_number;
end
$$;

create function public.withdraw_current_leaderboard()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  withdrawn_version bigint;
begin
  if not app_private.has_permission('leaderboards.publish') then
    raise exception using errcode = '42501', message = 'authorized AAL2 publisher required';
  end if;
  actor_account_id := app_private.current_account_id();
  perform app_private.lock_leaderboard_publication();

  update public.published_leaderboard_snapshots as snapshot
  set is_current = false, revoked_at = pg_catalog.clock_timestamp()
  where snapshot.is_current
  returning snapshot.version_number into withdrawn_version;
  if withdrawn_version is null then
    return false;
  end if;
  insert into app_private.audit_events (actor_account_id, action_key, reason_code)
  values (actor_account_id, 'leaderboard.withdrawn', 'v' || withdrawn_version::text);
  return true;
end
$$;

create function public.list_leaderboard_publications()
returns table (
  id uuid, version_number bigint, academic_year text, state text,
  published_at timestamptz, created_at timestamptz, row_count integer, board_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('leaderboards.publish') then
    raise exception using errcode = '42501', message = 'authorized AAL2 publisher required';
  end if;
  return query
  select snapshot.id, snapshot.version_number, snapshot.academic_year,
    case
      when snapshot.is_current then 'live'
      when snapshot.first_published_at is null then 'draft'
      when snapshot.revoked_at is not null then 'withdrawn'
      else 'previous'
    end,
    snapshot.published_at, snapshot.created_at, snapshot.row_count, snapshot.board_count
  from public.published_leaderboard_snapshots as snapshot
  order by snapshot.version_number desc
  limit 30;
end
$$;

-- Staff preview: the rows of a specific snapshot (draft or previous).
create function public.leaderboard_snapshot_rows(p_snapshot_id uuid)
returns table (
  level smallint, semester smallint, cohort_key text, board_kind text, module_key text,
  "position" smallint, public_name text, avatar_key text, avatar_family text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('leaderboards.publish') then
    raise exception using errcode = '42501', message = 'authorized AAL2 publisher required';
  end if;
  return query
  select board_row.level, board_row.semester, board_row.cohort_key, board_row.board_kind, board_row.module_key,
    board_row.position, board_row.public_name, board_row.avatar_key, board_row.avatar_family
  from public.published_leaderboard_rows as board_row
  where board_row.snapshot_id = p_snapshot_id
  order by 1, 2, 3, 4, 5, 6;
end
$$;

-- Public read functions run as the caller, so RLS limits them to the current snapshot.
create function public.public_leaderboard_catalog(p_level smallint, p_semester smallint)
returns table (cohort_key text, cohort_label text, board_kind text, module_key text, module_label text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct board_row.cohort_key, board_row.cohort_label, board_row.board_kind,
    board_row.module_key, board_row.module_label
  from public.published_leaderboard_rows as board_row
  join public.published_leaderboard_snapshots as snapshot on snapshot.id = board_row.snapshot_id
  where snapshot.is_current and snapshot.revoked_at is null
    and board_row.level = p_level and board_row.semester = p_semester
  order by 1, 3, 4;
$$;

create function public.public_leaderboard_board(
  p_level smallint, p_semester smallint, p_cohort_key text, p_board_kind text, p_module_key text
)
returns table ("position" smallint, public_name text, avatar_key text, avatar_family text, published_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select board_row.position, board_row.public_name, board_row.avatar_key, board_row.avatar_family, snapshot.published_at
  from public.published_leaderboard_rows as board_row
  join public.published_leaderboard_snapshots as snapshot on snapshot.id = board_row.snapshot_id
  where snapshot.is_current and snapshot.revoked_at is null
    and board_row.level = p_level and board_row.semester = p_semester
    and board_row.cohort_key = p_cohort_key and board_row.board_kind = p_board_kind
    and board_row.module_key is not distinct from p_module_key
  order by board_row.position
  limit 10;
$$;

------------------------------------------------------------------------------
-- Campus Wins
------------------------------------------------------------------------------

-- Canonical staff-approved public name. Students cannot change it.
alter table app_private.accounts
  add column public_display_name text
    check (public_display_name is null or (
      pg_catalog.length(pg_catalog.btrim(public_display_name)) between 1 and 60
      and public_display_name !~ '[[:cntrl:]<>"`\\]'
      and public_display_name !~ '^[=+@-]'
    ));

create function public.set_student_public_name(p_username text, p_public_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  target_account_id uuid;
begin
  if not app_private.has_permission('accounts.provision') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  actor_account_id := app_private.current_account_id();
  update app_private.accounts as account
  set public_display_name = pg_catalog.btrim(p_public_name),
      updated_at = pg_catalog.clock_timestamp()
  from app_private.identity_mappings as mapping
  where mapping.account_id = account.id
    and mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
    and exists (
      select 1 from app_private.account_role_grants as role_grant
      where role_grant.account_id = account.id and role_grant.role_name = 'student'
    )
  returning account.id into target_account_id;
  if target_account_id is null then
    return false;
  end if;
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, target_account_id, 'account.public_name_set', 'staff_approved');
  return true;
end
$$;

create function public.submit_campus_win(p_template_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  approved_name text;
  new_id uuid;
begin
  if not app_private.has_permission('campus_wins.submit') then
    raise exception using errcode = '42501', message = 'eligible student account required';
  end if;
  if p_template_key is null or p_template_key not in ('top3', 'workshop', 'project', 'helped') then
    raise exception using errcode = '22023', message = 'unknown achievement template';
  end if;
  actor_account_id := app_private.current_account_id();

  -- Serialize submissions per account so both limits hold under concurrency.
  select account.public_display_name into approved_name
  from app_private.accounts as account
  where account.id = actor_account_id
  for update;
  if approved_name is null then
    raise exception using errcode = 'AAW03', message = 'public name not yet approved by staff';
  end if;
  if exists (
    select 1 from app_private.campus_wins_submissions as submission
    where submission.owner_account_id = actor_account_id and submission.status = 'pending'
  ) then
    raise exception using errcode = 'AAW01', message = 'a submission is already pending review';
  end if;
  if exists (
    select 1 from app_private.campus_wins_submissions as submission
    where submission.owner_account_id = actor_account_id
      and submission.created_at > pg_catalog.now() - interval '7 days'
  ) then
    raise exception using errcode = 'AAW02', message = 'one submission per seven days';
  end if;

  insert into app_private.campus_wins_submissions (owner_account_id, template_key, status)
  values (actor_account_id, p_template_key, 'pending')
  returning id into new_id;
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, actor_account_id, 'campus_wins.submitted', p_template_key);
  return new_id;
end
$$;

create function public.my_campus_wins()
returns table (id uuid, template_key text, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
begin
  if not app_private.has_permission('campus_wins.submit') then
    raise exception using errcode = '42501', message = 'eligible student account required';
  end if;
  actor_account_id := app_private.current_account_id();
  return query
  select submission.id, submission.template_key,
    -- A removed post is shown to its owner as not approved; no moderation detail.
    case when submission.status in ('removed', 'hidden') then 'not_shown' else submission.status end,
    submission.created_at
  from app_private.campus_wins_submissions as submission
  where submission.owner_account_id = actor_account_id
  order by submission.created_at desc
  limit 10;
end
$$;

create function public.list_campus_win_moderation(p_status text)
returns table (
  id uuid, template_key text, status text, author_name text, avatar_key text, avatar_family text,
  created_at timestamptz, moderated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('campus_wins.moderate') then
    raise exception using errcode = '42501', message = 'authorized AAL2 moderator required';
  end if;
  if p_status is null or p_status not in ('pending', 'approved', 'hidden', 'rejected', 'removed') then
    raise exception using errcode = '22023', message = 'invalid moderation status';
  end if;
  return query
  select submission.id, submission.template_key, submission.status,
    coalesce(submission.public_author_name, account.public_display_name, 'Unapproved name'),
    coalesce(submission.approved_avatar_key, avatar.character_key, 'omar'),
    coalesce(submission.approved_avatar_family, avatar.family, 'ink'),
    submission.created_at, submission.moderated_at
  from app_private.campus_wins_submissions as submission
  join app_private.accounts as account on account.id = submission.owner_account_id
  left join public.student_avatar_configs as avatar on avatar.account_id = submission.owner_account_id
  where submission.status = p_status
  order by case when p_status = 'pending' then submission.created_at end asc,
    coalesce(submission.moderated_at, submission.created_at) desc
  limit 100;
end
$$;

create function public.moderate_campus_win(p_submission_id uuid, p_decision text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  current_submission app_private.campus_wins_submissions%rowtype;
  owner_name text;
  owner_avatar_key text;
  owner_avatar_family text;
begin
  if not app_private.has_permission('campus_wins.moderate') then
    raise exception using errcode = '42501', message = 'authorized AAL2 moderator required';
  end if;
  actor_account_id := app_private.current_account_id();
  -- NO KEY UPDATE does not conflict with the KEY SHARE lock a concurrent
  -- reaction insert takes through its foreign key, so the two cannot deadlock.
  select submission.* into current_submission
  from app_private.campus_wins_submissions as submission
  where submission.id = p_submission_id
  for no key update;
  if not found then
    raise exception using errcode = 'AAW05', message = 'submission not found';
  end if;
  if not (
    (current_submission.status = 'pending' and p_decision in ('approved', 'rejected'))
    or (current_submission.status = 'approved' and p_decision in ('hidden', 'removed'))
    or (current_submission.status = 'hidden' and p_decision in ('approved', 'removed'))
  ) then
    raise exception using errcode = 'AAW04', message = 'invalid moderation transition';
  end if;

  if p_decision = 'approved' then
    select account.public_display_name, coalesce(avatar.character_key, 'omar'), coalesce(avatar.family, 'ink')
    into owner_name, owner_avatar_key, owner_avatar_family
    from app_private.accounts as account
    left join public.student_avatar_configs as avatar on avatar.account_id = account.id
    where account.id = current_submission.owner_account_id and account.status = 'active';
    if owner_name is null then
      raise exception using errcode = 'AAW03', message = 'owner has no approved public name';
    end if;
    update app_private.campus_wins_submissions as submission
    set status = 'approved',
        public_author_name = coalesce(submission.public_author_name, owner_name),
        approved_avatar_key = coalesce(submission.approved_avatar_key, owner_avatar_key),
        approved_avatar_family = coalesce(submission.approved_avatar_family, owner_avatar_family),
        moderated_by = actor_account_id,
        moderated_at = pg_catalog.clock_timestamp()
    where submission.id = p_submission_id
    returning submission.* into current_submission;
    insert into public.campus_wins_public (
      post_id, template_key, public_author_name, avatar_key, avatar_family, published_at,
      heart_count, clap_count, fire_count
    )
    select current_submission.id, current_submission.template_key, current_submission.public_author_name,
      current_submission.approved_avatar_key, current_submission.approved_avatar_family,
      pg_catalog.clock_timestamp(),
      pg_catalog.count(*) filter (where reaction.reaction_key = 'heart'),
      pg_catalog.count(*) filter (where reaction.reaction_key = 'clap'),
      pg_catalog.count(*) filter (where reaction.reaction_key = 'fire')
    from app_private.campus_wins_reactions as reaction
    where reaction.post_id = current_submission.id;
  else
    update app_private.campus_wins_submissions as submission
    set status = p_decision,
        moderated_by = actor_account_id,
        moderated_at = pg_catalog.clock_timestamp()
    where submission.id = p_submission_id;
    delete from public.campus_wins_public as public_post where public_post.post_id = p_submission_id;
    if p_decision = 'removed' then
      delete from app_private.campus_wins_reactions as reaction where reaction.post_id = p_submission_id;
    end if;
  end if;

  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, current_submission.owner_account_id, 'campus_wins.' || p_decision, current_submission.template_key);
  return p_decision;
end
$$;

create function public.set_campus_win_reaction(p_post_id uuid, p_reaction text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  previous_reaction text;
  active_reaction text;
begin
  if not app_private.has_permission('campus_wins.react') then
    raise exception using errcode = '42501', message = 'eligible student account required';
  end if;
  if p_reaction is null or p_reaction not in ('heart', 'clap', 'fire') then
    raise exception using errcode = '22023', message = 'invalid reaction';
  end if;
  actor_account_id := app_private.current_account_id();

  -- Lock the public post first: all count changes for a post are serialized.
  perform 1 from public.campus_wins_public as public_post where public_post.post_id = p_post_id for update;
  if not found then
    raise exception using errcode = 'AAW05', message = 'post not found';
  end if;
  if exists (
    select 1 from app_private.campus_wins_submissions as submission
    where submission.id = p_post_id and submission.owner_account_id = actor_account_id
  ) then
    raise exception using errcode = 'AAW06', message = 'students cannot react to their own post';
  end if;
  select reaction.reaction_key into previous_reaction
  from app_private.campus_wins_reactions as reaction
  where reaction.post_id = p_post_id and reaction.owner_account_id = actor_account_id
  for update;

  if previous_reaction = p_reaction then
    delete from app_private.campus_wins_reactions as reaction
    where reaction.post_id = p_post_id and reaction.owner_account_id = actor_account_id;
    active_reaction := null;
  elsif previous_reaction is not null then
    update app_private.campus_wins_reactions as reaction
    set reaction_key = p_reaction, created_at = pg_catalog.clock_timestamp()
    where reaction.post_id = p_post_id and reaction.owner_account_id = actor_account_id;
    active_reaction := p_reaction;
  else
    insert into app_private.campus_wins_reactions (post_id, owner_account_id, reaction_key)
    values (p_post_id, actor_account_id, p_reaction);
    active_reaction := p_reaction;
  end if;

  update public.campus_wins_public as public_post
  set heart_count = public_post.heart_count
        + (case when active_reaction = 'heart' then 1 else 0 end)
        - (case when previous_reaction = 'heart' then 1 else 0 end),
      clap_count = public_post.clap_count
        + (case when active_reaction = 'clap' then 1 else 0 end)
        - (case when previous_reaction = 'clap' then 1 else 0 end),
      fire_count = public_post.fire_count
        + (case when active_reaction = 'fire' then 1 else 0 end)
        - (case when previous_reaction = 'fire' then 1 else 0 end)
  where public_post.post_id = p_post_id;
  return active_reaction;
end
$$;

create function public.my_campus_win_reactions()
returns table (post_id uuid, reaction_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
begin
  if not app_private.has_permission('campus_wins.react') then
    raise exception using errcode = '42501', message = 'eligible student account required';
  end if;
  actor_account_id := app_private.current_account_id();
  return query
  select reaction.post_id, reaction.reaction_key
  from app_private.campus_wins_reactions as reaction
  join public.campus_wins_public as public_post on public_post.post_id = reaction.post_id
  where reaction.owner_account_id = actor_account_id
  order by public_post.published_at desc
  limit 200;
end
$$;

------------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------------

revoke all on function public.create_leaderboard_draft(text, jsonb) from public, anon, service_role;
revoke all on function public.publish_leaderboard_snapshot(uuid) from public, anon, service_role;
revoke all on function public.withdraw_current_leaderboard() from public, anon, service_role;
revoke all on function public.list_leaderboard_publications() from public, anon, service_role;
revoke all on function public.leaderboard_snapshot_rows(uuid) from public, anon, service_role;
revoke all on function public.set_student_public_name(text, text) from public, anon, service_role;
revoke all on function public.submit_campus_win(text) from public, anon, service_role;
revoke all on function public.my_campus_wins() from public, anon, service_role;
revoke all on function public.list_campus_win_moderation(text) from public, anon, service_role;
revoke all on function public.moderate_campus_win(uuid, text) from public, anon, service_role;
revoke all on function public.set_campus_win_reaction(uuid, text) from public, anon, service_role;
revoke all on function public.my_campus_win_reactions() from public, anon, service_role;
grant execute on function public.create_leaderboard_draft(text, jsonb) to authenticated;
grant execute on function public.publish_leaderboard_snapshot(uuid) to authenticated;
grant execute on function public.withdraw_current_leaderboard() to authenticated;
grant execute on function public.list_leaderboard_publications() to authenticated;
grant execute on function public.leaderboard_snapshot_rows(uuid) to authenticated;
grant execute on function public.set_student_public_name(text, text) to authenticated;
grant execute on function public.submit_campus_win(text) to authenticated;
grant execute on function public.my_campus_wins() to authenticated;
grant execute on function public.list_campus_win_moderation(text) to authenticated;
grant execute on function public.moderate_campus_win(uuid, text) to authenticated;
grant execute on function public.set_campus_win_reaction(uuid, text) to authenticated;
grant execute on function public.my_campus_win_reactions() to authenticated;

revoke all on function public.public_leaderboard_catalog(smallint, smallint) from public;
revoke all on function public.public_leaderboard_board(smallint, smallint, text, text, text) from public;
grant execute on function public.public_leaderboard_catalog(smallint, smallint) to anon, authenticated;
grant execute on function public.public_leaderboard_board(smallint, smallint, text, text, text) to anon, authenticated;
