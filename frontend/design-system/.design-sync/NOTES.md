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
- **Geist font is not bundled.** Cards fall back to `system-ui`. Acceptable for a
  token preview; revisit only if exact Geist rendering is required in the pane.
- First sync: 2026-06-19. Project id pinned in `design-sync.config.json`.
