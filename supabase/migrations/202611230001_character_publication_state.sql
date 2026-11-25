-- Release A: tell a signed-in student, truthfully, whether their own saved
-- character is public. The answer is computed on the server from the same
-- public projection anonymous visitors read, so the studio can never claim
-- "public" for a character the board does not actually show.
--
-- States (no rank, level, username or link data is returned):
--   not_saved      no character saved yet
--   saved_private  saved; public characters are switched off for everyone
--   display_off    saved; the student has not switched public display on
--   awaiting_link  saved and opted in, but the current publication shows
--                  nothing for them (no verified link to a top-10 row, or no
--                  current publication)
--   public         the current public board shows this student's character
create function public.my_character_publication_state()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_account_id uuid;
  config record;
begin
  if not app_private.has_permission('avatar.write') then
    raise exception using errcode = '42501', message = 'active student account required';
  end if;
  owner_account_id := app_private.current_account_id();
  if owner_account_id is null
    or not exists (
      select 1 from app_private.account_role_grants as role_grant
      where role_grant.account_id = owner_account_id and role_grant.role_name = 'student'
    ) then
    raise exception using errcode = '42501', message = 'active student account required';
  end if;

  select avatar.show_on_leaderboard into config
  from public.student_avatar_configs as avatar
  where avatar.account_id = owner_account_id;
  if not found then
    return 'not_saved';
  end if;
  if not app_private.student_feature('avatar_personalization') then
    return 'saved_private';
  end if;
  if not config.show_on_leaderboard then
    return 'display_off';
  end if;
  -- "public" only when the anonymous projection itself returns this student's
  -- character for their verified row in the current publication.
  if exists (
    select 1
    from app_private.published_level_row_links as link
    join public.published_leaderboard_snapshots as snapshot
      on snapshot.id = link.snapshot_id and snapshot.is_current and snapshot.revoked_at is null
    where link.account_id = owner_account_id
      and exists (
        select 1 from public.public_level_leaderboard_v3(link.level) as board
        where board.position = link.position and board.avatar_key is not null
      )
  ) then
    return 'public';
  end if;
  return 'awaiting_link';
end
$$;
revoke all on function public.my_character_publication_state() from public, anon, service_role;
grant execute on function public.my_character_publication_state() to authenticated;
