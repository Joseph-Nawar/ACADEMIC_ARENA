-- M2 review fixes.
-- 1. Unresolved provider claims become reconcilable by an explicit staff retry
--    once a conservative quiescence window has elapsed. Before then, a held
--    claim still blocks any new credential generation.
-- 2. Cleanup of expired encrypted retry payloads is bounded per call and also
--    removes payloads whose claim is past the quiescence window.
-- 3. Operator-only (database owner) bootstrap of the first administrator and
--    break-glass staff MFA recovery. No API role can execute these.

-- The BFF aborts provider calls after 15 seconds; Auth Admin requests cannot
-- plausibly still be applied 15 minutes after the claim was taken.
create function app_private.credential_sync_lease_is_stale(p_leased_at timestamptz)
returns boolean
language sql
volatile
set search_path = ''
as $$
  select p_leased_at is not null
    and p_leased_at <= pg_catalog.clock_timestamp() - interval '15 minutes'
$$;
revoke all on function app_private.credential_sync_lease_is_stale(timestamptz) from public;

alter table app_private.credential_sync_operations add column leased_at timestamptz;
update app_private.credential_sync_operations
set leased_at = pg_catalog.clock_timestamp()
where lease_token_hash is not null;
alter table app_private.credential_sync_operations
  add constraint credential_sync_operations_lease_time_check
  check ((lease_token_hash is null) = (leased_at is null));

-- Lease time is stamped by the database whenever a claim is taken or changed.
-- Only security-definer functions write this table; no API role has grants.
create function app_private.stamp_credential_sync_lease()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lease_token_hash is null then
    new.leased_at := null;
  elsif tg_op = 'INSERT' or old.lease_token_hash is distinct from new.lease_token_hash then
    new.leased_at := pg_catalog.clock_timestamp();
  end if;
  return new;
end
$$;
revoke all on function app_private.stamp_credential_sync_lease() from public;
create trigger credential_sync_operations_stamp_lease
before insert or update on app_private.credential_sync_operations
for each row execute function app_private.stamp_credential_sync_lease();

create or replace function public.prune_expired_credential_sync_operations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  with doomed as (
    select operation.account_id, operation.operation_kind
    from app_private.credential_sync_operations as operation
    where operation.expires_at <= pg_catalog.clock_timestamp()
      and (operation.lease_token_hash is null
        or app_private.credential_sync_lease_is_stale(operation.leased_at))
    order by operation.expires_at
    limit 200
    for update skip locked
  )
  delete from app_private.credential_sync_operations as operation
  using doomed
  where operation.account_id = doomed.account_id
    and operation.operation_kind = doomed.operation_kind;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

create or replace function public.force_password_change_for_account(
  p_username text,
  p_password_jwe text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  target_account_id uuid;
  target_epoch bigint;
  current_operation app_private.credential_sync_operations%rowtype;
  reconciling boolean := false;
begin
  if not app_private.fictional_account_lifecycle_enabled() then
    raise exception using errcode = '42501', message = 'fictional account lifecycle is disabled';
  end if;
  if p_password_jwe is null or pg_catalog.length(p_password_jwe) not between 64 and 4096 then
    raise exception using errcode = '22023', message = 'invalid encrypted recovery credential';
  end if;
  if not app_private.has_permission('accounts.recover') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  actor_account_id := app_private.current_account_id();

  select account.id, account.credential_epoch into target_account_id, target_epoch
  from app_private.identity_mappings as mapping
  join app_private.accounts as account on account.id = mapping.account_id
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
    and account.status = 'active'
    and actor_account_id <> account.id
    and exists (
      select 1 from app_private.account_role_grants as student_role
      where student_role.account_id = account.id and student_role.role_name = 'student'
    )
    and not exists (
      select 1 from app_private.account_role_grants as staff_role
      where staff_role.account_id = account.id and staff_role.role_name in ('moderator', 'publisher', 'admin')
    )
  for update of account;
  if target_account_id is null then
    return false;
  end if;

  select operation.* into current_operation
  from app_private.credential_sync_operations as operation
  where operation.account_id = target_account_id
    and operation.operation_kind = 'student_password_recovery'
  for update;
  if found then
    if current_operation.lease_token_hash is not null then
      -- A provider request may still be in flight: never race it with a new
      -- generation until the quiescence window proves it has resolved.
      if not app_private.credential_sync_lease_is_stale(current_operation.leased_at) then
        return true;
      end if;
      reconciling := true;
    elsif current_operation.credential_epoch = target_epoch
      and current_operation.expires_at > pg_catalog.clock_timestamp()
      and current_operation.password_jwe is not null
      and current_operation.completed_at is null
      and (select account.force_password_change and account.credential_update_pending
           from app_private.accounts as account where account.id = target_account_id) then
      return true;
    end if;
  end if;

  update app_private.accounts as account
  set force_password_change = true,
      credential_update_pending = true,
      credential_epoch = account.credential_epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = target_account_id
  returning account.credential_epoch into target_epoch;
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'recovery',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = target_account_id and session.revoked_at is null;

  insert into app_private.credential_sync_operations (
    account_id, operation_kind, credential_epoch, password_jwe, expires_at,
    completed_at, created_at, lease_token_hash
  ) values (
    target_account_id, 'student_password_recovery', target_epoch, p_password_jwe,
    pg_catalog.clock_timestamp() + interval '15 minutes', null,
    pg_catalog.clock_timestamp(), null
  ) on conflict (account_id, operation_kind) do update set
    credential_epoch = excluded.credential_epoch,
    password_jwe = excluded.password_jwe,
    expires_at = excluded.expires_at,
    completed_at = null,
    created_at = excluded.created_at,
    lease_token_hash = null;

  if reconciling then
    insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
    values (actor_account_id, target_account_id, 'account.credential_sync_reconciled', 'stale_provider_claim');
  end if;
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, target_account_id, 'account.recovery_started', 'staff_recovery');
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
  target_epoch bigint;
  current_operation app_private.credential_sync_operations%rowtype;
  reconciling boolean := false;
begin
  if not app_private.fictional_account_lifecycle_enabled() then
    raise exception using errcode = '42501', message = 'fictional account lifecycle is disabled';
  end if;
  if not app_private.has_permission('accounts.mfa_reset') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  actor_account_id := app_private.current_account_id();

  select account.id, account.credential_epoch into target_account_id, target_epoch
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

  select operation.* into current_operation
  from app_private.credential_sync_operations as operation
  where operation.account_id = target_account_id
    and operation.operation_kind = 'staff_mfa_reset'
  for update;
  if found then
    if current_operation.lease_token_hash is not null then
      if not app_private.credential_sync_lease_is_stale(current_operation.leased_at) then
        return true;
      end if;
      reconciling := true;
    elsif current_operation.credential_epoch = target_epoch
      and current_operation.expires_at > pg_catalog.clock_timestamp()
      and current_operation.completed_at is null
      and (select account.force_password_change and account.credential_update_pending
           from app_private.accounts as account where account.id = target_account_id) then
      return true;
    end if;
  end if;

  update app_private.accounts as account
  set force_password_change = true,
      credential_update_pending = true,
      credential_epoch = account.credential_epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = target_account_id
  returning account.credential_epoch into target_epoch;
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'recovery',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = target_account_id and session.revoked_at is null;

  insert into app_private.credential_sync_operations (
    account_id, operation_kind, credential_epoch, password_jwe, expires_at,
    completed_at, created_at, lease_token_hash
  ) values (
    target_account_id, 'staff_mfa_reset', target_epoch, null,
    pg_catalog.clock_timestamp() + interval '15 minutes', null,
    pg_catalog.clock_timestamp(), null
  ) on conflict (account_id, operation_kind) do update set
    credential_epoch = excluded.credential_epoch,
    password_jwe = null,
    expires_at = excluded.expires_at,
    completed_at = null,
    created_at = excluded.created_at,
    lease_token_hash = null;

  if reconciling then
    insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
    values (actor_account_id, target_account_id, 'account.credential_sync_reconciled', 'stale_provider_claim');
  end if;
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, target_account_id, 'staff.mfa_reset', 'administrator_recovery');
  return true;
end
$$;

-- Operator-only: create the first administrator mapping for an Auth user that
-- the database owner created in the Supabase dashboard. Refuses once any
-- active administrator exists. The administrator must change the password and
-- enroll TOTP before any privileged action (AAL2 is enforced elsewhere).
create function app_private.operator_bootstrap_initial_admin(
  p_provider_user_id uuid,
  p_username text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_email text;
  username text := pg_catalog.lower(pg_catalog.btrim(p_username));
  new_account_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('academic_arena.admin_bootstrap'));
  if exists (
    select 1 from app_private.account_role_grants as role_grant
    join app_private.accounts as account on account.id = role_grant.account_id
    where role_grant.role_name = 'admin' and account.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'an active administrator already exists';
  end if;
  select pg_catalog.lower(auth_user.email) into provider_email
  from auth.users as auth_user
  where auth_user.id = p_provider_user_id
    and auth_user.deleted_at is null
    and auth_user.is_anonymous is not true
    and auth_user.is_sso_user is not true
    and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.now())
    and auth_user.email is not null;
  if provider_email is null then
    raise exception using errcode = '22023', message = 'provider user is not eligible';
  end if;
  if exists (select 1 from app_private.accounts as account where account.provider_user_id = p_provider_user_id) then
    raise exception using errcode = '22023', message = 'provider user is already mapped';
  end if;
  -- A factor enrolled before bootstrap could belong to whoever saw the
  -- temporary password; the administrator must enroll their own afterwards.
  if exists (select 1 from auth.mfa_factors as factor where factor.user_id = p_provider_user_id) then
    raise exception using errcode = '22023', message = 'provider user already has MFA factors';
  end if;
  delete from auth.sessions as provider_session where provider_session.user_id = p_provider_user_id;

  insert into app_private.accounts (provider_user_id, status, force_password_change)
  values (p_provider_user_id, 'active', true)
  returning id into new_account_id;
  insert into app_private.identity_mappings (account_id, username_normalized, provider_email)
  values (new_account_id, username, provider_email);
  insert into app_private.account_role_grants (account_id, role_name)
  values (new_account_id, 'admin');
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (new_account_id, 'staff.admin_bootstrapped', 'operator_bootstrap');
  return true;
end
$$;

-- Operator-only break-glass for a staff member (including the sole
-- administrator) who lost their TOTP factor. Removes provider factors and
-- provider sessions/refresh tokens, revokes BFF sessions, cancels any pending
-- provider sync, invalidates the old password, and forces a password change.
create function app_private.operator_recover_staff_mfa(p_username text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account_id uuid;
  target_provider_user_id uuid;
begin
  select account.id, account.provider_user_id into target_account_id, target_provider_user_id
  from app_private.identity_mappings as mapping
  join app_private.accounts as account on account.id = mapping.account_id
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
    and account.status = 'active'
    and exists (
      select 1 from app_private.account_role_grants as role_grant
      where role_grant.account_id = account.id
        and role_grant.role_name in ('moderator', 'publisher', 'admin')
    )
  for update of account;
  if target_account_id is null then
    raise exception using errcode = '22023', message = 'active staff account not found';
  end if;

  update app_private.accounts as account
  set force_password_change = true,
      credential_update_pending = false,
      credential_epoch = account.credential_epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = target_account_id;
  delete from app_private.credential_sync_operations as operation
  where operation.account_id = target_account_id;
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'admin_revoke',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = target_account_id and session.revoked_at is null;
  delete from auth.mfa_factors as factor where factor.user_id = target_provider_user_id;
  delete from auth.sessions as provider_session where provider_session.user_id = target_provider_user_id;
  -- The old password may be compromised with the lost device: replace it with
  -- an unknown random bcrypt hash. The operator then sets a temporary password.
  update auth.users as auth_user
  set encrypted_password = extensions.crypt(
        pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
      updated_at = pg_catalog.now()
  where auth_user.id = target_provider_user_id;

  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (target_account_id, 'staff.mfa_operator_recovery', 'operator_break_glass');
  return true;
end
$$;

revoke all on function app_private.operator_bootstrap_initial_admin(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app_private.operator_recover_staff_mfa(text) from public, anon, authenticated, service_role;
