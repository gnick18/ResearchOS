"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  patchOnboarding,
  readOnboarding,
  type OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import { isFreshUserForWizard } from "@/lib/onboarding/is-fresh-user";
import OnboardingWizardV3 from "./OnboardingWizardV3";
import WizardResumeModal from "./WizardResumeModal";
import type { WizardStep } from "./WizardStepMachine";

/**
 * Gate + mount logic for the Onboarding v3 wizard. Reads the sidecar
 * v4 on the active user, decides whether to mount, then renders the
 * wizard with the appropriate persistence callbacks.
 *
 * Mount precedence is **locked** (master 2026-05-20 relay):
 *
 *   ?wizard-preview=1 alone                 → real account, wizard ALWAYS shown (dev hook)
 *   ?wikiCapture=1 alone                    → fixture mode, wizard HIDDEN by default
 *   ?wikiCapture=1&wizard-preview=1         → fixture mode WITH wizard shown (wiki manager
 *                                              screenshot path for P6)
 *   neither flag                            → standard §11 gating
 *
 * The fixture × preview combined case is enforced INSIDE
 * `OnboardingProvider` at the top of orchestrator.tsx (line 71's
 * `!wizardPreviewMode` short-circuit lets `wizard-preview=1` through
 * even when `?wikiCapture=1` is set). This component only sees the
 * "neither flag" case OR the combined fixture-plus-preview case (and
 * the real-account-plus-preview case) — meaning the gate-by-fixture
 * decision is already made by the time we render.
 *
 * Auto-fire rule (§11, summarized):
 *   1. `_user_metadata` is empty OR has no mainUser (handled upstream;
 *       OnboardingProvider returns children-only when currentUser is null)
 *   2. AND `_onboarding.json` is absent OR has no wizard_completed_at
 *       AND no wizard_skipped_at
 *   3. UNLESS `wizard_force_show === true` (Settings "Re-run welcome
 *       tour" button OR the DevForceTipButton override)
 *
 * Existing-user invariant (L1/L22): any pre-v4 sidecar record migrates
 * to v4 with `feature_picks = null` AND `wizard_force_show = false`.
 * The check below honors that — an existing user's wizard does NOT
 * auto-mount; only `clearWizardCompletion()` (which flips
 * `wizard_force_show = true`) opens the door.
 */

interface WizardMountProps {
  username: string;
}

export default function WizardMount({ username }: WizardMountProps) {
  const searchParams = useSearchParams();
  const previewMode = searchParams?.get("wizard-preview") === "1";

  const [decision, setDecision] = useState<
    | { kind: "loading" }
    | { kind: "hidden" }
    | { kind: "show"; sidecar: OnboardingSidecar; initialStep: WizardStep }
  >({ kind: "loading" });

  // P5: the L10 resume modal sits in front of the wizard shell when the
  // sidecar carries a non-null `wizard_resume_state` and the wizard
  // would otherwise mount. `modalResolved` flips to true once the user
  // picks Resume / Restart / Discard so a parent re-render (sidecar
  // patch from elsewhere, etc.) does not re-summon the modal in the
  // same session.
  const [modalResolved, setModalResolved] = useState(false);

  const computeMount = useCallback(async () => {
    try {
      // wizard-preview=1 forces the wizard on regardless of sidecar
      // state. This is the dev / wiki-screenshot path; it must NOT
      // consult `wizard_completed_at` because the whole point of the
      // hook is to preview the wizard against an existing account.
      if (previewMode) {
        const sidecar = await readOnboarding(username);
        const initialStep = resumeStepFromSidecar(sidecar) ?? "intro";
        setDecision({ kind: "show", sidecar, initialStep });
        return;
      }

      // §11 gating below. wizard_force_show short-circuits to true so
      // the Settings re-run button (and the dev DevForceTipButton)
      // always wins, even for a user with a completed wizard.
      const sidecar = await readOnboarding(username);
      if (sidecar.wizard_force_show) {
        const initialStep = resumeStepFromSidecar(sidecar) ?? "intro";
        setDecision({ kind: "show", sidecar, initialStep });
        return;
      }
      if (sidecar.wizard_completed_at || sidecar.wizard_skipped_at) {
        setDecision({ kind: "hidden" });
        return;
      }
      // Existing-user invariant: pre-v4 sidecars normalize to
      // feature_picks=null + wizard_force_show=false. The only way a
      // user with a pre-existing sidecar reaches this branch with
      // feature_picks=null AND wizard_force_show=false AND no
      // completed/skipped timestamp is if the migration just ran AND
      // they never finished v2. v2's completed/skipped fields are
      // preserved across the v3 → v4 migration, so they should
      // already be hidden above. But the fresh-user check below is
      // the authoritative gate — only true freshness opens the door.
      const fresh = await isFreshUserForWizard(username);
      if (!fresh) {
        setDecision({ kind: "hidden" });
        return;
      }
      const initialStep = resumeStepFromSidecar(sidecar) ?? "intro";
      setDecision({ kind: "show", sidecar, initialStep });
    } catch (err) {
      console.error("[onboarding-v3] mount probe failed", err);
      setDecision({ kind: "hidden" });
    }
  }, [previewMode, username]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount probe is async I/O (sidecar read + fresh-user probe); setState fires only after the awaits complete, not synchronously.
    void computeMount();
  }, [computeMount]);

  const handleTransition = useCallback(
    async (next: WizardStep) => {
      const updated = await patchOnboarding(username, (cur) => ({
        ...cur,
        wizard_resume_state: {
          current_step: next,
          skipped_steps: cur.wizard_resume_state?.skipped_steps ?? [],
          artifacts_created:
            cur.wizard_resume_state?.artifacts_created ?? [],
        },
      }));
      setDecision((prev) =>
        prev.kind === "show"
          ? { kind: "show", sidecar: updated, initialStep: next }
          : prev,
      );
    },
    [username],
  );

  const handlePatch = useCallback(
    async (patch: (cur: OnboardingSidecar) => OnboardingSidecar) => {
      const updated = await patchOnboarding(username, patch);
      setDecision((prev) =>
        prev.kind === "show"
          ? { ...prev, sidecar: updated }
          : prev,
      );
    },
    [username],
  );

  const handleComplete = useCallback(async () => {
    await patchOnboarding(username, (cur) => ({
      ...cur,
      wizard_completed_at: new Date().toISOString(),
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
    }));
    setDecision({ kind: "hidden" });
  }, [username]);

  const handleSkip = useCallback(async () => {
    // L8: "I've got it from here" jumps to the cleanup grid. P4 will
    // ship the real grid; for P1 the placeholder cleanup step
    // immediately resolves on Finish, which the OnboardingWizardV3
    // routes through `onSkip` too. We persist wizard_skipped_at and
    // clear resume state here; the wizard unmounts via the decision
    // flip below.
    await patchOnboarding(username, (cur) => ({
      ...cur,
      wizard_skipped_at: new Date().toISOString(),
      wizard_force_show: false,
      wizard_resume_state: null,
    }));
    setDecision({ kind: "hidden" });
  }, [username]);

  if (decision.kind !== "show") return null;

  // P5 (§8 L10): if the sidecar carries a non-null wizard_resume_state
  // and the user has not yet resolved the modal in this session, the
  // mid-walkthrough close modal renders in place of the wizard shell.
  // The modal's three buttons all converge back into the same parent
  // state (modalResolved=true plus an optional initialStep override) so
  // the wizard mounts at the right step once the modal dismisses.
  const resumeState = decision.sidecar.wizard_resume_state;
  if (resumeState && !modalResolved) {
    return (
      <WizardResumeModal
        username={username}
        resumeState={resumeState}
        onResume={(savedStep) => {
          setDecision((prev) =>
            prev.kind === "show"
              ? { ...prev, initialStep: savedStep }
              : prev,
          );
          setModalResolved(true);
        }}
        onRestart={() => {
          // Restart wrote `wizard_resume_state = null` inside the modal;
          // we drop our cached copy and mount the wizard at intro.
          setDecision((prev) =>
            prev.kind === "show"
              ? {
                  ...prev,
                  sidecar: { ...prev.sidecar, wizard_resume_state: null },
                  initialStep: "intro",
                }
              : prev,
          );
          setModalResolved(true);
        }}
        onDiscard={() => {
          // Discard persisted `wizard_skipped_at`; the wizard does not
          // mount this session. Settings re-run still works because
          // clearWizardCompletion() clears wizard_skipped_at.
          setDecision({ kind: "hidden" });
          setModalResolved(true);
        }}
      />
    );
  }

  return (
    <OnboardingWizardV3
      username={username}
      initialStep={decision.initialStep}
      sidecar={decision.sidecar}
      onTransition={handleTransition}
      patchSidecar={handlePatch}
      onComplete={handleComplete}
      onSkip={handleSkip}
      previewMode={previewMode}
    />
  );
}

/** Pull a resume step out of the sidecar's wizard_resume_state. The
 *  P5 resume modal sits in front of the wizard shell when this returns
 *  a non-null step; users pick Resume (mount at this step), Restart
 *  (mount at intro), or Discard (skip). The initialStep we hand back
 *  here is what the wizard sees AFTER the modal resolves to Resume. */
function resumeStepFromSidecar(
  sidecar: OnboardingSidecar | null,
): WizardStep | null {
  const step = sidecar?.wizard_resume_state?.current_step;
  if (!step) return null;
  return step as WizardStep;
}
