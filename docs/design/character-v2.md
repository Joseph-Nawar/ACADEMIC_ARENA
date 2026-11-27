# Character V2: engine, catalogue and provenance

Release B replaces the 9 static characters with a modular, original character
engine. This page is the reference for the art system. Product and rollout
status are in `docs/progress.md`.

## Files

| File | Role |
|---|---|
| `assets/avatar-v2/catalog.js` | The trusted catalogue: palettes, options, items, collections, reward rules, the config schema and its validator. Pure data plus pure functions. Shared by the studio, the board, the BFF (B2) and the tests. |
| `assets/avatar-v2/render.js` | Deterministic SVG renderer. `render(config, { context })` returns an SVG string built only from catalogue constants. |
| `assets/studio-v2.js` | Create / Wardrobe / Arena Pass UI. Fictional demo only in B1. |
| `docs/design/avatar-v2-sheet.html` | Contact sheet of every option across skin tones, faces and builds (serve the repo root with any static server). |
| `tests/frontend/avatar-v2.test.mjs`, `tests/browser/v2-character-studio.spec.mjs` | Contract, asset-coverage, safety and UI tests. |

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

The server applies the same function at the write boundary (B2).
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
| Clothing | 10 tops (including a long tunic and a full-length dress), 7 bottoms (including midi and maxi skirts), 5 shoes, neck items, bags, earrings |
| Scenes | 8 backdrops, 6 stickers |

**Free for everyone (Campus Essentials):** every identity option, every head
covering, every assistive device and every everyday garment. The tests enforce
this.

**Earned (decorative special editions only):**

| Collection | Rule | Items |
|---|---|---|
| Elite | Verified Top 10 | Varsity jacket, court sneakers, pin, spotlight backdrop, Top 10 badge |
| Podium | Verified Top 3 | Track jacket, medal, podium stage, podium badge |
| Champion | Verified first place | Laurel, cape, gold kicks, champion hall, trophy |
| Scholar | Inactive until policy approval | Scholar's cap, stripe scarf, library |
| Seasonal | Inactive until XP rules are approved | Circuit cap, hoodie and pack, circuit grid, chip |

The board's crown for the current leader is separate and is never a wardrobe
item.

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
   collection and rarity.
2. Draw it in `render.js`, anchored to the build and face parameters, never to
   fixed pixels.
3. Run `npm test`. The coverage and render tests fail until every key draws
   well-formed SVG in every context.
4. Check it on the contact sheet across skin tones, builds and hair volumes.
