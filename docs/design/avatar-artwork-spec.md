# Character artwork production specification

**Status, 18 Nov 2026: the inclusive library is not complete.** Academic Arena
ships 9 characters in two art families:

- skin tones range from light to medium-brown only;
- there is one headscarf look;
- there is one wheelchair user (3D only).

This document is the brief for commissioning or generating new original
characters externally. It also gives the exact integration steps. New art only
adds allowlisted keys and image files: authentication, sessions, account links,
the public projection and RLS do not change.

## 1. Art direction (both families, always as a matched pair)

Every new character is delivered in **both** existing families, as the same
person with the same outfit and pose intent.

| | Comic Original (`ink`) | 3D Cartoon (`cartoon3d`) |
|---|---|---|
| Reference files | `assets/characters/amara-ink.png`, `habiba2-ink.png`, `malek-ink.png` | `amara-3d.png`, `habiba2-3d.png`, `zein-3d.png` |
| Look | Hand-inked comic illustration: confident dark outlines, flat colour with soft cel shading, warm palette, slight paper-print feel | Soft stylised 3D: rounded forms, gentle subsurface skin, studio lighting from the upper left, matte fabrics |
| Framing | Full figure from the knees or thighs up, standing, three-quarter or front view | Upper body to mid-thigh, centred |
| Mood | University students aged 18–25: stylish, expressive, never childish | Same |

Shared rules:

- Same proportions as the reference cast: heads about 1/6.5 of figure height in `ink` and about 1/4 in 3D.
- No background, ground shadow, text, logos, brand marks, flags or slogans.
- Expressions are positive and distinct, for example confident smile, calm, laughing, focused, wink or thoughtful. No caricature, no exaggerated features, no "mascot" faces.
- Clothing is everyday campus wear: hoodies, overshirts, blazers, knitwear, long cardigans, modest long sleeves and full-length skirts or trousers, backpacks and totes.

## 2. Diversity targets for the first expansion (minimum 18 new characters)

Plan the set as a grid so that no attribute is tied to a single face.

| Dimension | Minimum across the new set |
|---|---|
| Skin tone | 8 tones from light to deep (T1–T8). **At least 6 characters in T6–T8** (deep brown), with at least 4 different hairstyles or coverings among them. |
| Head covering | **At least 6 headscarf characters in at least 4 distinct styles**: wrapped hijab, sporty or athletic hijab, draped shayla, khimar-length wrap, turban-style wrap and underscarf with cap. They need at least 5 colours or patterns and at least 4 different skin tones. Also include at least 1 non-religious covering, such as a beanie or bucket hat. |
| Hair texture and style | Coils or 4C natural, locs, braids or cornrows, twists, afro puff, short fade, buzz or bald, curly long, wavy bob, straight long, ponytail and undercut. Each must appear on at least 2 different skin tones where the hair is visible. |
| Clothing and silhouette | At least 4 modest full-coverage outfits that are **not** limited to headscarf characters, plus at least 4 gender-neutral silhouettes. Vary build, so not every character is slim. |
| Accessories and access | Glasses on 3 or more, a visible hearing aid on 1 or more, and 1 or more additional mobility aid (cane, crutches or prosthetic) alongside the existing wheelchair character. |
| Expression | No more than 3 characters share the same expression. |

Respect rules, which are reviewed before integration:

- No stereotyped costume, skin tone or feature combinations, and no religious symbols beyond head coverings.
- No likeness of a real person.
- Skin, hair and fabrics are **drawn**, never recoloured with filters.
- Studio pickers never label a character by gender, religion, ethnicity or skin. Labels are mood words such as SPARK or CALM, and keys are neutral.

## 3. Delivery files, per character key `<key>` (lowercase letters and digits only)

| File | Format | Size | Notes |
|---|---|---|---|
| `<key>-ink.png` | PNG, RGBA, sRGB | **640 × 840** (existing art ranges from 317×495 to 668×829 and renders height-fitted) | Figure centred and bottom-aligned, touching the bottom edge, with a 3–5 % top margin. Optimise to ≤ 800 KB (pngquant or oxipng). |
| `<key>-face.png` | PNG, RGBA | **256 × 256** | Head and shoulders, eyes at about 42 % of the height, transparent. ≤ 150 KB. |
| `<key>-3d.png` | PNG, RGBA | **418 × 418** | Bottom-aligned, transparent. ≤ 400 KB. |
| `<key>-3d-face.jpg` | JPEG, quality 85 | **180 × 180** | Head and shoulders on the same light backdrop as the existing `*-3d-face.jpg`. ≤ 40 KB. |

- Keep layered or high-resolution masters (at least 2× the delivery size) with the commissioning records, **outside the repository**.
- Provide a written licence for every asset that permits university use, modification and public display. Generated art needs a provider licence that allows this, plus human review of every image. No remote image URLs; files are committed to `assets/characters/`.

## 4. Integration procedure (one PR per batch)

1. **Files:** add the 4 files per key to `assets/characters/`.
2. **Allowlists**, kept identical. The test `tests/frontend/avatar-assets.test.mjs` fails if they differ:
   - `assets/app.js`: add the key to `characterIds` and a mood word to `characterLabels`, in the same order;
   - `assets/data-access.js`: `CHARACTER_IDS`;
   - `functions/lib/validation.js`: `CHARACTER_IDS`;
   - `index.html`: the studio count text ("9 different looks").
3. **Append-only migration** `supabase/migrations/<timestamp>_avatar_library_<batch>.sql`. Never edit an existing migration. Replace each of these four constraints with the full new list:
   - `student_avatar_configs.student_avatar_configs_character_key_check`
   - `app_private.campus_wins_submissions.campus_wins_submissions_approved_avatar_key_check`
   - `published_leaderboard_rows.published_leaderboard_rows_avatar_key_check`
   - `campus_wins_public.campus_wins_public_avatar_key_check`

   Then redefine `public.save_own_avatar_preferences` with the same `not in (...)` list. Keep the grants: revoke from public, anon and service_role, and grant to authenticated.

   ```sql
   alter table public.student_avatar_configs drop constraint student_avatar_configs_character_key_check,
     add constraint student_avatar_configs_character_key_check check (character_key in ('omar', …, '<new keys>'));
   -- …same for the other three constraints…
   create or replace function public.save_own_avatar_preferences(…) … -- copy from 202611190001, extend the list only
   ```
4. **Tests:**
   - `npm test`: the asset gate checks files, formats, sizes, identical allowlists and mood-only labels.
   - `npm run supabase:start && npm run supabase:reset`, then `npm run supabase:stop && npm run test:m2:local` (all pgTAP and integration tests).
   - `npm run test:browser` and `npm run check:security`.
5. **Visual review**, recorded in the PR:
   - desktop at 1440px and phone at 390px;
   - for each new key, in both families: studio preview and picker tile, podium figure (ranks 1–3), top-ten thumbnail, Campus Wins card and the nav portrait;
   - no clipping, consistent line weight and lighting, and nothing rendering as a broken image.
6. **Independent review**, then merge. Apply the migration to staging and check there. Apply it to production only after a verified encrypted backup (`docs/operations/backup-restore.md`).

Existing student choices stay valid because keys are only ever added. Removing or renaming a key needs a data migration first and is out of scope.
