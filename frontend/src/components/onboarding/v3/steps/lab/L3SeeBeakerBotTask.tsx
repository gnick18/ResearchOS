import { useEffect } from "react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import { BEAKERBOT_DISPLAY_NAME } from "./lib/beakerbot-user";
import { findLabTask, findLabUser } from "./lib/lab-artifacts";

/**
 * L3: See the shared task. Static display + speech bubble. No new
 * artifact: the edit-demo task surfaced here was registered in L2.
 *
 * The wizard shows a mocked Workbench card to demonstrate where the
 * shared task would appear in Lab Mode. The user does not navigate
 * out of the wizard.
 */

interface L3Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
}

export default function L3SeeBeakerBotTask({
  sidecar,
  setNextDisabled,
}: L3Props) {
  const labUser = findLabUser(sidecar);
  const editTask = findLabTask(sidecar, "edit-demo");

  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  const hasShare = labUser !== null && editTask !== null;

  return (
    <div data-step-id="L3" className="space-y-4">
      <SpeechBubble>
        That&apos;s mine! You can see it because I shared it with you.
        In Lab Mode it sits on your shared Workbench, with a little
        colored dot so you can tell whose work is whose.
      </SpeechBubble>

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Lab Workbench, preview
        </div>
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="w-2.5 h-2.5 rounded-full bg-sky-500 flex-shrink-0"
          />
          <div className="flex-1 text-sm text-gray-800">
            <div className="font-medium">
              Experiment from {BEAKERBOT_DISPLAY_NAME}
            </div>
            <div className="text-xs text-gray-500">
              {hasShare
                ? "Shared with you, edit permission"
                : "(Go back to L2 if you skipped the spawn step.)"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
