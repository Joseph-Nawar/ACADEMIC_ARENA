# Avatar library: current state and expansion contract

## Current library (shipped, reviewed 2026-11-18)

There are 9 characters (`omar`, `mariam`, `youssef`, `amara`, `tariq`, `habiba2`, `malek`, `nour2`, `zein`). Each has two hand-illustrated raster families, Comic Original (`ink`) and 3D Cartoon (`cartoon3d`). Students also choose 6 backdrops and 5 stickers.

Honest gaps against the V1.2 inclusion goals:

- Skin tones range from light to medium-brown. No character has a dark skin tone.
- There is one headscarf look (`habiba2`: one design, one colour, one face).
- Hair textures include curly, coily-short, wavy and straight, but they are spread over only 9 fixed people.
- `zein` (3D) uses a wheelchair.

These gaps cannot be closed with code. The art is flat raster illustration, and recolouring skin, hair or scarves with filters gives unnatural results. The V1.2 brief forbids that. No image-generation tooling that matches this art was available in this repository, so **no new artwork was added**. Low-quality or inconsistent variants were not released to meet a count.

## What is ready for new art

- Selection is the student's choice only. Nothing is inferred from names, emails, gender or religion, and nothing is pre-selected.
- The server and SQL allowlist every key. Students cannot send paths, URLs, SVG or markup.
- Student opt-in, verified links, the public projection and default-off switches all work with any allowlisted character key.

## Adding a curated character (per new key, both families)

1. Commission original or licensed art matching the existing two families, with consistent line weight, palette and proportions. Target set:
   - at least 4 distinct headscarf designs and colours, across several faces and skin tones;
   - at least 3 darker skin tones, each with more than one hairstyle (coils, locs, braids, short natural, covered);
   - modest-clothing and gender-neutral silhouettes.
2. Files in `assets/characters/`, transparent where noted:
   - `<key>-ink.png` (full figure, about 900px tall, transparent);
   - `<key>-face.png` (square crop);
   - `<key>-3d.png`;
   - `<key>-3d-face.jpg`;
   - `<key>-3d-square.jpg`.
3. Add an append-only migration that extends the character allowlists. These are the check constraints on `student_avatar_configs`, `campus_wins_submissions` and the Campus Wins tables, plus `save_own_avatar_preferences`.
4. Add the key to the `CHARACTER_IDS` sets in `functions/lib/validation.js`, `assets/data-access.js` and `assets/app.js` (`characterIds`, `characterLabels`). The labels describe a mood, never an identity.
5. Review every new character on the site at desktop and 390px: studio, podium, list thumbnails, and Campus Wins.
