import { useEffect } from "react";

/**
 * Welcome (intro) step body. The 2-sentence elevator pitch from
 * ONBOARDING_V3_PROPOSAL.md §4 Step 0, rendered verbatim.
 *
 * The footer buttons "Let's go" (Next) and the persistent "I've got it
 * from here" link cover the two button choices the proposal lists; this
 * body only owns the heading + pitch. The shell's Next-button label
 * already switches to "Let's go" for the intro step.
 */
interface WelcomeStepProps {
  setNextDisabled: (disabled: boolean) => void;
}

export default function WelcomeStep({ setNextDisabled }: WelcomeStepProps) {
  useEffect(() => {
    // Welcome has no required pick; Next is always enabled.
    setNextDisabled(false);
  }, [setNextDisabled]);

  return (
    <div data-step-id="intro" className="space-y-3">
      <p className="text-base text-gray-700 leading-relaxed">
        ResearchOS keeps your experiments, lab notes, methods, and calendar
        in one local-first place. I&apos;m BeakerBot, and I&apos;m gonna
        help you get set up in about ten minutes. Ready?
      </p>
      <p className="text-sm text-gray-500">
        Hit <span className="font-medium text-gray-700">Let&apos;s go</span>{" "}
        when you&apos;re ready, or use{" "}
        <span className="font-medium text-gray-700">
          I&apos;ve got it from here
        </span>{" "}
        to skip straight to the cleanup grid. Anything we make together
        appears there so you can keep it or toss it.
      </p>
    </div>
  );
}
