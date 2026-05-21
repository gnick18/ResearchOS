import { useEffect, useState } from "react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import { BEAKERBOT_DISPLAY_NAME } from "./lib/beakerbot-user";
import { applyLabCleanupDefault } from "./lib/lab-artifacts";

/**
 * L11: BeakerBot cleanup option.
 *
 * Renders three radio buttons:
 *   - Yes, clean up   → sets every lab_user + lab_task artifact's
 *     `cleanup_default` to "discard". Phase 4's cleanup grid then
 *     starts those rows unchecked (default-discard).
 *   - No, keep them   → flips all lab_* artifacts to "keep".
 *   - Decide at end   → leaves the defaults in place (L2 / L4 / L8
 *     all registered with "discard"), and Phase 4 surfaces the rows
 *     unchecked so the user sees them at the cleanup screen.
 *
 * Persists the pick straight into the artifact list, so by the time
 * Phase 4 renders, the per-row defaults already reflect the user's
 * L11 answer. No separate L11 sentinel needed.
 *
 * Next stays enabled once the user has picked an option. The default
 * pick is "decide-end" so the step does not force a click.
 */

interface L11Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

type Pick = "yes" | "no" | "decide-end";

export default function L11BeakerBotCleanupOption({
  sidecar: _sidecar,
  setNextDisabled,
  patchSidecar,
}: L11Props) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [persisting, setPersisting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(pick === null);
  }, [pick, setNextDisabled]);

  const apply = async (choice: Pick) => {
    if (persisting) return;
    setPersisting(true);
    setError(null);
    try {
      await patchSidecar((cur) => {
        if (choice === "yes") return applyLabCleanupDefault(cur, "discard");
        if (choice === "no") return applyLabCleanupDefault(cur, "keep");
        // decide-end: leave defaults as-is (L2/L4/L8 registered "discard").
        return applyLabCleanupDefault(cur, "discard");
      });
      setPick(choice);
    } catch (err) {
      console.error("[onboarding-v3] L11 cleanup pick persist failed", err);
      setError("Couldn't save that. Try again.");
    } finally {
      setPersisting(false);
    }
  };

  return (
    <div data-step-id="L11" className="space-y-4">
      <SpeechBubble>
        Last call. Want me to tidy up the fake {BEAKERBOT_DISPLAY_NAME}
        user and the demo tasks I made? Pick now, or punt the decision
        to the cleanup screen.
      </SpeechBubble>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void apply("yes")}
          disabled={persisting}
          data-l11-pick="yes"
          className={`px-4 py-3 text-sm font-medium rounded-lg border transition-colors text-left ${
            pick === "yes"
              ? "border-sky-500 bg-sky-50 text-sky-900"
              : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
          } disabled:opacity-50`}
        >
          <div className="font-semibold">Yes, clean up the demo</div>
          <div className="text-xs text-gray-600 mt-0.5">
            Discard the fake user and the demo tasks at the cleanup
            screen.
          </div>
        </button>
        <button
          type="button"
          onClick={() => void apply("no")}
          disabled={persisting}
          data-l11-pick="no"
          className={`px-4 py-3 text-sm font-medium rounded-lg border transition-colors text-left ${
            pick === "no"
              ? "border-sky-500 bg-sky-50 text-sky-900"
              : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
          } disabled:opacity-50`}
        >
          <div className="font-semibold">
            No, keep {BEAKERBOT_DISPLAY_NAME} around
          </div>
          <div className="text-xs text-gray-600 mt-0.5">
            Useful if you want to keep practicing sharing / permission
            flavors.
          </div>
        </button>
        <button
          type="button"
          onClick={() => void apply("decide-end")}
          disabled={persisting}
          data-l11-pick="decide-end"
          className={`px-4 py-3 text-sm font-medium rounded-lg border transition-colors text-left ${
            pick === "decide-end"
              ? "border-sky-500 bg-sky-50 text-sky-900"
              : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
          } disabled:opacity-50`}
        >
          <div className="font-semibold">Decide at the cleanup screen</div>
          <div className="text-xs text-gray-600 mt-0.5">
            I&apos;ll show the rows there so you can pick item by item.
          </div>
        </button>
      </div>

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
