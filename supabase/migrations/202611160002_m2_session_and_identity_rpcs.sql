-- Narrow server-only functions for username resolution and opaque BFF sessions.
alter table app_private.bff_sessions
  add column csrf_token_jwe text not null check (pg_catalog.length(csrf_token_jwe) between 64 and 16384),
  add column provider_refresh_token_jwe text check (provider_refresh_token_jwe is null or pg_catalog.length(provider_refresh_token_jwe) between 64 and 16384);
alter table app_private.bff_sessions
  alter column csrf_token_jwe drop not null,
  alter column provider_access_token_jwe drop not null;

create or replace function public.resolve_login_identity(p_username text)
returns table (
  account_id uuid,
  provider_user_id uuid,
  provider_email text,
  account_status text,
  force_password_change boolean,
  credential_update_pending boolean,
  role_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select account.id,
         account.provider_user_id,
         mapping.provider_email,
         account.status,
         account.force_password_change,
         account.credential_update_pending,
         coalesce(pg_catalog.array_agg(role_grant.role_name order by role_grant.role_name), array[]::text[])
  from app_private.identity_mappings as mapping
  join app_private.accounts as account on account.id = mapping.account_id
  left join app_private.account_role_grants as role_grant on role_grant.account_id = account.id
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
    and pg_catalog.lower(pg_catalog.btrim(p_username)) ~ '^[a-z0-9][a-z0-9._-]{2,31}$'
  group by account.id, account.provider_user_id, mapping.provider_email,
    account.status, account.force_password_change, account.credential_update_pending
$$;

create or replace function public.create_bff_session(
  p_session_token_hash bytea,
  p_csrf_token_hash bytea,
  p_csrf_token_jwe text,
  p_account_id uuid,
  p_provider_session_id uuid,
  p_provider_access_token_jwe text,
  p_provider_refresh_token_jwe text,
  p_provider_access_expires_at timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_id uuid;
begin
  if pg_catalog.octet_length(p_session_token_hash) <> 32
    or pg_catalog.octet_length(p_csrf_token_hash) <> 32
    or pg_catalog.length(p_csrf_token_jwe) not between 64 and 16384
    or pg_catalog.length(p_provider_access_token_jwe) not between 64 and 16384
    or (p_provider_refresh_token_jwe is not null and pg_catalog.length(p_provider_refresh_token_jwe) not between 64 and 16384)
    or p_provider_session_id is null
    or p_provider_access_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > p_provider_access_expires_at
    or p_expires_at > pg_catalog.clock_timestamp() + interval '8 hours' then
    raise exception using errcode = '22023', message = 'invalid BFF session parameters';
  end if;

  if not exists (
    select 1 from app_private.accounts as account
    where account.id = p_account_id and account.status = 'active'
      and account.credential_update_pending = false
  ) then
    raise exception using errcode = '42501', message = 'active account required';
  end if;

  insert into app_private.bff_sessions (
    session_token_hash, csrf_token_hash, csrf_token_jwe, account_id,
    provider_session_id, provider_access_token_jwe, provider_refresh_token_jwe,
    provider_access_expires_at, expires_at
  ) values (
    p_session_token_hash, p_csrf_token_hash, p_csrf_token_jwe, p_account_id,
    p_provider_session_id, p_provider_access_token_jwe, p_provider_refresh_token_jwe,
    p_provider_access_expires_at, p_expires_at
  ) returning id into session_id;

  return session_id;
end
$$;

create or replace function public.resolve_bff_session(p_session_token_hash bytea)
returns table (
  session_id uuid,
  account_id uuid,
  provider_user_id uuid,
  provider_session_id uuid,
  provider_access_token_jwe text,
  provider_refresh_token_jwe text,
  csrf_token_hash bytea,
  csrf_token_jwe text,
  provider_access_expires_at timestamptz,
  expires_at timestamptz,
  force_password_change boolean,
  role_names text[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'expired',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.session_token_hash = p_session_token_hash
    and session.revoked_at is null
    and (
      session.expires_at <= pg_catalog.clock_timestamp()
      or session.provider_access_expires_at <= pg_catalog.clock_timestamp()
      or session.last_seen_at <= pg_catalog.clock_timestamp() - interval '30 minutes'
    );

  return query
  with touched as (
    update app_private.bff_sessions as session
    set last_seen_at = pg_catalog.clock_timestamp()
    from app_private.accounts as account
    where session.session_token_hash = p_session_token_hash
      and pg_catalog.octet_length(p_session_token_hash) = 32
      and session.account_id = account.id
      and account.status = 'active'
      and account.credential_update_pending = false
      and session.revoked_at is null
      and session.expires_at > pg_catalog.clock_timestamp()
      and session.provider_access_expires_at > pg_catalog.clock_timestamp()
      and session.last_seen_at > pg_catalog.clock_timestamp() - interval '30 minutes'
    returning session.id, session.account_id, account.provider_user_id,
      session.provider_session_id, session.provider_access_token_jwe,
      session.provider_refresh_token_jwe, session.csrf_token_hash,
      session.csrf_token_jwe, session.provider_access_expires_at,
      session.expires_at, account.force_password_change
  )
  select touched.id,
         touched.account_id,
         touched.provider_user_id,
         touched.provider_session_id,
         touched.provider_access_token_jwe,
         touched.provider_refresh_token_jwe,
         touched.csrf_token_hash,
         touched.csrf_token_jwe,
         touched.provider_access_expires_at,
         touched.expires_at,
         touched.force_password_change,
         coalesce(pg_catalog.array_agg(role_grant.role_name order by role_grant.role_name)
           filter (where role_grant.role_name is not null), array[]::text[])
  from touched
  left join app_private.account_role_grants as role_grant on role_grant.account_id = touched.account_id
  group by touched.id, touched.account_id, touched.provider_user_id, touched.provider_session_id,
    touched.provider_access_token_jwe, touched.provider_refresh_token_jwe,
    touched.csrf_token_hash, touched.csrf_token_jwe, touched.provider_access_expires_at,
    touched.expires_at, touched.force_password_change;
end
$$;

create or replace function public.revoke_bff_session(p_session_token_hash bytea, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  did_revoke boolean;
begin
  if pg_catalog.octet_length(p_session_token_hash) <> 32
    or p_reason not in ('logout', 'password_change', 'recovery', 'suspension', 'admin_revoke', 'expired', 'mfa_timeout', 'provider_error') then
    return false;
  end if;

  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = p_reason,
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.session_token_hash = p_session_token_hash and session.revoked_at is null;
  did_revoke := found;
  return did_revoke;
end
$$;

create or replace function public.revoke_account_sessions(p_account_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked_count integer;
begin
  if p_reason not in ('password_change', 'recovery', 'suspension', 'admin_revoke') then
    return 0;
  end if;
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = p_reason,
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = p_account_id and session.revoked_at is null;
  get diagnostics revoked_count = row_count;
  return revoked_count;
end
$$;

create or replace function public.update_bff_session_provider_tokens(
  p_session_token_hash bytea,
  p_provider_session_id uuid,
  p_provider_access_token_jwe text,
  p_provider_refresh_token_jwe text,
  p_provider_access_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  did_update boolean;
begin
  if pg_catalog.octet_length(p_session_token_hash) <> 32
    or p_provider_session_id is null
    or pg_catalog.length(p_provider_access_token_jwe) not between 64 and 16384
    or (p_provider_refresh_token_jwe is not null and pg_catalog.length(p_provider_refresh_token_jwe) not between 64 and 16384)
    or p_provider_access_expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;

  update app_private.bff_sessions as session
  set provider_session_id = p_provider_session_id,
      provider_access_token_jwe = p_provider_access_token_jwe,
      provider_refresh_token_jwe = p_provider_refresh_token_jwe,
      provider_access_expires_at = p_provider_access_expires_at,
      expires_at = pg_catalog.least(session.expires_at, p_provider_access_expires_at)
  from app_private.accounts as account
  where session.session_token_hash = p_session_token_hash
    and session.account_id = account.id and account.status = 'active'
    and session.revoked_at is null and session.expires_at > pg_catalog.clock_timestamp();
  did_update := found;
  return did_update;
end
$$;

revoke all on function public.resolve_login_identity(text) from public, anon, authenticated;
revoke all on function public.create_bff_session(bytea, bytea, text, uuid, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_bff_session(bytea) from public, anon, authenticated;
revoke all on function public.revoke_bff_session(bytea, text) from public, anon, authenticated;
revoke all on function public.revoke_account_sessions(uuid, text) from public, anon, authenticated;
revoke all on function public.update_bff_session_provider_tokens(bytea, uuid, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.resolve_login_identity(text) to service_role;
grant execute on function public.create_bff_session(bytea, bytea, text, uuid, uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.resolve_bff_session(bytea) to service_role;
grant execute on function public.revoke_bff_session(bytea, text) to service_role;
grant execute on function public.revoke_account_sessions(uuid, text) to service_role;
grant execute on function public.update_bff_session_provider_tokens(bytea, uuid, text, text, timestamptz) to service_role;
