# Dark mode toggle, comprehensive proposal

Status: proposal (foundation already seeded, see dark-mode-foundation.md)
Author: master orchestrator / branding arc
Date: 2026-06-05

## 1. What we are building, and what we are not

A user-facing setting that switches the whole app between light and dark, with
the preference remembered across sessions and, ideally, across pages that today
have nothing to do with the app shell (the public wiki especially).

Hard requirements from Grant:

- **The welcome page never goes dark.** It is a tuned, video-and-illustration
  sell page; it stays light always, regardless of the user's preference.
- **Everything else honors the preference**, including the wiki, eventually.
- **Legibility is non-negotiable.** Text is the easy 20%. The real work is that
  graphics, gradients, charts, illustrations, and embedded screenshots that look
  right on white do not automatically look right on near-black. This is not a
  recolor-the-text job; several surfaces need a purpose-built dark palette.

Non-goals for v1: per-component theme overrides, high-contrast/accessibility
themes beyond AA, automatic time-of-day switching, theming the marketing
landing page (`/` LandingPage) if we decide to treat it like welcome.

## 2. Why this is bigger than flipping text colors

A grep of the current tree:

- 748 `.tsx` components
- ~256 files hardcode `bg-white`, ~284 hardcode `text-gray-{700,800,900}`,
  ~261 hardcode `bg-gray-{50,100}`, ~243 hardcode `border-gray-{200,300}`
- 63 wiki `page.tsx` files
- ~120 screenshots / graphic PNGs under `public/`, most embedded in the wiki
- Hardcoded `fill="#..."` / `stroke="#..."` in the chart + sequence surfaces
  (GanttChart, LabGanttChart, LabActivityWidget, transparency SequenceMatch,
  the sequences/* viewers), plus the third-party OVE / SeqViz sequence editor
  which themes on its own terms

So the mechanical text/surface sweep alone is a few hundred files, and that is
the *easy* tier. The screenshots and charts are the part that can look broken if
we are naive about it (a light screenshot dropped into a dark page reads as a
glowing white slab).

## 3. The mechanism (already half-built)

`dark-mode-foundation.md` landed the core contract in `globals.css`:

- Semantic tokens (`--surface`, `--surface-raised`, `--surface-sunken`,
  `--foreground`, `--foreground-muted`, `--border-subtle`) with light values in
  `:root` and dark overrides in `[data-theme="dark"]`, mapped by reference in
  `@theme inline` so `bg-surface` / `text-foreground` / `border-border` flip when
  one attribute on `<html>` changes.
- The rainbow signature swaps to the saturated vivid ramp in dark.
- `color-scheme` flips so native controls and scrollbars adapt.

So the activation primitive is settled: **set `data-theme="dark"` on
`<html>`**. The rest of this proposal is (a) where the preference lives, (b) how
we keep it from flashing, (c) how we make every surface legible, and (d) how we
roll it out without shipping a half-dark app.

## 4. Where the preference lives (storage + public pages)

ResearchOS already has a dual-storage precedent (the markdown editor width
preset): a synchronous `localStorage` copy for instant first paint, plus the
durable per-user record in `users/<u>/settings.json`. Theme should follow the
same shape, with one important asymmetry.

**Primary source: `localStorage` (per device).** Theme is a display preference
tied to the screen you are looking at, not to your research data. A user may
want dark on their laptop at night and light on the lab projector. localStorage
is also the *only* source available on the public pages (welcome, wiki, auth)
where no research folder is open. So localStorage is authoritative for what to
paint.

**Optional durable mirror: `settings.json`.** When a folder is open, mirror the
choice into `users/<u>/settings.json` under a new `theme` key so a brand-new
device can inherit the user's last app-side choice on first load. This is a
convenience sync, not the source of truth. (Local-first, so this never leaves
the disk.)

**System preference: the third option.** Offer `light | dark | system`. `system`
defers to `prefers-color-scheme`. We do NOT silently auto-dark anyone who never
opened the setting; the stored default is explicit `light` until they choose
otherwise, so nobody is surprised. (We can revisit defaulting to `system` once
the dark surfaces are proven.)

Resolution order at load: explicit stored choice (localStorage) wins; if it is
`system` or unset-and-we-decide-to-honor-system, fall back to
`prefers-color-scheme`; final fallback `light`.

## 5. No flash of the wrong theme (FOUC)

The killer bug in every hand-rolled dark mode is the white flash before React
hydrates. Fix with a tiny synchronous inline `<script>` in the document
`<head>` (in `app/layout.tsx`) that reads localStorage and sets
`data-theme`/`color-scheme` on `<html>` *before first paint*:

```html
<script>
  try {
    var t = localStorage.getItem('researchos-theme') || 'light';
    if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.setAttribute('data-theme','dark');
    document.documentElement.style.colorScheme = t;
  } catch (e) {}
</script>
```

This runs on every route, including the wiki and auth, so the preference is
respected everywhere uniformly with no flash. A small `useTheme` hook then keeps
React state in sync and writes changes back.

## 6. The surface taxonomy (the real plan)

Every surface in the app falls into one of five tiers. The work is sorting them
and handling each tier's mechanism. This is where "entire color palettes per
page" gets concrete.

### Tier A — Token-drivable (the mechanical sweep)

Plain surfaces, text, borders. The fix is find-and-replace to the semantic
utilities:

| from | to |
|---|---|
| `bg-white` | `bg-surface-raised` (cards) or `bg-surface` (page) |
| `bg-gray-50` / `bg-gray-100` | `bg-surface-sunken` |
| `text-gray-900` / `-800` | `text-foreground` |
| `text-gray-500` / `-600` | `text-foreground-muted` |
| `border-gray-200` / `-300` | `border-border` |

~250-300 files, but low-risk and reviewable. These look identical in light (the
tokens equal today's values) and correct in dark for free. This is the bulk by
file count and the smallest by difficulty.

### Tier B — Brand accents (define the dark values)

`brand-sky`, `brand-action`, `brand-purple`, the `.btn-brand` gradient. These
mostly read fine on both surfaces, but two checks:

- `brand-action` (#1283C9) is tuned for AA on *white*. On near-black it is still
  legible but may want a brighter dark-mode variant (e.g. a `--accent` token
  that is brand-action in light and a lighter sky in dark) for links and small
  text. Define `--accent` / `--accent-strong` tokens rather than hardcoding.
- `brand-sky` (#1AA0E6) is already too low-contrast for small text on white; on
  dark it actually improves. Keep using it for marks/decoration only, same rule.

Deliverable: an accent token pair with light+dark values, plus a one-time audit
of `.btn-brand` on dark (the gradient is dark enough that white text still
passes, but confirm).

### Tier C — Bespoke dark treatment (graphics that do not translate)

These cannot be token-swapped; each needs a designed dark variant.

- **Rainbow / gradients.** Already seeded (vivid ramp in dark). Audit every
  `.brand-rainbow-bg` use: as a thin hairline it pops; as a large fill it needs
  lower opacity on dark. Make a `.brand-rainbow-bg` + opacity convention.
- **Charts (Gantt, LabActivity, transparency).** They hardcode hex `fill` /
  `stroke`. Introduce a small **chart palette** of tokens (grid lines, axis
  text, series colors, "today" marker) with light+dark values, and refactor the
  charts to read them. Series colors especially need dark-tuned versions
  (saturated mids that survive on near-black). This is real per-chart work.
- **BeakerBot SVGs.** The mark is sky-blue line art designed against white. On
  dark it mostly holds (sky on near-black is fine), but check the white facial
  highlights / any white fills that vanish on dark. May need a `currentColor`
  pass or a dark-aware stroke. Inventory every BeakerBot pose used outside
  welcome.
- **Markdown prose + code.** The note/method/experiment editors render prose and
  syntax-highlighted code. Needs a dark prose theme (the `.prose` overrides in
  globals.css) and a dark code-highlight palette. Treat the editor as its own
  themed island with explicit dark tokens.
- **Photo annotations (react-konva overlays).** Annotation colors are user-set
  over a photo; the *chrome* around the canvas themes, but the canvas + photo
  stay as-is (a photo is a photo). Theme the toolbar, not the image.

### Tier D — Themed islands we force-light (acceptable compromises)

Some surfaces are not worth a bespoke dark variant in v1 and look fine as a
light "card" inside a dark page, as long as we frame them so they read as
*content*, not a broken surface.

- **The third-party sequence editor (OVE / SeqViz).** It themes on its own
  terms and re-theming it is a project unto itself. For v1, render the sequence
  canvas in a force-light frame (a `LightOnly` wrapper, see below) with a clear
  border so it reads as an embedded tool. Revisit native dark later.
- **Embedded screenshots in the wiki (120 of them).** A light screenshot is a
  light screenshot. Do NOT try to invert or filter them (filters wreck color
  fidelity). Instead, wrap each in a neutral framed figure (subtle border +
  `--surface-sunken` mat + rounded corners) so on a dark page it reads as a
  framed photo, not a glowing slab. Hero screenshots can later get dark-mode
  recaptures (via `?wikiCapture=1` with `data-theme=dark`) if we deem them worth
  it, but framing is the v1 answer for all 120.

### Tier E — Permanently light (never themed)

- **The welcome page** (Grant's rule). Wrap it in `LightOnly`; it ignores the
  global theme forever.
- **Demo videos** (real-UI light captures) live on welcome, so they ride along
  as light. Any demo video reused on a dark surface gets the same framed-figure
  treatment as screenshots.
- Optionally the marketing landing page (`/`), TBD, likely same as welcome.

## 7. The `LightOnly` escape hatch (also the rollout safety valve)

A wrapper component that force-locks its subtree to the light palette even under
`data-theme="dark"`:

```css
[data-theme="dark"] .light-scope {
  color-scheme: light;
  --surface: #ffffff; --surface-raised: #ffffff; --surface-sunken: #f8fafc;
  --foreground: #171717; --foreground-muted: #6b7280; --border-subtle: #e5e7eb;
  --brand-rainbow: /* pastel */; --brand-rainbow-vertical: /* pastel */;
}
```

`<LightOnly>` just adds `.light-scope`. Three jobs:

1. **Permanent** on welcome (Tier E).
2. **Framing** embedded screenshots and the sequence editor (Tier D) so they
   stay correct inside dark pages.
3. **Rollout safety.** Any page not yet converted gets wrapped in `LightOnly`
   so it renders cleanly light even when the user picked dark, instead of
   showing a broken half-dark page. We remove the wrapper as each page is
   converted and verified. This is what lets us ship the toggle before all 748
   components are done, the toggle works, and un-converted areas simply stay
   light until their turn.

## 8. Legibility guardrails

Legibility is the acceptance criterion, so make it testable, not vibes.

- **Every text token must hit WCAG AA (4.5:1 normal, 3:1 large) against its
  paired surface, in both themes.** `--foreground` / `--foreground-muted` on
  `--surface` / `--surface-raised` / `--surface-sunken`, plus `--accent` on each.
- **Add a contrast-audit vitest** that computes the ratios for every
  token-on-surface pair in both themes and fails the build if any drop below AA.
  We already have a precedent for a pure-function-backed gate (the
  `/transparency` `buildTransparencyReport()` test), so mirror that pattern with
  a `buildContrastReport()`.
- **Keep the `brand-sky` caveat encoded** (decorative only, never small text)
  in both themes.
- Manual dark sweep of the heavy surfaces (editors, charts, sequence pane,
  dashboards) on a real account before flipping the default.

## 9. Phased rollout

Each phase is shippable; the toggle can exist from Phase 2 because `LightOnly`
keeps un-converted areas safe.

- **Phase 0 (done).** Token foundation + dark-rainbow reference (landed).
- **Phase 1, accent + chrome tokens.** Add `--accent` / `--accent-strong`, the
  chart-palette tokens, and the dark prose/code palette. Wire the contrast-audit
  test. No visible change yet.
- **Phase 2, the toggle + the shell.** Inline no-FOUC script, `useTheme` hook,
  the `light | dark | system` setting in Settings, localStorage + settings.json
  mirror. Convert the app shell (AppShell, nav, sidebar, top-level page chrome)
  to tokens. Wrap everything not yet converted in `LightOnly`. Ship: dark works
  for the shell; deeper pages still light.
- **Phase 3, core surfaces.** Convert the high-traffic interiors: notes/methods/
  experiments editors (+ dark prose), the inbox, settings, lab overview +
  widgets, trash, links. Recolor the charts. Remove their `LightOnly` wrappers
  as each is verified.
- **Phase 4, the wiki.** Convert the 63 wiki pages (mostly Tier A text/surface
  plus the framed-figure screenshot treatment). Welcome stays `LightOnly`.
- **Phase 5, the long tail + sequence editor.** Remaining dialogs and the
  decision on native dark for the sequence editor vs keeping it a light island.
- **Phase 6, polish + maybe default to `system`.** Once everything is proven.

## 10. The toggle UI

A segmented `light | dark | system` control in Settings (Appearance section),
plus optionally a quick toggle in the app header overflow menu. Reuse the
segmented-control pattern we just built for the share dialog so it is consistent.
Writes through `useTheme`, which updates `<html>`, localStorage, and (when a
folder is open) settings.json.

## 11. Risks and open questions

- **Screenshots are the biggest cost.** Framing all 120 is the cheap path;
  dark-mode recaptures are a real project. Recommend framing for v1, recapture
  only the handful of hero shots if at all. (Open: is framing visually good
  enough for the wiki's screenshot-heavy voice? Needs a mockup.)
- **Sequence editor native dark** is the biggest unknown (third-party). Light
  island is the safe v1 answer. (Open: how bad does the light island look on a
  dark sequences page? Needs a look.)
- **The mechanical sweep is large and touches hot files** (editors, sequences,
  onboarding) that other arcs edit. Coordinate so the token sweep does not
  collide; do it area-by-area in step with whoever owns each tree, same as the
  typography normalization is being run.
- **Charts** need dark-tuned series palettes that still encode meaning (status
  colors, member colors). Picking those is design work, not mechanical.
- **Do we theme the marketing landing page (`/`)?** Proposed: treat like
  welcome (permanently light) unless we want a dark landing.

## 12. Recommendation

Approve Phases 1-2 to get a working, safe toggle (shell-level dark + the
`LightOnly` safety valve), then convert surface areas incrementally behind it.
The architecture already supports it; the gating cost is the per-surface graphics
work in Tier C/D, which we pay down page by page rather than in one risky
big-bang sweep. Welcome and embedded light media stay light by design, so the
"must stay legible" bar is met at every step instead of being a final-day
scramble.
