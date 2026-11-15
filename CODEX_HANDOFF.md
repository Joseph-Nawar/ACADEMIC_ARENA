# Codex handoff — Academic Arena V6

**Preserve the V6 visual direction exactly.** Comic varsity characters and independently rendered 3D Cartoon family. Hero podium, gold crown ABOVE the winner's head, clear EUE header, minimalist leaderboard, Campus Wins. Avoid gradients, glassmorphism, generic card grids, social comments, photo uploads, grades/scores in published JSON.

## What has actually been built

- Working static V6 demo retaining all existing gamification visuals.
- Separate 2D and 3D nine-character families, selectable per user. NOT full modular sliders for hair/face/outfits yet (presets only).
- Runnable FastAPI pilot API and SQLite storage; isolated authentication, staff-issued accounts, first-password change, server-owned avatars, published snapshot reader, pending/approved Campus Wins, authenticated reactions, staff review, and CSV import with approval gate.
- Automated API smoke tests and desktop/mobile visual tests through an intercepted Chromium static render. No public hosting or real university accounts yet.

## Your task after visual sign-off

1. Audit the entire V6 repo, running smoke tests before changing anything; preserve all existing visuals. Report findings by severity.
2. Finish production hardening: PostgreSQL migrations, distributed throttling, secure deployment, content management, password recovery/reset, session management, structured logs/audit trail, data retention and account deletion, monitoring/backups.
3. Replace draft EUE wordmark with university-provided approved logo asset; do not independently invent/trademark an EUE mark.
4. Get secure approved official roster/group/module selection and a **separate publication-approved rank snapshot**, never publish grades, Academic Scores, student IDs, or raw attendance. Clarify rank disclosure approval.
5. Implement authenticated account ownership and moderator administrative tools with comprehensive integration tests and explicit user security acceptance criteria.
6. Test all flows visually in actual browser at 390px/768px/1440px. Preserve the first-place crown placement and ensure full character heads remain visible.
7. Do not deploy to a public URL until university IT/security reviews and owner authorizes launch.

The current backend is a pilot starter and is **NOT asserted to be market-ready or production-secure**.
