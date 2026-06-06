# Dark mode foundation

Status: seeded (token infrastructure landed, no user-facing toggle yet)
Decided: 2026-06-05 (Grant)

## The decision

While unifying the loading screens, we compared three looks for the full-page
loader every user passes through on the way in:

1. The old dark navy slate (blue-only, no brand identity)
2. Light + subtle rainbow, matching the welcome page
3. A new dark-mode look that keeps the rainbow, done for dark

Grant's call: **ship #2 as the default** (the whole app behind the loader is
light, so a light loader is the only one that reads as continuous), and **keep
#3 as the seed of a future site-wide dark mode** rather than throwing it away.

This doc captures #3's spec and the token contract so dark mode is incremental
later instead of a rewrite.

Reference renders (same loader, same copy):

- Shipped light default: `assets/light-loader-shipped.png`
- Dark-mode reference: `assets/dark-mode-loader-reference.png`

## What landed (the foundation)

All in `frontend/src/app/globals.css`. Additive, nothing references the new
utilities yet, so there is zero visual change to the app today.

### Semantic surface tokens

Light values in `:root`, dark overrides in `[data-theme="dark"]`:

| token | light | dark | role |
|---|---|---|---|
| `--surface` | `#ffffff` | `#0a0e1a` | page background |
| `--surface-raised` | `#ffffff` | `#131c2e` | cards, popups, modals |
| `--surface-sunken` | `#f8fafc` | `#0d1424` | subtle insets, gray-50 wells |
| `--foreground` | `#171717` | `#f1f5f9` | primary text |
| `--foreground-muted` | `#6b7280` | `#94a3b8` | secondary text |
| `--border-subtle` | `#e5e7eb` | `rgba(255,255,255,.1)` | hairlines |

`color-scheme` flips light/dark too, so native controls and scrollbars adapt.

### Tailwind utilities

Mapped by reference in `@theme inline` (so they resolve the live CSS var at use
time, which is what lets `data-theme` repaint without recompiling):

- `bg-surface`, `bg-surface-raised`, `bg-surface-sunken`
- `text-foreground`, `text-foreground-muted`
- `border-border` (shadcn-style idiom for the default hairline)

### Rainbow signature in dark

The pastel wash (`--brand-rainbow`) goes muddy on a dark surface, so in dark
mode `--brand-rainbow` and `--brand-rainbow-vertical` switch to the saturated
`--brand-rainbow-vivid` ramp. Every `.brand-rainbow-bg` surface picks this up
for free. In dark, the rainbow reads best as a low-opacity glow (~0.18-0.22),
not a solid fill.

## The dark-rainbow look (spec)

Pulled from the approved mockup so the look survives the screenshot:

- Background: `radial-gradient(130% 90% at 50% -10%, #16203a 0%, #0a0e1a 62%)`
- Vivid rainbow hairline across the top (`--brand-rainbow-vivid`, `h-1`)
- A soft rainbow aura behind the content (vivid ramp, `blur-3xl`, opacity `0.20`)
- Spinner tile keeps the `brand-sky -> brand-purple` gradient, plus a purple
  glow (`box-shadow: 0 10px 44px rgba(91,71,214,.5)`)
- Cards: `rgba(255,255,255,.04)` fill, `rgba(255,255,255,.1)` border
- Primary text `#f1f5f9`, muted `#94a3b8`
- Amber callout: `rgba(251,191,36,.08)` fill, `.32` border, `#fcd34d` heading

## Migration path (when dark mode is prioritized)

This is deliberately NOT done yet. When it is:

1. **Convert surfaces to tokens, area by area.** Swap raw `bg-white` /
   `text-gray-900` / `text-gray-500` / `border-gray-200` for `bg-surface(-raised)`
   / `text-foreground` / `text-foreground-muted` / `border-border`. The loader
   (`StagedLoadingScreen`) is the recommended first surface, it is small,
   self-contained, and we already have its dark spec.
2. **Keep brand accents as-is.** `brand-sky` / `brand-action` / `brand-purple`
   read fine on both surfaces; no dark variants needed.
3. **Add the toggle last**, once enough surfaces are token-driven to look right:
   - A setting that writes `data-theme` to `<html>` (`"light"` | `"dark"` |
     maybe `"system"`).
   - Persist to `localStorage`; restore with a tiny inline `<script>` in the
     document `<head>` so there is no light-flash before hydration (the standard
     no-FOUC pattern).
   - Optionally honor `prefers-color-scheme` for the `"system"` choice. We
     intentionally do NOT auto-dark today, so no one is surprised.

## Why this is cheap later

The brand colors and both rainbows were already centralized as CSS variables
this week, and now the surface/text/border tokens are too. So a future dark
mode is no longer a hunt-and-replace of scattered hex, it is (a) converting
components to the semantic utilities and (b) one attribute on `<html>`.
