# Dashboard Unification: Home + Lab Overview into One Page

Author: HR (dashboard-unification design), 2026-05-29
Status: design pass for sign-off. Build sequenced AFTER the PI project-widget
family (#85) lands, since that makes Home fully widget-ized (the prerequisite).

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
two surfaces is only: two routes, two layout fields
(`home_layout` / `lab_overview_layout`), two default widget sets, and the
nav label.

## Decisions (signed off)

1. Naming: account-aware nav label. "Home" for solo + member, "Lab Overview"
   for lab_head. Mirrors the existing "Links" vs "Lab Links" pattern.
2. Approach: this short design pass, then build, sequenced after #85.

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
  `labHeadVisible` already gates what each can ADD.

### What gets removed (the supersession)
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

1. #85 project widgets land (in flight): projects become widgets, so Home has
   nothing non-widget-izable left.
2. Build the unification: route collapse + redirect, the `dashboard_layout`
   migration, account-aware label + default sets, and the removals above.
3. Tour copy pass for the now-universal dashboard phase.

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
