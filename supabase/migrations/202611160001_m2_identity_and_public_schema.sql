-- Academic Arena M2 identity and public projection foundation.
-- No real identities, academic records, or ranking rows are seeded here.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant usage on schema app_private to service_role;

create table app_private.accounts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  provider_user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  force_password_change boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table app_private.identity_mappings (
  account_id uuid primary key references app_private.accounts(id) on delete cascade,
  username_normalized text not null unique
    check (username_normalized ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  provider_email text not null unique
    check (pg_catalog.length(provider_email) between 3 and 254 and provider_email = pg_catalog.lower(provider_email)),
  created_at timestamptz not null default pg_catalog.now()
);

create table app_private.account_role_grants (
  account_id uuid not null references app_private.accounts(id) on delete cascade,
  role_name text not null check (role_name in ('student', 'moderator', 'publisher', 'admin')),
  granted_at timestamptz not null default pg_catalog.now(),
  granted_by uuid references app_private.accounts(id) on delete set null,
  primary key (account_id, role_name)
);

create table app_private.role_permissions (
  role_name text not null check (role_name in ('student', 'moderator', 'publisher', 'admin')),
  permission_key text not null check (permission_key ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  primary key (role_name, permission_key)
);

insert into app_private.role_permissions (role_name, permission_key) values
  ('student', 'avatar.read'),
  ('student', 'avatar.write'),
  ('student', 'campus_wins.react'),
  ('student', 'campus_wins.submit'),
  ('moderator', 'campus_wins.moderate'),
  ('publisher', 'leaderboards.publish'),
  ('admin', 'accounts.provision'),
  ('admin', 'accounts.recover'),
  ('admin', 'accounts.suspend'),
  ('admin', 'campus_wins.moderate'),
  ('admin', 'leaderboards.publish'),
  ('admin', 'roles.manage');

create table app_private.bff_sessions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_token_hash bytea not null unique check (pg_catalog.octet_length(session_token_hash) = 32),
  csrf_token_hash bytea not null check (pg_catalog.octet_length(csrf_token_hash) = 32),
  account_id uuid not null references app_private.accounts(id) on delete cascade,
  provider_session_id uuid not null,
  provider_access_token_jwe text not null check (pg_catalog.length(provider_access_token_jwe) between 64 and 16384),
  provider_access_expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  last_seen_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or revoke_reason in ('logout', 'password_change', 'recovery', 'suspension', 'admin_revoke', 'expired')),
  check (expires_at > created_at),
  check (expires_at <= provider_access_expires_at),
  check ((revoked_at is null) = (revoke_reason is null))
);
create index bff_sessions_account_active_idx on app_private.bff_sessions (account_id, expires_at)
  where revoked_at is null;

create table app_private.login_rate_limit_buckets (
  bucket_kind text not null check (bucket_kind in ('username', 'client_ip')),
  bucket_key bytea not null check (pg_catalog.octet_length(bucket_key) = 32),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0),
  expires_at timestamptz not null,
  primary key (bucket_kind, bucket_key),
  check (expires_at > window_started_at),
  check (expires_at <= window_started_at + interval '16 minutes')
);
create index login_rate_limit_expiry_idx on app_private.login_rate_limit_buckets (expires_at);

create table app_private.audit_events (
  id bigint generated always as identity primary key,
  actor_account_id uuid references app_private.accounts(id) on delete set null,
  target_account_id uuid references app_private.accounts(id) on delete set null,
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  reason_code text check (reason_code is null or reason_code ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  created_at timestamptz not null default pg_catalog.now()
);
create index audit_events_target_time_idx on app_private.audit_events (target_account_id, created_at desc);

create table app_private.campus_wins_submissions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_account_id uuid not null references app_private.accounts(id) on delete cascade,
  template_key text not null check (template_key in ('top3', 'workshop', 'project', 'helped')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'hidden', 'removed')),
  public_author_name text,
  approved_avatar_key text,
  approved_avatar_family text check (approved_avatar_family is null or approved_avatar_family in ('ink', 'cartoon3d')),
  created_at timestamptz not null default pg_catalog.now(),
  moderated_by uuid references app_private.accounts(id) on delete set null,
  moderated_at timestamptz,
  moderation_reason_code text check (moderation_reason_code is null or moderation_reason_code ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  check (public_author_name is null or (pg_catalog.length(pg_catalog.btrim(public_author_name)) between 1 and 80 and public_author_name !~ '[[:cntrl:]]')),
  check (approved_avatar_key is null or approved_avatar_key in ('omar', 'mariam', 'youssef', 'amara', 'tariq', 'habiba2', 'malek', 'nour2', 'zein')),
  check (status <> 'approved' or (moderated_at is not null and public_author_name is not null and approved_avatar_key is not null and approved_avatar_family is not null))
);
create index campus_wins_submissions_owner_created_idx on app_private.campus_wins_submissions (owner_account_id, created_at desc);
create index campus_wins_submissions_queue_idx on app_private.campus_wins_submissions (created_at)
  where status = 'pending';
create unique index campus_wins_one_pending_per_account_idx on app_private.campus_wins_submissions (owner_account_id)
  where status = 'pending';

create table app_private.campus_wins_reactions (
  post_id uuid not null references app_private.campus_wins_submissions(id) on delete cascade,
  owner_account_id uuid not null references app_private.accounts(id) on delete cascade,
  reaction_key text not null check (reaction_key in ('heart', 'clap', 'fire')),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (post_id, owner_account_id)
);

create table public.student_avatar_configs (
  account_id uuid primary key references app_private.accounts(id) on delete cascade,
  character_key text not null check (character_key in ('omar', 'mariam', 'youssef', 'amara', 'tariq', 'habiba2', 'malek', 'nour2', 'zein')),
  family text not null check (family in ('ink', 'cartoon3d')),
  tone text not null default 'mint' check (tone in ('mint', 'coral', 'gold', 'paper', 'blue', 'lilac')),
  badge text not null default '✦' check (badge in ('✦', '⚡', '♥', '★', '')),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.published_leaderboard_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  version_number bigint not null unique check (version_number > 0),
  academic_year text not null check (academic_year ~ '^[a-zA-Z0-9._-]{4,32}$'),
  published_at timestamptz not null,
  is_current boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  check (not is_current or revoked_at is null)
);
create unique index one_current_leaderboard_snapshot_idx on public.published_leaderboard_snapshots ((is_current))
  where is_current and revoked_at is null;

create table public.published_leaderboard_rows (
  snapshot_id uuid not null references public.published_leaderboard_snapshots(id) on delete cascade,
  level smallint not null check (level in (4, 5, 6)),
  semester smallint not null check (semester in (1, 2)),
  cohort_key text not null check (cohort_key ~ '^[a-z0-9][a-z0-9._-]{0,47}$'),
  board_kind text not null check (board_kind in ('semester', 'module')),
  module_key text,
  position smallint not null check (position between 1 and 10),
  public_name text not null check (pg_catalog.length(pg_catalog.btrim(public_name)) between 1 and 80 and public_name !~ '[[:cntrl:]]'),
  avatar_key text not null check (avatar_key in ('omar', 'mariam', 'youssef', 'amara', 'tariq', 'habiba2', 'malek', 'nour2', 'zein')),
  avatar_family text not null check (avatar_family in ('ink', 'cartoon3d')),
  check (
    (board_kind = 'semester' and module_key is null)
    or (board_kind = 'module' and module_key is not null and module_key ~ '^[a-z0-9][a-z0-9._-]{0,47}$')
  ),
  unique nulls not distinct (snapshot_id, level, semester, cohort_key, board_kind, module_key, position)
);
create index published_leaderboard_lookup_idx on public.published_leaderboard_rows
  (level, semester, cohort_key, board_kind, module_key, position);

create table public.campus_wins_public (
  post_id uuid primary key references app_private.campus_wins_submissions(id) on delete cascade,
  template_key text not null check (template_key in ('top3', 'workshop', 'project', 'helped')),
  public_author_name text not null check (pg_catalog.length(pg_catalog.btrim(public_author_name)) between 1 and 80 and public_author_name !~ '[[:cntrl:]]'),
  avatar_key text not null check (avatar_key in ('omar', 'mariam', 'youssef', 'amara', 'tariq', 'habiba2', 'malek', 'nour2', 'zein')),
  avatar_family text not null check (avatar_family in ('ink', 'cartoon3d')),
  published_at timestamptz not null,
  heart_count integer not null default 0 check (heart_count >= 0),
  clap_count integer not null default 0 check (clap_count >= 0),
  fire_count integer not null default 0 check (fire_count >= 0)
);

-- Internal lookup helpers are intentionally not in PostgREST's exposed schema list.
create or replace function app_private.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account.id
  from app_private.accounts as account
  where account.provider_user_id = (select auth.uid())
    and account.status = 'active'
  limit 1
$$;

create or replace function app_private.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app_private.accounts as account
    where account.provider_user_id = (select auth.uid()) and account.status = 'active'
  )
$$;

create or replace function app_private.owns_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_account_id is not null and p_account_id = app_private.current_account_id()
$$;

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
      and permission.permission_key = p_permission_key
      and (
        role_grant.role_name = 'student'
        or coalesce((nullif(pg_catalog.current_setting('request.jwt.claims', true), ''))::jsonb ->> 'aal', '') = 'aal2'
      )
  )
$$;

create or replace function app_private.assign_avatar_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid;
begin
  if (select auth.uid()) is not null then
    current_id := app_private.current_account_id();
    if current_id is null then
      raise exception using errcode = '42501', message = 'active account required';
    end if;
    new.account_id := current_id;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create or replace function app_private.assert_public_campus_win()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_submission app_private.campus_wins_submissions%rowtype;
begin
  select submission.* into approved_submission
  from app_private.campus_wins_submissions as submission
  where submission.id = new.post_id and submission.status = 'approved';

  if not found
    or new.template_key is distinct from approved_submission.template_key
    or new.public_author_name is distinct from approved_submission.public_author_name
    or new.avatar_key is distinct from approved_submission.approved_avatar_key
    or new.avatar_family is distinct from approved_submission.approved_avatar_family then
    raise exception using errcode = '23514', message = 'public Campus Wins row must match an approved submission';
  end if;
  return new;
end
$$;

create trigger student_avatar_assign_owner
before insert or update on public.student_avatar_configs
for each row execute function app_private.assign_avatar_owner();
create trigger campus_wins_public_requires_approval
before insert or update on public.campus_wins_public
for each row execute function app_private.assert_public_campus_win();

-- Public schema RPCs are server-only and deliberately return no identity to browser roles.
create or replace function public.provision_account(
  p_provider_user_id uuid,
  p_username text,
  p_provider_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text;
  normalized_email text;
  confirmed_provider_email text;
  new_account_id uuid;
begin
  normalized_username := pg_catalog.lower(pg_catalog.btrim(p_username));
  normalized_email := pg_catalog.lower(pg_catalog.btrim(p_provider_email));
  if normalized_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$'
    or pg_catalog.length(normalized_email) not between 3 and 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'invalid provisioned account';
  end if;

  select pg_catalog.lower(auth_user.email) into confirmed_provider_email
  from auth.users as auth_user
  where auth_user.id = p_provider_user_id;
  if confirmed_provider_email is null or confirmed_provider_email <> normalized_email then
    raise exception using errcode = '23503', message = 'provider identity does not match';
  end if;

  insert into app_private.accounts (provider_user_id, status, force_password_change)
  values (p_provider_user_id, 'active', true)
  returning id into new_account_id;

  insert into app_private.identity_mappings (account_id, username_normalized, provider_email)
  values (new_account_id, normalized_username, normalized_email);

  insert into app_private.account_role_grants (account_id, role_name)
  values (new_account_id, 'student');

  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (new_account_id, 'account.provisioned', 'staff_provisioned');

  return new_account_id;
end
$$;

create or replace function public.consume_login_rate_limit(p_username_key bytea, p_client_ip_key bytea)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  username_count integer;
  client_ip_count integer;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if pg_catalog.octet_length(p_username_key) <> 32 or pg_catalog.octet_length(p_client_ip_key) <> 32 then
    return false;
  end if;

  insert into app_private.login_rate_limit_buckets as bucket (
    bucket_kind, bucket_key, window_started_at, attempt_count, expires_at
  ) values ('username', p_username_key, now_at, 1, now_at + interval '15 minutes')
  on conflict (bucket_kind, bucket_key) do update set
    attempt_count = case when bucket.window_started_at + interval '15 minutes' <= now_at then 1 else bucket.attempt_count + 1 end,
    window_started_at = case when bucket.window_started_at + interval '15 minutes' <= now_at then now_at else bucket.window_started_at end,
    expires_at = case when bucket.window_started_at + interval '15 minutes' <= now_at then now_at + interval '15 minutes' else bucket.expires_at end
  returning attempt_count into username_count;

  insert into app_private.login_rate_limit_buckets as bucket (
    bucket_kind, bucket_key, window_started_at, attempt_count, expires_at
  ) values ('client_ip', p_client_ip_key, now_at, 1, now_at + interval '15 minutes')
  on conflict (bucket_kind, bucket_key) do update set
    attempt_count = case when bucket.window_started_at + interval '15 minutes' <= now_at then 1 else bucket.attempt_count + 1 end,
    window_started_at = case when bucket.window_started_at + interval '15 minutes' <= now_at then now_at else bucket.window_started_at end,
    expires_at = case when bucket.window_started_at + interval '15 minutes' <= now_at then now_at + interval '15 minutes' else bucket.expires_at end
  returning attempt_count into client_ip_count;

  delete from app_private.login_rate_limit_buckets where expires_at < now_at;
  return username_count <= 8 and client_ip_count <= 40;
end
$$;

revoke all on function app_private.current_account_id() from public, anon;
revoke all on function app_private.account_is_active() from public, anon;
revoke all on function app_private.owns_account(uuid) from public, anon;
revoke all on function app_private.has_permission(text) from public, anon;
revoke all on function app_private.assign_avatar_owner() from public, anon, authenticated;
revoke all on function app_private.assert_public_campus_win() from public, anon, authenticated;
grant execute on function app_private.current_account_id() to authenticated;
grant execute on function app_private.account_is_active() to authenticated;
grant execute on function app_private.owns_account(uuid) to authenticated;
grant execute on function app_private.has_permission(text) to authenticated;

revoke all on function public.provision_account(uuid, text, text) from public, anon, authenticated;
grant execute on function public.provision_account(uuid, text, text) to service_role;
revoke all on function public.consume_login_rate_limit(bytea, bytea) from public, anon, authenticated;
grant execute on function public.consume_login_rate_limit(bytea, bytea) to service_role;

alter table app_private.accounts enable row level security;
alter table app_private.accounts force row level security;
alter table app_private.identity_mappings enable row level security;
alter table app_private.identity_mappings force row level security;
alter table app_private.account_role_grants enable row level security;
alter table app_private.account_role_grants force row level security;
alter table app_private.role_permissions enable row level security;
alter table app_private.role_permissions force row level security;
alter table app_private.bff_sessions enable row level security;
alter table app_private.bff_sessions force row level security;
alter table app_private.login_rate_limit_buckets enable row level security;
alter table app_private.login_rate_limit_buckets force row level security;
alter table app_private.audit_events enable row level security;
alter table app_private.audit_events force row level security;
alter table app_private.campus_wins_submissions enable row level security;
alter table app_private.campus_wins_submissions force row level security;
alter table app_private.campus_wins_reactions enable row level security;
alter table app_private.campus_wins_reactions force row level security;

alter table public.student_avatar_configs enable row level security;
alter table public.student_avatar_configs force row level security;
alter table public.published_leaderboard_snapshots enable row level security;
alter table public.published_leaderboard_snapshots force row level security;
alter table public.published_leaderboard_rows enable row level security;
alter table public.published_leaderboard_rows force row level security;
alter table public.campus_wins_public enable row level security;
alter table public.campus_wins_public force row level security;

create policy student_avatar_select_own on public.student_avatar_configs
  for select to authenticated using (app_private.owns_account(account_id));
create policy student_avatar_insert_own on public.student_avatar_configs
  for insert to authenticated with check (app_private.account_is_active() and account_id = app_private.current_account_id());
create policy student_avatar_update_own on public.student_avatar_configs
  for update to authenticated using (app_private.owns_account(account_id))
  with check (app_private.account_is_active() and account_id = app_private.current_account_id());

create policy public_read_current_leaderboard_snapshot on public.published_leaderboard_snapshots
  for select to anon, authenticated using (is_current and revoked_at is null);
create policy public_read_current_leaderboard_rows on public.published_leaderboard_rows
  for select to anon, authenticated using (
    exists (
      select 1 from public.published_leaderboard_snapshots as snapshot
      where snapshot.id = snapshot_id and snapshot.is_current and snapshot.revoked_at is null
    )
  );
create policy public_read_approved_campus_wins on public.campus_wins_public
  for select to anon, authenticated using (true);

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;
revoke all on table public.student_avatar_configs from public, anon, authenticated;
revoke all on table public.published_leaderboard_snapshots from public, anon, authenticated;
revoke all on table public.published_leaderboard_rows from public, anon, authenticated;
revoke all on table public.campus_wins_public from public, anon, authenticated;

grant select (character_key, family, tone, badge) on table public.student_avatar_configs to authenticated;
grant insert (character_key, family, tone, badge) on table public.student_avatar_configs to authenticated;
grant update (character_key, family, tone, badge) on table public.student_avatar_configs to authenticated;
grant select on table public.published_leaderboard_snapshots to anon, authenticated;
grant select on table public.published_leaderboard_rows to anon, authenticated;
grant select on table public.campus_wins_public to anon, authenticated;
grant insert, update, delete on table public.published_leaderboard_snapshots to service_role;
grant insert, update, delete on table public.published_leaderboard_rows to service_role;
grant insert, update, delete on table public.campus_wins_public to service_role;

-- Server-owned trigger functions and RPCs execute as their migration owner.
revoke all on function public.provision_account(uuid, text, text) from public, anon, authenticated;
revoke all on function public.consume_login_rate_limit(bytea, bytea) from public, anon, authenticated;

