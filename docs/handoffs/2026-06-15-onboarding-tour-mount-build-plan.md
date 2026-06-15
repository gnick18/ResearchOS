# Onboarding tutor — real app-level mount BUILD PLAN

**Worktree:** `.claude/worktrees/tour-mount`, branch `feat/onboarding-tour-mount` (branched from local main HEAD, so it has the whole flag-gated tutor). Merge to main when whole.
**Design (locked):** `docs/proposals/2026-06-14-llm-onboarding-tutor.md` §"The real app-level mount". Walkthrough review: `docs/handoffs/2026-06-15-onboarding-tutor-walkthrough-review.md`.

The job: make Beaker drive the REAL pages (vs the stand-in stage), gated, in demo mode, with a soft-ring spotlight, and the AI demo as a scripted multi-step plan-card.

## Done in this worktree (the foundation)
- `lib/onboarding/tour-gate.ts` (+ test) — `shouldRunOnboardingTutor({freshAccount})` / `markOnboardingTutorDone` / `resetOnboardingTutor`. Flag + fresh-account + once-per-device marker. Pure, storage-injectable.
- `components/onboarding/tutor/TourHost.tsx` — the persistent overlay wrapper. Gates, renders `OnboardingTutor`, records completion. `onComplete`/`onRememberFact` are the two TODO(live) integration points.

## Remaining increments (in order)

### 1. Mount TourHost in the app shell (persistent overlay)
`providers.tsx` is a stack of early-return gates (wizard, account-first, folder, app). The tutor is NOT an early return — it is an overlay on the running app so it survives `router.push`. Mount `<TourHost freshAccount={…} />` as a sibling of the main app render (the final fallthrough where the connected app renders), so it persists across navigation. Derive `freshAccount` from session state (mirror how the wizard reads `researchWizardReturn` + `!isConnected`). Keep it AFTER all gates so it only overlays the real app.

### 2. Tour-scoped demo mode
Reuse the existing demo-mode path (`isDemoOrWikiCapture()` + the demo fixtures; demo renders every surface on in-memory data with NO folder writes). On tour start: enter a tour-scoped demo-data mode pointed at a field-personalized fixture set (one resistance_assay table, one 8-tip tree, one sequence, …). On `onComplete`/skip: exit → user lands in their clean empty workspace. Investigate `lib/file-system/file-system-context.tsx` (demo detection) + the demo fixture source; add a tour flavor rather than forking demo mode.

### 3. Live-overlay rendering (replace the stand-in stage)
For `deep_demo` + `ai_demo` beats only, the tutor overlay goes TRANSPARENT so the real page shows. Keep welcome/picker/montage/memory/recap as opaque `TutorScreen` takeovers. Build a `LiveCursorLayer` (transparent, `pointer-events-none`, fixed) that floats `PresenterCursor` + `CoachBubble` + a SOFT RING (no dim — Grant pick B) positioned via `tutor-target.ts` `resolveTargetPoint` against `[data-tutor-target]` on the real page. The showcase-player already drives the steps; swap the stand-in stage for the live layer + a `router.push(choreography.route)` on the ARRIVE step.

### 4. Tag real controls
Add `data-tutor-target="<id>"` to the real controls named in `showcase-choreography.ts` (datahub-plot-button, phylo-export-tab, method-view-on-phone, sequence-annotate-button, chemistry-render-button, inventory-reorder-button, people-member-card). Small per-surface edits. The cursor lands via the resolver; the ring confirms.

### 5. AI demo = scripted multi-step plan-card
Replace `AiDemoBeat`'s single prompt→reply with a SCRIPTED (deterministic, no live model call) plan-card run: propose plan → tick create-table → analyze → plot → overlay-on-tree across the demo-mode Data Hub + Phylo, cursor moving between them, narrated. Reuse the real resumable plan-card component. Free + reliable; the capped meter funds the user's first REAL turn after the tour.

### 6. Persist memory + meter
Wire `TourHost.onRememberFact` to the per-user account-vault memory (`user-memory.ts` model + the real vault write). Accrue real usage into the `onboarding-meter` only for any genuinely-live turns (the scripted demo is free).

## Verify
Each increment: `npx tsc --noEmit`, `npx vitest run src/lib/onboarding`, icon-guard. Browser-verify the live driving on a real surface (the dev preview can't host real-page nav — verify in the app with the flag on). Merge to main only when the whole vertical slice works on at least Data Hub + Phylo.

## Risk note
Touches `providers.tsx` + demo mode + every surface — exactly why this is a worktree. Commit each increment; keep `main` untouched until merge.
