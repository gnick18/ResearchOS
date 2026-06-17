# Handoff — BeakerAI takeover session (2026-06-15, evening)

Took over the BeakerAI lane after the prior subscription throttled mid-chat. Picked up from `docs/handoffs/2026-06-15-beakerai-session-handoff.md` (the build briefing for A/A2 + the tutor). Coordinated live with the 5 sibling lanes (MobileUI, Phylo, Billing, Popup Unifier, INJEST, Figure Composer) via the CCD `send_message` channel. Memories: `[[project_beakerbot_analysis_picker]]`, `[[project_llm_onboarding_tutor]]`.

**Nothing pushed. Two feature branches + uncommitted layout polish on main. MobileUI holds the shared-tree merge role — ping before landing anything; both branches are based on pre-`f6accc8ba`/`c8f9f820b` main, so rebase onto current origin/main at merge.**

---

## 1. Priority #1 (A + A2) — LIVE-VERIFIED PASS on main ✅

The whole reason this lane existed is now verified against the real model (Claude-in-Chrome on authed :3000, via the `/demo` route since the test folder was empty). Verify prompt: `docs/test-prompts/2026-06-15-beakerbot-fixes-chrome-verify.md`.

- **A — analysis-picker engine-parity (the "suggest-then-refuse" fix): PASS, comprehensively.** XY table correctly offered NO t-test/ANOVA; residual/ROC graphs appeared ONLY when a regression/ROC was saved (confirmed across 3 tables: globalFit-only→none, linear-regression→residual present, ANOVA-only→omitted); clicking "One-way ANOVA" did NOT refuse → correct run card w/ assumption validation → engine ran + saved the analysis object. The final LLM narration was cut by a Fireworks rate-limit outage (infra, not an engine miss).
- **A2 — scroll past inline widgets: PASS** (scrollTop 2855→1855, no snap-back).
- **A2 — object chips open a popup, not navigation: PASS** (chip → Experiments record-set popup OVER the chat, no navigation, page state preserved, Escape closes clean, console clean).

Env notes that bit the verify: empty real folder forced `/demo` (alex fixtures have all needed tables + the real model — demo mode does NOT stub the model, `setModelCallerOverride` is test-only); a Fireworks rate-limit/provider-unreachable outage (shared key under cohort load); and a persistent dev-server "Compiling…" stall (HMR churn from the shared checkout) that lengthened runs.

**Minor follow-up (my lane, NOT a defect):** turn status lingered on "wrapping up…" ~1 min after the chips were already rendered + clickable before flipping to "done" (19s). Status-finalize lag in TurnStatusLine/thinking-status. Needs a healthy live env to investigate.

---

## 2. Picker-driven run stays in chat — branch `feat/picker-result-in-chat` (`f9cf44672`)

The handoff's "optional next": only a PICKER-driven analysis/graph run stays in chat; a typed "run a t-test" still navigates to the result sheet (Grant's locked nuance). Worktree `.claude/worktrees/picker-in-chat`.

- One-turn presentation latch `lib/ai/tools/analysis-presentation.ts` (`setAnalysisResultInChat`/`analysisResultInChat`). `conversation-store.send` gained an additive optional `{ resultInChat }` and arms the latch at the top of every turn it starts (default off → no leak to a later typed run). The 14 navigate sites in `datahub-analysis.ts` route through one `maybeNavigate` gate; `datahub-graph.ts`'s `make_datahub_graph` has an inline guard. Both still RUN + PERSIST the version-controlled result, only the soft-nav is skipped. The picker's `onPick` passes `{ resultInChat: true }`.
- tsc 0; datahub-analysis/graph + conversation-store suites green + a new pin (armed run stores but does NOT navigate). Panel persistence across nav + refresh already exists (dock in root layout + conversation-store binds a persisted thread).
- **GATE: step 4 of the verify prompt — needs the branch checked out on a healthy server + working provider, then merge via MobileUI.** Verifier cannot do the git checkout from the browser; it's deferred.

---

## 3. Onboarding tour live-mount — branch `feat/onboarding-tour-mount` (worktree `.claude/worktrees/tour-mount`)

The tutor is fully built on main behind `NEXT_PUBLIC_ONBOARDING_TUTOR` (off). This session advanced its real app-level mount — **every deterministic/testable piece landed headless; the live-driving + visual pieces are deliberately NOT built blind.** Build plan: `.claude/worktrees/tour-mount/docs/handoffs/2026-06-15-onboarding-tour-mount-build-plan.md`. Increment 1 (TourHost in providers.tsx) was already done (`19e19b3d7`).

- **Increment 4 — tag real controls (`6b6661009`):** `data-tutor-target` on all 7 choreography controls. 3 loop-rendered (datahub "New graph", phylo Export tab, chemistry "New") via an opt-in `tutorTarget?` prop so a shared op id never leaks cross-surface; 4 direct. (+ datahub "Analyze" button tagged `datahub-analyze-button` for the scripted demo cursor, in commit `d394efbd6`.)
- **Increment 2 — decision (`4541ab327`) + resume path + orchestration:** DECISION = reload-into-demo + resume marker, NOT a mid-session service swap (demo's fixture install is init-time at FileSystemProvider mount; reuse the existing `markDemoMode` sticky + `backupRealHandleForDemo`/`restorePreDemoStateOrClear` + `pre-demo-route.ts`). Pure `lib/onboarding/tour-demo-session.ts` (`6fe924242`): save/read/has/clear a `{role, goals, beatIndex, fixtureFlavor}` marker, storage-injectable, clockless, defensive-parse. RESUME (read) PATH COMPLETE (`4967e7cb4`): pure `resumeTutorState` rebuilds the SAME reel + clamps the beat; `OnboardingTutor` gained an optional `initialState`; TourHost reads the marker on mount → forces active so a post-reload/refresh tour resumes, clears on complete. BEGIN/EXIT ORCHESTRATION (`65ed9c3b2`): injectable `beginTourDemoSession` (saveMarker → storePreDemoRoute → hard-nav /demo) + `endTourDemoSession` (restore → clearDemoMode → clearMarker → hard-nav back), ordering unit-tested; READY but intentionally NOT YET INVOKED.
- **Increment 3 — scaffold (`27c079c6b`):** pure `rectInContainer` + `resolveTargetRect` in tutor-target.ts (soft ring needs the control box; center-of-rect == centerInContainer invariant tested) + `LiveCursorLayer.tsx` (transparent fixed inset-0 pointer-events-none real-page analog of ShowcaseStage: rAF player tick, `router.push` surface route on the ARRIVE step, cursor + soft-ring resolved against the layer per target-change + scroll/resize). NOT mounted (OnboardingTutor still renders ShowcaseStage), inert.
- **Increment 5 — scripted AI-demo plan engine (`d394efbd6`):** pure `lib/onboarding/scripted-plan.ts` — SCRIPTED_PLAN (create table → one-way ANOVA → estimation plot on Data Hub → carry onto the tree on Phylo) + stepping reducer (mirrors showcase-player) + `toActivePlan` projection that feeds the REAL `BeakerBotPlanCard` unchanged (verified against its steps/index/status consumption) + cue selectors (route/cursorTarget/narration) for the presenter cursor. The one chat-panel beat, deterministic (no model call, free, never errors).

**tsc 0; 186 onboarding tests green; icon-guard clean.** Demo fixture FLAVOR coupling RESOLVED: the existing `/demo` (alex) fixtures already ship a 4-group Column table ("fakeGFP expression (qPCR)") so the scripted "one-way ANOVA" is honest — no new seeding needed for the tutor.

**REMAINING = the coupled browser pass (do NOT build blind — risks UI rework):** (a) swap ShowcaseStage→LiveCursorLayer for deep_demo beats + transparent overlay; (b) INVOKE `beginTourDemoSession` from the picker "Start the show" behind an opaque "Setting the stage" screen; (c) INVOKE `endTourDemoSession` from TourHost.handleComplete with the real helpers; (d) wire AiDemoBeat to the real card + LiveCursorLayer (onResume/onDismiss); (e) increment 6 (account-vault memory + meter). **Verify via the Chrome loop: A (demo entry/resume) → B (Data Hub overlay) → C (Phylo nav) → D (clean exit).**

---

## 4. Open decisions (waiting on Grant) + queued items

1. **Picker 2-column layout** — UNCOMMITTED in the main working tree (`AnalysisPickerWidget.tsx`): full-width when inline + `@container` root + `grid-cols-1 @sm:grid-cols-2` + `line-clamp-2` hints (kills the right-side whitespace / endless-scroll feel). tsc 0. Awaiting Grant's visual okay, then commit path-scoped to main. (Pure CSS; did not affect the verify, which saw the old single-column picker.)
2. **SmartDataWizard same fix** — it has the identical problem (root capped `w-[440px]` even when inline; single-column TableStep/ColumnStep; GeomStep already uses `grid-cols-2`). BUT it lives in `components/phylo/` = **Phylo's lane, mid-verify.** Decision pending: send Phylo the fix via cdd, or do it myself coordinating first. Do NOT edit it unilaterally.
3. **Ephemeral dev seed** — spun a background chip (`task_585bfe65`); a sub-agent ADDED two Data Hub tables (qPCR Column + Growth-curve XY) to `lib/dev/seed-ephemeral.ts` reusing the real `dataHubApi.create`/`seedDataHubDoc` path, tsc 0 + seed gate 7/7, in its own worktree. Prevents the "Fresh ephemeral session has no tables" trap that blocked the first verify attempt. Sequences via MobileUI.

## Open / next (priority order)
1. Step 3 is done; only **step 4** (picker-in-chat branch) remains on the picker lane — verify on the branch, then merge via MobileUI.
2. Clear the two Grant decisions above (picker layout commit + SmartDataWizard owner).
3. The onboarding **coupled browser pass** (tour increments 2-invoke/3/5-wire/6) — a focused Chrome-loop session.
4. The "wrapping up…" status-finalize lag (minor, my lane).

## Coordination state
- **MobileUI** holds shared-tree merge sequencing. Ping before landing either branch; rebase onto current origin/main first.
- **Phylo** Phase 4 (suggest_tree_overlays) confirmed no conflict with my suggest_analyses (same `_ui` seam pattern, separate tools; only shared surface is conversation-store.send, my change additive). Re-smoke their overlay inline-add after my picker branch merges.
- **Popup Unifier** Phase C git-verified no overlap (providers.tsx not in their list; freshAccount predicate untouched). C1 reset-keep-data verified PASS (relayed to them — kept landing misrouted to me).
- **INJEST** prod-build lesson: adding a route to NAV_ITEMS fails the wiki-coverage prebuild gate (tsc won't catch it) — neither of my branches add a nav route (confirmed).

---

## Continuation — session 5b1dd06f (2026-06-15, 23:48; lost mid-stand-by to token exhaustion)

This second continuation of the lane ran out of tokens while idle-waiting on Grant's picker verify. Recovered by the takeover session via the on-disk transcript. **True end-state of the lane:**

1. **Summary aggregate widget — MERGED to `main` (`b13e0dddb`, confirmed ancestor of HEAD).** `:3032` dev server torn down. DONE, nothing outstanding.
2. **Composer Enter-mid-stream papercut — FIXED in its own spun-off session** (worktree `composer-queue-while-busy`, branch `worktree-composer-queue-while-busy`, commit `95bad3ded`; tsc 0, 1697 AI tests +2 new). Wired the composer into the pre-existing single-slot queue (`b3e9494f9`), textarea stays editable while streaming, empty-Enter no-ops. **Merge OWNED BY MobileUI** (relay sent asking it to *cherry-pick* `95bad3ded` onto local main — base is origin/main, diverged from local main, but the 2 touched files are byte-identical to main HEAD so it applies clean). Not this lane's action.
3. **picker-in-chat — ✅ MERGED to local main `b9691fc91` (2026-06-16), verified PASS.** Grant's Chrome verify on :3033/demo passed BOTH paths (picker click → result stays inline at /workbench, no nav, real ANOVA saved F=274.28 p<0.0001; typed run → navigates to /datahub; both genuinely ran+persisted, console clean). Takeover rebased onto current main (conflict-free) + ff-merged; `:3033` torn down, worktree removed, branch kept for safety. Prior state below kept for the record. Branch was `feat/picker-result-in-chat`, **HEAD `6a0165a52`** before rebase (single clean commit; supersedes the `f9cf44672`/`f9...` shas in the section above after a re-commit). Worktree `.claude/worktrees/picker-in-chat`, **dev server LIVE + warm on `:3033`** (`/demo` 200). 6 files, all in `frontend/src/{components,lib}/ai`. tsc 0. **Re-checked at takeover: NOT literally ff-able anymore** (main advanced with mobile commits up to `81651bde3` *after* the agent's last rebase) **but conflict-free** — merge-base `04644d95d`; none of the 6 picker files were touched on main since; `git merge-tree` shows zero conflict markers. So a rebase onto current main is trivially clean. **GATE = Grant runs step-4 of the verify prompt (picker run stays in chat / typed run still navigates) on `:3033`, then merge via MobileUI.** Verify prompt is reproduced in the takeover chat.
4. **onboarding tour-mount — headless increments built, coupled browser pass NOT built blind.** Branch `feat/onboarding-tour-mount` (`d394efbd6`), worktree `.claude/worktrees/tour-mount`. Increments 1-5 landed (see §3 above). Flagged build+verify, **awaiting Grant's call on whether to scope a focused Chrome-loop session** (do NOT build the remaining invoke/wire/visual pieces blind).

**Decisions still waiting on Grant:** picker 2-column layout polish (no longer dirty in the main working tree — either landed or discarded; not blocking) · SmartDataWizard same-fix owner (Phylo's lane) · whether to scope the tour-mount browser pass now.

### New this takeover — `setup_project` composite (built while standing by on the picker verify)

Grant asked the takeover to pick up an AI backlog item in parallel; chose the open "fully general cross-type composite" from `beakerbot-gui-gaps.md`. Built **`setup_project`**, the project-level analog of `setup_experiment`.

- **✅ MERGED to local main `d2c843a71` (2026-06-16).** Rebased onto current main (conflict-free — neither registry.ts nor system-prompt.ts was touched on main since base), re-verified tsc 0 + 34 tests green, ff-merged; worktree removed, branch `feat/beakerai-setup-project-composite` kept for safety. (Was commit `e9e1c9ab9` pre-rebase.)
- One consent → creates the Project, creates each experiment ALREADY ASSIGNED to that new project (back-to-back via `computeChainDates`), optional finish-to-start `chain`, scaffolds each results file, navigates to the Gantt with all new tasks highlighted (or to the project when no experiments). The back-reference (children → a parent that did not exist pre-call) is the capability the model cannot do by chaining separate `create_*` calls.
- Files: `setup-project.ts` + `setup-project.test.ts` (new), `registry.ts` + `system-prompt.ts` (edits). Pure `computeProjectSetupPlan` core + injectable deps. `action:true`/`isDestructive:false`/own-only/no-interpretation. **24 unit tests green, tsc 0, registry/slash-command tests green (99), house-style clean.**
- NOT browser-verified (it is a tool + headless test; no UI surface of its own — it reuses the existing approval-card + Gantt). Optional live :3000 smoke: ask BeakerBot "set up a cyp51A project with a PCR, a miniprep, and a sequencing experiment, chained" and confirm one numbered preview → project + 3 experiments on the Gantt, all under the new project, linked.
