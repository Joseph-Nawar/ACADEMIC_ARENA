# Avatar library: current state and expansion contract

## Current library (shipped, reviewed 2026-11-18)

There are 9 characters (`omar`, `mariam`, `youssef`, `amara`, `tariq`, `habiba2`, `malek`, `nour2`, `zein`). Each has two hand-illustrated raster families, Comic Original (`ink`) and 3D Cartoon (`cartoon3d`). Students also choose 6 backdrops and 5 stickers.

Honest gaps against the V1.2 inclusion goals:

- Skin tones range from light to medium-brown. No character has a dark skin tone.
- There is one headscarf look (`habiba2`: one design, one colour, one face).
- Hair textures include curly, coily-short, wavy and straight, but they are spread over only 9 fixed people.
- `zein` (3D) uses a wheelchair.

These gaps cannot be closed with code. The art is flat raster illustration, and recolouring skin, hair or scarves with filters gives unnatural results. The V1.2 brief forbids that. No image-generation tooling that matches this art was available in this repository, so **no new artwork was added**. Low-quality or inconsistent variants were not released to meet a count.

## Default board artwork (V1.3)

Ranked students without a verified, opted-in character are shown as anonymous competitors: faceless hooded figures in `assets/competitors/`, made by `scripts/generate-competitors.mjs`. They are not selectable characters and never appear in any allowlist.

## What is ready for new art

- Selection is the student's choice only. Nothing is inferred from names, emails, gender or religion, and nothing is pre-selected.
- The server and SQL allowlist every key. Students cannot send paths, URLs, SVG or markup.
- Student opt-in, verified links, the public projection and default-off switches all work with any allowlisted character key.

## Adding characters

Follow `avatar-artwork-spec.md`, which covers art direction, diversity targets, delivery sizes and the exact integration and test steps. `tests/frontend/avatar-assets.test.mjs` enforces the file formats and identical allowlists.
