# V3 Onboarding Rip Proposal

Author: V3 rip proposal author (orchestrator session, 2026-05-22)
Status: Ready for Phase B (deletion sub-bot)

## 1. Decision summary

V3 onboarding is **dead**. v4 is the only walkthrough, scoped to real new-user accounts on a real user folder. The `/demo` route and `?tutorial=1` query exist solely for fixture-mode browsing — NO tutorial overlay, NO tour controller mounts on the demo route. TryInDemo deep-links just land visitors on the page in fixture mode.

The full `frontend/src/components/onboarding/v3/` subtree (76 files) plus the V3-only Telegram cross-tab signal helper get deleted. A small number of non-V3 files get gutted to remove their V3 carve-outs.

## 2. Files to delete

### 2a. The v3 subtree (`frontend/src/components/onboarding/v3/`, 76 files)

Walked recursively. Every file below gets deleted.

Top-level wizard shell + mount + resume:

- `frontend/src/components/onboarding/v3/LabTourResumePrompt.tsx` — deferred lab-tour resume prompt rendered by providers.tsx.
- `frontend/src/components/onboarding/v3/OnboardingWizardV3.tsx` — wizard shell host (chrome around the step body, header, nav, BeakerBot host).
- `frontend/src/components/onboarding/v3/WizardMount.tsx` — sidecar-gated decision component that mounts the wizard or resume modal.
- `frontend/src/components/onboarding/v3/WizardResumeModal.tsx` — "resume your walkthrough" prompt when wizard_resume_state is set on the sidecar.
- `frontend/src/components/onboarding/v3/WizardStepMachine.ts` — step-id graph, ALL_STEP_IDS, transitions (setup → walkthrough → lab → cleanup).

Top-level tests (`v3/__tests__/`):

- `frontend/src/components/onboarding/v3/__tests__/LabTourResumePrompt.test.tsx` — covers the L8 lab-tour deferred prompt.
- `frontend/src/components/onboarding/v3/__tests__/OnboardingWizardV3.pose.test.tsx` — pose-transitions on the wizard shell BeakerBot.
- `frontend/src/components/onboarding/v3/__tests__/OnboardingWizardV3.skipLog.test.tsx` — skip-step logging into wizard_resume_state.
- `frontend/src/components/onboarding/v3/__tests__/WizardMount.disabled.test.tsx` — mount-gate "do not show" cases.
- `frontend/src/components/onboarding/v3/__tests__/WizardMount.invisibility.test.tsx` — mount-gate "fresh-user + escape-hatch" cases; also mocks `@/components/OnboardingTutorialSequencer` (path no longer exists outside historical doc references).
- `frontend/src/components/onboarding/v3/__tests__/WizardResumeModal.test.tsx` — resume modal + gate-precedence.
- `frontend/src/components/onboarding/v3/__tests__/WizardStepMachine.test.ts` — state-machine transitions + guards.

Setup phase step bodies + helpers (`v3/steps/setup/`):

- `frontend/src/components/onboarding/v3/steps/setup/Q1AccountTypeStep.tsx` — Q1 account-type radio.
- `frontend/src/components/onboarding/v3/steps/setup/Q1aLabStorageStep.tsx` — Q1a lab-storage follow-up.
- `frontend/src/components/onboarding/v3/steps/setup/Q1bLabConnectInfoStep.tsx` — Q1b lab-connect info screen.
- `frontend/src/components/onboarding/v3/steps/setup/Q2PurchasesStep.tsx` — Q2 purchases-feature opt-in.
- `frontend/src/components/onboarding/v3/steps/setup/Q3CalendarStep.tsx` — Q3 calendar opt-in.
- `frontend/src/components/onboarding/v3/steps/setup/Q4GoalsStep.tsx` — Q4 goals opt-in.
- `frontend/src/components/onboarding/v3/steps/setup/Q5TelegramStep.tsx` — Q5 Telegram opt-in.
- `frontend/src/components/onboarding/v3/steps/setup/Q6AiHelperStep.tsx` — Q6 AI helper opt-in.
- `frontend/src/components/onboarding/v3/steps/setup/RadioCard.tsx` — shared radio-card UI for Q1-Q6.
- `frontend/src/components/onboarding/v3/steps/setup/WelcomeStep.tsx` — opening welcome step.
- `frontend/src/components/onboarding/v3/steps/setup/feature-picks-init.ts` — derives initial feature_picks from Q1-Q6 answers.

Walkthrough phase step bodies + helpers (`v3/steps/walkthrough/`):

- `frontend/src/components/onboarding/v3/steps/walkthrough/W1CreateProjectStep.tsx` — W1 create-project guide.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W2CreateMethodStep.tsx` — W2 create-method guide.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W3CreateExperimentStep.tsx` — W3 create-experiment guide.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W4LinkMethodStep.tsx` — W4 link-method-to-experiment guide.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W5HybridEditorTourStep.tsx` — W5 hybrid editor (markdown + properties) tour.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W6PersonalizationStep.tsx` — W6 personalization (avatar, color).
- `frontend/src/components/onboarding/v3/steps/walkthrough/W7SearchTourStep.tsx` — W7 global search tour.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W8NotificationsTourStep.tsx` — W8 notifications tour.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W9WikiPointerStep.tsx` — W9 wiki pointer tour.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W10PurchasesTourStep.tsx` — W10 purchases-page tour.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W11GoalsTourStep.tsx` — W11 goals-page tour.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W12TelegramWithImageStep.tsx` — W12 Telegram send-photo demo (consumer of the `tutorial-signal` broadcast).
- `frontend/src/components/onboarding/v3/steps/walkthrough/W13CalendarTourStep.tsx` — W13 calendar tour.
- `frontend/src/components/onboarding/v3/steps/walkthrough/W14AiHelperStep.tsx` — W14 AI helper tour.
- `frontend/src/components/onboarding/v3/steps/walkthrough/lib/SpeechBubble.tsx` — speech-bubble overlay component shared by walkthrough steps.
- `frontend/src/components/onboarding/v3/steps/walkthrough/lib/auto-prerequisite.ts` — auto-creates missing artifacts (project, method, experiment) before W1-W4.
- `frontend/src/components/onboarding/v3/steps/walkthrough/lib/use-typewriter.ts` — typewriter-effect hook used by speech bubbles.
- `frontend/src/components/onboarding/v3/steps/walkthrough/lib/wizard-artifacts.ts` — tracks artifacts created during walkthrough for cleanup phase.

Walkthrough tests (`v3/steps/walkthrough/__tests__/`):

- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W1CreateProjectStep.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W2CreateMethodStep.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W3CreateExperimentStep.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W4LinkMethodStep.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W5HybridEditorTourStep.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W6PersonalizationStep.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W7W8W9.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W10W11W13.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W12TelegramWithImageStep.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/W14AiHelperStep.test.tsx`
- `frontend/src/components/onboarding/v3/steps/walkthrough/__tests__/wizard-artifacts.test.ts`

Lab phase step bodies + helpers (`v3/steps/lab/`):

- `frontend/src/components/onboarding/v3/steps/lab/LabPromptStep.tsx` — the "want to try lab mode?" prompt step (between walkthrough and lab).
- `frontend/src/components/onboarding/v3/steps/lab/L1WhatIsLabMode.tsx` — L1 explainer step.
- `frontend/src/components/onboarding/v3/steps/lab/L2SpawnFakeBeakerBot.tsx` — L2 spawn fake user step.
- `frontend/src/components/onboarding/v3/steps/lab/L3SeeBeakerBotTask.tsx` — L3 see-task-from-fake-user step.
- `frontend/src/components/onboarding/v3/steps/lab/L4PermissionPractice.tsx` — L4 permission practice.
- `frontend/src/components/onboarding/v3/steps/lab/L5UserSharesBack.tsx` — L5 fake user shares back.
- `frontend/src/components/onboarding/v3/steps/lab/L6RevokeShare.tsx` — L6 revoke-share step.
- `frontend/src/components/onboarding/v3/steps/lab/L7GanttAndActivityFeed.tsx` — L7 gantt + activity feed step.
- `frontend/src/components/onboarding/v3/steps/lab/L8LabPurchases.tsx` — L8 lab purchases step.
- `frontend/src/components/onboarding/v3/steps/lab/L9LabSearch.tsx` — L9 lab search step.
- `frontend/src/components/onboarding/v3/steps/lab/L10LabWrap.tsx` — L10 lab-mode wrap-up.
- `frontend/src/components/onboarding/v3/steps/lab/L11BeakerBotCleanupOption.tsx` — L11 offer to clean up fake user.
- `frontend/src/components/onboarding/v3/steps/lab/lib/beakerbot-user.ts` — fake "BeakerBot" user creation/seeding helper.
- `frontend/src/components/onboarding/v3/steps/lab/lib/lab-artifacts.ts` — tracks lab-phase artifacts for cleanup.

Lab tests (`v3/steps/lab/__tests__/`):

- `frontend/src/components/onboarding/v3/steps/lab/__tests__/L1L3L7L9L10.test.tsx`
- `frontend/src/components/onboarding/v3/steps/lab/__tests__/L2SpawnFakeBeakerBot.test.tsx`
- `frontend/src/components/onboarding/v3/steps/lab/__tests__/L4PermissionPractice.test.tsx`
- `frontend/src/components/onboarding/v3/steps/lab/__tests__/L5L6Share.test.tsx`
- `frontend/src/components/onboarding/v3/steps/lab/__tests__/L8L11.test.tsx`
- `frontend/src/components/onboarding/v3/steps/lab/__tests__/LabPromptStep.test.tsx`

Cleanup phase + tests (`v3/steps/cleanup/`):

- `frontend/src/components/onboarding/v3/steps/cleanup/Phase4CleanupStep.tsx` — final cleanup step UI (delete walkthrough/lab artifacts).
- `frontend/src/components/onboarding/v3/steps/cleanup/cleanup-execution.ts` — the actual delete-and-account logic.
- `frontend/src/components/onboarding/v3/steps/cleanup/__tests__/Phase4CleanupStep.test.tsx`
- `frontend/src/components/onboarding/v3/steps/cleanup/__tests__/cleanup-execution.test.ts`

**Total v3 subtree:** 76 files (50 source, 26 test).

### 2b. V3-only outside the subtree

- `frontend/src/lib/telegram/tutorial-signal.ts` — cross-tab BroadcastChannel signal between polling tab + V3 tutorial tab for the W12 "send photo via Telegram" demo. Three signal types: `photo-arrived`, `trigger-tutorial-modal`, `tutorial-state`. The only `subscribeTutorialSignal` consumer in the codebase was the V3 `OnboardingTutorialSequencer` (no longer present); the broadcast side (image-router) currently fires into a void. Verified: no v4 file imports from `tutorial-signal`. See §6 for the broader Telegram-signal teardown decision.

## 3. Files to MODIFY (not delete)

### 3a. `frontend/src/lib/providers.tsx`

Carve-outs to remove:

- Line 22: `import LabTourResumePrompt from "@/components/onboarding/v3/LabTourResumePrompt";` — delete.
- Line 382: `<LabTourResumePrompt username={currentUser} />` — delete.
- Lines 176-213 (the `isDemoOrWikiCapture() && currentUser` branch): currently wraps demo children in `OnboardingProvider` plus a conditional `V4MountForUser` when `isV4PreviewMode()` is set. The block-level comment (lines 177-200) is V3 framing ("tutorial-tab carve-out (`isTutorialMode()` → mount the sequencer)") and is wrong post-rip.

Post-rip behavior: the demo branch returns `<>{children}</>` (no `OnboardingProvider`, no V4 mount) — fixture data + the floating leave-demo button (already mounted at the `<Providers>` level) and that's it. The `isV4PreviewMode()` wiki-capture screenshot path is preserved by routing it to a small wrapper that mounts `V4MountForUser` only when the URL explicitly opts in via `?wizard-preview=1` or `?wizardSeedStep=…`. Plain `/demo` and bare `?wikiCapture=1` skip the orchestrator entirely.

Update the comment to reflect: "Demo + wiki-capture: render children only. V4MountForUser only mounts when the URL explicitly opts in (the v4 preview / screenshot pipeline). The V3 sequencer carve-out is gone."

### 3b. `frontend/src/lib/file-system/wiki-capture-mock.ts`

- Lines 300-341 (`TutorialMode` type, `getTutorialMode()`, `isTutorialMode()`): remove the `"full"` mode entirely (`?tutorial=1` no longer maps to anything). If the standalone Telegram walkthrough also dies (§6 decision), remove the file's tutorial-mode surface in full. Otherwise reduce `TutorialMode` to `"telegram"` only and update `getTutorialMode()` to return `null` for `?tutorial=1`.
- Line 314 docblock reference to `<OnboardingTutorialSequencer>` — remove.

Reverify after edit: `isTutorialMode()` callers (`FloatingLeaveDemoButton.tsx`, `LeaveDemoModal.tsx`, `DemoLabBanner.tsx`) still need to discriminate the Telegram walkthrough tab from the public-demo tab, so the function stays as long as Telegram-walkthrough mode survives. If Telegram-walkthrough mode is killed too (§6), all three callers go to plain "demo" copy.

### 3c. `frontend/src/lib/onboarding/orchestrator.tsx`

Currently the file is the V3 orchestrator + provider. Post-rip:

- Delete lines 5-6 (the `WizardMount` / `WizardStep` imports).
- Delete the entire `OnboardingOrchestrator` component body (lines 65-118) — it only existed to host `<WizardMount>` plus the v3 context API (`skipWizard`, `completeWizard`, `jumpToStep`). The context is consumed only by `DevForceTipButton` (also being gutted, §3f).
- Delete the `OrchestratorContextValue` interface (lines 46-61) and `OrchestratorContext` createContext (line 63).
- Delete the `useOnboarding()` hook (lines 120-122).
- `OnboardingProvider` (lines 124-178) shrinks dramatically: it no longer wraps an orchestrator, so the gate decision becomes "render children" in every branch. v4 mount decisions are made in `providers.tsx` directly. The simplest replacement is to **delete `orchestrator.tsx` entirely** and remove the `OnboardingProvider` import from `providers.tsx`.

Recommend: delete the file. Inline the `currentUser === "lab"` and `isDemoOrWikiCapture()` checks (already duplicated in `providers.tsx`) where v4-mount decisions get made.

If we keep `OnboardingProvider` as a thin pass-through wrapper for naming continuity, gut the docblock — the four-state truth table and "LOCKED" comments are V3 history.

### 3d. `frontend/src/components/LeaveDemoModal.tsx`

- Docblock (lines 15-45) describes "Phase-4 guided tutorial tab (`/demo?tutorial=1`, opened via `window.open` from the welcome modal)" — V3-specific. Rewrite to describe the post-rip two paths:
  - **Public demo path** (`/demo` or `/demo/<slug>`) — same restore-or-clear logic.
  - **Telegram-walkthrough tab** (`/demo?tutorial=telegram`, opened from `/settings#telegram`) — if §6 keeps this, keep the tutorial branch + update copy. If §6 kills it, delete the tutorial branch entirely and simplify the component.
- Line 18 reference to "Phase-4 guided tutorial tab" — delete.
- Line 48 "?tutorial=1 until we navigate" — V3-specific phrasing; rewrite or delete depending on Telegram-walkthrough fate.

Companion test file `LeaveDemoModal.test.tsx` already mocks `isTutorialMode` to false (line 29), so no test-side change needed unless the Telegram-walkthrough branch dies.

### 3e. `frontend/src/app/demo/[[...slug]]/page.tsx`

Inspected. Already does NOT special-case `?tutorial=1` — the catch-all just installs the fixture and redirects `/demo/<slug>` → `/<slug>`. No code change needed; verify post-rip that the comment / TryInDemo prop-drilling still tracks. The file is clean.

### 3f. `frontend/src/components/DevForceTipButton.tsx`

Imports `ALL_STEP_IDS` + `WizardStep` from `WizardStepMachine` (V3) and `useOnboarding()` from the orchestrator. Three flows all assume V3:

1. Mount wizard at step (v3 step picker)
2. Reset wizard state (clears v3 sidecar fields)
3. Show welcome wizard (creates Test user → forces v3 wizard)

Recommend: **delete this file entirely**. v4 has its own dev affordances (see `frontend/src/components/onboarding/v4/` — TourBootstrap, V4ResumePrompt, wizard-preview URL params). If Grant wants a v4 step-jumper button, that's a separate follow-up; it does not block this rip.

Find any importer of `DevForceTipButton` and gut the mount site. Quick check:

```
grep -rn "DevForceTipButton" frontend/src --include="*.tsx" --include="*.ts"
```

Phase B sub-bot runs this and updates the mount site (likely `frontend/src/app/layout.tsx` or `providers.tsx` floating-buttons cluster).

### 3g. BeakerBot files with stale `OnboardingTipCard` JSDoc references

These four files have lingering JSDoc / comment references to the V2-era `OnboardingTipCard` component (already deleted; the references are stale from before V3 even shipped). Remove the references:

- `frontend/src/components/BeakerBot.tsx` line 101: "The dotted pointer-line in `OnboardingTipCard` emits from the…" — delete the reference or replace with a generic phrasing.
- `frontend/src/components/BeakerBotCursor.tsx` line 314: "Same pattern as OnboardingTipCard.tsx." — delete.
- `frontend/src/components/BeakerBotBugStompScene.tsx` line 144: "Same pattern as OnboardingTipCard." — delete.
- `frontend/src/components/BeakerBotSkateboardScene.tsx` lines 26 and 117: "`OnboardingTipCard` uses 1000+; OnboardingWizard uses ~9000" and "same pattern as OnboardingTipCard" — delete both.

## 4. Files to AUDIT before deletion

Grep result for external importers of `@/components/onboarding/v3/*`:

```
$ grep -rn "@/components/onboarding/v3" frontend/src --include="*.tsx" --include="*.ts" | grep -v "/v3/"
frontend/src/lib/onboarding/orchestrator.tsx:5:  import WizardMount from "@/components/onboarding/v3/WizardMount";
frontend/src/lib/onboarding/orchestrator.tsx:6:  import type { WizardStep } from "@/components/onboarding/v3/WizardStepMachine";
frontend/src/components/DevForceTipButton.tsx:14: } from "@/components/onboarding/v3/WizardStepMachine";
frontend/src/lib/providers.tsx:22: import LabTourResumePrompt from "@/components/onboarding/v3/LabTourResumePrompt";
```

**Three external files** import from `v3/`:

1. `frontend/src/lib/providers.tsx` — covered by §3a. Drop the `LabTourResumePrompt` import + its render site.
2. `frontend/src/lib/onboarding/orchestrator.tsx` — covered by §3c. Delete the file or gut to a pass-through.
3. `frontend/src/components/DevForceTipButton.tsx` — covered by §3f. Delete the file.

No v4 file imports from v3 (`grep -rn "@/components/onboarding/v3" frontend/src/components/onboarding/v4` returns nothing). No shared lib pulls v3 code.

`frontend/src/components/onboarding/v4/steps/setup/types.ts` line 8 has a passing JSDoc reference to "the v3 WizardMount shell" as historical context — harmless, but Phase B should update the line to drop the V3 mention.

## 5. Test impact

- **V3 test count:** 26 files (7 in `v3/__tests__/`, 11 in `walkthrough/__tests__/`, 6 in `lab/__tests__/`, 2 in `cleanup/__tests__/`). All deleted with the subtree.
- **v4 tests importing from v3:** `grep -rn "@/components/onboarding/v3" frontend/src/components/onboarding/v4` returns nothing. v4 is clean.
- **Non-v3 files with V3 mocks:** none found.
  - `WizardMount.invisibility.test.tsx` mocks `@/components/OnboardingTutorialSequencer` (line 85) — that file is *inside* `v3/__tests__/`, so it dies with the rest.
  - `LeaveDemoModal.test.tsx` (line 29) mocks `isTutorialMode` to `false` from `@/lib/file-system/wiki-capture-mock`. Not a V3 mock per se — it's mocking the wiki-capture-mock surface. Stays as-is unless §6 removes `isTutorialMode`.
- **Telegram image-router tests** (`frontend/src/lib/telegram/image-router.test.ts`) mock `./tutorial-signal` and assert that `broadcastTutorialSignal` is called with specific shapes (`trigger-tutorial-modal`, `photo-arrived`). If §6 kills `tutorial-signal.ts`, these assertions plus the broadcasts in `image-router.ts` (lines 112, 344) go too. Phase B must delete those broadcast call sites in `image-router.ts` when the signal file dies, or the build breaks.

## 6. The Telegram cross-tab demo signal

`tutorial-signal.ts` carries the BroadcastChannel signal between the polling tab + the V3 tutorial tab for the W12 "send photo via Telegram" demo. Audit findings:

- **`subscribeTutorialSignal` has zero callers** in the codebase outside `tutorial-signal.ts` itself. The V3 sequencer was the only consumer; with V3 gone, the broadcasts in `image-router.ts` fire into a void.
- **`broadcastTutorialSignal` is called from three sites in `image-router.ts`:**
  - line 112 — `/tutorial` command → `trigger-tutorial-modal`
  - line 344 — photo arrival → `photo-arrived`
  - (one more block in tutorial-store-driven path)
- **v4 uses no BroadcastChannel for similar purposes.** Searched `BroadcastChannel` across v4 — no hits.
- **Telegram polling-tab Telegram-walkthrough mode (`?tutorial=telegram`):** the `/settings` page line 891 (`window.open("/demo?tutorial=telegram", "_blank", "noopener")`) and `wiki-capture-mock.ts` lines 305-309 (the `"telegram"` arm of `TutorialMode`) describe a **standalone Telegram walkthrough** — separate from the full V3 tour, opened from `/settings#telegram` post-V3. The brief does not explicitly cover this; treating it as in-scope for the rip means removing:
  - `/settings` line 889-893 `openTelegramWalkthrough` and the button that calls it.
  - The `"telegram"` arm of `TutorialMode` in `wiki-capture-mock.ts`.
  - `frontend/src/lib/telegram/tutorial-signal.ts` (already in §2b).
  - The `broadcastTutorialSignal` call sites in `image-router.ts`.
  - The matching `image-router.test.ts` tutorial-signal mock + assertions.
  - The `tutorial`-mode branches in `LeaveDemoModal.tsx`, `FloatingLeaveDemoButton.tsx`, `DemoLabBanner.tsx`.
  - `frontend/src/lib/telegram/tutorial-store.ts` and `tutorial-cleanup.ts` if they have no non-tutorial callers (Phase B needs to check).

**Recommendation:** rip the Telegram standalone walkthrough too. It's V3-era infrastructure (its consumer is the same kind of sequencer-style overlay that the rip is killing), it has no v4 equivalent, and leaving it half-wired with broadcasts firing into a void is worse than deleting it cleanly. If Grant wants a Telegram-specific onboarding moment later, v4 can host it inside the real-user tour.

**Surface this design call to master before Phase B fires** — the brief said V3 is dead but did not explicitly authorize ripping `?tutorial=telegram`. Default if not surfaced: keep `?tutorial=telegram` plumbing intact (preserve `tutorial-signal.ts`, `TutorialMode = "telegram"`, the `/settings` button), and only rip the V3 subtree + `LabTourResumePrompt` + V3-only orchestrator/wiki-mock branches.

## 7. Demo route behavior post-V3

After the rip:

- **`/demo` (no slug):** fixture installs via `<FileSystemProvider>`, user lands on home page signed in as `alex`, demo banner + floating Leave Demo button visible, **no tour overlay**, **no orchestrator mount**.
- **`/demo/<slug>` (e.g., `/demo/methods`):** fixture installs, the catch-all redirects to `/<slug>`, user sees the page in fixture mode with banner + Leave button, no tour overlay.
- **`?tutorial=1` query:** removed entirely from the public surface area. The `"full"` arm of `TutorialMode` in `wiki-capture-mock.ts` is deleted. No internal links use it — TryInDemo only generates `/demo/<slug>` (no query param), so no wiki page link needs updating.
- **`?wikiCapture=1` query:** unchanged. Localhost screenshot fixture mode still works, with the v4 sticky preview path (`?wizard-preview=1`) preserved for the wiki-manager P6 screenshot path.
- **`?wizard-preview=1` / `?wizardSeedStep=…`:** unchanged. v4 preview pipeline keeps working against the fixture.

## 8. Verification plan (post-deletion)

Phase B deletion sub-bot runs each of these before committing:

1. `npx tsc --noEmit` from `frontend/` — no type errors.
2. `npm test` (vitest) in `frontend/` — all suites pass. Expected diff: 26 V3 tests gone, count drops by 26; nothing else fails.
3. `npm run build` (next build) succeeds.
4. Dev server (`npm run dev`) — manual smoke:
   - Visit `/demo` → home page renders, fixture data visible (alex's projects), demo banner present, no tour, no overlay.
   - Visit `/demo/methods` → redirects to `/methods`, methods page renders with fixture data, no tour overlay.
   - Visit a wiki page with TryInDemo → click the TryInDemo link → lands on `/demo/<slug>` cleanly.
   - Sign out, create a brand-new user (real folder) → v4 tour mounts and runs welcome → … → goodbye normally.
5. Grep audit (must return ZERO non-historical hits):
   ```
   grep -rn "OnboardingTutorialSequencer\|OnboardingTipCard\|onboarding/v3\|WizardStepMachine\|WizardMount\|WizardResumeModal\|LabTourResumePrompt\|tips\.ts" frontend/src
   ```
   Any remaining hit must be either a Phase B oversight or an explicit historical comment ("removed in V3 rip — see V3_RIP_PROPOSAL.md").
6. If §6 went the "rip Telegram too" route: also verify `/settings#telegram` no longer offers a walkthrough button and that the page renders cleanly.

## 9. Risk + rollback

- **Risk:** a deep import we missed breaks the build.
  **Mitigation:** Phase B deletion sub-bot runs `tsc --noEmit` + `npm test` + `npm run build` before committing. Grep audit in §8.5 is the final guard.
- **Risk:** a wiki page TryInDemo link relies on `?tutorial=1` behavior.
  **Mitigation:** confirmed `TryInDemo.tsx` only generates `/demo/<slug>` — no query param. No wiki page in `frontend/src/app/wiki/` adds `?tutorial=1`. No update needed.
- **Risk:** `DevForceTipButton` is mounted somewhere and its removal leaves a dangling JSX node.
  **Mitigation:** Phase B greps for the import site and updates it.
- **Risk (§6 decision-dependent):** if the Telegram standalone walkthrough survives, leaving `tutorial-signal.ts` in place with the V3-orphan broadcasts is benign at runtime but adds dead code to read. Acceptable.
- **Risk:** the `_onboarding.json` sidecar still carries V3 fields (`feature_picks`, `wizard_resume_state`, `wizard_force_show`). Real users with mid-V3-walkthrough state on disk: there should be none, since V3 never shipped to production users (Grant's own folder is the only one with V3 sidecars). Phase B leaves the sidecar schema alone for now — v4 ignores those fields. A separate sidecar-schema cleanup chip can follow.

**Rollback:** `git revert <deletion-commit>`. V3 surface restored. Cherry-pick state stays clean because the proposal doc lands first as its own commit.

## 10. Phasing

Three sub-bots in sequence:

- **Phase A** *(this proposal doc)* — write `V3_RIP_PROPOSAL.md` and commit. Doc gets cherry-picked to main BEFORE Phase B fires.
- **Phase B** — deletion sub-bot rips the 76 v3 files + `tutorial-signal.ts` (if §6 authorized), updates the modified files in §3, runs `tsc --noEmit` + `npm test` + `npm run build`, commits. Surface back to master if §6 was unauthorized.
- **Phase C** — 2 verifier agents in parallel:
  - **Verifier 1:** smoke-tests `/demo` + `/demo/methods` in the dev server. Confirms no tour overlay, fixture data renders, TryInDemo deep links work.
  - **Verifier 2:** spawns a fresh real user on a real folder (use a sandbox folder, not Grant's real data). Confirms v4 mounts cleanly, welcome → … → goodbye plays through.

Master review point: between Phase B and Phase C, master inspects the diff + the §6 design call before greenlighting verifiers.

---

*Signed: V3 rip proposal author (2026-05-22)*
