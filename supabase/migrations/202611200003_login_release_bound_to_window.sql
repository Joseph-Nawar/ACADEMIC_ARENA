-- V1.6 hotfix, part 2 (append-only): a released attempt is given back only in
-- the limiter window it was counted in.
--
-- With 202611200002, if a 15-minute window rolled over between a successful
-- request's consume and its release, the release decremented the NEW window,
-- which may hold someone else's failure (including a guess against the same
-- username). Now the consume returns the window it counted the attempt in, and
-- the release decrements only that exact window.
--
-- consume_login_rate_limit (boolean) is unchanged and stays in use by staff
-- MFA routes, which never release.

create or replace function public.consume_login_attempt(p_username_key bytea, p_client_ip_key bytea)
returns table (allowed boolean, username_window timestamptz, client_ip_window timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  username_count integer;
  client_ip_count integer;
  username_started timestamptz;
  client_ip_started timestamptz;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if pg_catalog.octet_length(p_username_key) <> 32 or pg_catalog.octet_length(p_client_ip_key) <> 32 then
    return query select false, null::timestamptz, null::timestamptz;
    return;
  end if;

  insert into app_private.login_rate_limit_buckets as bucket (
    bucket_kind, bucket_key, window_started_at, attempt_count, expires_at
  ) values ('username', p_username_key, now_at, 1, now_at + interval '15 minutes')
  on conflict (bucket_kind, bucket_key) do update set
    attempt_count = case when bucket.window_started_at + interval '15 minutes' <= now_at then 1 else bucket.attempt_count + 1 end,
    window_started_at = case when bucket.window_started_at + interval '15 minutes' <= now_at then now_at else bucket.window_started_at end,
    expires_at = case when bucket.window_started_at + interval '15 minutes' <= now_at then now_at + interval '15 minutes' else bucket.expires_at end
  returning attempt_count, window_started_at into username_count, username_started;

  insert into app_private.login_rate_limit_buckets as bucket (
    bucket_kind, bucket_key, window_started_at, attempt_count, expires_at
  ) values ('client_ip', p_client_ip_key, now_at, 1, now_at + interval '15 minutes')
  on conflict (bucket_kind, bucket_key) do update set
    attempt_count = case when bucket.window_started_at + interval '15 minutes' <= now_at then 1 else bucket.attempt_count + 1 end,
    window_started_at = case when bucket.window_started_at + interval '15 minutes' <= now_at then now_at else bucket.window_started_at end,
    expires_at = case when bucket.window_started_at + interval '15 minutes' <= now_at then now_at + interval '15 minutes' else bucket.expires_at end
  returning attempt_count, window_started_at into client_ip_count, client_ip_started;

  delete from app_private.login_rate_limit_buckets where expires_at < now_at;
  return query select username_count <= 8 and client_ip_count <= 100, username_started, client_ip_started;
end
$$;

-- The window-unaware release from 202611200002 is replaced (no deployed
-- production code calls it).
drop function if exists public.release_login_attempt(bytea, bytea);

create or replace function public.release_login_attempt(
  p_username_key bytea,
  p_client_ip_key bytea,
  p_username_window timestamptz,
  p_client_ip_window timestamptz
)
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
  -- Only the bucket generation the attempt was counted in is touched.
  delete from app_private.login_rate_limit_buckets as bucket
  where ((bucket.bucket_kind = 'username' and bucket.bucket_key = p_username_key and bucket.window_started_at = p_username_window)
      or (bucket.bucket_kind = 'client_ip' and bucket.bucket_key = p_client_ip_key and bucket.window_started_at = p_client_ip_window))
    and bucket.attempt_count <= 1;
  update app_private.login_rate_limit_buckets as bucket
  set attempt_count = bucket.attempt_count - 1
  where ((bucket.bucket_kind = 'username' and bucket.bucket_key = p_username_key and bucket.window_started_at = p_username_window)
      or (bucket.bucket_kind = 'client_ip' and bucket.bucket_key = p_client_ip_key and bucket.window_started_at = p_client_ip_window))
    and bucket.attempt_count > 1;
end
$$;

revoke all on function public.consume_login_attempt(bytea, bytea) from public, anon, authenticated;
grant execute on function public.consume_login_attempt(bytea, bytea) to service_role;
revoke all on function public.release_login_attempt(bytea, bytea, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.release_login_attempt(bytea, bytea, timestamptz, timestamptz) to service_role;
