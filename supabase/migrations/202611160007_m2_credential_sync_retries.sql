-- Persist encrypted provider-sync intent so staff can safely retry transient failures.
-- The provider operation is idempotent for a single credential epoch: password
-- recovery reuses the same encrypted temporary password, while MFA reset repeats
-- factor deletion until no factors remain.

drop function if exists public.provision_account(uuid, text, text);
drop function if exists public.force_password_change_for_account(text);

create table app_private.credential_sync_operations (
  account_id uuid not null references app_private.accounts(id) on delete cascade,
  operation_kind text not null check (operation_kind in ('student_password_recovery', 'staff_mfa_reset')),
  credential_epoch bigint not null check (credential_epoch > 0),
  password_jwe text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (account_id, operation_kind),
  check (
    (operation_kind = 'student_password_recovery' and (
      (password_jwe is not null and pg_catalog.length(password_jwe) between 64 and 4096 and completed_at is null)
      or (password_jwe is null and completed_at is not null)
    ))
    or (operation_kind = 'staff_mfa_reset' and password_jwe is null)
  ),
  check (expires_at > created_at),
  check (completed_at is null or completed_at >= created_at)
);
alter table app_private.credential_sync_operations enable row level security;
alter table app_private.credential_sync_operations force row level security;
revoke all on app_private.credential_sync_operations from public, anon, authenticated, service_role;
create index credential_sync_operations_expiry_idx
  on app_private.credential_sync_operations (expires_at)
  where password_jwe is not null;

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
  where operation.expires_at <= pg_catalog.clock_timestamp();
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
begin
  if not app_private.fictional_account_lifecycle_enabled() then
    raise exception using errcode = '42501', message = 'fictional account lifecycle is disabled';
  end if;
  if pg_catalog.length(p_password_jwe) not between 64 and 4096 then
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

  if exists (
    select 1 from app_private.credential_sync_operations as operation
    where operation.account_id = target_account_id
      and operation.operation_kind = 'student_password_recovery'
      and operation.credential_epoch = target_epoch
      and operation.expires_at > pg_catalog.clock_timestamp()
      and operation.password_jwe is not null
      and (select account.force_password_change from app_private.accounts as account where account.id = target_account_id)
  ) then
    return true;
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
    account_id, operation_kind, credential_epoch, password_jwe, expires_at, completed_at, created_at
  ) values (
    target_account_id, 'student_password_recovery', target_epoch, p_password_jwe,
    pg_catalog.clock_timestamp() + interval '15 minutes', null, pg_catalog.clock_timestamp()
  ) on conflict (account_id, operation_kind) do update set
    credential_epoch = excluded.credential_epoch,
    password_jwe = excluded.password_jwe,
    expires_at = excluded.expires_at,
    completed_at = null,
    created_at = excluded.created_at;

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

  if exists (
    select 1 from app_private.credential_sync_operations as operation
    where operation.account_id = target_account_id
      and operation.operation_kind = 'staff_mfa_reset'
      and operation.credential_epoch = target_epoch
      and operation.expires_at > pg_catalog.clock_timestamp()
      and (select account.force_password_change from app_private.accounts as account where account.id = target_account_id)
  ) then
    return true;
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
    account_id, operation_kind, credential_epoch, password_jwe, expires_at, completed_at, created_at
  ) values (
    target_account_id, 'staff_mfa_reset', target_epoch, null,
    pg_catalog.clock_timestamp() + interval '15 minutes', null, pg_catalog.clock_timestamp()
  ) on conflict (account_id, operation_kind) do update set
    credential_epoch = excluded.credential_epoch,
    password_jwe = null,
    expires_at = excluded.expires_at,
    completed_at = null,
    created_at = excluded.created_at;

  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, target_account_id, 'staff.mfa_reset', 'administrator_recovery');
  return true;
end
$$;

create or replace function public.resolve_credential_sync_operation(
  p_account_id uuid,
  p_operation_kind text
)
returns table (
  account_id uuid,
  provider_user_id uuid,
  credential_epoch bigint,
  password_jwe text,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select account.id, account.provider_user_id, operation.credential_epoch,
    operation.password_jwe, operation.completed_at
  from app_private.credential_sync_operations as operation
  join app_private.accounts as account on account.id = operation.account_id
  where operation.account_id = p_account_id
    and operation.operation_kind = p_operation_kind
    and p_operation_kind in ('student_password_recovery', 'staff_mfa_reset')
    and operation.credential_epoch = account.credential_epoch
    and operation.expires_at > pg_catalog.clock_timestamp()
    and account.status = 'active'
    and account.force_password_change = true
    and (operation.operation_kind <> 'student_password_recovery' or operation.password_jwe is not null)
$$;

create or replace function public.complete_student_password_recovery(
  p_account_id uuid,
  p_expected_credential_epoch bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  update_pending boolean;
begin
  select account.credential_update_pending into update_pending
  from app_private.accounts as account
  join app_private.credential_sync_operations as operation on operation.account_id = account.id
  where account.id = p_account_id and account.status = 'active'
    and account.force_password_change = true
    and account.credential_epoch = p_expected_credential_epoch
    and operation.operation_kind = 'student_password_recovery'
    and operation.credential_epoch = p_expected_credential_epoch
  for update of account;
  if not found then
    return false;
  end if;
  if not update_pending then
    return exists (
      select 1 from app_private.credential_sync_operations as operation
      where operation.account_id = p_account_id
        and operation.operation_kind = 'student_password_recovery'
        and operation.credential_epoch = p_expected_credential_epoch
        and operation.completed_at is not null
    );
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
      completed_at = pg_catalog.clock_timestamp()
  where operation.account_id = p_account_id
    and operation.operation_kind = 'student_password_recovery'
    and operation.credential_epoch = p_expected_credential_epoch
    and operation.completed_at is null;
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (p_account_id, 'account.recovery_completed', 'provider_password_reset');
  return true;
end
$$;

create or replace function public.complete_staff_mfa_reset(
  p_account_id uuid,
  p_expected_credential_epoch bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  update_pending boolean;
begin
  select account.credential_update_pending into update_pending
  from app_private.accounts as account
  join app_private.credential_sync_operations as operation on operation.account_id = account.id
  where account.id = p_account_id and account.status = 'active'
    and account.force_password_change = true
    and account.credential_epoch = p_expected_credential_epoch
    and operation.operation_kind = 'staff_mfa_reset'
    and operation.credential_epoch = p_expected_credential_epoch
  for update of account;
  if not found then
    return false;
  end if;
  if not update_pending then
    return exists (
      select 1 from app_private.credential_sync_operations as operation
      where operation.account_id = p_account_id
        and operation.operation_kind = 'staff_mfa_reset'
        and operation.credential_epoch = p_expected_credential_epoch
        and operation.completed_at is not null
    );
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
  set completed_at = pg_catalog.clock_timestamp()
  where operation.account_id = p_account_id
    and operation.operation_kind = 'staff_mfa_reset'
    and operation.credential_epoch = p_expected_credential_epoch
    and operation.completed_at is null;
  insert into app_private.audit_events (target_account_id, action_key, reason_code)
  values (p_account_id, 'staff.mfa_reset_completed', 'provider_factor_removal');
  return true;
end
$$;

revoke all on function public.force_password_change_for_account(text, text) from public, anon, service_role;
grant execute on function public.force_password_change_for_account(text, text) to authenticated;
revoke all on function public.reset_staff_mfa_for_account(text) from public, anon, service_role;
grant execute on function public.reset_staff_mfa_for_account(text) to authenticated;
revoke all on function public.resolve_credential_sync_operation(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_credential_sync_operation(uuid, text) to service_role;
revoke all on function public.prune_expired_credential_sync_operations() from public, anon, authenticated;
grant execute on function public.prune_expired_credential_sync_operations() to service_role;
revoke all on function public.complete_student_password_recovery(uuid, bigint) from public, anon, authenticated;
grant execute on function public.complete_student_password_recovery(uuid, bigint) to service_role;
revoke all on function public.complete_staff_mfa_reset(uuid, bigint) from public, anon, authenticated;
grant execute on function public.complete_staff_mfa_reset(uuid, bigint) to service_role;
