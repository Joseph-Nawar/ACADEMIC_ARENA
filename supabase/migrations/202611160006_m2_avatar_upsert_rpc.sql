-- Keep avatar writes atomic without allowing a client to supply the owner key.
revoke insert, update, delete on table public.student_avatar_configs from anon, authenticated;

create or replace function public.save_own_avatar_config(
  p_character_key text,
  p_family text,
  p_tone text,
  p_badge text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_account_id uuid;
begin
  owner_account_id := app_private.current_account_id();
  if owner_account_id is null
    or not exists (
      select 1 from app_private.account_role_grants as role_grant
      where role_grant.account_id = owner_account_id and role_grant.role_name = 'student'
    ) then
    raise exception using errcode = '42501', message = 'active student account required';
  end if;

  if p_character_key not in ('omar', 'mariam', 'youssef', 'amara', 'tariq', 'habiba2', 'malek', 'nour2', 'zein')
    or p_family not in ('ink', 'cartoon3d')
    or p_tone not in ('mint', 'coral', 'gold', 'paper', 'blue', 'lilac')
    or p_badge not in ('✦', '⚡', '♥', '★', '') then
    raise exception using errcode = '22023', message = 'invalid avatar configuration';
  end if;

  insert into public.student_avatar_configs (account_id, character_key, family, tone, badge)
  values (owner_account_id, p_character_key, p_family, p_tone, p_badge)
  on conflict (account_id) do update
  set character_key = excluded.character_key,
      family = excluded.family,
      tone = excluded.tone,
      badge = excluded.badge,
      updated_at = pg_catalog.clock_timestamp();

  return true;
end
$$;

revoke all on function public.save_own_avatar_config(text, text, text, text) from public, anon, service_role;
grant execute on function public.save_own_avatar_config(text, text, text, text) to authenticated;
