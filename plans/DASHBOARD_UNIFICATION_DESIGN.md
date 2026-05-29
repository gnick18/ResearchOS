# Dashboard Unification: Home + Lab Overview into One Page

Author: HR (dashboard-unification design), 2026-05-29
Status: design refined, decisions signed off (2026-05-29). #85 (project
widgets) has LANDED. Build sequenced AFTER the focus-mode work (#88) lands,
since both edit the tour step-machine. Note: #85 made projects a WIDGET but
Home STILL renders a separate hardcoded project grid (see "Why this is mostly
collapsing"); removing that grid is now part of this build.

## Goal

Collapse the two dashboard surfaces (Home at `/` and Lab Overview at
`/lab-overview`) into ONE per-user widget dashboard. Everyone gets the same
page; PIs simply have additional widgets available (the lab-aggregation
tiles). The nav label is account-aware: "Home" for solo and member accounts,
"Lab Overview" for PIs (lab_head). One route, one concept.

This is a net SIMPLIFICATION: it supersedes two interim mechanisms shipped
earlier this session (the hide-Home-for-PIs migration and the PI walkthrough
Home-phase skip), both of which exist only because the two surfaces were
redundant-but-separate.

## Why this is mostly collapsing, not rewriting

The widget system is already unified under the hood:
- `SnapshotCanvas` is ONE component parameterized by a `surface` adapter
  (`CANVAS_ADAPTER` / `HOME_ADAPTER`); `HomeCanvas` is a thin wrapper.
- One catalog (`components/lab-overview/widgets/registry.ts`) with
  `surfaces: { canvas, home, sidebar }` flags + `memberVisible` /
  `labHeadVisible` account gating.
- Per-instance config exists (`WidgetInstanceConfig`, e.g. `pinnedMember`,
  and after #85 `projectScope` / `pinnedProject`).

So widget availability + rendering are already shared. What still splits the
two surfaces: two routes, two layout fields
(`home_layout` / `lab_overview_layout`), two default widget sets, the nav
label, AND one structural asymmetry uncovered on 2026-05-29: the Home route
(`src/app/page.tsx`) still renders a hardcoded "Research Project Overview"
project grid ABOVE the widget canvas (`HomeCanvas`), with its own "+ New
Project" button. Lab Overview has no such fixed grid; PIs reach projects only
through the Projects Overview widget that #85 added. #85 made projects a
widget but did NOT remove this hardcoded Home grid, so Home is not yet a pure
widget canvas. The unification deletes that grid so both surfaces are
identical in structure: a single widget canvas, nothing hardcoded on top.

## Decisions (signed off)

1. Naming: account-aware nav label. "Home" for solo + member, "Lab Overview"
   for lab_head. Mirrors the existing "Links" vs "Lab Links" pattern.
2. Approach: this short design pass, then build, sequenced after #85 (now also
   after the focus-mode build #88, since both edit the tour step-machine).
3. Remove the hardcoded "Research Project Overview" grid from Home so Home is a
   pure widget canvas matching Lab Overview (Grant, 2026-05-29).
4. Seed the Projects Overview widget as a DEFAULT for every account type, and
   INJECT it into existing layouts on migration (top position), so deleting the
   hardcoded grid is seamless and no one loses their project view. Users can
   still remove or rearrange it (Grant, 2026-05-29).
5. The Projects Overview widget's My/Lab scope toggle is PI-only. Solo and
   member accounts see only their own projects with NO toggle; lab_head keeps
   the My/Lab toggle. (Grant, 2026-05-29; the widget currently renders the
   toggle for everyone.)

## Proposed design

### Route
- `/` is the canonical dashboard for everyone. `/lab-overview` becomes a
  permanent redirect to `/` (preserve the bookmark target, the 2026-05-23
  rename already set this precedent for `/lab-inbox`).
- The single nav entry points at `/`, label resolved by account type.

### Layout model (data-shape change, FLAG)
- Collapse `home_layout` + `lab_overview_layout` into ONE per-user
  `dashboard_layout` (in `lib/settings/user-settings.ts` +
  `lib/lab-overview/layout-persistence.ts`).
- One-time migration when reading an old metadata record: seed
  `dashboard_layout` from the account-appropriate existing layout (PIs from
  `lab_overview_layout`, everyone else from `home_layout`), then ignore the
  legacy fields. Keep the legacy fields readable for one version for
  back-compat; do not delete them in the same release.
- Per-instance `widgetConfig` carries over unchanged.

### Default widget set
- Account-aware defaults on the one page: solo/member seed with the personal
  set (projects-overview in "my" mode, today/next-up, etc.); lab_head seed
  with the lab set (lab-experiments, lab-notes, trainee-notes, lab-purchases,
  projects-overview defaulting to "lab", etc.). Catalog `memberVisible` /
  `labHeadVisible` already gates what each can ADD. (The project widgets are
  already `memberVisible: true`, so availability needs no change.)
- Projects Overview is seeded as a default for EVERY account type, at the top
  of the canvas, so it replaces the deleted hardcoded grid 1:1. On migration,
  INJECT a Projects Overview instance at the top of any existing layout that
  does not already have one, so existing users do not open the dashboard to a
  missing project view. Users can remove or rearrange it afterward.

### Projects Overview scope toggle: PI-only
- The widget currently renders the My/Lab toggle for everyone
  (`ProjectsOverviewWidget.tsx`, the toggle comment says it "ALWAYS renders").
  Gate it: render the toggle only when the viewer is `lab_head`. Solo and
  member accounts get "my" scope with no toggle (for solo there is no lab, so
  "my" is the only meaningful scope anyway; for a member, "lab" scope is
  intentionally withheld per Grant). `resolveScope` should force "my" for
  non-lab-head viewers regardless of any stored `projectScope`, so a member who
  previously flipped a canvas instance to "lab" does not retain lab scope.

### What gets removed (the supersession)
- Hardcoded Home project grid (`src/app/page.tsx`): delete the "Research
  Project Overview" section (the project cards grid + its "+ New Project"
  button + the "N active projects / N active tasks" subhead) that renders above
  `HomeCanvas`. Its job is now the Projects Overview widget (which has its own
  inline New Project flow). After removal Home renders only the widget canvas,
  structurally identical to Lab Overview. Preserve the "+ New Project" entry
  point: it survives inside the Projects Overview widget, so no creation
  affordance is lost.
- Hide-Home migration (commit d46ab8b0): remove `showHomeForLabHead` (settings
  + store), the AppShell `showHomeTab` gating, the `page.tsx` lab_head ->
  `/lab-overview` landing redirect special-case, and the Settings "Show Home
  page" toggle. There is one dashboard at `/`; everyone lands there.
- PI walkthrough skip (commit 8f4afadd): remove `PI_SKIPPED_HOME_PHASE_STEP_IDS`
  and its `isStepGatedOut` clause. With one dashboard, every account walks the
  same dashboard-canvas phase. Reframe the section 6.1 to 6.3 copy from
  "your personal Home" to "your dashboard" so it reads correctly for PIs.
- Landing-redirect tour guard (commit 5323bb7b): re-evaluate. With no
  lab_head landing special-case, the guard may be unnecessary; the
  account-aware glide target (`homeOrLabOverviewNavSelector`) collapses to a
  single dashboard nav tab. Keep whatever is still load-bearing; drop the rest.

### Tour
- The walkthrough's dashboard phase becomes universal again (no PI gate). Net
  re-simplification of the tour we just special-cased. This also keeps the
  door open for the eventual dedicated PI tutorial without a Home/Lab-Overview
  split to reconcile.

## Sequencing

1. #85 project widgets: LANDED. Projects are now a widget, but Home still has
   the hardcoded grid (removed in step 2).
2. Focus-mode build (#88): in flight. It adds two tour steps to the same
   `step-machine.ts` this build edits, so the unification waits for it to land
   to avoid a step-machine collision.
3. Build the unification: delete the hardcoded Home grid + seed/inject the
   Projects Overview widget + PI-gate its scope toggle, route collapse +
   redirect, the `dashboard_layout` migration, account-aware label + default
   sets, and the removals above.
4. Tour copy pass for the now-universal dashboard phase.

## Risks

- Layout migration: merging two layouts into one must not drop a PI's existing
  lab-overview arrangement or a member's home arrangement. Seed from the
  account-appropriate one; test both directions.
- Re-touching the tour: we just gated the Home phase for PIs; un-gating it is
  low-risk (deleting a gate) but needs a walkthrough re-verify for a PI
  account (no bounce, correct copy).
- Back-compat: `/lab-overview` redirect; old metadata records with only the
  legacy layout fields.

## Open questions for sign-off

1. Canonical route: `/` (recommended) vs `/lab-overview` as the kept one.
2. Layout migration: one `dashboard_layout` (recommended) vs keep both fields
   and just render one. The former is cleaner; the latter is lower-risk but
   leaves dead state.
3. Do we remove the Settings "Show Home page" toggle entirely, or repurpose it?
   (Recommended: remove; there is only one dashboard.)
