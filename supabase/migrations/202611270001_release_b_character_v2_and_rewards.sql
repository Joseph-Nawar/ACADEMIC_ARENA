-- Release B2: Character Studio V2 persistence, server-authoritative cosmetic
-- ownership, verified rank rewards, and a consent-aware Campus Wins projection
-- (issue #25). Additive only: no existing row is converted or reset, and every
-- new switch defaults to off.
--
-- * student_avatar_configs gains a V2 config next to the classic one. Existing
--   rows keep active_look = 'classic' and their public-display choice. A
--   student switches to V2 only by saving one.
-- * The V2 allowlist (fields, values, collections, rank rules) is generated
--   from assets/avatar-v2/catalog.js; a contract test keeps them identical.
-- * Ownership is checked inside the database (save RPC and a table trigger),
--   so no direct RPC or table write can equip an item the account does not own.
-- * Rewards: a stable earning period (period_key), never a publication id.
--   One entitlement per (account, collection, period); retries, republishing
--   and rollback cannot duplicate it. Revocation is explicit, audited and
--   falls back to free items for anything equipped.
-- * Campus Wins: the public feed stops using the snapshot stored at approval.
--   It shows the author's latest saved character only with a separate
--   Campus Wins consent; otherwise a neutral figure.

-- ---------------------------------------------------------------------------
-- Rollout switches (owner-only), all off.
alter table app_private.student_feature_controls
  add column character_studio_v2 boolean not null default false,
  add column cosmetic_rewards boolean not null default false;

create or replace function app_private.student_feature(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p_feature
      when 'student_sign_in' then control.student_sign_in
      when 'student_provisioning' then control.student_provisioning
      when 'avatar_personalization' then control.avatar_personalization
      when 'welcome_dialog' then control.welcome_dialog
      when 'character_studio_v2' then control.character_studio_v2
      when 'cosmetic_rewards' then control.cosmetic_rewards
      else false
    end
    from app_private.student_feature_controls as control
    where control.singleton
  ), false)
$$;
revoke all on function app_private.student_feature(text) from public, anon, authenticated, service_role;

create or replace function app_private.operator_set_student_feature(p_feature text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_feature not in ('student_sign_in', 'student_provisioning', 'avatar_personalization', 'welcome_dialog',
                       'character_studio_v2', 'cosmetic_rewards')
    or p_enabled is null then
    raise exception using errcode = '22023', message = 'unknown student feature';
  end if;
  update app_private.student_feature_controls as control
  set student_sign_in = case when p_feature = 'student_sign_in' then p_enabled else control.student_sign_in end,
      student_provisioning = case when p_feature = 'student_provisioning' then p_enabled else control.student_provisioning end,
      avatar_personalization = case when p_feature = 'avatar_personalization' then p_enabled else control.avatar_personalization end,
      welcome_dialog = case when p_feature = 'welcome_dialog' then p_enabled else control.welcome_dialog end,
      character_studio_v2 = case when p_feature = 'character_studio_v2' then p_enabled else control.character_studio_v2 end,
      cosmetic_rewards = case when p_feature = 'cosmetic_rewards' then p_enabled else control.cosmetic_rewards end,
      updated_at = pg_catalog.clock_timestamp()
  where control.singleton;
  if p_feature = 'student_sign_in' and not p_enabled then
    update app_private.bff_sessions as bff_session
    set revoked_at = pg_catalog.clock_timestamp(), revoke_reason = 'admin_revoke',
        provider_access_token_jwe = null, provider_refresh_token_jwe = null, csrf_token_jwe = null
    where bff_session.revoked_at is null
      and not exists (
        select 1 from app_private.account_role_grants as role_grant
        where role_grant.account_id = bff_session.account_id and role_grant.role_name <> 'student'
      );
  end if;
  insert into app_private.audit_events (action_key, reason_code)
  values ('feature.' || p_feature || case when p_enabled then '.enabled' else '.disabled' end, 'operator');
  return p_enabled;
end
$$;
revoke all on function app_private.operator_set_student_feature(text, boolean) from public, anon, authenticated, service_role;

create function public.public_feature_state_v2()
returns table (student_sign_in boolean, avatar_personalization boolean, welcome_dialog boolean, character_studio_v2 boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select control.student_sign_in,
         control.avatar_personalization,
         control.welcome_dialog and control.student_sign_in,
         control.character_studio_v2
  from app_private.student_feature_controls as control
  where control.singleton
$$;
revoke all on function public.public_feature_state_v2() from public;
grant execute on function public.public_feature_state_v2() to anon, authenticated, service_role;

insert into app_private.role_permissions (role_name, permission_key) values ('admin', 'rewards.process');

-- ---------------------------------------------------------------------------
-- Trusted catalogue (generated). Private: browsers get it from catalog.js.
create table app_private.cosmetic_collections (
  collection_key text primary key check (collection_key ~ '^[a-z][a-z0-9_]{1,31}$'),
  free boolean not null,
  -- Whether the reward processor may grant it now. Inactive collections
  -- (Scholar, Seasonal) can't be earned until their policy is approved.
  earnable boolean not null,
  label text not null check (pg_catalog.length(label) between 1 and 48),
  sort_order smallint not null,
  check (not (free and earnable))
);
create table app_private.character_v2_fields (
  field text primary key check (field ~ '^[a-zA-Z]{1,24}$'),
  kind text not null check (kind in ('enum', 'item', 'set')),
  max_items smallint check ((kind = 'set') = (max_items is not null)),
  default_value jsonb not null,
  sort_order smallint not null unique
);
create table app_private.character_v2_values (
  field text not null references app_private.character_v2_fields(field),
  value text not null check (value ~ '^[a-z0-9]{1,24}$'),
  collection_key text not null references app_private.cosmetic_collections(collection_key),
  -- 'fitted' / 'crown' for headwear, 'big' for voluminous hair.
  trait text check (trait in ('fitted', 'crown', 'big')),
  primary key (field, value)
);
create table app_private.rank_reward_rules (
  max_position smallint not null check (max_position between 1 and 10),
  collection_key text primary key references app_private.cosmetic_collections(collection_key)
);
alter table app_private.cosmetic_collections enable row level security;
alter table app_private.cosmetic_collections force row level security;
alter table app_private.character_v2_fields enable row level security;
alter table app_private.character_v2_fields force row level security;
alter table app_private.character_v2_values enable row level security;
alter table app_private.character_v2_values force row level security;
alter table app_private.rank_reward_rules enable row level security;
alter table app_private.rank_reward_rules force row level security;
revoke all on table app_private.cosmetic_collections, app_private.character_v2_fields,
  app_private.character_v2_values, app_private.rank_reward_rules from public, anon, authenticated, service_role;

-- BEGIN GENERATED character-v2 catalogue (scripts/character-v2-sql.mjs)
insert into app_private.cosmetic_collections (collection_key, free, earnable, label, sort_order) values
  ('essentials', true, false, 'Campus Essentials', 1),
  ('elite', false, true, 'Elite Collection', 2),
  ('podium', false, true, 'Podium Collection', 3),
  ('champion', false, true, 'Champion Collection', 4),
  ('scholar', false, false, 'Scholar Collection', 5),
  ('seasonal', false, false, 'Seasonal Collection', 6);
insert into app_private.character_v2_fields (field, kind, max_items, default_value, sort_order) values
  ('skin', 'enum', null, '"s05"'::jsonb, 1),
  ('face', 'enum', null, '"oval"'::jsonb, 2),
  ('build', 'enum', null, '"regular"'::jsonb, 3),
  ('hair', 'enum', null, '"crop"'::jsonb, 4),
  ('hairColor', 'enum', null, '"h03"'::jsonb, 5),
  ('eyes', 'enum', null, '"almond"'::jsonb, 6),
  ('eyeColor', 'enum', null, '"e02"'::jsonb, 7),
  ('brows', 'enum', null, '"soft"'::jsonb, 8),
  ('nose', 'enum', null, '"button"'::jsonb, 9),
  ('mouth', 'enum', null, '"smile"'::jsonb, 10),
  ('facialHair', 'enum', null, '"none"'::jsonb, 11),
  ('blush', 'enum', null, '"none"'::jsonb, 12),
  ('liner', 'enum', null, '"none"'::jsonb, 13),
  ('lips', 'enum', null, '"none"'::jsonb, 14),
  ('details', 'set', 3, '[]'::jsonb, 15),
  ('headwear', 'item', null, '"none"'::jsonb, 16),
  ('headwearColor', 'enum', null, '"c11"'::jsonb, 17),
  ('glasses', 'item', null, '"none"'::jsonb, 18),
  ('glassesColor', 'enum', null, '"f01"'::jsonb, 19),
  ('hearing', 'item', null, '"none"'::jsonb, 20),
  ('mobility', 'item', null, '"none"'::jsonb, 21),
  ('earrings', 'item', null, '"none"'::jsonb, 22),
  ('top', 'item', null, '"hoodie"'::jsonb, 23),
  ('topColor', 'enum', null, '"c11"'::jsonb, 24),
  ('bottom', 'item', null, '"jeans"'::jsonb, 25),
  ('bottomColor', 'enum', null, '"c16"'::jsonb, 26),
  ('shoes', 'item', null, '"sneakers"'::jsonb, 27),
  ('shoesColor', 'enum', null, '"c03"'::jsonb, 28),
  ('neck', 'item', null, '"none"'::jsonb, 29),
  ('neckColor', 'enum', null, '"c05"'::jsonb, 30),
  ('back', 'item', null, '"none"'::jsonb, 31),
  ('backColor', 'enum', null, '"c05"'::jsonb, 32),
  ('backdrop', 'item', null, '"mint"'::jsonb, 33),
  ('sticker', 'item', null, '"spark"'::jsonb, 34);
insert into app_private.character_v2_values (field, value, collection_key, trait) values
  ('skin', 's01', 'essentials', null),
  ('skin', 's02', 'essentials', null),
  ('skin', 's03', 'essentials', null),
  ('skin', 's04', 'essentials', null),
  ('skin', 's05', 'essentials', null),
  ('skin', 's06', 'essentials', null),
  ('skin', 's07', 'essentials', null),
  ('skin', 's08', 'essentials', null),
  ('skin', 's09', 'essentials', null),
  ('skin', 's10', 'essentials', null),
  ('skin', 's11', 'essentials', null),
  ('skin', 's12', 'essentials', null),
  ('face', 'oval', 'essentials', null),
  ('face', 'round', 'essentials', null),
  ('face', 'square', 'essentials', null),
  ('face', 'heart', 'essentials', null),
  ('face', 'long', 'essentials', null),
  ('face', 'diamond', 'essentials', null),
  ('build', 'slim', 'essentials', null),
  ('build', 'regular', 'essentials', null),
  ('build', 'broad', 'essentials', null),
  ('build', 'soft', 'essentials', null),
  ('hair', 'bald', 'essentials', null),
  ('hair', 'buzz', 'essentials', null),
  ('hair', 'fade', 'essentials', null),
  ('hair', 'crop', 'essentials', null),
  ('hair', 'sidepart', 'essentials', null),
  ('hair', 'quiff', 'essentials', null),
  ('hair', 'curltop', 'essentials', null),
  ('hair', 'cornrows', 'essentials', null),
  ('hair', 'afro', 'essentials', 'big'),
  ('hair', 'puff', 'essentials', 'big'),
  ('hair', 'twopuffs', 'essentials', 'big'),
  ('hair', 'curlybob', 'essentials', 'big'),
  ('hair', 'curlylong', 'essentials', 'big'),
  ('hair', 'locs', 'essentials', null),
  ('hair', 'braids', 'essentials', null),
  ('hair', 'wavybob', 'essentials', null),
  ('hair', 'wavylong', 'essentials', null),
  ('hair', 'straightlong', 'essentials', null),
  ('hair', 'ponytail', 'essentials', null),
  ('hair', 'bun', 'essentials', 'big'),
  ('hair', 'pixie', 'essentials', null),
  ('hair', 'shag', 'essentials', null),
  ('hairColor', 'h01', 'essentials', null),
  ('hairColor', 'h02', 'essentials', null),
  ('hairColor', 'h03', 'essentials', null),
  ('hairColor', 'h04', 'essentials', null),
  ('hairColor', 'h05', 'essentials', null),
  ('hairColor', 'h06', 'essentials', null),
  ('hairColor', 'h07', 'essentials', null),
  ('hairColor', 'h08', 'essentials', null),
  ('hairColor', 'h09', 'essentials', null),
  ('hairColor', 'h10', 'essentials', null),
  ('hairColor', 'h11', 'essentials', null),
  ('hairColor', 'h12', 'essentials', null),
  ('hairColor', 'h13', 'essentials', null),
  ('hairColor', 'h14', 'essentials', null),
  ('hairColor', 'h15', 'essentials', null),
  ('hairColor', 'h16', 'essentials', null),
  ('eyes', 'almond', 'essentials', null),
  ('eyes', 'round', 'essentials', null),
  ('eyes', 'hooded', 'essentials', null),
  ('eyes', 'monolid', 'essentials', null),
  ('eyes', 'upturned', 'essentials', null),
  ('eyes', 'downturned', 'essentials', null),
  ('eyes', 'wide', 'essentials', null),
  ('eyes', 'joyful', 'essentials', null),
  ('eyeColor', 'e01', 'essentials', null),
  ('eyeColor', 'e02', 'essentials', null),
  ('eyeColor', 'e03', 'essentials', null),
  ('eyeColor', 'e04', 'essentials', null),
  ('eyeColor', 'e05', 'essentials', null),
  ('eyeColor', 'e06', 'essentials', null),
  ('eyeColor', 'e07', 'essentials', null),
  ('eyeColor', 'e08', 'essentials', null),
  ('eyeColor', 'e09', 'essentials', null),
  ('eyeColor', 'e10', 'essentials', null),
  ('brows', 'soft', 'essentials', null),
  ('brows', 'straight', 'essentials', null),
  ('brows', 'arched', 'essentials', null),
  ('brows', 'thick', 'essentials', null),
  ('brows', 'thin', 'essentials', null),
  ('brows', 'angled', 'essentials', null),
  ('brows', 'rounded', 'essentials', null),
  ('brows', 'bushy', 'essentials', null),
  ('nose', 'button', 'essentials', null),
  ('nose', 'rounded', 'essentials', null),
  ('nose', 'straight', 'essentials', null),
  ('nose', 'wide', 'essentials', null),
  ('nose', 'aquiline', 'essentials', null),
  ('nose', 'petite', 'essentials', null),
  ('mouth', 'smile', 'essentials', null),
  ('mouth', 'grin', 'essentials', null),
  ('mouth', 'laugh', 'essentials', null),
  ('mouth', 'smirk', 'essentials', null),
  ('mouth', 'calm', 'essentials', null),
  ('mouth', 'soft', 'essentials', null),
  ('mouth', 'wow', 'essentials', null),
  ('mouth', 'focused', 'essentials', null),
  ('mouth', 'cheeky', 'essentials', null),
  ('mouth', 'beam', 'essentials', null),
  ('facialHair', 'none', 'essentials', null),
  ('facialHair', 'stubble', 'essentials', null),
  ('facialHair', 'mustache', 'essentials', null),
  ('facialHair', 'goatee', 'essentials', null),
  ('facialHair', 'chinstrap', 'essentials', null),
  ('facialHair', 'short', 'essentials', null),
  ('facialHair', 'full', 'essentials', null),
  ('facialHair', 'long', 'essentials', null),
  ('facialHair', 'soulpatch', 'essentials', null),
  ('facialHair', 'vandyke', 'essentials', null),
  ('blush', 'none', 'essentials', null),
  ('blush', 'soft', 'essentials', null),
  ('blush', 'rosy', 'essentials', null),
  ('liner', 'none', 'essentials', null),
  ('liner', 'soft', 'essentials', null),
  ('liner', 'wing', 'essentials', null),
  ('liner', 'shadow', 'essentials', null),
  ('lips', 'none', 'essentials', null),
  ('lips', 'l01', 'essentials', null),
  ('lips', 'l02', 'essentials', null),
  ('lips', 'l03', 'essentials', null),
  ('lips', 'l04', 'essentials', null),
  ('lips', 'l05', 'essentials', null),
  ('details', 'freckles', 'essentials', null),
  ('details', 'beautymark', 'essentials', null),
  ('details', 'vitiligo', 'essentials', null),
  ('details', 'dimples', 'essentials', null),
  ('details', 'rosy', 'essentials', null),
  ('details', 'lashes', 'essentials', null),
  ('headwear', 'none', 'essentials', null),
  ('headwear', 'wrap', 'essentials', null),
  ('headwear', 'sport', 'essentials', null),
  ('headwear', 'draped', 'essentials', null),
  ('headwear', 'khimar', 'essentials', null),
  ('headwear', 'turban', 'essentials', null),
  ('headwear', 'kufi', 'essentials', 'crown'),
  ('headwear', 'beanie', 'essentials', 'fitted'),
  ('headwear', 'cap', 'essentials', 'fitted'),
  ('headwear', 'bucket', 'essentials', 'fitted'),
  ('headwear', 'mortarboard', 'scholar', 'fitted'),
  ('headwear', 'laurel', 'champion', 'crown'),
  ('headwear', 'circuitcap', 'seasonal', 'fitted'),
  ('headwearColor', 'c01', 'essentials', null),
  ('headwearColor', 'c02', 'essentials', null),
  ('headwearColor', 'c03', 'essentials', null),
  ('headwearColor', 'c04', 'essentials', null),
  ('headwearColor', 'c05', 'essentials', null),
  ('headwearColor', 'c06', 'essentials', null),
  ('headwearColor', 'c07', 'essentials', null),
  ('headwearColor', 'c08', 'essentials', null),
  ('headwearColor', 'c09', 'essentials', null),
  ('headwearColor', 'c10', 'essentials', null),
  ('headwearColor', 'c11', 'essentials', null),
  ('headwearColor', 'c12', 'essentials', null),
  ('headwearColor', 'c13', 'essentials', null),
  ('headwearColor', 'c14', 'essentials', null),
  ('headwearColor', 'c15', 'essentials', null),
  ('headwearColor', 'c16', 'essentials', null),
  ('glasses', 'none', 'essentials', null),
  ('glasses', 'round', 'essentials', null),
  ('glasses', 'square', 'essentials', null),
  ('glasses', 'cateye', 'essentials', null),
  ('glasses', 'wide', 'essentials', null),
  ('glasses', 'half', 'essentials', null),
  ('glasses', 'shades', 'essentials', null),
  ('glassesColor', 'f01', 'essentials', null),
  ('glassesColor', 'f02', 'essentials', null),
  ('glassesColor', 'f03', 'essentials', null),
  ('glassesColor', 'f04', 'essentials', null),
  ('glassesColor', 'f05', 'essentials', null),
  ('hearing', 'none', 'essentials', null),
  ('hearing', 'bte', 'essentials', null),
  ('hearing', 'btecolor', 'essentials', null),
  ('hearing', 'cochlear', 'essentials', null),
  ('mobility', 'none', 'essentials', null),
  ('mobility', 'cane', 'essentials', null),
  ('mobility', 'crutches', 'essentials', null),
  ('mobility', 'wheelchair', 'essentials', null),
  ('earrings', 'none', 'essentials', null),
  ('earrings', 'studs', 'essentials', null),
  ('earrings', 'hoops', 'essentials', null),
  ('top', 'tee', 'essentials', null),
  ('top', 'hoodie', 'essentials', null),
  ('top', 'sweater', 'essentials', null),
  ('top', 'shirt', 'essentials', null),
  ('top', 'overshirt', 'essentials', null),
  ('top', 'cardigan', 'essentials', null),
  ('top', 'blazer', 'essentials', null),
  ('top', 'polo', 'essentials', null),
  ('top', 'tunic', 'essentials', null),
  ('top', 'dress', 'essentials', null),
  ('top', 'varsity', 'elite', null),
  ('top', 'podiumjacket', 'podium', null),
  ('top', 'circuithoodie', 'seasonal', null),
  ('topColor', 'c01', 'essentials', null),
  ('topColor', 'c02', 'essentials', null),
  ('topColor', 'c03', 'essentials', null),
  ('topColor', 'c04', 'essentials', null),
  ('topColor', 'c05', 'essentials', null),
  ('topColor', 'c06', 'essentials', null),
  ('topColor', 'c07', 'essentials', null),
  ('topColor', 'c08', 'essentials', null),
  ('topColor', 'c09', 'essentials', null),
  ('topColor', 'c10', 'essentials', null),
  ('topColor', 'c11', 'essentials', null),
  ('topColor', 'c12', 'essentials', null),
  ('topColor', 'c13', 'essentials', null),
  ('topColor', 'c14', 'essentials', null),
  ('topColor', 'c15', 'essentials', null),
  ('topColor', 'c16', 'essentials', null),
  ('bottom', 'jeans', 'essentials', null),
  ('bottom', 'chinos', 'essentials', null),
  ('bottom', 'joggers', 'essentials', null),
  ('bottom', 'wide', 'essentials', null),
  ('bottom', 'cargo', 'essentials', null),
  ('bottom', 'midi', 'essentials', null),
  ('bottom', 'maxi', 'essentials', null),
  ('bottomColor', 'c01', 'essentials', null),
  ('bottomColor', 'c02', 'essentials', null),
  ('bottomColor', 'c03', 'essentials', null),
  ('bottomColor', 'c04', 'essentials', null),
  ('bottomColor', 'c05', 'essentials', null),
  ('bottomColor', 'c06', 'essentials', null),
  ('bottomColor', 'c07', 'essentials', null),
  ('bottomColor', 'c08', 'essentials', null),
  ('bottomColor', 'c09', 'essentials', null),
  ('bottomColor', 'c10', 'essentials', null),
  ('bottomColor', 'c11', 'essentials', null),
  ('bottomColor', 'c12', 'essentials', null),
  ('bottomColor', 'c13', 'essentials', null),
  ('bottomColor', 'c14', 'essentials', null),
  ('bottomColor', 'c15', 'essentials', null),
  ('bottomColor', 'c16', 'essentials', null),
  ('shoes', 'sneakers', 'essentials', null),
  ('shoes', 'hightops', 'essentials', null),
  ('shoes', 'boots', 'essentials', null),
  ('shoes', 'loafers', 'essentials', null),
  ('shoes', 'flats', 'essentials', null),
  ('shoes', 'elite', 'elite', null),
  ('shoes', 'gold', 'champion', null),
  ('shoesColor', 'c01', 'essentials', null),
  ('shoesColor', 'c02', 'essentials', null),
  ('shoesColor', 'c03', 'essentials', null),
  ('shoesColor', 'c04', 'essentials', null),
  ('shoesColor', 'c05', 'essentials', null),
  ('shoesColor', 'c06', 'essentials', null),
  ('shoesColor', 'c07', 'essentials', null),
  ('shoesColor', 'c08', 'essentials', null),
  ('shoesColor', 'c09', 'essentials', null),
  ('shoesColor', 'c10', 'essentials', null),
  ('shoesColor', 'c11', 'essentials', null),
  ('shoesColor', 'c12', 'essentials', null),
  ('shoesColor', 'c13', 'essentials', null),
  ('shoesColor', 'c14', 'essentials', null),
  ('shoesColor', 'c15', 'essentials', null),
  ('shoesColor', 'c16', 'essentials', null),
  ('neck', 'none', 'essentials', null),
  ('neck', 'headphones', 'essentials', null),
  ('neck', 'scarf', 'essentials', null),
  ('neck', 'scholarscarf', 'scholar', null),
  ('neck', 'medal', 'podium', null),
  ('neck', 'elitepin', 'elite', null),
  ('neckColor', 'c01', 'essentials', null),
  ('neckColor', 'c02', 'essentials', null),
  ('neckColor', 'c03', 'essentials', null),
  ('neckColor', 'c04', 'essentials', null),
  ('neckColor', 'c05', 'essentials', null),
  ('neckColor', 'c06', 'essentials', null),
  ('neckColor', 'c07', 'essentials', null),
  ('neckColor', 'c08', 'essentials', null),
  ('neckColor', 'c09', 'essentials', null),
  ('neckColor', 'c10', 'essentials', null),
  ('neckColor', 'c11', 'essentials', null),
  ('neckColor', 'c12', 'essentials', null),
  ('neckColor', 'c13', 'essentials', null),
  ('neckColor', 'c14', 'essentials', null),
  ('neckColor', 'c15', 'essentials', null),
  ('neckColor', 'c16', 'essentials', null),
  ('back', 'none', 'essentials', null),
  ('back', 'backpack', 'essentials', null),
  ('back', 'tote', 'essentials', null),
  ('back', 'cape', 'champion', null),
  ('back', 'circuitpack', 'seasonal', null),
  ('backColor', 'c01', 'essentials', null),
  ('backColor', 'c02', 'essentials', null),
  ('backColor', 'c03', 'essentials', null),
  ('backColor', 'c04', 'essentials', null),
  ('backColor', 'c05', 'essentials', null),
  ('backColor', 'c06', 'essentials', null),
  ('backColor', 'c07', 'essentials', null),
  ('backColor', 'c08', 'essentials', null),
  ('backColor', 'c09', 'essentials', null),
  ('backColor', 'c10', 'essentials', null),
  ('backColor', 'c11', 'essentials', null),
  ('backColor', 'c12', 'essentials', null),
  ('backColor', 'c13', 'essentials', null),
  ('backColor', 'c14', 'essentials', null),
  ('backColor', 'c15', 'essentials', null),
  ('backColor', 'c16', 'essentials', null),
  ('backdrop', 'mint', 'essentials', null),
  ('backdrop', 'coral', 'essentials', null),
  ('backdrop', 'gold', 'essentials', null),
  ('backdrop', 'paper', 'essentials', null),
  ('backdrop', 'sky', 'essentials', null),
  ('backdrop', 'lilac', 'essentials', null),
  ('backdrop', 'campus', 'essentials', null),
  ('backdrop', 'night', 'essentials', null),
  ('backdrop', 'library', 'scholar', null),
  ('backdrop', 'spotlight', 'elite', null),
  ('backdrop', 'podium', 'podium', null),
  ('backdrop', 'hall', 'champion', null),
  ('backdrop', 'circuit', 'seasonal', null),
  ('sticker', 'none', 'essentials', null),
  ('sticker', 'spark', 'essentials', null),
  ('sticker', 'bolt', 'essentials', null),
  ('sticker', 'heart', 'essentials', null),
  ('sticker', 'star', 'essentials', null),
  ('sticker', 'book', 'essentials', null),
  ('sticker', 'code', 'essentials', null),
  ('sticker', 'elite', 'elite', null),
  ('sticker', 'podium', 'podium', null),
  ('sticker', 'trophy', 'champion', null),
  ('sticker', 'circuit', 'seasonal', null);
insert into app_private.rank_reward_rules (max_position, collection_key) values
  (10, 'elite'),
  (3, 'podium'),
  (1, 'champion');
-- END GENERATED character-v2 catalogue

-- ---------------------------------------------------------------------------
-- Earning periods and entitlements.
create table app_private.reward_periods (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  -- Stable identity chosen by staff (e.g. 2026-27:week-05). Never a
  -- publication id, so a correction or rollback stays the same period.
  period_key text not null unique check (period_key ~ '^[a-z0-9][a-z0-9._:-]{2,63}$'),
  -- Future approved sources reuse the same entitlements.
  source_kind text not null check (source_kind in (
    'academic_rank', 'academic_threshold', 'attendance', 'weekly_challenge', 'workshop',
    'hackathon', 'improvement', 'module_competition', 'arena_pass'
  )),
  label text not null check (label ~ '^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,47}$'),
  created_by uuid references app_private.accounts(id) on delete set null,
  created_at timestamptz not null default pg_catalog.now()
);
-- Each publication can feed one period only (a re-keyed retry cannot grant twice).
create table app_private.reward_period_snapshots (
  snapshot_id uuid primary key references public.published_leaderboard_snapshots(id) on delete restrict,
  period_id uuid not null references app_private.reward_periods(id) on delete restrict,
  bound_by uuid references app_private.accounts(id) on delete set null,
  bound_at timestamptz not null default pg_catalog.now()
);
create table app_private.cosmetic_entitlements (
  account_id uuid not null references app_private.accounts(id) on delete cascade,
  collection_key text not null references app_private.cosmetic_collections(collection_key),
  period_id uuid not null references app_private.reward_periods(id) on delete restrict,
  -- Evidence: the verified row that earned it (no grades or scores).
  evidence_level smallint check (evidence_level in (4, 5, 6)),
  evidence_position smallint check (evidence_position between 1 and 10),
  evidence_version bigint,
  granted_by uuid references app_private.accounts(id) on delete set null,
  granted_at timestamptz not null default pg_catalog.now(),
  revoked_at timestamptz,
  revoked_by uuid references app_private.accounts(id) on delete set null,
  revoke_reason text check (revoke_reason in ('result_corrected', 'link_corrected', 'granted_in_error')),
  primary key (account_id, collection_key, period_id),
  check ((revoked_at is null) = (revoke_reason is null))
);
create index cosmetic_entitlements_period_idx on app_private.cosmetic_entitlements (period_id);
-- Append-only history of every grant, revocation and equipped fallback.
create table app_private.reward_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  -- Plain ids (no foreign keys): a cascading SET NULL would be an UPDATE,
  -- which the append-only trigger refuses, and history must not block an
  -- account deletion.
  actor_account_id uuid,
  target_account_id uuid,
  period_id uuid references app_private.reward_periods(id) on delete restrict,
  collection_key text references app_private.cosmetic_collections(collection_key),
  event_kind text not null check (event_kind in ('granted', 'regranted', 'revoked', 'equipped_fallback', 'processed')),
  reason_code text check (reason_code ~ '^[a-z0-9_.:-]{1,64}$')
);
create function app_private.reward_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'reward history is append-only';
end
$$;
create trigger reward_events_append_only
before update or delete or truncate on app_private.reward_events
for each statement execute function app_private.reward_events_append_only();

alter table app_private.reward_periods enable row level security;
alter table app_private.reward_periods force row level security;
alter table app_private.reward_period_snapshots enable row level security;
alter table app_private.reward_period_snapshots force row level security;
alter table app_private.cosmetic_entitlements enable row level security;
alter table app_private.cosmetic_entitlements force row level security;
alter table app_private.reward_events enable row level security;
alter table app_private.reward_events force row level security;
revoke all on table app_private.reward_periods, app_private.reward_period_snapshots,
  app_private.cosmetic_entitlements, app_private.reward_events from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- V2 config storage next to the classic look.
alter table public.student_avatar_configs
  alter column character_key drop not null,
  alter column family drop not null,
  add column active_look text not null default 'classic' check (active_look in ('classic', 'v2')),
  add column v2_config jsonb check (v2_config is null or pg_catalog.jsonb_typeof(v2_config) = 'object'),
  add column v2_updated_at timestamptz,
  add column revision bigint not null default 0 check (revision >= 0),
  -- Separate consent for Campus Wins (issue #25): leaderboard consent never implies it.
  add column show_on_campus_wins boolean not null default false,
  add column show_on_campus_wins_changed_at timestamptz,
  add constraint student_avatar_configs_has_a_look check (character_key is not null or v2_config is not null),
  add constraint student_avatar_configs_classic_complete check ((character_key is null) = (family is null)),
  add constraint student_avatar_configs_active_look_exists check (
    (active_look = 'classic' and character_key is not null) or (active_look = 'v2' and v2_config is not null)
  );
-- Browser roles still read and write only the classic columns directly; V2
-- goes through the RPCs below.

create function app_private.owned_collections(p_account_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select collection.collection_key from app_private.cosmetic_collections as collection where collection.free
  union
  select entitlement.collection_key from app_private.cosmetic_entitlements as entitlement
  where entitlement.account_id = p_account_id and entitlement.revoked_at is null
$$;

-- Error codes for a V2 config; empty when it is valid AND every item is owned.
-- Mirrors validateConfig() in catalog.js (the BFF runs that first).
create function app_private.character_v2_errors(p_config jsonb, p_account_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  errors text[] := '{}';
  spec record;
  entry jsonb;
  found_collection text;
  owned text[];
begin
  if p_config is null or pg_catalog.jsonb_typeof(p_config) <> 'object' then
    return array['not_object'];
  end if;
  if pg_catalog.octet_length(p_config::text) > 2048 then
    return array['too_large'];
  end if;
  if p_config -> 'v' is distinct from '2'::jsonb then
    errors := errors || 'bad_version'::text;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_config) as key(name)
    where key.name <> 'v' and not exists (select 1 from app_private.character_v2_fields as field where field.field = key.name)
  ) then
    errors := errors || 'unknown_field'::text;
  end if;
  owned := array(select app_private.owned_collections(p_account_id));
  for spec in select field.field, field.kind, field.max_items from app_private.character_v2_fields as field order by field.sort_order loop
    entry := p_config -> spec.field;
    if entry is null then
      errors := errors || ('missing:' || spec.field);
      continue;
    end if;
    if spec.kind = 'set' then
      if pg_catalog.jsonb_typeof(entry) <> 'array' or pg_catalog.jsonb_array_length(entry) > spec.max_items
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(entry) as item(value)
          where pg_catalog.jsonb_typeof(item.value) <> 'string'
            or not exists (
              select 1 from app_private.character_v2_values as allowed
              where allowed.field = spec.field and allowed.value = item.value #>> '{}'
            )
        )
        or (select pg_catalog.count(distinct item.value) from pg_catalog.jsonb_array_elements(entry) as item(value))
          <> pg_catalog.jsonb_array_length(entry) then
        errors := errors || ('invalid:' || spec.field);
      end if;
      continue;
    end if;
    if pg_catalog.jsonb_typeof(entry) <> 'string' then
      errors := errors || ('invalid:' || spec.field);
      continue;
    end if;
    select allowed.collection_key into found_collection
    from app_private.character_v2_values as allowed
    where allowed.field = spec.field and allowed.value = entry #>> '{}';
    if not found then
      errors := errors || ('invalid:' || spec.field);
    elsif not (found_collection = any(owned)) then
      errors := errors || ('not_owned:' || spec.field);
    end if;
  end loop;
  if pg_catalog.cardinality(errors) = 0 and exists (
    select 1
    from app_private.character_v2_values as hat, app_private.character_v2_values as hair
    where hat.field = 'headwear' and hat.value = p_config ->> 'headwear' and hat.trait = 'fitted'
      and hair.field = 'hair' and hair.value = p_config ->> 'hair' and hair.trait = 'big'
  ) then
    errors := errors || 'incompatible:headwear'::text;
  end if;
  return errors;
end
$$;

create function app_private.character_v2_default()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('v', 2) || pg_catalog.jsonb_object_agg(field.field, field.default_value)
  from app_private.character_v2_fields as field
$$;

-- The same look with every item the account no longer owns swapped for the
-- free default of that slot (and a hat that no longer fits removed). Always
-- returns a valid, owned config; an unreadable one becomes the default look.
create function app_private.character_v2_owned_fallback(p_config jsonb, p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb := p_config;
  spec record;
  owned text[];
begin
  if p_config is null then
    return null;
  end if;
  owned := array(select app_private.owned_collections(p_account_id));
  for spec in
    select field.field, field.default_value
    from app_private.character_v2_fields as field
    join app_private.character_v2_values as allowed on allowed.field = field.field
    where field.kind = 'item' and allowed.value = p_config ->> field.field and not (allowed.collection_key = any(owned))
  loop
    result := pg_catalog.jsonb_set(result, array[spec.field], spec.default_value);
  end loop;
  if pg_catalog.cardinality(app_private.character_v2_errors(result, p_account_id)) = 0 then
    return result;
  end if;
  result := pg_catalog.jsonb_set(result, '{headwear}', '"none"'::jsonb);
  if pg_catalog.cardinality(app_private.character_v2_errors(result, p_account_id)) = 0 then
    return result;
  end if;
  return app_private.character_v2_default();
end
$$;

-- The owner trigger from M2 set account_id to the *caller's* account on every
-- write. That was harmless while only students wrote their own row, but a
-- staff-side write (the equipped-item fallback after a revocation) would have
-- moved the row to the staff account. The owner is now fixed after insert.
create or replace function app_private.assign_avatar_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid;
begin
  if tg_op = 'UPDATE' then
    new.account_id := old.account_id;
  elsif (select auth.uid()) is not null then
    current_id := app_private.current_account_id();
    if current_id is null then
      raise exception using errcode = '42501', message = 'active account required';
    end if;
    new.account_id := current_id;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

-- Database write boundary: every write that sets or changes a V2 config is
-- checked (shape, catalogue membership, ownership, compatibility), whichever
-- role or function performs it. Every update also bumps the revision used
-- for stale-save detection.
create function app_private.guard_character_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
  end if;
  if new.v2_config is not null and (tg_op = 'INSERT' or new.v2_config is distinct from old.v2_config)
    and pg_catalog.cardinality(app_private.character_v2_errors(new.v2_config, new.account_id)) > 0 then
    raise exception using errcode = '22023', message = 'character configuration not allowed';
  end if;
  return new;
end
$$;
-- Fires after student_avatar_assign_owner (alphabetical), so account_id is final.
create trigger student_avatar_v2_guard
before insert or update on public.student_avatar_configs
for each row execute function app_private.guard_character_v2();

create function app_private.lock_character(p_account_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('arena.character:' || p_account_id::text, 0))
$$;

create function app_private.current_student_account()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_account_id uuid;
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
  return owner_account_id;
end
$$;

-- The signed-in student's own characters, consents and inventory. Returns no
-- rank, link, username or grade data.
create function public.my_character_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_account_id uuid := app_private.current_student_account();
  config public.student_avatar_configs%rowtype;
begin
  select avatar.* into config from public.student_avatar_configs as avatar where avatar.account_id = owner_account_id;
  return pg_catalog.jsonb_build_object(
    'saved', found,
    'activeLook', case when found then config.active_look end,
    'revision', coalesce(config.revision, 0),
    'classic', case when config.character_key is not null then pg_catalog.jsonb_build_object(
      'base', config.character_key, 'style', config.family, 'tone', config.tone, 'badge', config.badge) end,
    'v2', config.v2_config,
    'showOnLeaderboard', coalesce(config.show_on_leaderboard, false),
    'showOnCampusWins', coalesce(config.show_on_campus_wins, false),
    'studioEnabled', app_private.student_feature('character_studio_v2'),
    'owned', (select pg_catalog.jsonb_agg(owned.name order by owned.name) from app_private.owned_collections(owner_account_id) as owned(name)),
    'grants', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'collection', entitlement.collection_key, 'period', period.label, 'grantedAt', entitlement.granted_at)
        order by entitlement.granted_at desc)
      from app_private.cosmetic_entitlements as entitlement
      join app_private.reward_periods as period on period.id = entitlement.period_id
      where entitlement.account_id = owner_account_id and entitlement.revoked_at is null
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function public.my_character_v2() from public, anon, service_role;
grant execute on function public.my_character_v2() to authenticated;

-- Save the V2 look and/or which look is shown, plus both public consents.
-- p_v2_config null keeps the stored V2 look. p_expected_revision must match
-- (0 when nothing is saved yet): a stale tab or a late request is refused
-- (AAC09) instead of overwriting newer work or an equipped-item fallback.
-- Errors: AAC01 item not owned, AAC03 V2 not switched on, 22023 invalid.
create function public.save_own_character_v2(
  p_expected_revision bigint,
  p_v2_config jsonb,
  p_active_look text,
  p_show_on_leaderboard boolean,
  p_show_on_campus_wins boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_account_id uuid := app_private.current_student_account();
  config public.student_avatar_configs%rowtype;
  errors text[];
  next_v2 jsonb;
  saved_revision bigint;
begin
  if p_expected_revision is null or p_expected_revision < 0 or p_active_look is null
    or p_active_look not in ('classic', 'v2') or p_show_on_leaderboard is null or p_show_on_campus_wins is null then
    raise exception using errcode = '22023', message = 'invalid character request';
  end if;
  if (p_v2_config is not null or p_active_look = 'v2') and not app_private.student_feature('character_studio_v2') then
    raise exception using errcode = 'AAC03', message = 'custom characters are not switched on';
  end if;
  perform app_private.lock_character(owner_account_id);
  select avatar.* into config from public.student_avatar_configs as avatar
  where avatar.account_id = owner_account_id
  for update;
  if coalesce(config.revision, 0) <> p_expected_revision then
    raise exception using errcode = 'AAC09', message = 'character changed elsewhere';
  end if;
  if p_v2_config is not null then
    errors := app_private.character_v2_errors(p_v2_config, owner_account_id);
    if exists (select 1 from pg_catalog.unnest(errors) as error(code) where error.code like 'not_owned:%') then
      raise exception using errcode = 'AAC01', message = 'item not owned';
    elsif pg_catalog.cardinality(errors) > 0 then
      raise exception using errcode = '22023', message = 'invalid character configuration';
    end if;
  end if;
  next_v2 := coalesce(p_v2_config, config.v2_config);
  if (p_active_look = 'v2' and next_v2 is null) or (p_active_look = 'classic' and config.character_key is null) then
    raise exception using errcode = '22023', message = 'no saved look to show';
  end if;

  if config.account_id is null then
    insert into public.student_avatar_configs (
      account_id, v2_config, v2_updated_at, active_look, show_on_leaderboard, show_on_leaderboard_changed_at,
      show_on_campus_wins, show_on_campus_wins_changed_at
    ) values (
      owner_account_id, next_v2, pg_catalog.clock_timestamp(), p_active_look, p_show_on_leaderboard, pg_catalog.clock_timestamp(),
      p_show_on_campus_wins, pg_catalog.clock_timestamp()
    )
    returning revision into saved_revision;
  else
    update public.student_avatar_configs as avatar
    set v2_config = next_v2,
        v2_updated_at = case when p_v2_config is not null then pg_catalog.clock_timestamp() else avatar.v2_updated_at end,
        active_look = p_active_look,
        show_on_leaderboard = p_show_on_leaderboard,
        show_on_leaderboard_changed_at = case when avatar.show_on_leaderboard is distinct from p_show_on_leaderboard
          then pg_catalog.clock_timestamp() else avatar.show_on_leaderboard_changed_at end,
        show_on_campus_wins = p_show_on_campus_wins,
        show_on_campus_wins_changed_at = case when avatar.show_on_campus_wins is distinct from p_show_on_campus_wins
          then pg_catalog.clock_timestamp() else avatar.show_on_campus_wins_changed_at end,
        updated_at = pg_catalog.clock_timestamp()
    where avatar.account_id = owner_account_id
    returning avatar.revision into saved_revision;
  end if;
  return saved_revision;
end
$$;
revoke all on function public.save_own_character_v2(bigint, jsonb, text, boolean, boolean) from public, anon, service_role;
grant execute on function public.save_own_character_v2(bigint, jsonb, text, boolean, boolean) to authenticated;

-- A classic save through the existing RPC makes the classic look the one shown.
create function public.use_own_classic_look()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_account_id uuid := app_private.current_student_account();
  saved_revision bigint;
begin
  perform app_private.lock_character(owner_account_id);
  update public.student_avatar_configs as avatar
  set active_look = 'classic'
  where avatar.account_id = owner_account_id and avatar.character_key is not null and avatar.active_look <> 'classic'
  returning avatar.revision into saved_revision;
  return coalesce(saved_revision, (select avatar.revision from public.student_avatar_configs as avatar where avatar.account_id = owner_account_id));
end
$$;
revoke all on function public.use_own_classic_look() from public, anon, service_role;
grant execute on function public.use_own_classic_look() to authenticated;

-- ---------------------------------------------------------------------------
-- One decision for every public surface: which look (if any) may be shown
-- for this account under the given consent. Classic fields or a V2 config,
-- never both; nothing for a suspended account or with personalization off.
create function app_private.public_character(p_account_id uuid, p_surface text)
returns table (avatar_key text, avatar_family text, avatar_tone text, avatar_badge text, character_v2 jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when use_v2 then null else avatar.character_key end,
    case when use_v2 then null else avatar.family end,
    case when use_v2 then null else avatar.tone end,
    case when use_v2 then null else avatar.badge end,
    case when use_v2 then app_private.character_v2_owned_fallback(avatar.v2_config, avatar.account_id) end
  from public.student_avatar_configs as avatar
  join app_private.accounts as account on account.id = avatar.account_id and account.status = 'active'
  cross join lateral (
    select avatar.active_look = 'v2' and avatar.v2_config is not null and app_private.student_feature('character_studio_v2') as use_v2
  ) as choice
  where avatar.account_id = p_account_id
    and app_private.student_feature('avatar_personalization')
    and case p_surface
      when 'leaderboard' then avatar.show_on_leaderboard
      when 'campus_wins' then avatar.show_on_campus_wins
      else false
    end
    and (use_v2 or avatar.character_key is not null)
$$;
revoke all on function app_private.public_character(uuid, text) from public, anon, authenticated, service_role;

-- Public board: v3 plus the complete V2 look of linked, active, opted-in
-- students. v3 stays for rollback (it shows their classic look, or the
-- reviewed default for V2-only students).
create function public.public_level_leaderboard_v4(p_level smallint)
returns table (
  "position" smallint, public_name text, release_label text, published_at timestamptz,
  avatar_key text, avatar_family text, avatar_tone text, avatar_badge text, default_avatar_key text,
  character_v2 jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select level_row.position, level_row.public_name, snapshot.release_label, snapshot.published_at,
         chosen.avatar_key, chosen.avatar_family, chosen.avatar_tone, chosen.avatar_badge, artwork.character_key,
         chosen.character_v2
  from public.published_level_rows as level_row
  join public.published_leaderboard_snapshots as snapshot on snapshot.id = level_row.snapshot_id
  left join app_private.published_level_row_artwork as artwork
    on artwork.snapshot_id = level_row.snapshot_id and artwork.level = level_row.level and artwork.position = level_row.position
  left join app_private.published_level_row_links as link
    on link.snapshot_id = level_row.snapshot_id and link.level = level_row.level and link.position = level_row.position
  left join lateral app_private.public_character(link.account_id, 'leaderboard') as chosen on true
  where snapshot.is_current and snapshot.revoked_at is null and snapshot.board_format = 'level_only'
    and level_row.level = p_level and p_level in (4, 5, 6)
  order by level_row.position
  limit 10
$$;
revoke all on function public.public_level_leaderboard_v4(smallint) from public;
grant execute on function public.public_level_leaderboard_v4(smallint) to anon, authenticated;

-- The studio's status line now follows the look actually shown (classic or V2).
create or replace function public.my_character_publication_state()
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
  owner_account_id := app_private.current_student_account();
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
  if exists (
    select 1
    from app_private.published_level_row_links as link
    join public.published_leaderboard_snapshots as snapshot
      on snapshot.id = link.snapshot_id and snapshot.is_current and snapshot.revoked_at is null
    where link.account_id = owner_account_id
      and exists (
        select 1 from public.public_level_leaderboard_v4(link.level) as board
        where board.position = link.position and (board.avatar_key is not null or board.character_v2 is not null)
      )
  ) then
    return 'public';
  end if;
  return 'awaiting_link';
end
$$;
revoke all on function public.my_character_publication_state() from public, anon, service_role;
grant execute on function public.my_character_publication_state() to authenticated;

-- ---------------------------------------------------------------------------
-- Campus Wins (issue #25): read the author's current consent and look at
-- request time. Hidden, removed and suspended authors' posts never appear.
-- The stored approved_avatar_* / avatar_* snapshot columns are no longer
-- read by the app; they stay one release for rollback.
create function public.public_campus_wins_v2(p_templates text[])
returns table (
  post_id uuid, template_key text, public_author_name text, published_at timestamptz,
  heart_count integer, clap_count integer, fire_count integer,
  avatar_key text, avatar_family text, avatar_tone text, avatar_badge text, character_v2 jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select post.post_id, post.template_key, post.public_author_name, post.published_at,
         post.heart_count, post.clap_count, post.fire_count,
         chosen.avatar_key, chosen.avatar_family, chosen.avatar_tone, chosen.avatar_badge, chosen.character_v2
  from public.campus_wins_public as post
  join app_private.campus_wins_submissions as submission on submission.id = post.post_id and submission.status = 'approved'
  join app_private.accounts as account on account.id = submission.owner_account_id and account.status = 'active'
  left join lateral app_private.public_character(account.id, 'campus_wins') as chosen on true
  where p_templates is not null and post.template_key = any(p_templates)
  order by post.published_at desc
  limit 60
$$;
revoke all on function public.public_campus_wins_v2(text[]) from public;
grant execute on function public.public_campus_wins_v2(text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verified rank rewards. Eligibility comes only from staff-verified links of a
-- published level-only snapshot to active student accounts; never from a
-- name, a draft or an unverified row, and never from avatar consent.
create function app_private.rank_reward_eligibility(p_snapshot_id uuid)
returns table (account_id uuid, level smallint, "position" smallint, collection_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select link.account_id, link.level, link.position, rule.collection_key
  from app_private.published_level_row_links as link
  join app_private.accounts as account on account.id = link.account_id and account.status = 'active'
  join app_private.rank_reward_rules as rule on link.position <= rule.max_position
  join app_private.cosmetic_collections as collection on collection.collection_key = rule.collection_key and collection.earnable
  where link.snapshot_id = p_snapshot_id
    and exists (
      select 1 from app_private.account_role_grants as role_grant
      where role_grant.account_id = link.account_id and role_grant.role_name = 'student'
    )
$$;
revoke all on function app_private.rank_reward_eligibility(uuid) from public, anon, authenticated, service_role;

create function app_private.reward_snapshot(p_snapshot_id uuid)
returns public.published_leaderboard_snapshots
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.published_leaderboard_snapshots%rowtype;
begin
  select snapshot.* into target from public.published_leaderboard_snapshots as snapshot where snapshot.id = p_snapshot_id;
  if not found or target.board_format <> 'level_only' or target.first_published_at is null then
    raise exception using errcode = '22023', message = 'published level-only leaderboard not found';
  end if;
  return target;
end
$$;
revoke all on function app_private.reward_snapshot(uuid) from public, anon, authenticated, service_role;

create function app_private.valid_period_key(p_period_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_period_key is not null and p_period_key ~ '^[a-z0-9][a-z0-9._:-]{2,63}$'
$$;

-- Aggregate preview of processing a publication for an earning period. No
-- names, usernames or accounts; counts only. Grants nothing.
create function public.preview_rank_rewards(p_snapshot_id uuid, p_period_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.published_leaderboard_snapshots%rowtype;
  period app_private.reward_periods%rowtype;
  bound_key text;
  result jsonb;
begin
  if not app_private.has_permission('rewards.process') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  if not app_private.valid_period_key(p_period_key) then
    raise exception using errcode = '22023', message = 'invalid earning period';
  end if;
  target := app_private.reward_snapshot(p_snapshot_id);
  select reward_period.* into period from app_private.reward_periods as reward_period where reward_period.period_key = p_period_key;
  select bound_period.period_key into bound_key
  from app_private.reward_period_snapshots as binding
  join app_private.reward_periods as bound_period on bound_period.id = binding.period_id
  where binding.snapshot_id = p_snapshot_id;

  with eligible as (
    select * from app_private.rank_reward_eligibility(p_snapshot_id)
  ), existing as (
    select entitlement.* from app_private.cosmetic_entitlements as entitlement where entitlement.period_id = period.id
  ), per_collection as (
    select collection.collection_key,
      (select pg_catalog.count(*) from eligible where eligible.collection_key = collection.collection_key
         and not exists (select 1 from existing where existing.account_id = eligible.account_id and existing.collection_key = eligible.collection_key)) as new_grants,
      (select pg_catalog.count(*) from eligible join existing using (account_id, collection_key)
         where eligible.collection_key = collection.collection_key and existing.revoked_at is null) as already_granted,
      (select pg_catalog.count(*) from eligible join existing using (account_id, collection_key)
         where eligible.collection_key = collection.collection_key and existing.revoked_at is not null) as previously_revoked,
      (select pg_catalog.count(*) from existing where existing.collection_key = collection.collection_key and existing.revoked_at is null
         and not exists (select 1 from eligible where eligible.account_id = existing.account_id and eligible.collection_key = existing.collection_key)) as would_revoke
    from app_private.cosmetic_collections as collection
    where collection.earnable
  )
  select pg_catalog.jsonb_build_object(
    'snapshot', pg_catalog.jsonb_build_object('version', target.version_number, 'label', target.release_label, 'current', target.is_current and target.revoked_at is null),
    'period', pg_catalog.jsonb_build_object('key', p_period_key, 'exists', period.id is not null, 'label', period.label,
      'sourceKind', period.source_kind,
      'versions', coalesce((select pg_catalog.jsonb_agg(snapshot.version_number order by snapshot.version_number)
        from app_private.reward_period_snapshots as binding
        join public.published_leaderboard_snapshots as snapshot on snapshot.id = binding.snapshot_id
        where binding.period_id = period.id), '[]'::jsonb)),
    'rows', (select pg_catalog.count(*) from public.published_level_rows as level_row where level_row.snapshot_id = p_snapshot_id),
    'linked', (select pg_catalog.count(*) from app_private.published_level_row_links as link where link.snapshot_id = p_snapshot_id),
    'eligibleStudents', (select pg_catalog.count(distinct eligible.account_id) from eligible),
    'exclusions', pg_catalog.jsonb_build_object(
      'unlinked', (select pg_catalog.count(*) from public.published_level_rows as level_row where level_row.snapshot_id = p_snapshot_id
        and not exists (select 1 from app_private.published_level_row_links as link where link.snapshot_id = level_row.snapshot_id
          and link.level = level_row.level and link.position = level_row.position)),
      'inactiveAccounts', (select pg_catalog.count(*) from app_private.published_level_row_links as link
        join app_private.accounts as account on account.id = link.account_id
        where link.snapshot_id = p_snapshot_id and account.status <> 'active')),
    'collections', (select pg_catalog.jsonb_object_agg(per_collection.collection_key, pg_catalog.jsonb_build_object(
        'newGrants', per_collection.new_grants, 'alreadyGranted', per_collection.already_granted,
        'previouslyRevoked', per_collection.previously_revoked, 'wouldRevoke', per_collection.would_revoke))
      from per_collection),
    'conflicts', pg_catalog.jsonb_build_object(
      'snapshotBoundToPeriod', bound_key,
      'snapshotBoundElsewhere', bound_key is not null and bound_key <> p_period_key,
      'periodSourceMismatch', period.id is not null and period.source_kind <> 'academic_rank'),
    'rewardsSwitchOn', app_private.student_feature('cosmetic_rewards')
  ) into result;
  return result;
end
$$;
revoke all on function public.preview_rank_rewards(uuid, text) from public, anon, service_role;
grant execute on function public.preview_rank_rewards(uuid, text) to authenticated;

-- Swap any no-longer-owned equipped item for the free default and log it.
create function app_private.apply_equipped_fallback(p_account_id uuid, p_actor uuid, p_period_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  config public.student_avatar_configs%rowtype;
  fixed jsonb;
begin
  select avatar.* into config from public.student_avatar_configs as avatar where avatar.account_id = p_account_id for update;
  if not found or config.v2_config is null then
    return false;
  end if;
  fixed := app_private.character_v2_owned_fallback(config.v2_config, p_account_id);
  if fixed = config.v2_config then
    return false;
  end if;
  update public.student_avatar_configs as avatar set v2_config = fixed, v2_updated_at = pg_catalog.clock_timestamp()
  where avatar.account_id = p_account_id;
  insert into app_private.reward_events (actor_account_id, target_account_id, period_id, event_kind, reason_code)
  values (p_actor, p_account_id, p_period_id, 'equipped_fallback', 'free_default');
  return true;
end
$$;
revoke all on function app_private.apply_equipped_fallback(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Process verified results for one earning period. Idempotent: retries,
-- republishing and rollback grant nothing twice.
--   p_mode 'grant'     grant what is missing; never revokes; never re-grants a revoked one.
--   p_mode 'reconcile' also revokes this period's grants the given (corrected)
--                      publication no longer supports, re-grants revoked ones it
--                      supports again, and falls back equipped items.
-- Refused unless the owner has switched cosmetic_rewards on.
create function public.process_rank_rewards(p_snapshot_id uuid, p_period_key text, p_period_label text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  target public.published_leaderboard_snapshots%rowtype;
  period app_private.reward_periods%rowtype;
  bound_period uuid;
  candidate record;
  granted integer := 0;
  regranted integer := 0;
  revoked integer := 0;
  fallbacks integer := 0;
  affected uuid[] := '{}';
  account uuid;
begin
  if not app_private.has_permission('rewards.process') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  if not app_private.student_feature('cosmetic_rewards') then
    raise exception using errcode = 'AAR01', message = 'cosmetic rewards are not switched on';
  end if;
  if not app_private.valid_period_key(p_period_key) or p_mode is null or p_mode not in ('grant', 'reconcile')
    or p_period_label is null or p_period_label !~ '^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,47}$' then
    raise exception using errcode = '22023', message = 'invalid reward request';
  end if;
  actor_account_id := app_private.current_account_id();
  -- Links cannot change underneath, and two processors cannot interleave.
  perform app_private.lock_leaderboard_publication();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('arena.rewards', 0));
  target := app_private.reward_snapshot(p_snapshot_id);

  insert into app_private.reward_periods (period_key, source_kind, label, created_by)
  values (p_period_key, 'academic_rank', p_period_label, actor_account_id)
  on conflict (period_key) do nothing;
  select reward_period.* into period from app_private.reward_periods as reward_period where reward_period.period_key = p_period_key;
  if period.source_kind <> 'academic_rank' then
    raise exception using errcode = 'AAR03', message = 'earning period belongs to another reward source';
  end if;
  insert into app_private.reward_period_snapshots (snapshot_id, period_id, bound_by)
  values (p_snapshot_id, period.id, actor_account_id)
  on conflict (snapshot_id) do nothing;
  select binding.period_id into bound_period from app_private.reward_period_snapshots as binding where binding.snapshot_id = p_snapshot_id;
  if bound_period <> period.id then
    raise exception using errcode = 'AAR02', message = 'publication already processed for another earning period';
  end if;

  -- Per-account locks in a fixed order; the student save takes the same lock.
  for account in
    select distinct account_id from (
      select eligible.account_id from app_private.rank_reward_eligibility(p_snapshot_id) as eligible
      union
      select entitlement.account_id from app_private.cosmetic_entitlements as entitlement
      where p_mode = 'reconcile' and entitlement.period_id = period.id
    ) as accounts
    order by account_id
  loop
    perform app_private.lock_character(account);
  end loop;

  for candidate in
    select eligible.*, entitlement.revoked_at, entitlement.account_id is not null as exists_already
    from app_private.rank_reward_eligibility(p_snapshot_id) as eligible
    left join app_private.cosmetic_entitlements as entitlement
      on entitlement.account_id = eligible.account_id and entitlement.collection_key = eligible.collection_key
     and entitlement.period_id = period.id
    order by eligible.account_id, eligible.collection_key
  loop
    if not candidate.exists_already then
      insert into app_private.cosmetic_entitlements (
        account_id, collection_key, period_id, evidence_level, evidence_position, evidence_version, granted_by
      ) values (
        candidate.account_id, candidate.collection_key, period.id, candidate.level, candidate.position, target.version_number, actor_account_id
      )
      on conflict do nothing;
      if found then
        granted := granted + 1;
        insert into app_private.reward_events (actor_account_id, target_account_id, period_id, collection_key, event_kind, reason_code)
        values (actor_account_id, candidate.account_id, period.id, candidate.collection_key, 'granted', 'v' || target.version_number::text);
      end if;
    elsif candidate.revoked_at is not null and p_mode = 'reconcile' then
      update app_private.cosmetic_entitlements as entitlement
      set revoked_at = null, revoked_by = null, revoke_reason = null,
          evidence_level = candidate.level, evidence_position = candidate.position, evidence_version = target.version_number
      where entitlement.account_id = candidate.account_id and entitlement.collection_key = candidate.collection_key
        and entitlement.period_id = period.id;
      regranted := regranted + 1;
      insert into app_private.reward_events (actor_account_id, target_account_id, period_id, collection_key, event_kind, reason_code)
      values (actor_account_id, candidate.account_id, period.id, candidate.collection_key, 'regranted', 'v' || target.version_number::text);
    end if;
  end loop;

  if p_mode = 'reconcile' then
    for candidate in
      select entitlement.account_id, entitlement.collection_key
      from app_private.cosmetic_entitlements as entitlement
      where entitlement.period_id = period.id and entitlement.revoked_at is null
        and not exists (
          select 1 from app_private.rank_reward_eligibility(p_snapshot_id) as eligible
          where eligible.account_id = entitlement.account_id and eligible.collection_key = entitlement.collection_key
        )
      order by entitlement.account_id, entitlement.collection_key
    loop
      update app_private.cosmetic_entitlements as entitlement
      set revoked_at = pg_catalog.clock_timestamp(), revoked_by = actor_account_id, revoke_reason = 'result_corrected'
      where entitlement.account_id = candidate.account_id and entitlement.collection_key = candidate.collection_key
        and entitlement.period_id = period.id;
      revoked := revoked + 1;
      affected := affected || candidate.account_id;
      insert into app_private.reward_events (actor_account_id, target_account_id, period_id, collection_key, event_kind, reason_code)
      values (actor_account_id, candidate.account_id, period.id, candidate.collection_key, 'revoked', 'result_corrected');
    end loop;
    for account in select distinct affected_id from pg_catalog.unnest(affected) as changed(affected_id) order by 1 loop
      if app_private.apply_equipped_fallback(account, actor_account_id, period.id) then
        fallbacks := fallbacks + 1;
      end if;
    end loop;
  end if;

  insert into app_private.reward_events (actor_account_id, period_id, event_kind, reason_code)
  values (actor_account_id, period.id, 'processed',
    'v' || target.version_number::text || '-' || p_mode || '-g' || granted::text || '-r' || revoked::text);
  insert into app_private.audit_events (actor_account_id, action_key, reason_code)
  values (actor_account_id, 'rewards.processed', 'v' || target.version_number::text || '-' || p_mode || '-g' || granted::text || '-r' || revoked::text);
  return pg_catalog.jsonb_build_object('period', p_period_key, 'version', target.version_number, 'mode', p_mode,
    'granted', granted, 'regranted', regranted, 'revoked', revoked, 'equippedFallbacks', fallbacks);
end
$$;
revoke all on function public.process_rank_rewards(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.process_rank_rewards(uuid, text, text, text) to authenticated;

-- Audited manual revocation of one student's grant for one period (e.g. a
-- link that was verified in error). Works with the rewards switch off, so a
-- mistake can always be corrected.
create function public.revoke_cosmetic_entitlement(p_username text, p_collection text, p_period_key text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  target_account uuid;
  target_period uuid;
begin
  if not app_private.has_permission('rewards.process') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  if p_reason is null or p_reason not in ('result_corrected', 'link_corrected', 'granted_in_error') then
    raise exception using errcode = '22023', message = 'invalid revocation reason';
  end if;
  actor_account_id := app_private.current_account_id();
  select mapping.account_id into target_account from app_private.identity_mappings as mapping
  where mapping.username_normalized = pg_catalog.lower(pg_catalog.btrim(p_username));
  select reward_period.id into target_period from app_private.reward_periods as reward_period where reward_period.period_key = p_period_key;
  if target_account is null or target_period is null then
    raise exception using errcode = '22023', message = 'entitlement not found';
  end if;
  perform app_private.lock_character(target_account);
  update app_private.cosmetic_entitlements as entitlement
  set revoked_at = pg_catalog.clock_timestamp(), revoked_by = actor_account_id, revoke_reason = p_reason
  where entitlement.account_id = target_account and entitlement.collection_key = p_collection
    and entitlement.period_id = target_period and entitlement.revoked_at is null;
  if not found then
    raise exception using errcode = '22023', message = 'entitlement not found';
  end if;
  insert into app_private.reward_events (actor_account_id, target_account_id, period_id, collection_key, event_kind, reason_code)
  values (actor_account_id, target_account, target_period, p_collection, 'revoked', p_reason);
  insert into app_private.audit_events (actor_account_id, target_account_id, action_key, reason_code)
  values (actor_account_id, target_account, 'rewards.revoked', p_reason);
  perform app_private.apply_equipped_fallback(target_account, actor_account_id, target_period);
  return true;
end
$$;
revoke all on function public.revoke_cosmetic_entitlement(text, text, text, text) from public, anon, service_role;
grant execute on function public.revoke_cosmetic_entitlement(text, text, text, text) to authenticated;

-- Staff history: aggregate counts per earning period.
create function public.list_reward_periods()
returns table (period_key text, label text, source_kind text, versions bigint[], active jsonb, revoked bigint, last_processed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('rewards.process') then
    raise exception using errcode = '42501', message = 'authorized AAL2 administrator required';
  end if;
  return query
  select period.period_key, period.label, period.source_kind,
    array(select snapshot.version_number from app_private.reward_period_snapshots as binding
          join public.published_leaderboard_snapshots as snapshot on snapshot.id = binding.snapshot_id
          where binding.period_id = period.id order by 1),
    coalesce((select pg_catalog.jsonb_object_agg(counts.collection_key, counts.total) from (
      select entitlement.collection_key, pg_catalog.count(*) as total from app_private.cosmetic_entitlements as entitlement
      where entitlement.period_id = period.id and entitlement.revoked_at is null group by 1) as counts), '{}'::jsonb),
    (select pg_catalog.count(*) from app_private.cosmetic_entitlements as entitlement
      where entitlement.period_id = period.id and entitlement.revoked_at is not null),
    (select pg_catalog.max(event.occurred_at) from app_private.reward_events as event
      where event.period_id = period.id and event.event_kind = 'processed')
  from app_private.reward_periods as period
  order by period.created_at desc
  limit 50;
end
$$;
revoke all on function public.list_reward_periods() from public, anon, service_role;
grant execute on function public.list_reward_periods() to authenticated;

revoke all on function app_private.owned_collections(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.character_v2_errors(jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.character_v2_default() from public, anon, authenticated, service_role;
revoke all on function app_private.character_v2_owned_fallback(jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.guard_character_v2() from public, anon, authenticated, service_role;
revoke all on function app_private.lock_character(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.current_student_account() from public, anon, authenticated, service_role;
revoke all on function app_private.valid_period_key(text) from public, anon, authenticated, service_role;
revoke all on function app_private.reward_events_append_only() from public, anon, authenticated, service_role;
