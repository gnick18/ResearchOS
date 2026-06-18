"use client";

import { useEffect, useState } from "react";
import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import CloudProviderBeat from "@/components/picker-walkthrough/CloudProviderBeat";
import DataFlowBeat from "@/components/picker-walkthrough/DataFlowBeat";
import FolderChoiceBeat, {
  type FolderChoice,
} from "@/components/picker-walkthrough/FolderChoiceBeat";
import SkipLink from "@/components/picker-walkthrough/SkipLink";
import SpeechBubble from "@/components/picker-walkthrough/SpeechBubble";
import WelcomeBeat from "@/components/picker-walkthrough/WelcomeBeat";
import WhereWorkLivesBeat from "@/components/picker-walkthrough/WhereWorkLivesBeat";
import WhyCheapPrivateBeat from "@/components/picker-walkthrough/WhyCheapPrivateBeat";

/**
 * Picker walkthrough modal (opt-in).
 *
 * Hosts the rewritten 5-beat intro that used to fire automatically as a
 * pre-onboarding gate (retired in 75c6107b). The beats are now reachable
 * ONLY by the explicit walkthrough CTA on the folder picker; returning
 * users (and anyone who just wants to get to work) skip the whole thing.
 *
 * The rewrite (2026-06-18) teaches how the site actually works now: a free
 * account for identity, local-first data, an animated explainer of what
 * touches the cloud and when, why that keeps things cheap and private, and
 * only then the folder setup.
 *
 * Five beats:
 *
 *   1. welcome            Hi, plus the free-account-is-identity line.
 *   2. where-work-lives   Your folder is yours, on your machine.
 *   3. data-flow          The animated DataFlowExplainer (Local/Share/Collab/Cost).
 *   4. why-cheap-private  Cost + privacy both flow from local-first.
 *   5. set up your folder folder-choice (+ conditional cloud-provider).
 *
 * State machine (linear, with one conditional branch in the folder setup):
 *
 *   welcome            -> where-work-lives
 *   where-work-lives   -> data-flow
 *   data-flow          -> why-cheap-private
 *   why-cheap-private  -> folder-choice
 *   folder-choice + local -> close
 *   folder-choice + cloud -> cloud-provider
 *   cloud-provider     -> close
 *   ANY                -> close (via the skip link in the corner)
 *
 * The modal is a controlled component: the parent owns `open` and
 * `onClose`. When `open` is false the modal renders nothing. Close fires on
 * Skip, on the local-folder branch of folder-choice, and on completion of
 * the cloud-provider beat. The modal does NOT touch the file system or
 * trigger folder linking; the user always returns to the picker (which owns
 * the actual link / create flows).
 *
 * No persistence: the modal is purely opt-in, so we do not remember that
 * the user took it. Reopening is a one-click decision each time.
 */
export interface PickerWalkthroughModalProps {
  open: boolean;
  onClose: () => void;
}

type Step =
  | "welcome"
  | "where-work-lives"
  | "data-flow"
  | "why-cheap-private"
  | "folder-choice"
  | "cloud-provider";

// BeakerBot pose per beat: waving / pointing / thinking / pointing /
// thinking / pointing-down across the flow. The folder-picker handoff
// happens via onClose, not as a final beat, so cheering does not appear here.
const BEAT_POSE: Record<Step, BeakerBotPose> = {
  welcome: "waving",
  "where-work-lives": "pointing",
  "data-flow": "thinking",
  "why-cheap-private": "pointing",
  "folder-choice": "thinking",
  "cloud-provider": "pointing-down",
};

export default function PickerWalkthroughModal({
  open,
  onClose,
}: PickerWalkthroughModalProps) {
  const [step, setStep] = useState<Step>("welcome");
  // `dismissing` guards against double-fire if a user double-clicks the
  // final CTA or the skip link between the click event and the onClose cycle.
  const [dismissing, setDismissing] = useState(false);

  // Escape closes the modal. role="dialog" + aria-modal="true" promise
  // dialog semantics so the keyboard shortcut is expected; without this hook
  // the only way out was the skip link. The listener is gated on `open` so it
  // does not steal Escape on screens where the modal is hidden.
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

  // Reset to the welcome beat + clear the dismiss guard before notifying the
  // parent so a subsequent reopen starts fresh.
  const finish = () => {
    if (dismissing) return;
    setDismissing(true);
    setStep("welcome");
    onClose();
  };

  const handleFolderChoice = (choice: FolderChoice) => {
    if (choice === "local") {
      // Local users skip the cloud-provider beat entirely and go straight
      // back to the picker.
      finish();
      return;
    }
    setStep("cloud-provider");
  };

  // The data-flow beat hosts a wide interactive, so widen its card.
  const wide = step === "data-flow";

  return (
    <div
      className="fixed inset-0 z-[110] overflow-y-auto bg-white"
      data-picker-walkthrough="active"
      data-picker-walkthrough-step={step}
      role="dialog"
      aria-modal="true"
      aria-label="ResearchOS walkthrough"
    >
      {/* Unified welcome-page stage: the same soft pastel-rainbow aurora wash
          the welcome and pricing pages sit on, over an opaque light base. This
          replaces the old dark slate overlay carried over from the retired
          pre-onboarding flow. */}
      <MarketingBackdrop tone="vivid" />
      {/* Skip link anchors to the full-screen dialog (true top-right corner
          of the viewport) rather than the centered card. */}
      <SkipLink onSkip={finish} disabled={dismissing} />
      <div className="relative z-10 flex min-h-full items-center justify-center px-4 py-6">
        <div
          className={`relative flex w-full flex-col items-center ${
            wide ? "max-w-3xl" : "max-w-2xl"
          }`}
        >
        {/* BeakerBot mascot. ~144px reads larger than the v4 tour's 120px
            (the user's first impression of the character) without crowding
            the speech bubble on smaller viewports. */}
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

        <SpeechBubble testId={`picker-walkthrough-bubble-${step}`} wide={wide}>
          {step === "welcome" && (
            <WelcomeBeat onNext={() => setStep("where-work-lives")} />
          )}
          {step === "where-work-lives" && (
            <WhereWorkLivesBeat onNext={() => setStep("data-flow")} />
          )}
          {step === "data-flow" && (
            <DataFlowBeat onNext={() => setStep("why-cheap-private")} />
          )}
          {step === "why-cheap-private" && (
            <WhyCheapPrivateBeat onNext={() => setStep("folder-choice")} />
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
    </div>
  );
}
