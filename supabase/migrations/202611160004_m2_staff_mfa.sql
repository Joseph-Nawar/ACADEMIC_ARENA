insert into app_private.role_permissions (role_name, permission_key)
values ('admin', 'accounts.mfa_reset')
on conflict (role_name, permission_key) do nothing;

create or replace function public.record_staff_mfa_event(p_account_id uuid, p_action_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action_key not in (
    'staff.mfa_enrollment_started', 'staff.mfa_enrolled', 'staff.mfa_verified'
  ) then
    return false;
  end if;
  if not exists (
    select 1
    from app_private.accounts as account
    join app_private.account_role_grants as role_grant on role_grant.account_id = account.id
    where account.id = p_account_id and account.status = 'active'
      and role_grant.role_name in ('moderator', 'publisher', 'admin')
  ) then
    return false;
  end if;
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (p_account_id, p_account_id, p_action_key, 'totp');
  return true;
end
$$;

create or replace function public.reset_staff_mfa_for_account(p_username text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  target_account_id uuid;
begin
  if not app_private.has_permission('accounts.mfa_reset') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  actor_account_id := app_private.current_account_id();

  select account.id into target_account_id
  from app_private.identity_mappings as mapping
  join app_private.accounts as account on account.id = mapping.account_id
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
    and account.status = 'active'
    and account.id <> actor_account_id
    and exists (
      select 1 from app_private.account_role_grants as role_grant
      where role_grant.account_id = account.id
        and role_grant.role_name in ('moderator', 'publisher', 'admin')
    )
  for update of account;

  if target_account_id is null then
    return false;
  end if;

  update app_private.accounts as account
  set force_password_change = true, updated_at = pg_catalog.clock_timestamp()
  where account.id = target_account_id;
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'recovery',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = target_account_id and session.revoked_at is null;
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, target_account_id, 'staff.mfa_reset', 'administrator_recovery');
  return true;
end
$$;

revoke all on function public.record_staff_mfa_event(uuid, text) from public, anon, authenticated;
grant execute on function public.record_staff_mfa_event(uuid, text) to service_role;
revoke all on function public.reset_staff_mfa_for_account(text) from public, anon, authenticated;
grant execute on function public.reset_staff_mfa_for_account(text) to authenticated;
