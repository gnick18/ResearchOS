import { useEffect } from "react";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";

/**
 * L1: What Lab Mode is. Static intro per §6 L1. BeakerBot explains the
 * concept; no artifacts created.
 */

interface L1Props {
  setNextDisabled: (disabled: boolean) => void;
}

export default function L1WhatIsLabMode({ setNextDisabled }: L1Props) {
  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  return (
    <div data-step-id="L1" className="space-y-4">
      <SpeechBubble>
        Lab Mode is where you and your teammates see each other&apos;s
        work. Right now I&apos;m the only other lab member, which is a
        little embarrassing for me. Let me fix that.
      </SpeechBubble>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 leading-relaxed">
        Lab Mode adds a separate Workbench, Gantt, Purchases, and Search
        view that aggregates anything labmates share with you. Your own
        view stays untouched.
      </div>
    </div>
  );
}
