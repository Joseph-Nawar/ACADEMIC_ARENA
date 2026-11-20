-- V1.6 student sign-in hotfix (append-only).
--
-- 1. The login limiter now counts failed attempts only. The BFF still consumes
--    an attempt atomically before calling Auth (so concurrent guesses cannot
--    race past the limit) and gives it back only after a fully successful
--    sign-in or password change. Before this, a student's own successful
--    sign-in and password change used 2 of their 8 attempts, and every
--    successful student on a shared campus IP used up the 40-attempt IP budget.
-- 2. Per-username limit: 8 failures per 15 minutes (unchanged).
--    Per-client-IP limit: 100 failures per 15 minutes (was 40 attempts,
--    successes included), so one university network can onboard a cohort.
-- 3. app_private.auth_diagnostic_events: private reason codes for each sign-in
--    and password-change outcome, for incident investigation. No usernames,
--    emails, IPs, passwords or tokens are stored. Service role only, RLS
--    forced, 7-day retention, flood-resistant write budgets.

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
  return username_count <= 8 and client_ip_count <= 100;
end
$$;

-- Gives back the attempt consumed by a request that then succeeded. Only the
-- BFF (service role) calls it, and only after Auth accepted the password.
create or replace function public.release_login_attempt(p_username_key bytea, p_client_ip_key bytea)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.octet_length(p_username_key) <> 32 or pg_catalog.octet_length(p_client_ip_key) <> 32 then
    return;
  end if;
  -- Delete exhausted rows first, so a row decremented to 1 below is kept.
  delete from app_private.login_rate_limit_buckets as bucket
  where ((bucket.bucket_kind = 'username' and bucket.bucket_key = p_username_key)
      or (bucket.bucket_kind = 'client_ip' and bucket.bucket_key = p_client_ip_key))
    and bucket.attempt_count <= 1;
  update app_private.login_rate_limit_buckets as bucket
  set attempt_count = bucket.attempt_count - 1
  where ((bucket.bucket_kind = 'username' and bucket.bucket_key = p_username_key)
      or (bucket.bucket_kind = 'client_ip' and bucket.bucket_key = p_client_ip_key))
    and bucket.attempt_count > 1;
end
$$;

revoke all on function public.release_login_attempt(bytea, bytea) from public, anon, authenticated;
grant execute on function public.release_login_attempt(bytea, bytea) to service_role;
revoke all on function public.consume_login_rate_limit(bytea, bytea) from public, anon, authenticated;
grant execute on function public.consume_login_rate_limit(bytea, bytea) to service_role;

create table app_private.auth_diagnostic_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  correlation_id uuid not null,
  flow text not null check (flow in ('login', 'password_change')),
  stage text not null check (stage in (
    -- shared
    'invalid_request', 'rate_limited', 'lookup_unavailable', 'credential_update_pending',
    -- login
    'unknown_username', 'account_inactive', 'no_role', 'student_sign_in_off',
    'provider_rejected', 'provider_unavailable', 'provider_identity_mismatch', 'provider_token_invalid',
    'mfa_factor_error', 'session_store_failed', 'signed_in',
    -- password change
    'account_mismatch', 'current_password_rejected', 'provider_update_rejected',
    'provider_update_uncertain', 'completion_failed', 'changed', 'changed_signed_in'
  )),
  outcome text not null check (outcome in ('success', 'rejected', 'unavailable')),
  account_id uuid references app_private.accounts(id) on delete cascade,
  -- Account state at that moment (no credentials): was a temporary password
  -- still required, and which credential epoch was current.
  temporary_password boolean,
  credential_epoch bigint
);
create index auth_diagnostic_events_time_idx on app_private.auth_diagnostic_events (occurred_at);
create index auth_diagnostic_events_account_idx on app_private.auth_diagnostic_events (account_id, occurred_at);

alter table app_private.auth_diagnostic_events enable row level security;
alter table app_private.auth_diagnostic_events force row level security;
revoke all on table app_private.auth_diagnostic_events from public, anon, authenticated;

-- p_username is used only to find the account for stages that run before the
-- BFF resolved it (rate_limited); it is never stored.
create or replace function public.record_auth_diagnostic(
  p_correlation_id uuid,
  p_flow text,
  p_stage text,
  p_outcome text,
  p_account_id uuid,
  p_username text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
  target_account uuid := p_account_id;
begin
  -- Malformed requests are logged to the console only (no account, no value).
  if p_stage = 'invalid_request' then
    return;
  end if;
  -- Backstop for storage on Supabase Free: at most 300 rows per minute.
  if (select pg_catalog.count(*) from app_private.auth_diagnostic_events
      where occurred_at > now_at - interval '1 minute') >= 300 then
    return;
  end if;

  if target_account is null and p_username is not null
     and pg_catalog.lower(pg_catalog.btrim(p_username)) ~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    select mapping.account_id into target_account
    from app_private.identity_mappings as mapping
    where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username));
  end if;

  -- Budgets, so floods cannot crowd out real accounts' events:
  -- * events without an account (unknown usernames, any IP) share 20/minute;
  -- * a throttled account is recorded once per 15-minute limiter window.
  -- Other account events are already bounded by the limiter (8 failures per
  -- 15 minutes) or need the account's password.
  if target_account is null then
    if (select pg_catalog.count(*) from app_private.auth_diagnostic_events
        where account_id is null and occurred_at > now_at - interval '1 minute') >= 20 then
      return;
    end if;
  elsif p_stage = 'rate_limited' and exists (
    select 1 from app_private.auth_diagnostic_events
    where account_id = target_account and stage = 'rate_limited' and occurred_at > now_at - interval '15 minutes'
  ) then
    return;
  end if;

  insert into app_private.auth_diagnostic_events (
    correlation_id, flow, stage, outcome, account_id, temporary_password, credential_epoch
  )
  select p_correlation_id, p_flow, p_stage, p_outcome, account.id,
         account.force_password_change, account.credential_epoch
  from (select 1) as one
  left join app_private.accounts as account on account.id = target_account;

  delete from app_private.auth_diagnostic_events where occurred_at < now_at - interval '7 days';
end
$$;

revoke all on function public.record_auth_diagnostic(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_auth_diagnostic(uuid, text, text, text, uuid, text) to service_role;
