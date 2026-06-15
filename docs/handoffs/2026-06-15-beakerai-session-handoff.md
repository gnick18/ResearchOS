# Handoff — BeakerAI session (2026-06-15)

**Lane:** BeakerAI. **Branches:** everything below is on **`main`** unless noted; the onboarding live-mount work is on the worktree branch **`feat/onboarding-tour-mount`** (`.claude/worktrees/tour-mount`).

Two big arcs this session: (A) the BeakerBot analysis/graph picker + three chat bug fixes, and (B) the LLM onboarding tutor (built earlier) + the start of its real app-level mount. Memories: `[[project_beakerbot_analysis_picker]]`, `[[project_llm_onboarding_tutor]]`.

---

## A. BeakerBot analysis/graph picker — DONE on main (needs live verify)

The fix for "Beaker suggests an analysis then refuses it." ONE constraint-aware engine, doors share it.

- **Engine** `lib/datahub/table-capabilities.ts` (`c129f9044`, parity fix `c4e546298`): `tableCapabilities(content) -> { analyses, graphs }`, every item runnable. Analyses reuse `validAnalysisTypes`; graphs are `plotKindsForTable` / `validPlotKinds`. Diagnostic plots (residual/ROC) are analysis-gated via `findRegressionAnalysis`/`findRocAnalysis` (matches NewGraphDialog exactly). Labels compiler-enforced via `Record<AnalysisType|PlotKind>`.
- **Chat tool + seam** (`a368fc8c7`): `suggest_analyses` (resolves open/named table via context-bridge `selection.type "datahub-table"`, narrates only valid options, registered in DEFAULT_TOOLS) + `analysis-picker.ts` `_ui` seam.
- **Widget + wiring** (`0f478e3ba`): `AnalysisPickerWidget.tsx` (ONE widget, `focus` "both"|"analyses"|"graphs", inline-scroll-safe) + conversation-store lift + BeakerBotConversation mount; pick -> `send("Run the X on TABLE")`, no navigation.
- **GUI dedup** (`ed94f9f38`): NewGraphDialog now imports the engine's `findRegression/findRoc` (one source). `GuidedAnalysisWizard` needs NO dedup (it's a `planAnalysis` recommender with a `runnable` guard, safe by construction). Bigtable `DatasetAnalysisDialog` is correctly separate (schema-based, not archetype) — deliberately NOT touched.

**Design (Grant-locked):** "Plot this" / "Analyze" GUI buttons are just `focus` modes onto the same widget if ever wanted; do NOT replace the richer existing GUI wizards (downgrade).

## A2. Three chat bug fixes — DONE on main (need live verify)
- **Chat scroll past inline widgets** (`43486f702`): SmartDataWizard got an `inline` prop (drops its internal `max-h/overflow-y-auto` so the chat owns the scroll); auto-scroll now sticks-to-bottom-only-when-near-bottom.
- **Object chips open a popup, not navigate** (`0af1e8c83`): `ObjectChip` click reads the ref id from `parseObjectDeepLink` OR `parseObjectEmbed`, opens via the chip's own type, so an embed-form chip never falls through to `router.push`.

**Verify all of A/A2 with:** `docs/test-prompts/2026-06-15-beakerbot-fixes-chrome-verify.md` (needs the live model on authed :3000; the dev preview cannot).

---

## B. LLM onboarding tutor — built on main (flag-gated dark) + live-mount started on the worktree

Full tutor on `main` behind `NEXT_PUBLIC_ONBOARDING_TUTOR` (off, inert): reel director, step machine, all beats (welcome/picker/deep-demo/AI-demo/montage/memory/recap), per-user memory model, capped meter, the visual overhaul (LIVING `<BeakerBot>` heroes, `MarketingBackdrop`, shiny rainbow CTA), and the walkthrough-review fixes (picker Skip+Back, AI/montage controls, rAF timing, warm copy). Dev preview: `/dev/onboarding-tutor`. Full detail in `[[project_llm_onboarding_tutor]]` + `docs/handoffs/2026-06-15-onboarding-tutor-walkthrough-review.md`.

**Live mount (worktree `feat/onboarding-tour-mount`):**
- Build plan: `.claude/worktrees/tour-mount/docs/handoffs/2026-06-15-onboarding-tour-mount-build-plan.md` (6 increments).
- **Increment 1 DONE** (`19e19b3d7`): `TourHost` mounts in `providers.tsx` as a peer of CelebrationManager (above the route outlet, persists across nav), gated on `isFreshUserForWizard` + the flag (inert in prod). Branch has current main merged in.
- **Increments 2-6 = the live-driving chunk (NOT started):** enter tour-scoped demo mode, render deep/AI beats TRANSPARENT over the real page with the SOFT-RING spotlight (Grant pick B), tag real controls (`data-tutor-target`), scripted multi-step plan-card AI demo. **KEY FINDING:** demo mode's `fileService`->fixture swap is INIT-TIME, so entering it mid-tour is not a flag flip (needs a reload-into-demo, which unmounts the tour, OR a tour-scoped in-memory data layer). And it is only verifiable in a real browser. So increments 2-3+ are ONE coupled, browser-verified pass — do them with a Chrome loop, not blind.

---

## Open / next (priority order)
1. Run the Chrome verify prompt (A/A2) on authed :3000.
2. Optional: chat-run-result should open inline/popup not navigate (run_datahub_analysis navigates -> closes chat; same chat-preserving principle as the fixes above; design nuance = only the picker-driven run should stay in chat).
3. The onboarding live-driving pass (tour increments 2-6) — focused browser-verified session.

## Notes
- No active Data Hub lane this session; "INJEST" is the Icon Library lane (name collision), confirmed not editing datahub/*.
- Bash safety classifier was intermittently down late session; read-only tools unaffected.
