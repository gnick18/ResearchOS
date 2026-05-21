import { useEffect, useState } from "react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";

/**
 * lab-prompt step body — the "Take Lab tour now or later?" gate that
 * fires after W14 (or W9 when no conditional walkthrough applies) for
 * lab accounts. L18 lock: three buttons.
 *
 * Writer contract (P1 design-flag #1 resolution):
 *   - "Take Lab tour now"   → no sidecar write. The state machine sees
 *     no opt-out and routes Next to L1 via `isLabTourActive`.
 *   - "Later"               → patch `lab_tour_pending: true`. The state
 *     machine sees the opt-out and routes Next to phase4-cleanup.
 *     P3b's natural-Lab-Mode-entry trigger reads the same flag to
 *     re-prompt on the user's first navigation into /lab.
 *   - "Dismiss"             → patch `lab_tour_dismissed_at: <ISO>`.
 *     Permanent: P3b never re-fires for this user. Settings re-run
 *     still works.
 *
 * The shell's Next button drives the actual transition. The three
 * buttons here only persist the pick; Next reads `getLabTourDecision`
 * on its next render and chooses the destination. We enable Next when
 * the user has clicked any of the three, and we show a small
 * confirmation strip so the choice is visible before they click Next.
 */

interface LabPromptStepProps {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

type Pick = "now" | "later" | "dismiss" | null;

function pickFromSidecar(sidecar: OnboardingSidecar | null): Pick {
  if (!sidecar) return null;
  if (sidecar.lab_tour_dismissed_at) return "dismiss";
  if (sidecar.lab_tour_pending) return "later";
  return null;
}

export default function LabPromptStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: LabPromptStepProps) {
  // Resume-aware: if the user back-stepped onto this step after picking
  // earlier, we surface that pick from the sidecar fields the writer
  // already wrote. "Now" leaves nothing to read; we track it in local
  // state so the confirmation strip still reflects the current click.
  const persistedPick = pickFromSidecar(sidecar);
  const [pick, setPick] = useState<Pick>(persistedPick);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(pick === null);
  }, [pick, setNextDisabled]);

  const handleNow = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // The "Now" branch clears any previous opt-out so a back-step +
      // re-pick lands the user in L1 cleanly. Without this clear, a
      // user who first picked Later then back-stepped to pick Now
      // would still have `lab_tour_pending: true` in the sidecar and
      // the state machine would route them to phase4-cleanup anyway.
      await patchSidecar((cur) => ({
        ...cur,
        lab_tour_pending: false,
        lab_tour_dismissed_at: null,
      }));
      setPick("now");
    } catch (err) {
      console.error("[onboarding-v3] lab-prompt Now clear failed", err);
      setError("Couldn't save that. Try again or skip this step.");
    } finally {
      setBusy(false);
    }
  };

  const handleLater = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await patchSidecar((cur) => ({
        ...cur,
        lab_tour_pending: true,
        lab_tour_dismissed_at: null,
      }));
      setPick("later");
    } catch (err) {
      console.error("[onboarding-v3] lab-prompt Later persist failed", err);
      setError("Couldn't save that. Try again or skip this step.");
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const dismissedAt = new Date().toISOString();
      await patchSidecar((cur) => ({
        ...cur,
        lab_tour_pending: false,
        lab_tour_dismissed_at: dismissedAt,
      }));
      setPick("dismiss");
    } catch (err) {
      console.error("[onboarding-v3] lab-prompt Dismiss persist failed", err);
      setError("Couldn't save that. Try again or skip this step.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-step-id="lab-prompt" className="space-y-4">
      <SpeechBubble>
        You picked Lab. The Lab Mode tour shows how sharing, permissions,
        and the activity feed work, on a fake teammate I&apos;ll spin up
        for two minutes. Want to do it now, save it for later, or skip it
        entirely?
      </SpeechBubble>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleNow()}
          disabled={busy}
          data-lab-prompt-pick="now"
          className={`px-4 py-3 text-sm font-medium rounded-lg border transition-colors text-left ${
            pick === "now"
              ? "border-sky-500 bg-sky-50 text-sky-900"
              : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
          } disabled:opacity-50`}
        >
          <div className="font-semibold">Take the Lab tour now</div>
          <div className="text-xs text-gray-600 mt-0.5">
            About two minutes. We can wrap up after.
          </div>
        </button>
        <button
          type="button"
          onClick={() => void handleLater()}
          disabled={busy}
          data-lab-prompt-pick="later"
          className={`px-4 py-3 text-sm font-medium rounded-lg border transition-colors text-left ${
            pick === "later"
              ? "border-sky-500 bg-sky-50 text-sky-900"
              : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
          } disabled:opacity-50`}
        >
          <div className="font-semibold">Later</div>
          <div className="text-xs text-gray-600 mt-0.5">
            I&apos;ll prompt you the first time you open Lab Mode on your
            own.
          </div>
        </button>
        <button
          type="button"
          onClick={() => void handleDismiss()}
          disabled={busy}
          data-lab-prompt-pick="dismiss"
          className={`px-4 py-3 text-sm font-medium rounded-lg border transition-colors text-left ${
            pick === "dismiss"
              ? "border-sky-500 bg-sky-50 text-sky-900"
              : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
          } disabled:opacity-50`}
        >
          <div className="font-semibold">Dismiss</div>
          <div className="text-xs text-gray-600 mt-0.5">
            Skip the tour for good. You can re-run from Settings whenever.
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
