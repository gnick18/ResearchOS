# Handoff: badge network-page publish path + nudge Phase C (2026-06-20)

Business-lane ("Buisness Boi") session, taking over from the badges + nudge +
pricing-golive lane. Finished the shimmer-nudge pattern (Phase C), then built
badge system Phase 2 end to end: the owner-side foundation, a hard course-correct
when Grant clarified badges are a network-page-only feature, and the full publish
path so a holder's public profile renders real earned + pinned badges. Durable
facts are in agent memory ([[project_badge_system]], [[project_nudge_shimmer_pattern]],
[[feedback_subbot_worktree_isolation]]); this doc is the pick-up pointer.

Everything below is ON ORIGIN (the shared main checkout auto-pushes via other
lanes, so "held for eyeball" commits reached origin on their own). All badge UI is
flag-gated dark behind `NEXT_PUBLIC_BADGES_ENABLED` (off in prod), so nothing is
user-visible until Grant flips it.

## 1. Shipped this session (on origin/main)

### Nudge pattern Phase C (commit `5948ad024`)
Three one-line `useNudge(key, { eligible })` shimmers, reusing `lib/ui/use-nudge.ts`
+ `.ros-nudge-shimmer`: first earned-but-unpinned medallion in `BadgeBin.tsx`,
the literature button in `MoleculeDetail.tsx`, the arrange/align bar in
`FigureComposer.tsx`. Closes the nudge pattern (A + B + C all shipped).

### Badge system Phase 2, the publish path (merge `e5aa24c51`, parent `426a1fa3e`)
Grant decided BOTH holders + a MINIMAL snapshot (earned + pinned ids only, no
counts). A badge is a NETWORK-PAGE feature only, the public page is server-rendered
+ public, so it renders from a server-readable PUBLISHED snapshot, never the local
folder (unreachable) or the E2E account blob (server-blind).

- Shared CONTRACT: `lib/badges/snapshot.ts` (`BadgeSnapshot { earnedBadgeIds,
  pinnedBadgeIds }` + pure `buildBadgeSnapshot` + defensive parse/serialize, 13
  tests), `components/badges/BadgePublicView.tsx` (read-only public render),
  `BadgeEditor.tsx` (controlled owner pinner).
- RESEARCHER holder: `directory_profiles` +2 idempotent text columns
  `earned_badge_ids` / `pinned_badge_ids` (mirror `pinned_works`); threaded through
  the Ed25519 SIGNED PAYLOAD as `earnedBadges=` / `pinnedBadges=` lines, position
  locked after `notifyOnCollabInvite` and before `issuedAt`, IDENTICAL on client
  (`profile.ts buildProfilePayloadBytes`) and server (`signature.ts
  buildProfilePayload`); a sign+verify round-trip test passes. Public render
  `BadgePublicView` on `/researchers/[fingerprint]`; owner pins in `ProfileEditorCard`
  (`SharingSection.tsx`).
- LAB holder: `lab_sites` +1 idempotent col `badge_snapshot_json` (null = no
  snapshot) + new `PUT /api/social/lab-site/badges` (same flag/session/owns-lab/
  entitled auth as the page route); the `[labSlug]` route reads + parses it and
  `LabSitePageView` renders `BadgePublicView` (REPLACING the old `demoBadgeMetrics`
  placeholder); owner pins in `LabSiteDashboard`'s new `LabBadgesSection`.
- Metrics: experiments (`labApi.getExperiments`) + lab tenure (earliest member
  `created_at`) are wired via the pure leaf `lib/badges/metrics-pure.ts` + loader
  `metrics.ts`. `isFounding` / `hasExternalShare` / `hasCompanionSite` deliberately
  stay FALSE with documented wire-points (never-ship-an-unvalidated-number rule).

Merged-tree VERIFIED as its own gate: tsc 0, 582 tests, icon-guard green, both
migrations idempotent + additive + null-safe, payload symmetry confirmed by hand.

### Doc trueup (commit `f7771c694`)
Corrected the prior handoff + AGENTS lane pointer (Phase B was described as
unpushed when it had already reached origin).

## 2. Course-correct worth knowing (commits on origin)

First built badge Phase 2 as an IN-APP `/badges` route with pins in the E2E
account-settings blob (commit `7983b32aab`), per a misread of Grant's "store it
where we store account/dept/inst metadata" answer. Grant corrected: badges are a
NETWORK-PAGE feature, no in-app surface. Reverted the route + the
`AccountScopedSettings.pinnedBadgeIds` field; `lib/badges/pins.ts` back to
localStorage-only behind a load/save seam (commit folded into `5e387dedb`, which
another lane also used to unblock 6 red prod deploys by adding /badges +
/class-materials to the wiki-coverage `EXCLUDED_PREFIXES`). The `/badges` entry in
that exclude list is now dead (route deleted), harmless. See [[project_badge_system]]
for the full arc.

## 3. Git / env state at handoff

- Local main == origin/main, 0/0 in sync (HEAD `2755443c2` at write time; the tree
  moves fast across ~5 lanes). The shared main checkout auto-pushes, so verify
  origin before assuming anything is "held".
- Grant runs main on `:3000` with `NEXT_PUBLIC_BADGES_ENABLED=1` (and
  `NEXT_PUBLIC_SEQ_BOTTOM_BAR_V2=1`) for local eyeballing only, not prod.
- DB FLAG (Grant-approved, "both holders"): on the next prod deploy the idempotent
  migrations add `directory_profiles.earned_badge_ids` + `.pinned_badge_ids` and
  `lab_sites.badge_snapshot_json`. Additive + null-safe, but it is a real prod Neon
  change that runs on first query regardless of the UI flag.

## 4. To eyeball (Grant, :3000, flags on)

- A lab public site (the `[labSlug]` home) shows real earned + pinned badges; the
  lab-site dashboard's badges card pins + publishes.
- `/researchers/[fingerprint]` shows a researcher's published badges; Settings ->
  profile editor pins + publishes.

## 5. Conventions that bit this session

- SPAWN PARALLEL SUB-BOTS WITH `isolation: "worktree"`. The two badge sub-bots were
  spawned WITHOUT it, so they ran in the SHARED main checkout concurrently and
  briefly switched it off main. They edited non-overlapping files and collapsed into
  one verified commit (`426a1fa3e`), but that was luck. See
  [[feedback_subbot_worktree_isolation]].
- Verify the MERGED tree yourself (tsc + tests on the integrated result), not a
  sub-bot's branch-level claim ([[feedback_verify_merged_tree_before_push]]).
- tsc as its OWN gate before commit (the pre-commit hook is icon-guard only).
- House style: no em-dashes, no emojis, no mid-sentence colons, state the WHY.

## 6. Phase 2 follow-ups (queued, not blocking)

- Real wiring for the `isFounding` / `hasExternalShare` / `hasCompanionSite`
  criteria (currently FALSE): founding needs the per-lab founding-cohort record
  (billing go-live FLAG), external-share needs the lab roster to tell external from
  intra-lab, companion-site is server-side (`listPublishedPages`).
- Awarded-grant call-site adapter, BLOCKED on the classroom lane's Stage 3 grant
  record type (contract already agreed, see [[project_badge_system]]).
- labId class-aggregate badges, richer hero graphics + dedicated glyphs (Grant
  sign-off per glyph), and the full catalog (member milestones, open-data, cited,
  open-source contributor, dept-wide aggregates).
