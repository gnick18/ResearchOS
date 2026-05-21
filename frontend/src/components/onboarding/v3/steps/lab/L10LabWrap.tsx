import { useEffect } from "react";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";

/**
 * L10: Lab Mode tour wrap.
 *
 * Proposal §6 reserves L10 as "merged into L8 if Q2 = No". P3a ships
 * L10 as a thin standalone wrap step so the lab path has a clean
 * closing moment regardless of Q2's value. The state machine already
 * allows L10 unconditionally; the brief permitted either a placeholder
 * or a folded-into-L8 variant. The standalone path keeps the
 * Q2-conditional gating localized to L8 alone.
 *
 * No artifact. Next stays enabled.
 */

interface L10Props {
  setNextDisabled: (disabled: boolean) => void;
}

export default function L10LabWrap({ setNextDisabled }: L10Props) {
  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  return (
    <div data-step-id="L10" className="space-y-4">
      <SpeechBubble>
        That&apos;s Lab Mode. Sharing, edit and view-only flavors,
        revoke, lab Gantt, search, the works. One last thing before we
        wrap, so you can decide what to keep.
      </SpeechBubble>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 leading-relaxed">
        Next we&apos;ll check whether you want me to tidy up the fake
        teammate I made for this demo, or leave them around so you can
        keep experimenting.
      </div>
    </div>
  );
}
