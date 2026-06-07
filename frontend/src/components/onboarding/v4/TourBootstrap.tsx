"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import {
  patchOnboarding,
  readOnboarding,
  type OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import { TOUR_STEP_ORDER } from "./step-machine";
import { getStep } from "./step-registry";
import { runEndOfTourAutoCleanup } from "./steps/cleanup/auto-cleanup";
import { useTourController } from "./TourController";

/** sessionStorage key carrying a step id across a hard reload triggered
 *  by the Resume-stuck-404 mitigation. See `handleResume` for the full
 *  handoff narrative. */
const AUTO_RESUME_FLAG = "v4_auto_resume_on_next_mount";

// Wiki-pointer nav suppression flag helpers moved to a standalone
// dependency-free module (circular-import break 2026-05-27). The cycle
// was step-registry -> WikiPointerStep -> TourBootstrap -> step-registry,
// which vitest's module loader couldn't resolve (step-bodies test suite
// failed to import). WikiPointerStep now imports the set/clear helpers
// from wiki-pointer-nav-flag.ts directly instead of from this file, so
// the cycle never forms. Re-exported here so any prior importer that
// reaches for them via TourBootstrap keeps working.
import {
  isWikiNavInProgress,
  markWikiPointerNavActive,
  clearWikiPointerNavActive,
} from "./wiki-pointer-nav-flag";

// Re-export so any prior importer reaching for these via TourBootstrap
// keeps working. `clearWikiPointerNavActive` + `isWikiNavInProgress`
// are also used internally below.
export { markWikiPointerNavActive, clearWikiPointerNavActive };

/** v4 step ids in the §6.12 wiki-pointer cluster. Used by the bootstrap
 *  probe to recognize a saved resume step as "mid-cluster" so the
 *  suppression flag is honored. 2026-06-03 (HR / tour-simplification):
 *  the two cursor navigation beats (wiki-pointer-click-demo,
 *  wiki-pointer-back-demo) were cut, so no tour step drives a
 *  BeakerBot wiki navigation anymore and the suppression flag is never
 *  set from the cluster. The two surviving awareness beats stay listed
 *  for the guard; the flag-honoring branch below is now effectively
 *  inert but harmless (kept as a safety net). */
const WIKI_POINTER_STEP_IDS: ReadonlySet<string> = new Set([
  "wiki-pointer-intro",
  "wiki-pointer-icon-spotlight",
]);

/** Selector for the AppShell's static mount marker. Stays in sync with
 *  the `data-app-shell-mounted` attribute set on AppShell's outer wrapper
 *  div. When the selector doesn't resolve, the page rendered something
 *  other than AppShell (most commonly the Next.js 404 fallback after a
 *  dev-server restart) and the tour can't actually proceed. */
const APP_SHELL_SELECTOR = "[data-app-shell-mounted]";

/** True when the AppShell's static mount marker is present in the DOM.
 *  SSR-safe: returns false when `document` is undefined. */
function isAppShellMounted(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(APP_SHELL_SELECTOR) !== null;
}

/**
 * Silent kill flag — emergency brake for heavy-development windows.
 *
 * When `NEXT_PUBLIC_DISABLE_V4_TOUR` is set to "1" (or "true"), the
 * auto-mount gate does NOT auto-fire the tour for a fresh user: the
 * probe resolves to a no-op and a fresh user simply lands on the normal
 * empty state with no banner, notice, or copy of any kind. Use this to
 * stop the tour from ambushing real fresh users while the product
 * surfaces it walks are mid-refactor (a renamed route or removed widget
 * would otherwise strand every new account on a broken beat).
 *
 * Default OFF: when the var is unset the tour fires normally. The flag
 * is read at module load (Next inlines NEXT_PUBLIC_* at build time), so
 * toggling it requires a rebuild, which is intentional for an emergency
 * brake rather than a per-request switch.
 *
 * IMPORTANT: the flag only suppresses the AUTO-fire path. The dev
 * `?wizard-preview=1` force-walkthrough launch (previewMode below)
 * bypasses it entirely so QA can still drive the tour while it is
 * disabled for real users.
 */
const V4_TOUR_KILLED =
  process.env.NEXT_PUBLIC_DISABLE_V4_TOUR === "1" ||
  process.env.NEXT_PUBLIC_DISABLE_V4_TOUR === "true";

/** Resolve the expected route for a step id, falling back to "/" when
 *  the step body has no fixed route (dynamic-route steps) or the id
 *  isn't registered. Mirrors the controller's auto-navigate effect. */
function computeExpectedRoute(stepId: string): string {
  return getStep(stepId)?.expectedRoute ?? "/";
}

/** Read + clear the auto-resume sessionStorage flag. Returns the saved
 *  step id when present, `null` otherwise. Swallows storage errors
 *  (private-mode / disabled storage) so the bootstrap never throws. */
function readAutoResumeFlag(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const v = sessionStorage.getItem(AUTO_RESUME_FLAG);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function clearAutoResumeFlag(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(AUTO_RESUME_FLAG);
  } catch {
    // Swallow.
  }
}

function writeAutoResumeFlag(stepId: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(AUTO_RESUME_FLAG, stepId);
  } catch {
    // Swallow.
  }
}

/**
 * Onboarding v4 P11 bootstrap. Sits inside `<TourControllerProvider>`
 * and decides what the tour should do on first mount for the active
 * user:
 *
 *   1. Fresh user (no `wizard_completed_at` AND no `wizard_skipped_at`
 *      AND no `wizard_resume_state`): call `controller.start()` so the
 *      tour begins at the first applicable step.
 *   2. Mid-v4 resume (`wizard_resume_state.current_step` is a v4 step
 *      id, ie in `TOUR_STEP_ORDER`):
 *        - When the saved step is "welcome" (or null): treat as fresh.
 *          The user has not moved past the welcome card so there is
 *          nothing meaningful to resume; the modal would just ask them
 *          to pick Resume vs Restart over the same starting state.
 *        - Otherwise: render the Restart / Resume / Discard modal so
 *          the user can pick whether to pick up where they left off
 *          (P12). Without this modal, every refresh silently jumped
 *          back to the resume step which Grant flagged as disorienting.
 *   3. v3-in-flight (`wizard_resume_state.current_step` is NOT a v4
 *      step id): render a one-time prompt asking the user to restart
 *      on v4 or skip wholesale.
 *   4. Completed / skipped: no-op.
 *
 * The mid-tour-resume case respects `feature_picks` already on the
 * sidecar because the TourController seeded its `featurePicks` slot via
 * `initialFeaturePicks` at provider mount. The gating machine consults
 * that for every step transition, so resuming at, say,
 * `home-create-project` for a solo user just works.
 *
 * The component renders nothing on the happy paths (start / no-op);
 * only the resume / v3-in-flight prompt paths render DOM. Bypasses on
 * the dev `?wizard-preview=1` query, where the dev hook always
 * force-starts the tour at the first step so screenshots / wiki
 * captures work regardless of the user's sidecar state.
 */

interface TourBootstrapProps {
  username: string;
}

type BootstrapState =
  | { kind: "probing" }
  | { kind: "resolved" }
  | { kind: "v3-inflight"; sidecar: OnboardingSidecar }
  | { kind: "v4-resume"; sidecar: OnboardingSidecar; resumeStep: string };

export default function TourBootstrap({ username }: TourBootstrapProps) {
  const searchParams = useSearchParams();
  // Live-test R6 (2026-05-22): previewMode previously read the URL
  // alone (`searchParams.get("wizard-preview")`). After any in-app
  // navigation that strips the query string (eg. home page project
  // card → /workbench/projects/<id>), previewMode flipped false on
  // remount, the bootstrap fell through the previewMode short-circuit,
  // and surfaced the V4ResumePrompt mid-tour. Now the check ALSO
  // reads the sticky sessionStorage flag set by isV4PreviewMode, so a
  // tour started under ?wizard-preview=1 stays in preview mode across
  // navigations until the tab closes.
  const urlPreview = searchParams?.get("wizard-preview") === "1";
  const stickyPreview =
    typeof window !== "undefined" &&
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("researchos:v4-preview-active") === "1";
  const previewMode = urlPreview || stickyPreview;
  const controller = useTourController();
  const [state, setState] = useState<BootstrapState>({ kind: "probing" });

  // One-shot bootstrap. The decision is taken on first mount per user
  // session; subsequent renders (state flips, controller advances) do
  // not re-fire the probe so we never re-summon the prompt mid-tour.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sidecar = await readOnboarding(username);
        if (cancelled) return;

        if (previewMode) {
          // Dev hook (parallels v3's WizardMount). The previous behavior
          // was an unconditional `controller.start()` (or seeded start)
          // which silently wiped progress on any reload while the sticky
          // sessionStorage preview flag was set. R2 chip A Fix 1/3: the
          // wiki-capture-driven `?wizardSeedStep=<id>` path is still the
          // intentional force-start (screenshot scripts seed
          // `wizard_resume_state` themselves and expect the bootstrap
          // to honor the URL). A real user under sticky preview mode
          // with mid-tour progress must NOT lose that progress on hard
          // reload, so we now still consult `wizard_resume_state` and
          // surface the V4ResumePrompt when the saved step is past
          // welcome and no explicit seed is present in the URL.
          // P12 follow-up: previewMode pre-empts the auto-resume flag.
          // Preview is always a force-start (when no real progress is
          // being honored), so any stale flag from a prior session is
          // cleared here too — otherwise a sessionStorage value left
          // over from a real-user reload could bleed into the preview
          // surface.
          if (typeof sessionStorage !== "undefined") {
            try {
              sessionStorage.removeItem(AUTO_RESUME_FLAG);
            } catch {
              // sessionStorage can throw in private-mode / locked-down
              // browsers; swallow and continue.
            }
          }
          // Live-test R7 (2026-05-22 HR): honor `?wizardSeedStep=<id>`
          // when set under preview mode. wiki-capture-mock.ts seeds an
          // `_onboarding.json` with `wizard_resume_state.current_step =
          // seedStep` so screenshot scripts can land directly on a
          // mid-tour step. Previously this branch dropped the seed on
          // the floor (called `controller.start()` with no argument,
          // bootstrapping every preview URL from `welcome`). Now we
          // read `?wizardSeedStep` from the URL, validate it is a real
          // v4 step id via the registry-backed isV4StepId helper, and
          // pass it through to `controller.start(seedStep)`. Invalid /
          // missing seeds fall through to the resume-state-aware path.
          const seedStep = searchParams?.get("wizardSeedStep") ?? null;
          if (seedStep && isV4StepId(seedStep)) {
            controller.start(seedStep);
            setState({ kind: "resolved" });
            return;
          }
          // R2 chip A Fix 1/3: honor mid-tour `wizard_resume_state`
          // under sticky preview mode. If the user has real progress
          // past welcome, surface the V4ResumePrompt (or honor a
          // welcome-step resume as a fresh start) instead of silently
          // restarting from welcome. The dev-hook force-start behavior
          // still applies when there is no meaningful resume state
          // (null OR welcome).
          //
          // R2 chip A Fix 3/3 (approach b): apply the same defensive
          // mid-tour-step + null-picks guard the non-preview branch
          // has below, so preview-mode reload doesn't bypass it.
          const previewResumeId =
            sidecar.wizard_resume_state?.current_step ?? null;
          if (
            previewResumeId &&
            isV4StepId(previewResumeId) &&
            previewResumeId !== "welcome"
          ) {
            if (sidecar.feature_picks === null) {
              console.warn(
                "[onboarding-v4] preview-mode resume_state has mid-tour step",
                previewResumeId,
                "but feature_picks is null; forcing restart from welcome",
              );
              controller.start();
              setState({ kind: "resolved" });
              return;
            }
            setState({
              kind: "v4-resume",
              sidecar,
              resumeStep: previewResumeId,
            });
            return;
          }
          controller.start();
          setState({ kind: "resolved" });
          return;
        }

        // Silent kill flag (emergency brake). Reached only on the
        // non-preview path (preview returned above), so QA's
        // force-walkthrough still works. Resolve to a no-op so a fresh
        // user lands on the normal empty state with no auto-fired tour
        // and no notice. We do NOT touch the sidecar — flipping the flag
        // off later restores normal auto-fire for users who never saw
        // the tour.
        if (V4_TOUR_KILLED) {
          setState({ kind: "resolved" });
          return;
        }

        // Completed / skipped: do nothing. Settings re-run is the
        // only way back in.
        if (sidecar.wizard_completed_at || sidecar.wizard_skipped_at) {
          setState({ kind: "resolved" });
          return;
        }

        // P12 follow-up: auto-resume handoff. If the previous render
        // detected a stuck-404 (no AppShell) when the user clicked
        // Resume, we set a sessionStorage flag and hard-reloaded the
        // target route. On this mount the AppShell should now be there;
        // jump straight to controller.start(savedStep) and skip the
        // modal (re-prompting would be confusing — the user already
        // clicked Resume once). The flag is always cleared, even when
        // the saved step is stale (no longer in TOUR_STEP_ORDER) or
        // AppShell still isn't mounted, so it cannot pin the user in a
        // loop.
        const savedAutoResume = readAutoResumeFlag();
        if (savedAutoResume) {
          clearAutoResumeFlag();
          if (isV4StepId(savedAutoResume) && isAppShellMounted()) {
            controller.start(savedAutoResume);
            setState({ kind: "resolved" });
            return;
          }
          // Stale flag (step removed from the graph, or AppShell still
          // missing). Fall through to the normal sidecar-driven path so
          // the user sees the resume modal again — better than a silent
          // no-op.
        }

        const resumeId = sidecar.wizard_resume_state?.current_step ?? null;
        if (resumeId) {
          if (isV4StepId(resumeId)) {
            // A saved resume at the welcome step has no meaningful
            // progress to ask about (the user has not advanced past
            // the opening card). Treat the same as fresh and start
            // from the first applicable step. Any other v4 step id
            // surfaces the Restart / Resume / Discard modal (P12) so
            // the user opts in to where they pick up rather than
            // silently teleporting.
            if (resumeId === "welcome") {
              controller.start();
              setState({ kind: "resolved" });
              return;
            }
            // Wiki-pointer cluster nav suppression (2026-05-27, wiki-
            // pointer nav fix manager). Historically the cluster's
            // cursor click on the `?` icon navigated the user to a
            // `/wiki/*` route mid-cluster, which remounted V4MountForUser
            // inside the wiki shell, re-ran this probe, and would surface
            // the V4ResumePrompt mid-walk. The suppression flag (set by
            // the click-demo beat, cleared by the back-demo beat) covered
            // that window. 2026-06-03 (HR / tour-simplification): both
            // cursor navigation beats were cut, so no tour step sets the
            // flag anymore and this branch is effectively inert. It is
            // kept as a harmless safety net in case a future cluster beat
            // re-introduces a BeakerBot-driven wiki nav.
            if (
              WIKI_POINTER_STEP_IDS.has(resumeId) &&
              isWikiNavInProgress()
            ) {
              controller.start(resumeId);
              setState({ kind: "resolved" });
              return;
            }
            // R2 chip A Fix 3/3 (approach b): defensive guard against
            // inconsistent sidecar state where current_step is a real
            // mid-tour step but feature_picks is null. This can happen
            // when Restart cleared picks but the user closed the tab
            // mid-run before re-answering Q1-Q6 (the P12 persist effect
            // wrote the new mid-tour step into resume_state, but picks
            // is still null because they never made it through setup).
            // Resuming at a mid-tour step with null picks mis-gates
            // every conditional step (e.g., lab-cluster steps gate on
            // picks.account_type, purchases-tab on picks.purchases,
            // etc.) — the user lands in a tour that's missing half its
            // surface. Force a clean restart from welcome with a
            // console warning so this case is visible in logs.
            if (sidecar.feature_picks === null) {
              console.warn(
                "[onboarding-v4] resume_state has mid-tour step",
                resumeId,
                "but feature_picks is null; forcing restart from welcome",
              );
              controller.start();
              setState({ kind: "resolved" });
              return;
            }
            setState({ kind: "v4-resume", sidecar, resumeStep: resumeId });
            return;
          }
          // v3-in-flight: surface the prompt before auto-starting v4
          // so the user gets a chance to opt out cleanly.
          setState({ kind: "v3-inflight", sidecar });
          return;
        }

        // Fresh user (no completion, no skip, no resume state) ->
        // kick off v4 at the first applicable step.
        controller.start();
        setState({ kind: "resolved" });
      } catch (err) {
        console.error("[onboarding-v4] bootstrap probe failed", err);
        if (!cancelled) setState({ kind: "resolved" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally only on username + previewMode. The controller
    // identity is stable across renders and we don't want a re-probe
    // when start() flips currentStep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, previewMode]);

  const { start, setFeaturePicks } = controller;
  const handleRestart = useCallback(async () => {
    try {
      await patchOnboarding(username, (cur) => ({
        ...cur,
        wizard_resume_state: null,
      }));
    } catch (err) {
      console.error("[onboarding-v4] v3-inflight restart patch failed", err);
    }
    start();
    setState({ kind: "resolved" });
  }, [username, start]);

  const handleSkip = useCallback(async () => {
    try {
      await patchOnboarding(username, (cur) => ({
        ...cur,
        wizard_skipped_at: new Date().toISOString(),
        wizard_force_show: false,
        wizard_resume_state: null,
      }));
    } catch (err) {
      console.error("[onboarding-v4] v3-inflight skip patch failed", err);
    }
    setState({ kind: "resolved" });
  }, [username]);

  // P12: Resume modal handlers. The modal renders when the user has a
  // valid v4 resume_state pointing at a non-welcome step. Three paths:
  //
  //   - Resume: keep `wizard_resume_state` + `feature_picks` intact,
  //     call controller.start(resumeStep). The user lands exactly
  //     where they left off.
  //   - Restart: clear `wizard_resume_state` AND `feature_picks` so
  //     Q1-Q6 are fresh, call controller.start() to begin at welcome.
  //     `feature_picks` is wiped because restarting the tour without
  //     wiping picks would leave the gating machine in a half-state
  //     (e.g., lab steps still gated based on stale Q1).
  //   - Discard: set `wizard_skipped_at` to now, clear resume_state,
  //     no controller.start(). The user exits the tour entirely; the
  //     Settings re-run path is the only way back in.
  const handleResume = useCallback(async () => {
    if (state.kind !== "v4-resume") return;
    const target = state.resumeStep;
    setState({ kind: "resolved" });

    // P12 follow-up: stuck-404 mitigation. The Resume modal is portaled
    // onto document.body, which means it renders fine even when the
    // underlying page failed to compile and Next.js fell back to its
    // built-in 404 surface (the exact failure mode Grant hit after
    // killing + restarting the dev server). In that state:
    //   1. The patch sidecar call still succeeds.
    //   2. controller.start(target) flips internal state but there is
    //      no AppShell mounted to render the next step into, so nothing
    //      visible happens.
    //   3. The controller's expectedRoute effect calls router.push to
    //      the target, but router.push on the same path is a silent
    //      no-op — and even if it pushed, the 404 page wouldn't
    //      reactively re-render into the real route.
    // The user sees: same 404, same speech bubble overlaying it.
    // Soft-lock. Force a hard reload of the target route instead so
    // Next.js gets a fresh compile pass and the real AppShell renders.
    // The sidecar's `wizard_resume_state` is untouched (we don't even
    // patch it on Resume), so the auto-resume flag plus the original
    // sidecar entry combine to put the user back on the right step
    // after the reload.
    if (!isAppShellMounted()) {
      writeAutoResumeFlag(target);
      if (typeof window !== "undefined") {
        window.location.href = computeExpectedRoute(target);
      }
      return;
    }

    // TourStepId is a free-form string alias; isV4StepId guarded the
    // value before we transitioned into "v4-resume", so it is safe to
    // hand straight to start() without re-validating.
    start(target);
  }, [state, start]);

  const handleRestartV4 = useCallback(async () => {
    // Clear the wiki-pointer nav suppression flag (defensive). If the
    // user wound up at the resume modal while a stale flag was hanging
    // around (rare, but possible if the previous run was force-killed
    // mid-cluster), restarting must not leave it set for the next mount.
    clearWikiPointerNavActive();
    try {
      // R2 chip A Fix 3/3 (approach a): explicitly seed
      // wizard_resume_state to { current_step: "welcome", ... } rather
      // than nulling it. The previous null-patch left a brief window
      // where, if the user closed the browser between Restart and the
      // P12 persist effect firing for the new welcome step, the resume
      // state could be inconsistent with feature_picks (picks: null but
      // resume_state: null — fine in isolation, but if a stale write
      // beat us we'd be in trouble). Seeding welcome explicitly makes
      // the post-Restart sidecar a coherent "fresh-but-not-quite-empty"
      // shape: feature_picks: null + current_step: welcome, which the
      // bootstrap special-cases as fresh-start (the "resume at welcome
      // means treat as fresh" branch in the probe).
      await patchOnboarding(username, (cur) => ({
        ...cur,
        wizard_resume_state: {
          current_step: "welcome",
          skipped_steps: [],
          artifacts_created: cur.wizard_resume_state?.artifacts_created ?? [],
        },
        feature_picks: null,
      }));
    } catch (err) {
      console.error("[onboarding-v4] resume-modal restart patch failed", err);
    }
    setState({ kind: "resolved" });
    setFeaturePicks(null);
    start();
  }, [username, setFeaturePicks, start]);

  const handleDiscard = useCallback(async () => {
    // Clear the wiki-pointer nav suppression flag (defensive). Discard
    // ends the tour entirely; any leftover suppression flag must not
    // bleed into the next session where it could falsely suppress a
    // legitimate resume modal.
    clearWikiPointerNavActive();
    // Chip E (2026-05-26): Discard now runs the SAME auto-cleanup
    // sweep as tour-goodbye so tour-created artifacts (most notably
    // the step-1 project) do not survive as orphans on disk. The
    // previous behavior wrote `wizard_skipped_at` and cleared
    // `wizard_resume_state` but left every `artifacts_created` row
    // alive — a user who came back days after starting the tour and
    // picked "Discard" was left with an unwanted project, plus any
    // method categories / experiments / etc. spawned by partial walks.
    //
    // Critical difference from tour-goodbye: pass `firstProjectId:
    // null`. The "preserve the first project" rule exists for the
    // happy-path user who completes the tour and wants a real working
    // project to keep. A user who explicitly chose Discard does not
    // want any of the tour's residue, including the first project, so
    // it must NOT qualify for that exemption. The other two
    // preservation rules (settings_change, ai_helper_prompt_copied)
    // are hardcoded inside `runEndOfTourAutoCleanup` and remain
    // active — color / animation tweaks and clipboard-write artifacts
    // are non-deletable by design.
    //
    // `runEndOfTourAutoCleanup` itself ends with a sidecar patch that
    // sets `wizard_completed_at`. We follow it with a second patch
    // that flips the sidecar to the skipped state (`wizard_skipped_at`
    // set, `wizard_completed_at` cleared, feature_picks wiped per the
    // R2 chip A Fix 2/3 contract). The two patches are sequential so
    // the final on-disk shape is correct regardless of intermediate
    // values.
    try {
      await runEndOfTourAutoCleanup({ username, firstProjectId: null });
    } catch (err) {
      // The auto-cleanup function is best-effort and never throws
      // internally, but guard anyway so a future regression in that
      // contract cannot wedge the Discard flow.
      console.warn(
        "[onboarding-v4] resume-modal discard auto-cleanup failed",
        err,
      );
    }
    try {
      // R2 chip A Fix 2/3: Discard must clear feature_picks too.
      // Without this, stale partial Q1-Q6 answers from the in-flight
      // run keep driving tab visibility (deriveVisibleTabs falls back
      // to settings.json only when picks === null). The user explicitly
      // chose to discard the tour, so leaving their half-answered
      // feature_picks in place would silently keep tabs hidden that
      // their actual settings.json wants visible.
      //
      // Chip E follow-up: this patch ALSO nulls `wizard_completed_at`
      // because the upstream auto-cleanup call sets it; Discard is a
      // skip, not a completion, and the two timestamps are mutually
      // exclusive per the sidecar schema.
      await patchOnboarding(username, (cur) => ({
        ...cur,
        wizard_skipped_at: new Date().toISOString(),
        wizard_completed_at: null,
        wizard_force_show: false,
        wizard_resume_state: null,
        feature_picks: null,
      }));
    } catch (err) {
      console.error("[onboarding-v4] resume-modal discard patch failed", err);
    }
    setState({ kind: "resolved" });
  }, [username]);

  if (state.kind === "v3-inflight") {
    return (
      <V3InflightPrompt onRestart={handleRestart} onSkip={handleSkip} />
    );
  }

  if (state.kind === "v4-resume") {
    return (
      <V4ResumePrompt
        onResume={handleResume}
        onRestart={handleRestartV4}
        onDiscard={handleDiscard}
      />
    );
  }

  return null;
}

const V4_STEP_SET: ReadonlySet<string> = new Set(TOUR_STEP_ORDER);

/** True when the step id belongs to v4's step graph. v3 step ids
 *  ("intro", "W3", "L4" etc.) return false and trigger the v3-inflight
 *  prompt. */
export function isV4StepId(stepId: string): boolean {
  return V4_STEP_SET.has(stepId);
}

interface V3InflightPromptProps {
  onRestart: () => void;
  onSkip: () => void;
}

/**
 * One-shot modal for users who had a v3 walkthrough in flight (a non-v4
 * `wizard_resume_state.current_step`) at the moment v4 activates. Two
 * buttons:
 *
 *   - Restart: clears `wizard_resume_state`, calls
 *     `controller.start()` so v4 begins at the welcome step.
 *   - Skip: writes `wizard_skipped_at`, clears `wizard_resume_state`.
 *     Settings re-run still works because it clears that field.
 *
 * The modal mirrors v3's `WizardResumeModal` chrome (BeakerBot header,
 * centered card, primary + secondary buttons) so the user's visual
 * vocabulary stays consistent across the v3 -> v4 cutover.
 */
function V3InflightPrompt({ onRestart, onSkip }: V3InflightPromptProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target is client-only.
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome tour updated"
      data-testid="v3-inflight-prompt"
      className="fixed inset-0 z-[350] flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="bg-surface-raised rounded-2xl shadow-2xl ring-1 ring-black/5 border border-border w-[480px] max-w-[calc(100vw-2rem)] mx-4 overflow-hidden">
        <div className="px-7 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-4">
            <div
              aria-hidden
              className="flex-shrink-0"
              style={{ width: 96, height: 96 }}
            >
              <BeakerBot
                pose="waving"
                alive
                direction="right"
                className="w-full h-full text-sky-500"
              />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-meta font-medium text-foreground-muted uppercase tracking-wide">
                Heads up
              </span>
              <h2 className="mt-1 text-heading font-semibold text-foreground">
                Welcome tour updated
              </h2>
            </div>
          </div>
        </div>

        <div className="px-7 py-6 text-body text-foreground-muted leading-relaxed">
          <p>
            We refreshed the welcome tour. You had some progress on the
            old version. Want to start the new one, or skip and keep
            what you have?
          </p>
        </div>

        <div className="px-7 pb-5 pt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onSkip}
            data-testid="v3-inflight-skip"
            className="px-4 py-2 text-body font-medium border border-border bg-surface-sunken text-foreground rounded-lg hover:bg-border transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onRestart}
            data-testid="v3-inflight-restart"
            className="px-4 py-2 text-body font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
          >
            Restart
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface V4ResumePromptProps {
  onResume: () => void;
  onRestart: () => void;
  onDiscard: () => void;
}

/**
 * P12 Restart / Resume / Discard modal for users who have a v4 mid-tour
 * `wizard_resume_state.current_step` set to a non-welcome v4 step. Grant
 * flagged every-refresh-snapping-to-welcome as a blocker; the modal
 * lets him pick:
 *
 *   - Resume (default focus, primary action): pick up where left off.
 *     Keeps both `wizard_resume_state` and `feature_picks` intact.
 *   - Restart: blow away `wizard_resume_state` AND `feature_picks` so
 *     Q1-Q6 are fresh, start at welcome.
 *   - Discard: write `wizard_skipped_at`, clear resume_state, exit the
 *     tour. Settings re-run is the only way back in.
 *
 * Mirrors the V3InflightPrompt chrome (BeakerBot header, centered card,
 * sky-blue primary) so the visual vocabulary stays consistent.
 */
function V4ResumePrompt({
  onResume,
  onRestart,
  onDiscard,
}: V4ResumePromptProps) {
  const [mounted, setMounted] = useState(false);
  const resumeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target is client-only.
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    // Default-focus the Resume button so the keyboard happy path
    // (Enter to continue) matches Grant's expected flow on every
    // refresh: continue what you were doing.
    resumeRef.current?.focus();
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Continue your welcome tour?"
      data-testid="v4-resume-prompt"
      className="fixed inset-0 z-[350] flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="bg-surface-raised rounded-2xl shadow-2xl ring-1 ring-black/5 border border-border w-[480px] max-w-[calc(100vw-2rem)] mx-4 overflow-hidden">
        <div className="px-7 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-4">
            <div
              aria-hidden
              className="flex-shrink-0"
              style={{ width: 96, height: 96 }}
            >
              <BeakerBot
                pose="waving"
                alive
                direction="right"
                className="w-full h-full text-sky-500"
              />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-meta font-medium text-foreground-muted uppercase tracking-wide">
                Welcome tour
              </span>
              <h2 className="mt-1 text-heading font-semibold text-foreground">
                Continue your welcome tour?
              </h2>
            </div>
          </div>
        </div>

        <div className="px-7 py-6 text-body text-foreground-muted leading-relaxed">
          <p>
            You were partway through setting up ResearchOS. Pick up
            where you left off, restart from the beginning, or skip the
            tour entirely.
          </p>
        </div>

        <div className="px-7 pb-5 pt-2 flex items-center justify-end gap-3 flex-wrap">
          <button
            type="button"
            onClick={onDiscard}
            data-testid="v4-resume-discard"
            className="px-4 py-2 text-body font-medium border border-border bg-surface-sunken text-foreground rounded-lg hover:bg-border transition-colors"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onRestart}
            data-testid="v4-resume-restart"
            className="px-4 py-2 text-body font-medium border border-border bg-surface-sunken text-foreground rounded-lg hover:bg-border transition-colors"
          >
            Restart
          </button>
          <button
            ref={resumeRef}
            type="button"
            onClick={onResume}
            data-testid="v4-resume-resume"
            className="px-4 py-2 text-body font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
          >
            Resume
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
