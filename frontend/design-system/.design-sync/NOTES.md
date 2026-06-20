# design-sync notes (ResearchOS Design System)

- **Shape = `cards` (off-converter).** This folder is NOT a buildable package or a
  Storybook. It is a curated, hand-authored set of static preview cards already in
  the Claude Design upload layout. There is no `dist/`, no `package.json`, no
  component bundle to compile. The standard converter (`package-build.mjs`) does
  not apply and should not be run here.
- **Sync = direct DesignSync upload.** `tokens.css` (root) + every
  `components/<slug>/index.html`. Each card's first line is a `@dsCard` marker, so
  the pane builds its index automatically; `register_assets` is not needed.
- **Token integrity is the gate.** Verified every `var(--x)` used in the cards
  resolves against `tokens.css` (38 defined, 35 used, 0 undefined). All 16 cards
  carry the marker and link `../../tokens.css`. No external image/script/font refs
  (only inline SVG + data URIs).
- **Geist font is now self-hosted.** `fonts/geist.css` (variable-font subsets
  geist-0..10.woff2, both Geist + Geist Mono, weights 400-800) is `@import`ed as
  the first rule of `tokens.css`, so it travels in the styles `@import` closure
  every card receives. Cards inherit it via `.ds-stage { font-family: var(--font-sans) }`
  in tokens.css. Source = the app's marketing self-host bundle (next/font/google
  origin). `system-ui` remains the fallback. To refresh, re-copy from
  docs/marketing/assets/fonts and re-upload `tokens.css` + `fonts/**`.
- First sync: 2026-06-19. Project id pinned in `.design-sync/config.json` (moved
  from the legacy root `design-sync.config.json`).
- Re-sync 2026-06-19: the original project (`cc5da0e3-...`, "ResearchOS Design
  System") was deleted on claude.ai (get_project 404, list_projects empty), so it
  was recreated fresh as "ResearchOS Design" (`ea7e3892-aa05-4cdd-b035-73c15744522c`)
  and all 29 files (tokens.css + 16 cards + fonts/geist.css + 11 woff2) re-uploaded.
  Token integrity re-verified: 38 tokens defined (size + `-lh` pairs share a line),
  35 used across cards, 0 undefined. No `_ds_sync.json` anchor for the cards shape
  (off-converter); each re-sync re-verifies, which is correct here.
