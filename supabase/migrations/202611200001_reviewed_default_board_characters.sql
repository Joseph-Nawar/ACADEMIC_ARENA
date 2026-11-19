-- V1.4 staff-reviewed default board characters, additive.
--
-- One approved character per published level row, chosen by AAL2 staff for
-- that specific publication. Stores only an allowlisted character key: no
-- name, gender, or any other attribute. Each publication needs its own
-- review, so a new weekly release never inherits artwork by rank position;
-- rollback restores that version's approved characters. A linked, opted-in
-- student's own character always takes precedence.

create table app_private.published_level_row_artwork (
  snapshot_id uuid not null,
  level smallint not null,
  position smallint not null,
  character_key text not null
    constraint published_level_row_artwork_character_key_check
    check (character_key in ('omar', 'mariam', 'youssef', 'amara', 'tariq', 'habiba2', 'malek', 'nour2', 'zein')),
  approved_by uuid references app_private.accounts(id) on delete set null,
  approved_at timestamptz not null default pg_catalog.now(),
  primary key (snapshot_id, level, position),
  foreign key (snapshot_id, level, position)
    references public.published_level_rows (snapshot_id, level, position) on delete cascade
);
alter table app_private.published_level_row_artwork enable row level security;
alter table app_private.published_level_row_artwork force row level security;
revoke all on table app_private.published_level_row_artwork from public, anon, authenticated, service_role;

-- Replace one publication's reviewed characters atomically. p_rows is a jsonb
-- array of {level, rank, character}; rows left out show the neutral fallback.
create function public.approve_level_row_artwork(p_snapshot_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  target public.published_leaderboard_snapshots%rowtype;
  approved integer;
begin
  if not app_private.has_permission('leaderboards.publish') then
    raise exception using errcode = '42501', message = 'authorized AAL2 publisher required';
  end if;
  actor_account_id := app_private.current_account_id();
  select snapshot.* into target from public.published_leaderboard_snapshots as snapshot where snapshot.id = p_snapshot_id;
  if not found or target.board_format <> 'level_only' then
    raise exception using errcode = '22023', message = 'level-only publication not found';
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' or pg_catalog.jsonb_array_length(p_rows) > 30
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_rows) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'object'
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item.value)) <> 3
        or not (item.value ? 'level' and item.value ? 'rank' and item.value ? 'character')
        or pg_catalog.jsonb_typeof(item.value -> 'level') <> 'number'
        or pg_catalog.jsonb_typeof(item.value -> 'rank') <> 'number'
        or pg_catalog.jsonb_typeof(item.value -> 'character') <> 'string'
    ) then
    raise exception using errcode = '22023', message = 'each row needs exactly level, rank, and character';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_rows) as item(value)
    group by item.value ->> 'level', item.value ->> 'rank' having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'duplicate ranking position';
  end if;

  perform app_private.lock_leaderboard_publication();
  delete from app_private.published_level_row_artwork as artwork where artwork.snapshot_id = p_snapshot_id;
  begin
    insert into app_private.published_level_row_artwork (snapshot_id, level, position, character_key, approved_by)
    select p_snapshot_id, (item.value ->> 'level')::smallint, (item.value ->> 'rank')::smallint,
           item.value ->> 'character', actor_account_id
    from pg_catalog.jsonb_array_elements(p_rows) as item(value);
  exception
    when foreign_key_violation or check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'unknown ranking position or character';
  end;
  get diagnostics approved = row_count;
  insert into app_private.audit_events (actor_account_id, action_key, reason_code)
  values (actor_account_id, 'leaderboard.artwork_approved', 'v' || target.version_number::text || '-n' || approved::text);
  return approved;
end
$$;

create function public.list_level_row_artwork(p_snapshot_id uuid)
returns table (level smallint, "position" smallint, character_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('leaderboards.publish') then
    raise exception using errcode = '42501', message = 'authorized AAL2 publisher required';
  end if;
  return query
  select artwork.level, artwork.position, artwork.character_key
  from app_private.published_level_row_artwork as artwork
  where artwork.snapshot_id = p_snapshot_id
  order by 1, 2;
end
$$;

revoke all on function public.approve_level_row_artwork(uuid, jsonb) from public, anon, service_role;
revoke all on function public.list_level_row_artwork(uuid) from public, anon, service_role;
grant execute on function public.approve_level_row_artwork(uuid, jsonb) to authenticated;
grant execute on function public.list_level_row_artwork(uuid) to authenticated;

-- Public projection: V2 plus the publication's reviewed default character.
create function public.public_level_leaderboard_v3(p_level smallint)
returns table (
  "position" smallint, public_name text, release_label text, published_at timestamptz,
  avatar_key text, avatar_family text, avatar_tone text, avatar_badge text, default_avatar_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select level_row.position, level_row.public_name, snapshot.release_label, snapshot.published_at,
         chosen.character_key, chosen.family, chosen.tone, chosen.badge, artwork.character_key
  from public.published_level_rows as level_row
  join public.published_leaderboard_snapshots as snapshot on snapshot.id = level_row.snapshot_id
  left join app_private.published_level_row_artwork as artwork
    on artwork.snapshot_id = level_row.snapshot_id and artwork.level = level_row.level and artwork.position = level_row.position
  left join lateral (
    select avatar.character_key, avatar.family, avatar.tone, avatar.badge
    from app_private.published_level_row_links as link
    join app_private.accounts as account on account.id = link.account_id and account.status = 'active'
    join public.student_avatar_configs as avatar on avatar.account_id = account.id and avatar.show_on_leaderboard
    where link.snapshot_id = level_row.snapshot_id and link.level = level_row.level and link.position = level_row.position
      and app_private.student_feature('avatar_personalization')
  ) as chosen on true
  where snapshot.is_current and snapshot.revoked_at is null and snapshot.board_format = 'level_only'
    and level_row.level = p_level and p_level in (4, 5, 6)
  order by level_row.position
  limit 10
$$;
revoke all on function public.public_level_leaderboard_v3(smallint) from public;
grant execute on function public.public_level_leaderboard_v3(smallint) to anon, authenticated;
