"use client";

import { useEffect, useState } from "react";
import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";
import CloudProviderBeat from "@/components/picker-walkthrough/CloudProviderBeat";
import FolderChoiceBeat, {
  type FolderChoice,
} from "@/components/picker-walkthrough/FolderChoiceBeat";
import SecurityBeat from "@/components/picker-walkthrough/SecurityBeat";
import SkipLink from "@/components/picker-walkthrough/SkipLink";
import SpeechBubble from "@/components/picker-walkthrough/SpeechBubble";
import WelcomeBeat from "@/components/picker-walkthrough/WelcomeBeat";

/**
 * Picker walkthrough modal (opt-in).
 *
 * Hosts the 4-beat intro (welcome → security → folder-choice →
 * cloud-provider) that used to fire automatically as a pre-onboarding
 * gate (retired in 75c6107b). The 4 beats are now reachable ONLY by
 * the explicit walkthrough CTA on the folder picker; returning users
 * (and anyone who just wants to get to work) skip the whole thing.
 *
 * State machine (linear, with one conditional branch):
 *
 *   welcome           → security
 *   security          → folder-choice
 *   folder-choice + local  → close
 *   folder-choice + cloud  → cloud-provider
 *   cloud-provider    → close
 *   ANY               → close (via the skip link in the corner)
 *
 * The modal is a controlled component: the parent owns `open` and
 * `onClose`. When `open` is false the modal renders nothing. Close
 * is what fires on Skip + on completion of Beat 4 + on Beat 3's
 * local-folder branch. The modal does NOT touch the file system or
 * trigger folder linking; the user always returns to the picker
 * (which is the surface that owns the actual link / create flows).
 *
 * No persistence: the modal is purely opt-in, so we do not remember
 * that the user took it. Reopening is a one-click decision they make
 * each time on the picker.
 */
export interface PickerWalkthroughModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = "welcome" | "security" | "folder-choice" | "cloud-provider";

// BeakerBot pose per beat: waving / pointing / thinking / pointing-down
// across the 4 beats. The folder-picker handoff happens via onClose,
// not as a 5th beat, so cheering does not appear here.
const BEAT_POSE: Record<Step, BeakerBotPose> = {
  welcome: "waving",
  security: "pointing",
  "folder-choice": "thinking",
  "cloud-provider": "pointing-down",
};

export default function PickerWalkthroughModal({
  open,
  onClose,
}: PickerWalkthroughModalProps) {
  const [step, setStep] = useState<Step>("welcome");
  // `dismissing` guards against double-fire if a user double-clicks
  // the final CTA or the skip link between the click event and the
  // onClose cycle.
  const [dismissing, setDismissing] = useState(false);

  // Escape closes the modal. role="dialog" + aria-modal="true" promise
  // dialog semantics so the keyboard shortcut is expected; without this
  // hook the only way out was the skip link. Window-level keydown matches
  // the lightweight popover pattern elsewhere in the codebase (e.g.
  // DevForceWalkthroughButton). The listener is gated on `open` so it
  // does not steal Escape on screens where the modal is hidden.
  // (panel mechanical fixes, 2026-05-26)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dismissing) return;
      setDismissing(true);
      setStep("welcome");
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, dismissing, onClose]);

  if (!open) return null;

  // Reset to the welcome beat + clear the dismiss guard before notifying
  // the parent so a subsequent reopen starts fresh. We do this inline
  // rather than in an effect because react-hooks lint forbids
  // setState-in-effect on the open→close transition, and the parent
  // unmounts us anyway via `open=false` (so the state set here only
  // matters for the very next reopen).
  const finish = () => {
    if (dismissing) return;
    setDismissing(true);
    setStep("welcome");
    onClose();
  };

  const handleFolderChoice = (choice: FolderChoice) => {
    if (choice === "local") {
      // Local users skip the cloud-provider beat entirely and go
      // straight back to the picker.
      finish();
      return;
    }
    setStep("cloud-provider");
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95 px-4 py-6 backdrop-blur-sm"
      data-picker-walkthrough="active"
      data-picker-walkthrough-step={step}
      role="dialog"
      aria-modal="true"
      aria-label="ResearchOS walkthrough"
    >
      {/* Skip link anchors to the full-screen dialog (true top-right
          corner of the viewport) rather than the centered card. */}
      <SkipLink onSkip={finish} disabled={dismissing} />
      <div className="relative flex w-full max-w-2xl flex-col items-center">
        {/* BeakerBot mascot. ~144px reads larger than the v4 tour's 120px
            (the user's first impression of the character) without
            crowding the speech bubble on smaller viewports. */}
        <div
          className="mb-1 flex h-36 w-36 items-center justify-center text-sky-500"
          data-testid="picker-walkthrough-mascot"
        >
          <BeakerBot
            pose={BEAT_POSE[step]}
            className="h-full w-full text-sky-300"
            ariaLabel="BeakerBot"
            easterEgg="heart"
          />
        </div>

        <SpeechBubble testId={`picker-walkthrough-bubble-${step}`}>
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
      </div>
    </div>
  );
}
