import { useEffect } from "react";
import type { SetupStepProps } from "./types";

/**
 * Welcome (intro) step body for v4's Phase 1 modal. 2-sentence elevator
 * pitch from ONBOARDING_V4_PROPOSAL.md §6 intro, ported verbatim from
 * the v3 WelcomeStep. L9 keeps this step modal-contained so the body
 * is purely text + the shell's Next button.
 *
 * Welcome takes the standard SetupStepProps shape so the modal-setup
 * registry can mount every Phase 1 body via one component-prop signature
 * even though Welcome itself ignores `sidecar` + `patchSidecar`.
 */
export default function WelcomeStep({ setNextDisabled }: SetupStepProps) {
  useEffect(() => {
    // Welcome has no required pick; Next is always enabled.
    setNextDisabled(false);
  }, [setNextDisabled]);

  return (
    <div data-step-id="welcome" className="space-y-3">
      <p className="text-base text-gray-700 leading-relaxed">
        ResearchOS keeps your experiments, lab notes, methods, and calendar
        in one local-first place. I&apos;m BeakerBot, and I&apos;m gonna
        get you set up in about ten minutes.
      </p>
      <p className="text-base text-gray-700 leading-relaxed">
        A few things to know going in. I&apos;ll ask you seven quick setup
        questions, then walk you through the pages worth knowing about,
        skipping ones you turned off. I won&apos;t cover every button,
        just enough that you can find the rest on your own.
      </p>
      <p className="text-base text-gray-700 leading-relaxed">
        Anything we build together during the tour gets cleaned up at the
        end. Only your first project stays.
      </p>
      <p className="text-sm text-gray-500">
        Hit <span className="font-medium text-gray-700">Let&apos;s go</span>{" "}
        when you&apos;re ready, or{" "}
        <span className="font-medium text-gray-700">Skip walkthrough</span>{" "}
        to jump straight to your account.
      </p>
    </div>
  );
}
