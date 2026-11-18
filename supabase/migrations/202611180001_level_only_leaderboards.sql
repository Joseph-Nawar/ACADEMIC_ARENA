-- V1 level-only leaderboards (Level 4/5/6 · Top 10), additive.
--
-- Reuses published_leaderboard_snapshots for versioning, the single current
-- snapshot, withdrawal (withdraw_current_leaderboard), audit, and the
-- publication advisory lock. Level-only rows live in their own table and hold
-- only snapshot, level, position, and approved public name: no student
-- account, identifier, metric, avatar, semester, cohort, or module.
-- The semester/module tables and functions are unchanged for a later V2.

alter table public.published_leaderboard_snapshots
  add column board_format text not null default 'semester_module'
    check (board_format in ('semester_module', 'level_only')),
  add column release_label text
    check (release_label is null or release_label ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$');

grant select (board_format, release_label) on table public.published_leaderboard_snapshots to anon, authenticated;

create table public.published_level_rows (
  snapshot_id uuid not null references public.published_leaderboard_snapshots(id) on delete cascade,
  level smallint not null check (level in (4, 5, 6)),
  position smallint not null check (position between 1 and 10),
  public_name text not null check (
    pg_catalog.length(pg_catalog.btrim(public_name)) between 1 and 80
    and public_name !~ '[[:cntrl:]<>"`\\{}\[\]|;=]'
    and public_name !~ '^[=+@-]'
    and public_name is nfkc normalized
    and public_name !~ '[\u115F\u1160\u3164\uFFA0\u034F\u17B4\u17B5\u180B-\u180F\uFE00-\uFE0F\u200B-\u200F\u2060-\u2064\u202A-\u202E\u2066-\u2069]'
  ),
  primary key (snapshot_id, level, position)
);
create unique index published_level_rows_unique_name_idx
  on public.published_level_rows (snapshot_id, level, pg_catalog.lower(pg_catalog.btrim(public_name)));

alter table public.published_level_rows enable row level security;
alter table public.published_level_rows force row level security;
create policy public_read_current_level_rows on public.published_level_rows
  for select to anon, authenticated using (
    exists (
      select 1 from public.published_leaderboard_snapshots as snapshot
      where snapshot.id = snapshot_id
        and snapshot.is_current and snapshot.revoked_at is null
        and snapshot.board_format = 'level_only'
    )
  );
revoke all on table public.published_level_rows from public, anon, authenticated;
grant select on table public.published_level_rows to anon, authenticated;

-- Draft: exactly 10 contiguous ranks for each of Levels 4, 5, and 6 (30 rows).
create function public.create_level_leaderboard_draft(
  p_academic_year text,
  p_release_label text,
  p_rows jsonb
)
returns table (draft_id uuid, version_number bigint, row_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  new_id uuid;
  new_version bigint;
  inserted_rows integer;
begin
  if not app_private.has_permission('leaderboards.publish') then
    raise exception using errcode = '42501', message = 'authorized AAL2 publisher required';
  end if;
  actor_account_id := app_private.current_account_id();
  if p_academic_year is null or p_academic_year !~ '^20[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'invalid academic year';
  end if;
  if p_release_label is null or p_release_label !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$' then
    raise exception using errcode = '22023', message = 'invalid release label';
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' or pg_catalog.jsonb_array_length(p_rows) <> 30 then
    raise exception using errcode = '22023', message = 'exactly 30 ranking rows are required';
  end if;

  perform app_private.lock_leaderboard_publication();

  -- One unpublished draft at a time (either format); keep the 20 newest published.
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
  insert into public.published_leaderboard_snapshots (
    version_number, academic_year, release_label, board_format, published_at, is_current, board_count
  ) values (new_version, p_academic_year, p_release_label, 'level_only', null, false, 3)
  returning id into new_id;

  insert into public.published_level_rows (snapshot_id, level, position, public_name)
  select new_id, row_data.level, row_data.position, row_data.public_name
  from pg_catalog.jsonb_to_recordset(p_rows) as row_data(level smallint, position smallint, public_name text);
  get diagnostics inserted_rows = row_count;

  if (select pg_catalog.count(distinct level_row.level) from public.published_level_rows as level_row
      where level_row.snapshot_id = new_id) <> 3
    or exists (
      select 1 from public.published_level_rows as level_row
      where level_row.snapshot_id = new_id
      group by level_row.level
      having pg_catalog.count(*) <> 10 or pg_catalog.max(level_row.position) <> 10
    ) then
    raise exception using errcode = '22023', message = 'each level needs ranks 1 to 10';
  end if;

  update public.published_leaderboard_snapshots as snapshot
  set row_count = inserted_rows
  where snapshot.id = new_id;
  insert into app_private.audit_events (actor_account_id, action_key, reason_code)
  values (actor_account_id, 'leaderboard.draft_created', 'v' || new_version::text);
  return query select new_id, new_version, inserted_rows;
end
$$;

-- Publish or roll back to a level-only snapshot. Legacy semester/module
-- snapshots are refused, so the V1 workflow cannot publish them.
create function public.publish_level_leaderboard_snapshot(p_snapshot_id uuid)
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
  if not found or target.board_format <> 'level_only' or target.row_count <> 30 then
    raise exception using errcode = '22023', message = 'level-only publication not found';
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

-- Staff preview/diff source: rows of any level-only snapshot.
create function public.level_leaderboard_snapshot_rows(p_snapshot_id uuid)
returns table (level smallint, "position" smallint, public_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('leaderboards.publish') then
    raise exception using errcode = '42501', message = 'authorized AAL2 publisher required';
  end if;
  return query
  select level_row.level, level_row.position, level_row.public_name
  from public.published_level_rows as level_row
  where level_row.snapshot_id = p_snapshot_id
  order by 1, 2;
end
$$;

create function public.list_level_leaderboard_publications()
returns table (
  id uuid, version_number bigint, academic_year text, release_label text, board_format text, state text,
  published_at timestamptz, created_at timestamptz, row_count integer
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
  select snapshot.id, snapshot.version_number, snapshot.academic_year, snapshot.release_label, snapshot.board_format,
    case
      when snapshot.is_current then 'live'
      when snapshot.first_published_at is null then 'draft'
      when snapshot.revoked_at is not null then 'withdrawn'
      else 'previous'
    end,
    snapshot.published_at, snapshot.created_at, snapshot.row_count
  from public.published_leaderboard_snapshots as snapshot
  order by snapshot.version_number desc
  limit 30;
end
$$;

-- Public read, as the caller: RLS limits it to the current level-only snapshot.
create function public.public_level_leaderboard(p_level smallint)
returns table ("position" smallint, public_name text, release_label text, published_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select level_row.position, level_row.public_name, snapshot.release_label, snapshot.published_at
  from public.published_level_rows as level_row
  join public.published_leaderboard_snapshots as snapshot on snapshot.id = level_row.snapshot_id
  where snapshot.is_current and snapshot.revoked_at is null and snapshot.board_format = 'level_only'
    and level_row.level = p_level
  order by level_row.position
  limit 10;
$$;

revoke all on function public.create_level_leaderboard_draft(text, text, jsonb) from public, anon, service_role;
revoke all on function public.publish_level_leaderboard_snapshot(uuid) from public, anon, service_role;
revoke all on function public.level_leaderboard_snapshot_rows(uuid) from public, anon, service_role;
revoke all on function public.list_level_leaderboard_publications() from public, anon, service_role;
grant execute on function public.create_level_leaderboard_draft(text, text, jsonb) to authenticated;
grant execute on function public.publish_level_leaderboard_snapshot(uuid) to authenticated;
grant execute on function public.level_leaderboard_snapshot_rows(uuid) to authenticated;
grant execute on function public.list_level_leaderboard_publications() to authenticated;
revoke all on function public.public_level_leaderboard(smallint) from public;
grant execute on function public.public_level_leaderboard(smallint) to anon, authenticated;
