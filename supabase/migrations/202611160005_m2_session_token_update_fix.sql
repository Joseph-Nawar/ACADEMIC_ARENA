-- LEAST is a PostgreSQL special expression, not a schema-qualifiable function.
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
      expires_at = least(session.expires_at, p_provider_access_expires_at)
  from app_private.accounts as account
  where session.session_token_hash = p_session_token_hash
    and session.account_id = account.id and account.status = 'active'
    and session.revoked_at is null and session.expires_at > pg_catalog.clock_timestamp();
  did_update := found;
  return did_update;
end
$$;

revoke all on function public.update_bff_session_provider_tokens(bytea, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.update_bff_session_provider_tokens(bytea, uuid, text, text, timestamptz) to service_role;
