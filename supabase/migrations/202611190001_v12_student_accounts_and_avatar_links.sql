-- V1.2 student accounts, private ranking links, and opt-in public avatars. Additive.
--
-- * Separate default-off rollout controls (never the fictional lifecycle gate):
--   student sign-in, operator provisioning/recovery, public avatar
--   personalization, and the welcome dialog. Only the database owner
--   (Supabase SQL editor / Management API) can change them.
-- * Operator-only (postgres) provisioning and recovery functions used by
--   scripts/student-accounts.mjs together with the supported Auth Admin API.
--   They read auth.users / auth.mfa_factors but never write auth.* tables.
-- * A private mapping from a published level row to a verified student
--   account, approved per snapshot by an AAL2 administrator. Anonymous and
--   student roles cannot select it; the public projection exposes only
--   allowlisted artwork fields for opted-in, linked, active students.

create table app_private.student_feature_controls (
  singleton boolean primary key default true check (singleton),
  student_sign_in boolean not null default false,
  student_provisioning boolean not null default false,
  avatar_personalization boolean not null default false,
  welcome_dialog boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now()
);
insert into app_private.student_feature_controls (singleton) values (true);
alter table app_private.student_feature_controls enable row level security;
alter table app_private.student_feature_controls force row level security;
revoke all on table app_private.student_feature_controls from public, anon, authenticated, service_role;

create function app_private.student_feature(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p_feature
      when 'student_sign_in' then control.student_sign_in
      when 'student_provisioning' then control.student_provisioning
      when 'avatar_personalization' then control.avatar_personalization
      when 'welcome_dialog' then control.welcome_dialog
      else false
    end
    from app_private.student_feature_controls as control
    where control.singleton
  ), false)
$$;
revoke all on function app_private.student_feature(text) from public, anon, authenticated, service_role;

-- Owner-only switch. Turning student sign-in off also ends every live
-- student-only session; public rankings are unaffected.
create function app_private.operator_set_student_feature(p_feature text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_feature not in ('student_sign_in', 'student_provisioning', 'avatar_personalization', 'welcome_dialog')
    or p_enabled is null then
    raise exception using errcode = '22023', message = 'unknown student feature';
  end if;
  update app_private.student_feature_controls as control
  set student_sign_in = case when p_feature = 'student_sign_in' then p_enabled else control.student_sign_in end,
      student_provisioning = case when p_feature = 'student_provisioning' then p_enabled else control.student_provisioning end,
      avatar_personalization = case when p_feature = 'avatar_personalization' then p_enabled else control.avatar_personalization end,
      welcome_dialog = case when p_feature = 'welcome_dialog' then p_enabled else control.welcome_dialog end,
      updated_at = pg_catalog.clock_timestamp()
  where control.singleton;
  if p_feature = 'student_sign_in' and not p_enabled then
    update app_private.bff_sessions as bff_session
    set revoked_at = pg_catalog.clock_timestamp(), revoke_reason = 'admin_revoke'
    where bff_session.revoked_at is null
      and not exists (
        select 1 from app_private.account_role_grants as role_grant
        where role_grant.account_id = bff_session.account_id and role_grant.role_name <> 'student'
      );
  end if;
  insert into app_private.audit_events (action_key, reason_code)
  values ('feature.' || p_feature || case when p_enabled then '.enabled' else '.disabled' end, 'operator');
  return p_enabled;
end
$$;
revoke all on function app_private.operator_set_student_feature(text, boolean) from public, anon, authenticated, service_role;

-- Public, non-sensitive rollout state for the browser (via the BFF).
create function public.public_feature_state()
returns table (student_sign_in boolean, avatar_personalization boolean, welcome_dialog boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select control.student_sign_in,
         control.avatar_personalization,
         control.welcome_dialog and control.student_sign_in
  from app_private.student_feature_controls as control
  where control.singleton
$$;
revoke all on function public.public_feature_state() from public;
grant execute on function public.public_feature_state() to anon, authenticated, service_role;

-- Student-role permissions now also require the student sign-in rollout
-- switch. Staff permissions are unchanged (active, no pending credential
-- change, AAL2).
create or replace function app_private.has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.accounts as account
    join app_private.account_role_grants as role_grant on role_grant.account_id = account.id
    join app_private.role_permissions as permission on permission.role_name = role_grant.role_name
    where account.provider_user_id = (select auth.uid())
      and account.status = 'active'
      and account.force_password_change = false
      and account.credential_update_pending = false
      and permission.permission_key = p_permission_key
      and (
        (role_grant.role_name = 'student' and app_private.student_feature('student_sign_in'))
        or (role_grant.role_name <> 'student'
          and coalesce((nullif(pg_catalog.current_setting('request.jwt.claims', true), ''))::jsonb ->> 'aal', '') = 'aal2')
      )
  )
$$;

insert into app_private.role_permissions (role_name, permission_key) values ('admin', 'leaderboards.link');

-- ---------------------------------------------------------------------------
-- Avatar opt-in (default off). Existing saved avatars stay valid unchanged.
alter table public.student_avatar_configs
  add column show_on_leaderboard boolean not null default false,
  add column show_on_leaderboard_changed_at timestamptz;
grant select (show_on_leaderboard) on table public.student_avatar_configs to authenticated;

create function public.save_own_avatar_preferences(
  p_character_key text,
  p_family text,
  p_tone text,
  p_badge text,
  p_show_on_leaderboard boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_account_id uuid;
begin
  if not app_private.has_permission('avatar.write') then
    raise exception using errcode = '42501', message = 'active student account required';
  end if;
  owner_account_id := app_private.current_account_id();
  if owner_account_id is null
    or not exists (
      select 1 from app_private.account_role_grants as role_grant
      where role_grant.account_id = owner_account_id and role_grant.role_name = 'student'
    ) then
    raise exception using errcode = '42501', message = 'active student account required';
  end if;
  if p_character_key is null or p_character_key not in ('omar', 'mariam', 'youssef', 'amara', 'tariq', 'habiba2', 'malek', 'nour2', 'zein')
    or p_family is null or p_family not in ('ink', 'cartoon3d')
    or p_tone is null or p_tone not in ('mint', 'coral', 'gold', 'paper', 'blue', 'lilac')
    or p_badge is null or p_badge not in ('✦', '⚡', '♥', '★', '')
    or p_show_on_leaderboard is null then
    raise exception using errcode = '22023', message = 'invalid avatar configuration';
  end if;

  insert into public.student_avatar_configs (
    account_id, character_key, family, tone, badge, show_on_leaderboard, show_on_leaderboard_changed_at
  ) values (
    owner_account_id, p_character_key, p_family, p_tone, p_badge, p_show_on_leaderboard, pg_catalog.clock_timestamp()
  )
  on conflict (account_id) do update
  set character_key = excluded.character_key,
      family = excluded.family,
      tone = excluded.tone,
      badge = excluded.badge,
      show_on_leaderboard = excluded.show_on_leaderboard,
      show_on_leaderboard_changed_at = case
        when public.student_avatar_configs.show_on_leaderboard is distinct from excluded.show_on_leaderboard
          then pg_catalog.clock_timestamp()
        else public.student_avatar_configs.show_on_leaderboard_changed_at
      end,
      updated_at = pg_catalog.clock_timestamp();
  return true;
end
$$;
revoke all on function public.save_own_avatar_preferences(text, text, text, text, boolean) from public, anon, service_role;
grant execute on function public.save_own_avatar_preferences(text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Private, staff-verified links from a published level row to a student account.
create table app_private.published_level_row_links (
  snapshot_id uuid not null,
  level smallint not null,
  position smallint not null,
  account_id uuid not null references app_private.accounts(id) on delete cascade,
  approved_by uuid references app_private.accounts(id) on delete set null,
  approved_at timestamptz not null default pg_catalog.now(),
  primary key (snapshot_id, level, position),
  unique (snapshot_id, account_id),
  foreign key (snapshot_id, level, position)
    references public.published_level_rows (snapshot_id, level, position) on delete cascade
);
create index published_level_row_links_account_idx on app_private.published_level_row_links (account_id);
alter table app_private.published_level_row_links enable row level security;
alter table app_private.published_level_row_links force row level security;
revoke all on table app_private.published_level_row_links from public, anon, authenticated, service_role;

-- Validates a link list (jsonb array of {level, rank, username}) against a
-- level-only snapshot. Usernames must belong to active student-only accounts.
-- Names are never used for matching.
create function app_private.resolve_level_row_links(p_snapshot_id uuid, p_links jsonb)
returns table (
  level smallint, "position" smallint, public_name text, account_id uuid, username text,
  provider_email text, account_status text, previous_state text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.published_leaderboard_snapshots%rowtype;
  previous_snapshot_id uuid;
begin
  select snapshot.* into target from public.published_leaderboard_snapshots as snapshot
  where snapshot.id = p_snapshot_id;
  if not found or target.board_format <> 'level_only' then
    raise exception using errcode = '22023', message = 'level-only publication not found';
  end if;
  if p_links is null or pg_catalog.jsonb_typeof(p_links) <> 'array' or pg_catalog.jsonb_array_length(p_links) > 30 then
    raise exception using errcode = '22023', message = 'at most 30 links are allowed';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_links) as item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item.value)) <> 3
      or not (item.value ? 'level' and item.value ? 'rank' and item.value ? 'username')
  ) then
    raise exception using errcode = '22023', message = 'each link needs exactly level, rank, and username';
  end if;

  -- Most recent other published snapshot, used only to label changes for review.
  select snapshot.id into previous_snapshot_id
  from public.published_leaderboard_snapshots as snapshot
  where snapshot.board_format = 'level_only' and snapshot.first_published_at is not null
    and snapshot.id <> p_snapshot_id and snapshot.version_number < target.version_number
  order by snapshot.version_number desc
  limit 1;

  create temporary table if not exists pg_temp.requested_links (
    level smallint, position smallint, username text
  ) on commit drop;
  truncate pg_temp.requested_links;
  begin
    insert into pg_temp.requested_links (level, position, username)
    select (item.value ->> 'level')::smallint, (item.value ->> 'rank')::smallint,
           pg_catalog.lower(pg_catalog.btrim(item.value ->> 'username'))
    from pg_catalog.jsonb_array_elements(p_links) as item(value);
  exception when others then
    raise exception using errcode = '22023', message = 'invalid link row';
  end;
  if exists (select 1 from pg_temp.requested_links as link
             where link.level not in (4, 5, 6) or link.position not between 1 and 10
               or link.username is null or link.username !~ '^[a-z0-9][a-z0-9._-]{2,31}$') then
    raise exception using errcode = '22023', message = 'invalid link row';
  end if;
  if exists (select 1 from pg_temp.requested_links as link group by link.level, link.position having pg_catalog.count(*) > 1) then
    raise exception using errcode = '22023', message = 'duplicate ranking position';
  end if;
  if exists (select 1 from pg_temp.requested_links as link group by link.username having pg_catalog.count(*) > 1) then
    raise exception using errcode = '22023', message = 'duplicate username';
  end if;
  if exists (
    select 1 from pg_temp.requested_links as link
    left join public.published_level_rows as level_row
      on level_row.snapshot_id = p_snapshot_id and level_row.level = link.level and level_row.position = link.position
    where level_row.snapshot_id is null
  ) then
    raise exception using errcode = '22023', message = 'ranking position not in this publication';
  end if;
  if exists (
    select 1 from pg_temp.requested_links as link
    left join app_private.identity_mappings as mapping on mapping.username_normalized = link.username
    left join app_private.accounts as account on account.id = mapping.account_id
    where account.id is null
      or not exists (select 1 from app_private.account_role_grants as role_grant
                     where role_grant.account_id = account.id and role_grant.role_name = 'student')
      or exists (select 1 from app_private.account_role_grants as role_grant
                 where role_grant.account_id = account.id and role_grant.role_name <> 'student')
  ) then
    raise exception using errcode = '22023', message = 'unknown or ineligible student username';
  end if;

  return query
  select link.level, link.position, level_row.public_name, account.id, mapping.username_normalized,
         mapping.provider_email, account.status,
         case
           when previous_snapshot_id is null then 'new'
           when exists (
             select 1 from app_private.published_level_row_links as old_link
             join public.published_level_rows as old_row
               on old_row.snapshot_id = old_link.snapshot_id and old_row.level = old_link.level
               and old_row.position = old_link.position
             where old_link.snapshot_id = previous_snapshot_id and old_link.account_id = account.id
               and old_row.level = link.level
               and pg_catalog.lower(pg_catalog.btrim(old_row.public_name)) = pg_catalog.lower(pg_catalog.btrim(level_row.public_name))
           ) then 'unchanged'
           when exists (
             select 1 from app_private.published_level_row_links as old_link
             where old_link.snapshot_id = previous_snapshot_id and old_link.account_id = account.id
           ) then 'changed'
           else 'new'
         end
  from pg_temp.requested_links as link
  join public.published_level_rows as level_row
    on level_row.snapshot_id = p_snapshot_id and level_row.level = link.level and level_row.position = link.position
  join app_private.identity_mappings as mapping on mapping.username_normalized = link.username
  join app_private.accounts as account on account.id = mapping.account_id
  order by link.level, link.position;
end
$$;
revoke all on function app_private.resolve_level_row_links(uuid, jsonb) from public, anon, authenticated, service_role;

create function public.preview_level_row_links(p_snapshot_id uuid, p_links jsonb)
returns table (
  level smallint, "position" smallint, public_name text, username text, provider_email text,
  account_status text, previous_state text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('leaderboards.link') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  return query
  select resolved.level, resolved.position, resolved.public_name, resolved.username, resolved.provider_email,
         resolved.account_status, resolved.previous_state
  from app_private.resolve_level_row_links(p_snapshot_id, p_links) as resolved;
end
$$;

-- Replaces the links of one snapshot atomically (an empty list clears them).
create function public.approve_level_row_links(p_snapshot_id uuid, p_links jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  linked integer;
  version bigint;
begin
  if not app_private.has_permission('leaderboards.link') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  actor_account_id := app_private.current_account_id();
  perform app_private.lock_leaderboard_publication();
  delete from app_private.published_level_row_links as link where link.snapshot_id = p_snapshot_id;
  insert into app_private.published_level_row_links (snapshot_id, level, position, account_id, approved_by)
  select p_snapshot_id, resolved.level, resolved.position, resolved.account_id, actor_account_id
  from app_private.resolve_level_row_links(p_snapshot_id, p_links) as resolved;
  get diagnostics linked = row_count;
  select snapshot.version_number into version from public.published_leaderboard_snapshots as snapshot
  where snapshot.id = p_snapshot_id;
  insert into app_private.audit_events (actor_account_id, action_key, reason_code)
  values (actor_account_id, 'leaderboard.links_approved', 'v' || version::text || '-n' || linked::text);
  return linked;
end
$$;

create function public.list_level_row_links(p_snapshot_id uuid)
returns table (level smallint, "position" smallint, public_name text, username text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('leaderboards.link') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  return query
  select link.level, link.position, level_row.public_name, mapping.username_normalized
  from app_private.published_level_row_links as link
  join public.published_level_rows as level_row
    on level_row.snapshot_id = link.snapshot_id and level_row.level = link.level and level_row.position = link.position
  join app_private.identity_mappings as mapping on mapping.account_id = link.account_id
  where link.snapshot_id = p_snapshot_id
  order by 1, 2;
end
$$;

revoke all on function public.preview_level_row_links(uuid, jsonb) from public, anon, service_role;
revoke all on function public.approve_level_row_links(uuid, jsonb) from public, anon, service_role;
revoke all on function public.list_level_row_links(uuid) from public, anon, service_role;
grant execute on function public.preview_level_row_links(uuid, jsonb) to authenticated;
grant execute on function public.approve_level_row_links(uuid, jsonb) to authenticated;
grant execute on function public.list_level_row_links(uuid) to authenticated;

-- Public projection: current level-only rows plus allowlisted artwork for
-- linked, active, opted-in students when personalization is switched on.
-- Never returns account, username, email, or link data.
create function public.public_level_leaderboard_v2(p_level smallint)
returns table (
  "position" smallint, public_name text, release_label text, published_at timestamptz,
  avatar_key text, avatar_family text, avatar_tone text, avatar_badge text
)
language sql
stable
security definer
set search_path = ''
as $$
  select level_row.position, level_row.public_name, snapshot.release_label, snapshot.published_at,
         chosen.character_key, chosen.family, chosen.tone, chosen.badge
  from public.published_level_rows as level_row
  join public.published_leaderboard_snapshots as snapshot on snapshot.id = level_row.snapshot_id
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
revoke all on function public.public_level_leaderboard_v2(smallint) from public;
grant execute on function public.public_level_leaderboard_v2(smallint) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Operator-only provisioning and recovery (database owner via SQL editor or
-- Management API; never exposed to PostgREST roles). Used with the Auth Admin
-- API by scripts/student-accounts.mjs.

-- Read-only reconciliation view over roster emails (no writes to auth.*).
create function app_private.operator_student_provisioning_state(p_emails text[])
returns table (
  provider_email text, auth_user_id uuid, auth_confirmed boolean, auth_has_signed_in boolean,
  auth_created_by_tool boolean, account_username text, account_status text, account_roles text[],
  force_password_change boolean, credential_update_pending boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select requested.email,
         auth_user.id,
         auth_user.email_confirmed_at is not null,
         auth_user.last_sign_in_at is not null,
         coalesce(auth_user.raw_app_meta_data ->> 'aa_provisioning', '') = 'v1',
         mapping.username_normalized,
         account.status,
         (select pg_catalog.array_agg(role_grant.role_name order by role_grant.role_name)
          from app_private.account_role_grants as role_grant where role_grant.account_id = account.id),
         account.force_password_change,
         account.credential_update_pending
  from pg_catalog.unnest(p_emails) as requested(email)
  left join auth.users as auth_user
    on pg_catalog.lower(auth_user.email) = requested.email and auth_user.deleted_at is null
  left join app_private.identity_mappings as mapping on mapping.provider_email = requested.email
  left join app_private.accounts as account on account.id = mapping.account_id
$$;
revoke all on function app_private.operator_student_provisioning_state(text[]) from public, anon, authenticated, service_role;

create function app_private.operator_username_taken(p_usernames text[])
returns table (username text)
language sql
stable
security definer
set search_path = ''
as $$
  select mapping.username_normalized from app_private.identity_mappings as mapping
  where mapping.username_normalized = any (p_usernames)
$$;
revoke all on function app_private.operator_username_taken(text[]) from public, anon, authenticated, service_role;

-- Maps a confirmed Auth user to a new student-only account (forced password
-- change). Idempotent: an identical existing mapping returns 'exists'.
create function app_private.operator_provision_student(
  p_provider_user_id uuid,
  p_username text,
  p_provider_email text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := pg_catalog.lower(pg_catalog.btrim(p_username));
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_provider_email));
  existing record;
  new_account_id uuid;
begin
  if not app_private.student_feature('student_provisioning') then
    raise exception using errcode = '42501', message = 'student provisioning is disabled';
  end if;
  if v_username is null or v_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$'
    or v_email is null or pg_catalog.length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'invalid provisioned account';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('academic_arena.student_provisioning'));

  select account.id, mapping.username_normalized, mapping.provider_email into existing
  from app_private.accounts as account
  join app_private.identity_mappings as mapping on mapping.account_id = account.id
  where account.provider_user_id = p_provider_user_id;
  if found then
    if existing.username_normalized = v_username and existing.provider_email = v_email
      and exists (select 1 from app_private.account_role_grants as role_grant
                  where role_grant.account_id = existing.id and role_grant.role_name = 'student')
      and not exists (select 1 from app_private.account_role_grants as role_grant
                      where role_grant.account_id = existing.id and role_grant.role_name <> 'student') then
      return 'exists';
    end if;
    raise exception using errcode = '23505', message = 'provider user is already mapped differently';
  end if;
  if exists (select 1 from app_private.identity_mappings as mapping
             where mapping.username_normalized = v_username or mapping.provider_email = v_email) then
    raise exception using errcode = '23505', message = 'username or email already in use';
  end if;
  if not exists (
    select 1 from auth.users as auth_user
    where auth_user.id = p_provider_user_id
      and pg_catalog.lower(auth_user.email) = v_email
      and auth_user.email_confirmed_at is not null
      and auth_user.deleted_at is null
      and auth_user.is_anonymous is not true
      and auth_user.is_sso_user is not true
      and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.now())
  ) then
    raise exception using errcode = '23503', message = 'provider identity does not match';
  end if;
  if exists (select 1 from auth.mfa_factors as factor where factor.user_id = p_provider_user_id) then
    raise exception using errcode = '22023', message = 'provider user already has MFA factors';
  end if;

  insert into app_private.accounts (provider_user_id, status, force_password_change)
  values (p_provider_user_id, 'active', true)
  returning id into new_account_id;
  insert into app_private.identity_mappings (account_id, username_normalized, provider_email)
  values (new_account_id, v_username, v_email);
  insert into app_private.account_role_grants (account_id, role_name)
  values (new_account_id, 'student');
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (new_account_id, 'account.provisioned', 'operator_batch');
  return 'created';
end
$$;
revoke all on function app_private.operator_provision_student(uuid, text, text) from public, anon, authenticated, service_role;

-- Recovery step 1: lock the student account (no sign-in, sessions revoked,
-- new credential epoch) before the operator sets a fresh temporary password
-- through the Auth Admin API. The lock is never released by elapsed time.
create function app_private.operator_begin_student_recovery(p_username text, p_verification_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
begin
  if not app_private.student_feature('student_provisioning') then
    raise exception using errcode = '42501', message = 'student provisioning is disabled';
  end if;
  if p_verification_code is null or p_verification_code !~ '^[a-z0-9][a-z0-9_.-]{0,63}$' then
    raise exception using errcode = '22023', message = 'identity verification reference required';
  end if;
  select account.id, account.provider_user_id into target
  from app_private.identity_mappings as mapping
  join app_private.accounts as account on account.id = mapping.account_id
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
  for update of account;
  if not found
    or not exists (select 1 from app_private.account_role_grants as role_grant
                   where role_grant.account_id = target.id and role_grant.role_name = 'student')
    or exists (select 1 from app_private.account_role_grants as role_grant
               where role_grant.account_id = target.id and role_grant.role_name <> 'student') then
    raise exception using errcode = '22023', message = 'student account not found';
  end if;
  if exists (select 1 from app_private.credential_sync_operations as operation
             where operation.account_id = target.id and operation.completed_at is null) then
    raise exception using errcode = '55P03', message = 'an in-app credential operation is in progress';
  end if;

  update app_private.accounts as account
  set force_password_change = true,
      credential_update_pending = true,
      credential_epoch = account.credential_epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = target.id;
  update app_private.bff_sessions as bff_session
  set revoked_at = pg_catalog.clock_timestamp(), revoke_reason = 'recovery'
  where bff_session.account_id = target.id and bff_session.revoked_at is null;
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (target.id, 'account.recovery_started', p_verification_code);
  return target.provider_user_id;
end
$$;
revoke all on function app_private.operator_begin_student_recovery(text, text) from public, anon, authenticated, service_role;

-- Recovery step 2, only after the Auth Admin API confirmed the new password.
-- The student must still change it at the next sign-in.
create function app_private.operator_finish_student_recovery(p_username text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  select account.id into target_id
  from app_private.identity_mappings as mapping
  join app_private.accounts as account on account.id = mapping.account_id
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
    and account.credential_update_pending
  for update of account;
  if not found or not exists (
    select 1 from app_private.audit_events as event
    where event.target_account_id = target_id and event.action_key = 'account.recovery_started'
      and not exists (select 1 from app_private.audit_events as later
                      where later.target_account_id = target_id and later.action_key = 'account.recovery_completed'
                        and later.id > event.id)
  ) then
    raise exception using errcode = '22023', message = 'no operator recovery in progress';
  end if;
  update app_private.accounts as account
  set credential_update_pending = false, force_password_change = true, updated_at = pg_catalog.clock_timestamp()
  where account.id = target_id;
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (target_id, 'account.recovery_completed', 'operator');
  return true;
end
$$;
revoke all on function app_private.operator_finish_student_recovery(text) from public, anon, authenticated, service_role;

create function app_private.operator_set_student_status(p_username text, p_status text, p_reason_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if p_status not in ('active', 'suspended')
    or p_reason_code is null or p_reason_code !~ '^[a-z0-9][a-z0-9_.-]{0,63}$' then
    raise exception using errcode = '22023', message = 'invalid status change';
  end if;
  select account.id into target_id
  from app_private.identity_mappings as mapping
  join app_private.accounts as account on account.id = mapping.account_id
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
  for update of account;
  if not found
    or exists (select 1 from app_private.account_role_grants as role_grant
               where role_grant.account_id = target_id and role_grant.role_name <> 'student') then
    raise exception using errcode = '22023', message = 'student account not found';
  end if;
  update app_private.accounts as account
  set status = p_status, updated_at = pg_catalog.clock_timestamp()
  where account.id = target_id;
  if p_status = 'suspended' then
    update app_private.bff_sessions as bff_session
    set revoked_at = pg_catalog.clock_timestamp(), revoke_reason = 'suspension'
    where bff_session.account_id = target_id and bff_session.revoked_at is null;
  end if;
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (target_id, case when p_status = 'suspended' then 'account.suspended' else 'account.reactivated' end, p_reason_code);
  return true;
end
$$;
revoke all on function app_private.operator_set_student_status(text, text, text) from public, anon, authenticated, service_role;

-- The pre-V1.2 avatar RPC now also honours the student sign-in switch (via
-- avatar.write) and keeps the stored public-display choice unchanged.
create or replace function public.save_own_avatar_config(
  p_character_key text,
  p_family text,
  p_tone text,
  p_badge text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_choice boolean;
begin
  if not app_private.has_permission('avatar.write') then
    raise exception using errcode = '42501', message = 'active student account required';
  end if;
  select avatar.show_on_leaderboard into current_choice
  from public.student_avatar_configs as avatar
  where avatar.account_id = app_private.current_account_id();
  return public.save_own_avatar_preferences(p_character_key, p_family, p_tone, p_badge, coalesce(current_choice, false));
end
$$;
revoke all on function public.save_own_avatar_config(text, text, text, text) from public, anon, service_role;
grant execute on function public.save_own_avatar_config(text, text, text, text) to authenticated;
