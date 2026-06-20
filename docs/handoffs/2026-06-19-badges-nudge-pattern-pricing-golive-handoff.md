# Handoff: badge system + shimmer-nudge pattern + pricing go-live (2026-06-19)

Business-lane ("Buisness Boi") session. Built the GitHub-style badge system, the
app-wide "shimmer to nudge discovery" pattern, took public pricing live, redid the
transparency page, audited + fixed the marketing pages, and coordinated four other
lanes. Durable facts are in agent memory ([[project_badge_system]],
[[project_nudge_shimmer_pattern]], [[project_published_validation]]); this doc is
the pick-up-where-I-left-off pointer.

## 1. IMMEDIATE in-flight (do these first)

### Phase B of the nudge pattern (RUNNING in background)
- Sub-bot building the sequence-editor SINGLE/DOUBLE-CLICK model in worktree
  `.claude/worktrees/seq-nudge-phaseb`, branch `feat/seq-nudge-phaseb`. agentId
  `aae4967ef61ce95fa` (resume via SendMessage if needed).
- Behavior: single-click a feature selects it AND shimmers the relevant rail op
  (coding -> Protein, primer -> Primers, a decent-length region -> Cut/enzyme),
  NEVER auto-opens; double-click opens that panel directly and retires the nudge.
  Also converts the primer's old auto-open (`autoOpenOpForKind("feature-primer")`)
  to the new model.
- NEXT: when its task-notification fires, read the Agent result (do NOT read the
  .output transcript), review the diff (the feature double-click handler + the
  per-kind `useNudge` map in `SequenceEditView.tsx` are the risky bits), run tsc +
  `vitest src/lib/sequences src/lib/ui` + icon-guard, then merge to local main.
  Bundle with Phase A for Grant to eyeball on `/sequences` (his .env.local has
  `NEXT_PUBLIC_SEQ_BOTTOM_BAR_V2=1`), then leave the push to Grant. Sweep the
  worktree + branch after merge.

### Phase C of the nudge pattern (NOT started)
- The starter batch as one-line `useNudge(key, { eligible })` calls (see
  [[project_nudge_shimmer_pattern]] for the ranked audit): (1) unpinned earned
  BADGE shimmers in `components/badges/BadgeBin.tsx` (the `earned && !pinned`
  medallion) to invite pinning; (2) MOLECULE selected -> shimmer the literature
  button in `components/chemistry/MoleculeDetail.tsx`; (3) FIGURE panel selected
  -> shimmer the Arrange/align bar in `components/figure/FigureComposer.tsx`. Plus
  optional Data Hub fresh-table -> "Run analysis". Reuse `lib/ui/use-nudge.ts` +
  `.ros-nudge-shimmer`. Wait for Grant's go on Phase B first.

## 2. Shipped this session (on origin/main, done)

- **Pricing founding rate, LIVE**: lab is a `$25` FOUNDING lock-in rate (lifetime
  for founding labs, no `$40` anchor), solo `$3`, dept is contact/TBD with a
  `/departments/contact` reach-out form (emails gnickles@wisc.edu; research-os.app
  inbound is blocked until ~late Aug). `isPricingLive()` is now LIVE BY DEFAULT
  (commit `33ab3ed6c`; set `NEXT_PUBLIC_PRICING_LIVE=false` to re-hide). Config:
  `FOUNDING_LAB_BASE_CENTS` in `lib/billing/model-a/pricing.ts`; the public price is
  a catalog override in `lib/billing/catalog.ts` while `MODEL_A_PLANS` stays the
  engine/operator steady-state. FLAG: the lifetime lock-in needs a per-lab
  founding-cohort record at billing go-live (billing is OFF in beta).
- **Badge system v1**, flag-off behind `NEXT_PUBLIC_BADGES_ENABLED`: catalog +
  pure earning engine + medallions + shelf/bin + `/dev/badges` showcase + a
  flag-gated section on the demo-lab profile. Real glyphs `globe` / `medal` /
  `rosette` (Grant sign-off) in the icon registry. Classroom-aligned `awarded`
  criterion. Pins = localStorage only. See [[project_badge_system]].
- **Nudge pattern Phase A**: `lib/ui/use-nudge.ts` (`useNudge` + `markNudgeUsed`,
  throttle = shimmer until seen 4x or clicked, then stop nagging), one canonical
  `.ros-nudge-shimmer` sky class, the 3 fragmenting shimmers consolidated. The
  Cmd-J BeakerBot chip KEEPS its own rainbow (`beakerbot-ai-shimmer`), it is an AI
  affordance not a nudge (commit `ae858f57a` restored that after the consolidation
  wrongly unified it).
- **Protein-shimmer + seq-bottom-bar v2** (seq editor): selecting a gene of
  interest shimmers the Protein op instead of auto-opening; bottom bar is
  flag-off (`NEXT_PUBLIC_SEQ_BOTTOM_BAR_V2`).
- **Transparency `/transparency` redesign** (scorecard + grouped rail +
  summary-first + hybrid spotlight + independent scroll + rail-coverage) AND the
  floating-point-noise classifier fix (`numericallyExact`, relative 1e-6). See
  [[project_published_validation]].
- **Marketing-page audit + fixes**: /ai cost copy ("small markup over compute",
  not "at cost"), /departments lab-site domain (.com not .app), /about + /terms
  Model-A framing, brand-token cleanup, PRICING.md un-staled.
- **Icon Lib /admin IA redesign** merged + verified (my catalog constants + the
  Finances panels render on their new nav).

## 3. Git / env state at handoff

- Local main `0f7ef92a5`, currently 1 BEHIND origin (the SHARED main checkout is
  used by ~5 sessions; other lanes push main, which often carries my "held"
  commits up too, so verify before assuming anything is unpushed). Reconcile with
  `git fetch && git merge --ff-only origin/main` BEFORE working.
- DIRTY TREE, not mine: another lab-view lane has uncommitted work
  (`workbench/page.tsx`, `lab-overview/LabOverviewPage.tsx`, `lib/lab/lab-read.ts`,
  `lib/lab/lab-view-materialize.ts`). LEAVE these alone; never `git add -A` or
  `git stash`. Stage explicit paths only.
- Grant runs main on `:3000`; his `frontend/.env.local` has
  `NEXT_PUBLIC_SEQ_BOTTOM_BAR_V2=1` + `NEXT_PUBLIC_BADGES_ENABLED=1` for local
  eyeballing only (not prod).
- Active worktree: `seq-nudge-phaseb` (Phase B).

## 4. Conventions to carry (the ones that bit this session)

- Run `npx tsc --noEmit` as its OWN gate BEFORE committing; the pre-commit hook is
  icon-guard ONLY, not tsc, so a JSX typo can commit clean and break Grant's :3000.
- New icon glyphs are verified assets needing Grant sign-off; add ONE registry
  entry (path content, no new `<svg>` element, so icon-guard stays green).
- Behavioral (non-flag-gated) changes: merge to local main on a clean report,
  Grant eyeballs on :3000, push only on his explicit "push".
- Grant's house style: no em-dashes, no emojis, no mid-sentence colons, sentence
  case, state the WHY, BeakerBot is the only mascot, brand tokens not raw hex.

## 5. Coordination (other lanes, all settled)

- Classroom lane (`local_8a4eb49b`): awarded-grant transport CONTRACT locked (a
  per-student shared record under the instructor owner-prefix, shared_with the
  student, encrypted under the class team key; the badge call-site adapter reads
  grants -> awardedBadgeIds). They PING this lane when their Stage 3 grant record
  type lands; wire the adapter together then. Class id = labId, holder = account
  identity, no new holder type.
- Billing/account lane (`local_982220af`): the admin-grants test tsc error is
  FIXED on origin (`2289664a7`).
- Icon Lib (`local_02d3d6e9`): /admin redesign merged + verified.

## 6. Grant's open decisions (not blocking, his call)

- `/about` maintenance gate: Grant said DO NOT flip it yet (only /pricing went
  live). Gate is `ABOUT_LIVE` in `app/about/page.tsx`.
- `/terms` is a live legal page still self-labeled "DRAFT pending review" in code,
  worth confirming its status.
- Badge phase 2 (persistence + network snapshot publish + earning metrics +
  awarded-grant transport), founding-rate lock-in enforcement at billing go-live,
  and growing the badge system (more badges + custom hero graphics) are queued.
