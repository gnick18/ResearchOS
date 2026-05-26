# §6.2 click-bypass R2 — root cause and fix

Date: 2026-05-26
Sub-bot: §6.2 click-bypass R2
Worktree: `.claude/worktrees/agent-aba110eb6d18bf9ef`

## Symptom

On the v4 walkthrough `project-overview-nav` step (§6.2 NAV), the cursor
glides to the freshly-created project card on `/home`, performs a
visible click animation, but the navigation never lands. The route
stays on `/`, the `InputLockOverlay` stays mounted with
`pointer-events: auto`, and the user is wedged behind a 5%-dim lock
until the cursor-lock watchdog fires 30s later.

## Phase 1 — Pipeline trace

1. `home-create-project-fill` completes (project file written to disk,
   `tour:project-created` fires).
2. Step machine advances to `project-overview-nav`.
3. `InProductWalkthroughOverlay` mounts a fresh cursor + sets
   `cursorActive = true` and `__beakerBotCursorScriptRunning = true`.
4. The step's `cursorScript()` builds via `safeNavClickAction(
   "[data-tour-target^='home-project-card-']", 2000)`.
5. `safeNavClickAction` returns `[glide, callback]`.
6. `runScript` plays:
   - **glide** → cursor visually arrives at the card center
   - **callback** → `document.querySelector(selector)` re-resolves the
     fresh node, sets `__beakerBotCursorClicking = true`, calls
     `fresh.click()`, clears the flag in `finally`.
7. The card's `onClick` handler fires, calls `router.push(
   "/workbench/projects/<id>")`.
8. `runScript` resolves; `finally` clears
   `__beakerBotCursorScriptRunning = false`.
9. React commits the navigation; `usePathname()` updates;
   the auto-nav `useEffect` fires.
10. Auto-nav effect sees `pathname = "/workbench/projects/<id>"`,
    `expectedRoute = "/"`, **`__beakerBotCursorScriptRunning = false`
    (already cleared in step 8)**.
11. Auto-nav effect pushes the user BACK to `/` — undoing the cursor's
    nav.
12. The cursor-script effect for `project-overview-nav` has already
    completed; no new overlay-mount cycle starts. The lock stays
    mounted (`cursorActive` is still true from the previous render
    until React fully unwinds). 30s later, the watchdog fires and
    force-releases.

## Phase 2 — Instrumentation evidence

Playwright drive of `/?wikiCapture=1&wizard-preview=1&wizardSeedStep=home-create-project`,
walking §6.1 trigger → fill → §6.2 NAV. Probes added at each step of
the click chain. Console output, in order:

```
[§6.2-R2-PROBE] runScript START step=project-overview-nav, actions.length=2
[§6.2-R2-PROBE] safeNavClickAction BEFORE click: attached=true, tag=DIV, dataTourTarget=home-project-card-5, flagBefore=undefined
[§6.2-R2-PROBE] safeNavClickAction flag SET: true
[§6.2-R2-PROBE] InputLockOverlay blockEvent: type=click, flag=true, ...
[§6.2-R2-PROBE] InputLockOverlay blockEvent: SHORT-CIRCUIT (flag set) type=click
[§6.2-R2-PROBE] project-card onClick FIRED: id=5, name=R2 Repro, isTrusted=false
[§6.2-R2-PROBE] project-card onClick CALLING router.push(/workbench/projects/5)
[§6.2-R2-PROBE] project-card onClick AFTER router.push
[§6.2-R2-PROBE] safeNavClickAction AFTER fresh.click() returned (sync)
[§6.2-R2-PROBE] safeNavClickAction flag CLEARED: false
[§6.2-R2-PROBE] runScript END step=project-overview-nav, cancelled=false, watchdogFired=false
[§6.2-R2-PROBE] history.pushState url=/workbench/projects/5, locationBefore=/
[§6.2-R2-PROBE] history.pushState RETURNED, locationAfter=/workbench/projects/5
[§6.2-R2-PROBE] history.pushState CALLED url=/, locationBefore=/workbench/projects/5    <-- THE BOUNCE-BACK
[§6.2-R2-PROBE] history.pushState RETURNED, locationAfter=/
```

What fired: the entire click chain. Card's onClick ran. `router.push`
was called. **What's missing from prior chip's theory**: the click
was not absorbed. It dispatched, the handler executed, the navigation
happened.

The killer: the `history.pushState url=/workbench/projects/5` event
fires AFTER `runScript END`. That is, React Router commits the
navigation asynchronously, after the cursor-script's synchronous
finally has already cleared `__beakerBotCursorScriptRunning`. The
auto-nav `useEffect` then fires on the pathname change with the
running flag false — and pushes the user back to `expectedRoute`.

## Phase 3 — Root cause (one sentence)

`router.push` from inside the cursor's click handler is async; the
TourController's auto-nav effect observes the resulting pathname
change AFTER the cursor-script's synchronous `finally` block has
already cleared `__beakerBotCursorScriptRunning`, so the
running-flag guard short-circuits to `false` and the effect pushes
the user back to the step's `expectedRoute` — undoing the cursor's
navigation.

## Phase 4 — Fix

Introduced `window.__beakerBotCursorPendingNavigation`, a second flag
set inside `safeNavClickAction`'s playback-time callback BEFORE the
click and NOT cleared in the `finally` block. The TourController's
auto-nav effect consumes the flag on the first cursor-driven
pathname change it observes (sets it back to `false`), so any
subsequent USER nav-escape on the same step still gets corrected.

A 2-second safety drain timer in the cursor-script effect clears
the flag defensively if the click never produced a pathname change
(e.g., a future bug where the receiver short-circuits).

Files touched:
- `frontend/src/components/onboarding/v4/steps/walkthrough/lib/cursor-script.ts`
  — set pending-nav flag in the playback-time callback
- `frontend/src/components/onboarding/v4/TourController.tsx`
  — consume the flag in the auto-nav effect + safety drain in cursor-script effect

This is an architectural fix, not a symptom patch. It correctly
models the producer/consumer relationship between the cursor's
async click-then-router.push and the auto-nav effect's
pathname-driven correction — closing the race window that the
existing `__beakerBotCursorScriptRunning` flag could not.

## Phase 5 — Tests

New unit tests (4 total):

1. `cursor-script.test.tsx` — `safeNavClickAction()` describe block:
   - sets pending-nav flag true at click time and leaves it true after
     (the consumer in TourController is responsible for clearing)
   - a user click on the same anchored target element still navigates
     (the lock-bypass and the auto-nav fix are orthogonal)
   - selector miss → no flag set (no phantom nav to suppress)
2. `TourController.test.tsx` — `expectedRoute auto-navigation`:
   - does NOT auto-correct when the cursor's async `router.push` lands
     after the running flag has cleared (asserts flag is consumed)
3. `step-bodies.test.tsx` — `ProjectOverviewNavStep`:
   - cursor click sets `__beakerBotCursorPendingNavigation` for the
     auto-nav effect consumer

End-to-end (Playwright) verification:
- Walk §6.1 trigger → fill → create project → land on §6.2 NAV
- Cursor glides + clicks → pathname becomes `/workbench/projects/5`
- No bounce-back to `/`; `pendingNav` flag cleared by consumer
- `lockMounted = false`; watchdog never fires

Vitest results: `pnpm vitest run "onboarding/v4"` — 805 tests pass.
Two pre-existing failures in unrelated files (`page-drag.test.tsx`,
`ResearchFolderSetupNew.test.tsx`) are not touched by this change.

## What was NOT the bug (avoiding future trap)

The prior chip's finding ("click DISPATCHED but router.push never
ran") was almost right but reversed the conclusion: the click WAS
dispatched, AND router.push DID run. The navigation landed for a
single React commit cycle and was then immediately undone by the
auto-nav effect. From the user's perspective the lock-stays-mounted
symptom is identical, which is why the prior investigation framed it
as "router.push silently no-oped".

Future bug hunters: instrument `history.pushState` calls, not just
the synchronous click chain. The synchronous chain works; the
post-commit bounce is the actual fault.
