-- M2 review fixes. Application state only: nothing here writes to the
-- provider-managed auth schema. Provider changes are made through the Supabase
-- Auth Admin API (BFF routes or the operator runbook).
--
-- 1. Held provider claims never expire automatically. Supabase Auth does not
--    enforce our fencing token, so elapsed time is not evidence that an older
--    password update can no longer land. Only an explicit operator release
--    (database owner) clears a held claim, and it destroys the never-revealed
--    temporary password so a delayed write can only set an unknown password.
-- 2. Encrypted temporary passwords are scrubbed as soon as their operation
--    expires, by a pg_cron job (included in Supabase Free) and on each login.
-- 3. Operator-only first-admin bootstrap and staff MFA break-glass lock/finish.
--    No API role can execute these.

alter table app_private.credential_sync_operations add column leased_at timestamptz;
update app_private.credential_sync_operations
set leased_at = pg_catalog.clock_timestamp()
where lease_token_hash is not null;
alter table app_private.credential_sync_operations
  add constraint credential_sync_operations_lease_time_check
  check ((lease_token_hash is null) = (leased_at is null));

-- Allow an uncompleted student recovery row whose expired payload was erased.
-- Such a row can never be claimed (claims require a payload) and only an
-- operator release removes it.
alter table app_private.credential_sync_operations drop constraint credential_sync_operations_check;
alter table app_private.credential_sync_operations
  add constraint credential_sync_operations_payload_check check (
    (operation_kind = 'student_password_recovery' and (
      password_jwe is null
      or (pg_catalog.length(password_jwe) between 64 and 4096 and completed_at is null)
    ))
    or (operation_kind = 'staff_mfa_reset' and password_jwe is null)
  );

-- Records when a claim was taken, for operator diagnosis only. Only
-- security-definer functions write this table; no API role has grants.
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

-- Expired operations can no longer be claimed, so their encrypted payload is
-- never needed again. Unclaimed expired rows are deleted; held expired rows are
-- kept (they still block a new generation) but their payload is erased.
create or replace function public.prune_expired_credential_sync_operations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
  scrubbed_count integer;
begin
  with doomed as (
    select operation.account_id, operation.operation_kind
    from app_private.credential_sync_operations as operation
    where operation.expires_at <= pg_catalog.clock_timestamp()
      and operation.lease_token_hash is null
    order by operation.expires_at
    limit 500
    for update skip locked
  )
  delete from app_private.credential_sync_operations as operation
  using doomed
  where operation.account_id = doomed.account_id
    and operation.operation_kind = doomed.operation_kind;
  get diagnostics deleted_count = row_count;

  with held as (
    select operation.account_id, operation.operation_kind
    from app_private.credential_sync_operations as operation
    where operation.expires_at <= pg_catalog.clock_timestamp()
      and operation.password_jwe is not null
    order by operation.expires_at
    limit 500
    for update skip locked
  )
  update app_private.credential_sync_operations as operation
  set password_jwe = null
  from held
  where operation.account_id = held.account_id
    and operation.operation_kind = held.operation_kind;
  get diagnostics scrubbed_count = row_count;
  return deleted_count + scrubbed_count;
end
$$;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'academic-arena-prune-credential-sync',
  '* * * * *',
  'select public.prune_expired_credential_sync_operations()'
);

-- Operator-only: clear a held provider claim after following the runbook.
-- The account stays blocked (forced change + pending) until staff start a new
-- recovery or MFA reset, which then begins a new credential generation.
create function app_private.operator_release_stuck_credential_sync(
  p_username text,
  p_operation_kind text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account_id uuid;
begin
  if p_operation_kind is null or p_operation_kind not in ('student_password_recovery', 'staff_mfa_reset') then
    raise exception using errcode = '22023', message = 'unknown operation kind';
  end if;
  select operation.account_id into target_account_id
  from app_private.credential_sync_operations as operation
  join app_private.identity_mappings as mapping on mapping.account_id = operation.account_id
  join app_private.accounts as account on account.id = operation.account_id
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
    and operation.operation_kind = p_operation_kind
    and operation.lease_token_hash is not null
    and operation.completed_at is null
  for update of operation, account;
  if target_account_id is null then
    raise exception using errcode = '22023', message = 'no held provider claim for this account';
  end if;

  -- Deleting the row destroys the encrypted temporary password and the lease.
  -- The original holder can no longer release or finalize anything.
  delete from app_private.credential_sync_operations as operation
  where operation.account_id = target_account_id
    and operation.operation_kind = p_operation_kind;
  update app_private.accounts as account
  set force_password_change = true,
      credential_update_pending = true,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = target_account_id;
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'admin_revoke',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = target_account_id and session.revoked_at is null;
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (target_account_id, 'account.credential_sync_operator_released', p_operation_kind);
  return true;
end
$$;

-- Operator-only: map the first administrator to an Auth user that the project
-- owner created through the dashboard or Auth Admin API. Reads auth.users and
-- auth.mfa_factors; never writes them.
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
-- administrator) who lost their TOTP factor. Step 1 locks the account in
-- application state; the operator then deletes factors and sets a fresh
-- password through the Auth Admin API; step 2 unblocks password change.
create function app_private.operator_lock_staff_for_mfa_recovery(p_username text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account_id uuid;
  target_epoch bigint;
begin
  select account.id into target_account_id
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
      credential_update_pending = true,
      credential_epoch = account.credential_epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = target_account_id
  returning account.credential_epoch into target_epoch;
  delete from app_private.credential_sync_operations as operation
  where operation.account_id = target_account_id;
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'admin_revoke',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = target_account_id and session.revoked_at is null;
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (target_account_id, 'staff.mfa_operator_recovery_started', 'operator_break_glass');
  return target_epoch;
end
$$;

create function app_private.operator_finish_staff_mfa_recovery(
  p_username text,
  p_expected_credential_epoch bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account_id uuid;
begin
  select account.id into target_account_id
  from app_private.identity_mappings as mapping
  join app_private.accounts as account on account.id = mapping.account_id
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username))
    and account.status = 'active'
    and account.force_password_change = true
    and account.credential_update_pending = true
    and account.credential_epoch = p_expected_credential_epoch
    and not exists (
      select 1 from app_private.credential_sync_operations as operation
      where operation.account_id = account.id
    )
  for update of account;
  if target_account_id is null then
    raise exception using errcode = '22023', message = 'no matching locked staff recovery';
  end if;

  -- The forced password change stays set: the staff member signs in with the
  -- fresh operator-issued password, must change it, then re-enrolls TOTP.
  update app_private.accounts as account
  set credential_update_pending = false,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = target_account_id;
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (target_account_id, 'staff.mfa_operator_recovery_completed', 'operator_break_glass');
  return true;
end
$$;

revoke all on function app_private.operator_release_stuck_credential_sync(text, text) from public, anon, authenticated, service_role;
revoke all on function app_private.operator_bootstrap_initial_admin(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app_private.operator_lock_staff_for_mfa_recovery(text) from public, anon, authenticated, service_role;
revoke all on function app_private.operator_finish_staff_mfa_recovery(text, bigint) from public, anon, authenticated, service_role;
