# Character V2: engine, catalogue and provenance

Release B replaces the 9 static characters with a modular, original character
engine. This page is the reference for the art system. Product and rollout
status are in `docs/progress.md`.

## Files

| File | Role |
|---|---|
| `assets/avatar-v2/catalog.js` | The trusted catalogue: palettes, options, items, collections, reward rules, the config schema and its validator. Pure data plus pure functions. Shared by the studio, the board, the BFF (B2) and the tests. |
| `assets/avatar-v2/render.js` | Deterministic SVG renderer. `render(config, { context })` returns an SVG string built only from catalogue constants. |
| `assets/studio-v2.js` | Create / Wardrobe / Arena Pass UI. Demo store (local, fictional) or server store (`/api/me/character`, B2). |
| `functions/lib/character-v2.js` | The BFF's validator: imports the same `catalog.js`. |
| `scripts/character-v2-sql.mjs` | Generates the database allowlist (fields, values, collections, traits, rank rules) from `catalog.js`. |
| `supabase/migrations/202611270001_*.sql` | B2 storage, ownership, rewards, public projections. |
| `docs/design/avatar-v2-sheet.html` | Contact sheet of every option across skin tones, faces and builds (serve the repo root with any static server). |
| `tests/frontend/avatar-v2.test.mjs`, `tests/frontend/character-v2-contract.test.mjs`, `supabase/tests/v18_character_v2_rewards.test.sql`, `tests/m2/v18-character-v2-rewards.integration.test.mjs`, `tests/browser/v2-character-studio.spec.mjs`, `tests/browser/b2-character-server.spec.mjs` | Contract, asset-coverage, safety, database, live BFF and UI tests. |

## A saved character

A character is a flat, versioned object of catalogue keys, about 600 bytes.
The full field list is in `catalog.fields`.

```json
{ "v": 2, "skin": "s07", "face": "oval", "build": "regular", "hair": "locs", "hairColor": "h03",
  "eyes": "almond", "eyeColor": "e02", "brows": "soft", "nose": "button", "mouth": "smile",
  "facialHair": "short", "blush": "none", "liner": "none", "lips": "none", "details": [],
  "headwear": "none", "headwearColor": "c11", "glasses": "none", "glassesColor": "f01",
  "hearing": "none", "mobility": "none", "earrings": "none",
  "top": "overshirt", "topColor": "c10", "bottom": "jeans", "bottomColor": "c01",
  "shoes": "sneakers", "shoesColor": "c03", "neck": "none", "neckColor": "c05",
  "back": "none", "backColor": "c05", "backdrop": "coral", "sticker": "spark" }
```

`validateConfig(input, { ownedItems })` rules:

- Every field is required, and unknown fields are rejected.
- Values must be catalogue keys. Colours are palette keys, never hex codes.
- `details` holds at most 3 entries, with no duplicates.
- The serialized config must be 1 KB or less.
- Every non-essential item must be in `ownedItems`.
- Fitted hats cannot be worn over big hair.

The BFF runs the same function before every save. The database checks the
same rules again (`app_private.character_v2_errors`, generated allowlist) in
the save RPC **and** in a table trigger, including ownership, so no direct RPC
or table write can store an unowned item.
`normalizeForRender` is only for drawing: anything unknown becomes the default.
It never converts a classic (V1) look into guessed V2 features.

## Coordinate system and layers

Full context: `viewBox 0 0 400 600`.

| Point | y |
|---|---|
| Head centre (x 200) | 150 |
| Eyes (x ±31) | 158 |
| Mouth | 210 |
| Chin | about 238 |
| Neck base | 266 |
| Shoulders | about 292 |
| Waist | 392 |
| Ankles | 562 |
| Soles | 584 |

Seated pose (wheelchair): knees at 452, soles at 558 on the footplate.

Other contexts crop the same drawing:

| Context | viewBox | Used for |
|---|---|---|
| `portrait` | `56 8 288 288` | Board thumbnails, the profile chip |
| `face` | `112 104 176 136` | Feature thumbnails |
| `torso` | `30 240 340 360` | Clothing thumbnails |
| `legs` | `60 380 280 220` | Clothing thumbnails |

Layer order, back to front:

1. backdrop
2. cape or bag body
3. hair back
4. wheelchair back
5. legs, bottoms and shoes
6. neck
7. top
8. cane or crutch shafts
9. arms and hands
10. neck items
11. bag straps
12. head-covering drape
13. ears and face
14. facial details
15. beard
16. mouth
17. mustache
18. nose, eyes, brows
19. hair front
20. glasses
21. headwear front
22. hearing devices
23. earrings
24. sticker

Builds (`slim`, `regular`, `broad`, `soft`) set the shoulder, waist, hip, arm
and leg widths. Every garment is drawn from those anchors, so clothes fit every
build.

Compatibility rules:

- Head coverings with `hidesHair` replace the hair layers.
- Coverings with `hidesEars` also hide the ears, earrings and hearing devices. The studio explains this.
- Fitted hats clip the hair above their brim, and they are disallowed over big hair. The studio disables them, with a reason, and the validator rejects them.
- Crown items (kufi, laurel) sit on any hair.
- A full-length dress covers the bottoms layer.

Shading:

- Every fill is a soft gradient from the top left, with an outline in a darker shade of the same colour. There are no black strokes.
- Skin, hair and fabric colours are drawn, never filtered.
- Output uses presentation attributes only (no `style`), so it works under the strict CSP.
- Gradient ids are unique to each render, so many characters can share a page.

## Catalogue (launch)

| Area | Count |
|---|---|
| Skin tones, light through deep | 12 |
| Face shapes / builds | 6 / 4 |
| Hairstyles | 22: bald, buzz, fade, crop, side part, quiff, curly-top fade, cornrows, afro, high puff, two puffs, curly bob, long curls, locs, box braids, wavy bob, long waves, long straight, ponytail, top bun, pixie, shoulder shag |
| Hair colours / eye shapes / eye colours | 16 / 8 / 10 |
| Brows / noses / mouths | 8 / 6 / 10 |
| Facial hair | 10 |
| Head coverings and hats | 4 headscarf styles (wrapped, sport, draped, full-coverage), head wrap, kufi, beanie, cap, bucket hat, each in 16 colours |
| Makeup and details | Liner, wing, shadow; 5 lip colours; blush; freckles, beauty mark, vitiligo, dimples, rosy nose, long lashes |
| Access | 6 glasses styles in 5 frame colours; 2 hearing aid styles; cochlear processor; cane; forearm crutches; wheelchair |
| Clothing | 14 tops (including a long tunic, a full-length dress, an open abaya and a thobe), 10 bottoms (including midi and maxi skirts, knee shorts, leggings, pleated trousers), 7 shoes (including sandals and slip-ons), neck items (headphones, scarf, tie, campus lanyard), bags (backpack, tote, messenger), earrings |
| Scenes | 8 backdrops, 6 stickers |

**Free for everyone (Campus Essentials):** every identity option, every head
covering, every assistive device and every everyday garment. The tests enforce
this.

**Earned (decorative special editions only):**

| Collection | Rule | Items |
|---|---|---|
| Elite | Verified Top 10 | Headband with "10" shield, varsity jacket, court sneakers, pin, spotlight backdrop, Top 10 badge |
| Podium | Verified Top 3 | Silver cap with gold star, track jacket, medal, podium stage, podium badge |
| Champion | Verified first place | Laurel, cape, gold kicks, champion hall, trophy |
| Scholar | Inactive until policy approval | Scholar's cap, stripe scarf, library |
| Seasonal | Inactive until XP rules are approved | Circuit cap, hoodie and pack, circuit grid, chip |

The board's crown for the current leader is separate and is never a wardrobe
item. Each earned collection has something on or around the head, or a
backdrop, so it shows on 56 px rank thumbnails. Earned items keep fixed
signature colours. Locked items show a written requirement (TOP 10, TOP 3,
1ST PLACE) and rarity glyphs (○ ◆ ✦ ★), so nothing depends on colour alone.

## Storage, ownership and rewards (B2)

- **Storage.** `student_avatar_configs` keeps the classic look and adds
  `v2_config`, `active_look` (`classic` | `v2`) and `revision`. Existing rows
  stay `classic` and nothing is converted. A student switches to V2 only by
  saving one; saving in the classic studio shows the classic look again.
- **Stale and concurrent saves.** Every save carries the revision it was based
  on. The server refuses a mismatch (`409 character_changed`); the studio keeps
  the edits and loads the latest. Every update bumps the revision, including
  an equipped-item fallback.
- **Ownership.** Collections are owned through
  `app_private.cosmetic_entitlements`, one row per (account, collection,
  earning period). Free collections need no row.
- **Rank rewards.** Only staff-verified links of a published level-only
  publication count, never names or unverified rows, and never avatar
  consent. Top 10 → Elite; Top 3 → plus Podium; 1st → plus Champion
  (`app_private.rank_reward_rules`, generated from `rankRewards`).
- **Earning period.** Staff pick a stable key such as `2026-27:week-05`. A
  publication can belong to one period only. Retries, corrected
  republications and rollbacks of the same week use the same key, so nothing
  is granted twice. A later week is a new period, so a drop in rank never
  removes earlier rewards.
- **Corrections.** `reconcile` revokes this period's grants that the corrected
  publication no longer supports (`revoke_reason = result_corrected`). Any
  revoked item being worn falls back to the slot's free default. Everything
  goes to the append-only `app_private.reward_events`.
- **Future sources.** `reward_periods.source_kind` already allows academic
  thresholds, attendance, weekly challenges, workshops, hackathons,
  improvement, module competitions and Arena Pass. Each needs an approved
  rule and its own processor; none exists yet.
- **Switches** (owner-only, all off): `character_studio_v2` (V2 saving and
  public V2 looks) and `cosmetic_rewards` (granting). Previews work while
  rewards are off.

## Provenance and licensing

- All V2 artwork is original vector drawing written as code in
  `assets/avatar-v2/render.js` for Academic Arena.
- No third-party, stock, traced or AI-generated images are used.
- No Bitmoji, Snapchat, Fortnite or Epic assets, names or trade dress are used.
  Only general interaction ideas are borrowed: a layered editor and a reward
  track.
- Nothing is fetched at runtime and there are no paid services.
- Badge numerals use system fonts.
- `catalog.PROVENANCE` records this, and a test checks it.
- Rights belong to the Academic Arena owner, the same as the rest of the
  repository. If the project is commercialized, record the author and the
  assignment terms here.

## Adding an item

1. Add the key to `catalog.items`, or to an option table, with its slot,
   collection and rarity. Then regenerate the database allowlist: before the
   B2 migration is merged, run `node scripts/character-v2-sql.mjs --write`
   on it; after that, put the regenerated block in a **new** migration. The
   contract test reads the newest block.
2. Draw it in `render.js`, anchored to the build and face parameters, never to
   fixed pixels.
3. Run `npm test`. The coverage and render tests fail until every key draws
   well-formed SVG in every context.
4. Check it on the contact sheet across skin tones, builds and hair volumes.
