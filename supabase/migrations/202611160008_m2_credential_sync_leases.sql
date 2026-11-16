-- Fence provider-side credential changes so only one BFF request can mutate an
-- Auth identity for a recovery generation at a time. The five-minute lease is
-- longer than the BFF's bounded provider request timeout; retries wait for the
-- lease to expire after an uncertain upstream result.

alter table app_private.credential_sync_operations
  add column lease_token_hash bytea,
  add column lease_until timestamptz,
  add constraint credential_sync_operations_lease_pair_check check (
    (lease_token_hash is null and lease_until is null)
    or (lease_token_hash is not null and pg_catalog.octet_length(lease_token_hash) = 32 and lease_until is not null)
  );

create index credential_sync_operations_lease_until_idx
  on app_private.credential_sync_operations (lease_until)
  where lease_until is not null;

drop function public.resolve_credential_sync_operation(uuid, text);
drop function public.complete_student_password_recovery(uuid, bigint);
drop function public.complete_staff_mfa_reset(uuid, bigint);

create or replace function public.prune_expired_credential_sync_operations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from app_private.credential_sync_operations as operation
  where operation.expires_at <= pg_catalog.clock_timestamp()
    and (operation.lease_until is null or operation.lease_until <= pg_catalog.clock_timestamp());
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
    -- An upstream request may still be running even when its retry payload has
    -- expired. Never let a new generation race the outstanding provider call.
    if current_operation.lease_until > pg_catalog.clock_timestamp() then
      return true;
    end if;
    if current_operation.credential_epoch = target_epoch
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
    completed_at, created_at, lease_token_hash, lease_until
  ) values (
    target_account_id, 'student_password_recovery', target_epoch, p_password_jwe,
    pg_catalog.clock_timestamp() + interval '15 minutes', null,
    pg_catalog.clock_timestamp(), null, null
  ) on conflict (account_id, operation_kind) do update set
    credential_epoch = excluded.credential_epoch,
    password_jwe = excluded.password_jwe,
    expires_at = excluded.expires_at,
    completed_at = null,
    created_at = excluded.created_at,
    lease_token_hash = null,
    lease_until = null;

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
    if current_operation.lease_until > pg_catalog.clock_timestamp() then
      return true;
    end if;
    if current_operation.credential_epoch = target_epoch
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
    completed_at, created_at, lease_token_hash, lease_until
  ) values (
    target_account_id, 'staff_mfa_reset', target_epoch, null,
    pg_catalog.clock_timestamp() + interval '15 minutes', null,
    pg_catalog.clock_timestamp(), null, null
  ) on conflict (account_id, operation_kind) do update set
    credential_epoch = excluded.credential_epoch,
    password_jwe = null,
    expires_at = excluded.expires_at,
    completed_at = null,
    created_at = excluded.created_at,
    lease_token_hash = null,
    lease_until = null;

  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, target_account_id, 'staff.mfa_reset', 'administrator_recovery');
  return true;
end
$$;

create or replace function public.claim_credential_sync_operation(
  p_account_id uuid,
  p_operation_kind text,
  p_lease_token_hash text
)
returns table (
  account_id uuid,
  provider_user_id uuid,
  credential_epoch bigint,
  password_jwe text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_token_hash is null or p_lease_token_hash !~ '^[0-9a-f]{64}$'
    or p_operation_kind is null
    or p_operation_kind not in ('student_password_recovery', 'staff_mfa_reset') then
    return;
  end if;

  return query
  with claimed as (
    update app_private.credential_sync_operations as operation
    set lease_token_hash = pg_catalog.decode(p_lease_token_hash, 'hex'),
        lease_until = pg_catalog.clock_timestamp() + interval '5 minutes'
    from app_private.accounts as account
    where operation.account_id = p_account_id
      and operation.operation_kind = p_operation_kind
      and operation.account_id = account.id
      and operation.credential_epoch = account.credential_epoch
      and operation.expires_at > pg_catalog.clock_timestamp()
      and operation.completed_at is null
      and (operation.lease_until is null or operation.lease_until <= pg_catalog.clock_timestamp())
      and account.status = 'active'
      and account.force_password_change = true
      and account.credential_update_pending = true
      and (p_operation_kind <> 'student_password_recovery' or operation.password_jwe is not null)
    returning operation.account_id, operation.credential_epoch, operation.password_jwe
  )
  select claimed.account_id, account.provider_user_id, claimed.credential_epoch, claimed.password_jwe
  from claimed
  join app_private.accounts as account on account.id = claimed.account_id;
end
$$;

create or replace function public.complete_student_password_recovery(
  p_account_id uuid,
  p_expected_credential_epoch bigint,
  p_lease_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  update_pending boolean;
begin
  if p_lease_token_hash is null or p_lease_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  select account.credential_update_pending into update_pending
  from app_private.accounts as account
  join app_private.credential_sync_operations as operation on operation.account_id = account.id
  where account.id = p_account_id and account.status = 'active'
    and account.force_password_change = true
    and account.credential_epoch = p_expected_credential_epoch
    and operation.operation_kind = 'student_password_recovery'
    and operation.credential_epoch = p_expected_credential_epoch
    and operation.completed_at is null
    and operation.lease_token_hash = pg_catalog.decode(p_lease_token_hash, 'hex')
    and operation.lease_until > pg_catalog.clock_timestamp()
  for update of account, operation;
  if not found or not update_pending then
    return false;
  end if;

  update app_private.accounts as account
  set credential_update_pending = false,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = p_account_id and account.status = 'active'
    and account.force_password_change = true
    and account.credential_update_pending = true
    and account.credential_epoch = p_expected_credential_epoch;
  if not found then
    return false;
  end if;
  update app_private.credential_sync_operations as operation
  set password_jwe = null,
      completed_at = pg_catalog.clock_timestamp(),
      lease_token_hash = null,
      lease_until = null
  where operation.account_id = p_account_id
    and operation.operation_kind = 'student_password_recovery'
    and operation.credential_epoch = p_expected_credential_epoch
    and operation.lease_token_hash = pg_catalog.decode(p_lease_token_hash, 'hex');
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (p_account_id, 'account.recovery_completed', 'provider_password_reset');
  return true;
end
$$;

create or replace function public.complete_staff_mfa_reset(
  p_account_id uuid,
  p_expected_credential_epoch bigint,
  p_lease_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  update_pending boolean;
begin
  if p_lease_token_hash is null or p_lease_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  select account.credential_update_pending into update_pending
  from app_private.accounts as account
  join app_private.credential_sync_operations as operation on operation.account_id = account.id
  where account.id = p_account_id and account.status = 'active'
    and account.force_password_change = true
    and account.credential_epoch = p_expected_credential_epoch
    and operation.operation_kind = 'staff_mfa_reset'
    and operation.credential_epoch = p_expected_credential_epoch
    and operation.completed_at is null
    and operation.lease_token_hash = pg_catalog.decode(p_lease_token_hash, 'hex')
    and operation.lease_until > pg_catalog.clock_timestamp()
  for update of account, operation;
  if not found or not update_pending then
    return false;
  end if;

  update app_private.accounts as account
  set credential_update_pending = false,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = p_account_id and account.status = 'active'
    and account.force_password_change = true
    and account.credential_update_pending = true
    and account.credential_epoch = p_expected_credential_epoch;
  if not found then
    return false;
  end if;
  update app_private.credential_sync_operations as operation
  set completed_at = pg_catalog.clock_timestamp(),
      lease_token_hash = null,
      lease_until = null
  where operation.account_id = p_account_id
    and operation.operation_kind = 'staff_mfa_reset'
    and operation.credential_epoch = p_expected_credential_epoch
    and operation.lease_token_hash = pg_catalog.decode(p_lease_token_hash, 'hex');
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (p_account_id, 'staff.mfa_reset_completed', 'provider_factor_removal');
  return true;
end
$$;

revoke all on function public.force_password_change_for_account(text, text) from public, anon, service_role;
grant execute on function public.force_password_change_for_account(text, text) to authenticated;
revoke all on function public.reset_staff_mfa_for_account(text) from public, anon, service_role;
grant execute on function public.reset_staff_mfa_for_account(text) to authenticated;
revoke all on function public.claim_credential_sync_operation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_credential_sync_operation(uuid, text, text) to service_role;
revoke all on function public.prune_expired_credential_sync_operations() from public, anon, authenticated;
grant execute on function public.prune_expired_credential_sync_operations() to service_role;
revoke all on function public.complete_student_password_recovery(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.complete_student_password_recovery(uuid, bigint, text) to service_role;
revoke all on function public.complete_staff_mfa_reset(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.complete_staff_mfa_reset(uuid, bigint, text) to service_role;
