-- Staff lifecycle RPCs remain disabled on hosted projects until a separate
-- reviewed integration step explicitly enables them. Only local seed data
-- turns this gate on for fictional end-to-end tests.
create table app_private.runtime_controls (
  singleton boolean primary key default true check (singleton),
  allow_fictional_account_lifecycle boolean not null default false
);
insert into app_private.runtime_controls (singleton, allow_fictional_account_lifecycle)
values (true, false);
alter table app_private.runtime_controls enable row level security;
alter table app_private.runtime_controls force row level security;
revoke all on table app_private.runtime_controls from public, anon, authenticated, service_role;

create or replace function app_private.fictional_account_lifecycle_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select control.allow_fictional_account_lifecycle
    from app_private.runtime_controls as control
    where control.singleton
  ), false)
$$;
revoke all on function app_private.fictional_account_lifecycle_enabled() from public, anon, authenticated, service_role;

alter table app_private.accounts
  add column credential_epoch bigint not null default 0 check (credential_epoch >= 0);

-- Mandatory password setup also gates student-owned data and staff permissions.
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
    and account.force_password_change = false
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
    where account.provider_user_id = (select auth.uid())
      and account.status = 'active'
      and account.force_password_change = false
  )
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
      and account.force_password_change = false
      and permission.permission_key = p_permission_key
      and (
        role_grant.role_name = 'student'
        or coalesce((nullif(pg_catalog.current_setting('request.jwt.claims', true), ''))::jsonb ->> 'aal', '') = 'aal2'
      )
  )
$$;

create or replace function public.complete_password_change(
  p_account_id uuid,
  p_expected_credential_epoch bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
begin
  select account.id into actor_account_id
  from app_private.accounts as account
  where account.id = p_account_id and account.status = 'active'
    and account.credential_epoch = p_expected_credential_epoch
  for update;
  if actor_account_id is null then
    return false;
  end if;

  update app_private.accounts as account
  set force_password_change = false,
      credential_epoch = account.credential_epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = actor_account_id and account.status = 'active'
    and account.credential_epoch = p_expected_credential_epoch;
  if not found then
    return false;
  end if;

  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'password_change',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = actor_account_id and session.revoked_at is null;

  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, actor_account_id, 'account.password_changed', 'self_service');
  return true;
end
$$;

create or replace function public.resolve_account_identity(p_account_id uuid)
returns table (
  account_id uuid,
  provider_user_id uuid,
  provider_email text,
  username_normalized text,
  account_status text,
  credential_epoch bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select account.id, account.provider_user_id, mapping.provider_email,
         mapping.username_normalized, account.status, account.credential_epoch
  from app_private.accounts as account
  join app_private.identity_mappings as mapping on mapping.account_id = account.id
  where account.id = p_account_id
$$;

create or replace function public.provision_student_account(
  p_provider_user_id uuid,
  p_username text,
  p_provider_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  normalized_username text;
  normalized_email text;
  confirmed_provider_email text;
  new_account_id uuid;
begin
  if not app_private.fictional_account_lifecycle_enabled() then
    raise exception using errcode = '42501', message = 'fictional account lifecycle is disabled';
  end if;
  if not app_private.has_permission('accounts.provision') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  actor_account_id := app_private.current_account_id();
  normalized_username := pg_catalog.lower(pg_catalog.btrim(p_username));
  normalized_email := pg_catalog.lower(pg_catalog.btrim(p_provider_email));
  if normalized_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$'
    or pg_catalog.length(normalized_email) not between 3 and 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'invalid provisioned account';
  end if;

  select pg_catalog.lower(auth_user.email) into confirmed_provider_email
  from auth.users as auth_user
  where auth_user.id = p_provider_user_id and auth_user.email_confirmed_at is not null;
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
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, new_account_id, 'account.provisioned', 'staff_provisioned');
  return true;
end
$$;

create or replace function public.force_password_change_for_account(p_username text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  target_account_id uuid;
begin
  if not app_private.fictional_account_lifecycle_enabled() then
    raise exception using errcode = '42501', message = 'fictional account lifecycle is disabled';
  end if;
  if not app_private.has_permission('accounts.recover') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  actor_account_id := app_private.current_account_id();

  select account.id into target_account_id
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

  update app_private.accounts as account
  set force_password_change = true,
      credential_epoch = account.credential_epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = target_account_id;
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'recovery',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = target_account_id and session.revoked_at is null;
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, target_account_id, 'account.recovery_started', 'staff_recovery');
  return true;
end
$$;

create or replace function public.suspend_student_account(p_username text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  target_account_id uuid;
begin
  if not app_private.fictional_account_lifecycle_enabled() then
    raise exception using errcode = '42501', message = 'fictional account lifecycle is disabled';
  end if;
  if not app_private.has_permission('accounts.suspend') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  actor_account_id := app_private.current_account_id();

  select account.id into target_account_id
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

  update app_private.accounts as account
  set status = 'suspended',
      credential_epoch = account.credential_epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  where account.id = target_account_id;
  update app_private.bff_sessions as session
  set revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'suspension',
      provider_access_token_jwe = null,
      provider_refresh_token_jwe = null,
      csrf_token_jwe = null
  where session.account_id = target_account_id and session.revoked_at is null;
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, target_account_id, 'account.suspended', 'staff_suspension');
  return true;
end
$$;

revoke all on function public.complete_password_change(uuid, bigint) from public, anon, authenticated;
revoke all on function public.resolve_account_identity(uuid) from public, anon, authenticated;
revoke all on function public.provision_student_account(uuid, text, text) from public, anon, service_role;
revoke all on function public.force_password_change_for_account(text) from public, anon, service_role;
revoke all on function public.suspend_student_account(text) from public, anon, service_role;
grant execute on function public.complete_password_change(uuid, bigint) to service_role;
grant execute on function public.resolve_account_identity(uuid) to service_role;
grant execute on function public.provision_student_account(uuid, text, text) to authenticated;
grant execute on function public.force_password_change_for_account(text) to authenticated;
grant execute on function public.suspend_student_account(text) to authenticated;
