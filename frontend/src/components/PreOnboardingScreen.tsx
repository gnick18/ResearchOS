"use client";

import { useEffect, useState } from "react";
import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";
import {
  hasSeenPreOnboarding,
  markPreOnboardingSeen,
  resetPreOnboardingSeen,
} from "@/lib/pre-onboarding/pre-onboarding-storage";
import CloudProviderBeat from "@/components/pre-onboarding/CloudProviderBeat";
import CredentialsFooter from "@/components/pre-onboarding/CredentialsFooter";
import FolderChoiceBeat, {
  type FolderChoice,
} from "@/components/pre-onboarding/FolderChoiceBeat";
import SecurityBeat from "@/components/pre-onboarding/SecurityBeat";
import SkipLink from "@/components/pre-onboarding/SkipLink";
import SpeechBubble from "@/components/pre-onboarding/SpeechBubble";
import WelcomeBeat from "@/components/pre-onboarding/WelcomeBeat";

/**
 * Pre-onboarding screen — P1.
 *
 * Hosts the 4-beat intro (welcome → security → folder-choice →
 * cloud-provider) and dismisses into the existing DataSetupScreen
 * once the user finishes or skips. See PRE_ONBOARDING_PROPOSAL.md for
 * the locked design (8 design locks, §3) and per-beat copy spec (§6).
 *
 * State machine (linear, with one conditional branch):
 *
 *   welcome           → security
 *   security          → folder-choice
 *   folder-choice + local  → done
 *   folder-choice + cloud  → cloud-provider
 *   cloud-provider    → done
 *   ANY               → done (via the skip link in the corner)
 *
 * `done` synchronously calls `markPreOnboardingSeen()` + `onComplete()`.
 * providers.tsx flips its gate flag and ResearchFolderSetupNew takes
 * over (existing P0 wiring — nothing changes downstream).
 *
 * Chrome (per L6 in the proposal): full-screen takeover with the same
 * dim gradient backdrop as the v4 setup modal. BeakerBot is rendered
 * large above a white speech bubble that hosts the beat-specific
 * content. A small skip link sits in the top-right corner.
 */
export interface PreOnboardingScreenProps {
  onComplete: () => void;
}

type Step = "welcome" | "security" | "folder-choice" | "cloud-provider";

// BeakerBot pose per beat. Pulled from proposal §6 — the proposal calls
// for "waving / pointing / thinking / pointing-down / cheering" across
// the 5 beats. For the 4-beat P1 surface we use waving / pointing /
// thinking / pointing-down. The folder-picker handoff happens at the
// END of beat 4, not as a 5th beat, so cheering does not appear in P1.
const BEAT_POSE: Record<Step, BeakerBotPose> = {
  welcome: "waving",
  security: "pointing",
  "folder-choice": "thinking",
  "cloud-provider": "pointing-down",
};

export default function PreOnboardingScreen({
  onComplete,
}: PreOnboardingScreenProps) {
  // Manual-QA reset hook (preserved from P0). On mount: if the URL has
  // `?reset-pre-onboarding=1`, clear the seen flag and strip the param
  // so a refresh does not keep wiping state. The gate predicate has
  // already fired by the time we run here, so this only affects the
  // NEXT cold load.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("reset-pre-onboarding") === "1") {
        resetPreOnboardingSeen();
        params.delete("reset-pre-onboarding");
        const next =
          window.location.pathname +
          (params.toString() ? `?${params.toString()}` : "") +
          window.location.hash;
        window.history.replaceState(null, "", next);
      }
    } catch {
      // URL parsing / history mutation can fail in exotic embeds;
      // never crash the screen over a dev hook.
    }
  }, []);

  const [step, setStep] = useState<Step>("welcome");
  // `dismissing` guards against double-fire if a user double-clicks
  // the final CTA or the skip link between the click event and the
  // onComplete cycle.
  const [dismissing, setDismissing] = useState(false);

  const finish = () => {
    if (dismissing) return;
    setDismissing(true);
    markPreOnboardingSeen();
    onComplete();
  };

  const handleFolderChoice = (choice: FolderChoice) => {
    if (choice === "local") {
      // Local users skip the cloud-provider beat entirely and go
      // straight to the folder picker.
      finish();
      return;
    }
    setStep("cloud-provider");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-6"
      data-pre-onboarding-screen="active"
      data-pre-onboarding-step={step}
      role="dialog"
      aria-modal="true"
      aria-label="ResearchOS pre-onboarding"
    >
      {/* Skip link anchors to the full-screen dialog (true top-right
          corner of the viewport) rather than the centered card. Inside
          a max-w-2xl container it sat next to the mascot at wide
          viewports, which read as crowded: a first-time visitor scans
          screen corners for escape hatches, not card edges. Moved up
          on 2026-05-25 by the pre-onboarding fresh-eyes verifier. */}
      <SkipLink onSkip={finish} disabled={dismissing} />
      <div className="relative flex w-full max-w-2xl flex-col items-center">

        {/* BeakerBot mascot. ~144px reads larger than the v4 tour's 120px
            (the user's first impression of the character, per the
            proposal §4.3) without crowding the speech bubble on smaller
            viewports. */}
        <div
          className="mb-1 flex h-36 w-36 items-center justify-center text-sky-500"
          data-testid="pre-onboarding-mascot"
        >
          <BeakerBot
            pose={BEAT_POSE[step]}
            className="h-full w-full text-sky-300"
            ariaLabel="BeakerBot"
            easterEgg="tickle"
          />
        </div>

        <SpeechBubble testId={`pre-onboarding-bubble-${step}`}>
          {step === "welcome" && (
            <WelcomeBeat onNext={() => setStep("security")} />
          )}
          {step === "security" && (
            <SecurityBeat onNext={() => setStep("folder-choice")} />
          )}
          {step === "folder-choice" && (
            <FolderChoiceBeat onContinue={handleFolderChoice} />
          )}
          {step === "cloud-provider" && (
            <CloudProviderBeat onContinue={finish} />
          )}
        </SpeechBubble>
        {/* Persistent credentials strip across all beats. Authority
            signal added 2026-05-25 per Grant: a first-time researcher
            needs to see "real academic project, not a data-harvesting
            scheme" structurally, before the security beat lands. */}
        <CredentialsFooter />
      </div>
    </div>
  );
}

// Re-export the persistence read so callers (providers.tsx gate, dev
// tooling) can hit a single import path rather than reaching into the
// lib folder directly. Preserved from the P0 surface.
export { hasSeenPreOnboarding };
