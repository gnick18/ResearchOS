import { useEffect, useState } from "react";
import { sharingApi } from "@/lib/local-api";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import { BEAKERBOT_DISPLAY_NAME, BEAKERBOT_USERNAME } from "./lib/beakerbot-user";

/**
 * L6: Revoke BeakerBot's access on the experiment from L5.
 *
 * Calls sharingApi.unshareTask with the experiment id encoded in the
 * L5 artifact id (`<id>:l5-share-back`). No new artifact registered;
 * the L5 experiment artifact stays in the cleanup grid but no longer
 * has a corresponding share entry on BeakerBot's `_shared_with_me`.
 *
 * If the L5 artifact is missing (user skipped L5), the step renders a
 * pointer back rather than firing an unshare on a non-existent task.
 * Next stays enabled either way.
 */

interface L6Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
}

function findL5Experiment(sidecar: OnboardingSidecar | null) {
  const entries = sidecar?.wizard_resume_state?.artifacts_created ?? [];
  for (const entry of entries) {
    if (entry.type !== "experiment") continue;
    if (entry.id.endsWith(":l5-share-back")) {
      const colonIdx = entry.id.indexOf(":");
      const idStr = entry.id.slice(0, colonIdx);
      const taskId = Number(idStr);
      if (Number.isFinite(taskId)) return taskId;
    }
  }
  return null;
}

export default function L6RevokeShare({ sidecar, setNextDisabled }: L6Props) {
  const taskId = findL5Experiment(sidecar);
  const [revoked, setRevoked] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  const handleRevoke = async () => {
    if (revoking || revoked || taskId === null) return;
    setRevoking(true);
    setError(null);
    try {
      await sharingApi.unshareTask(taskId, BEAKERBOT_USERNAME);
      setRevoked(true);
    } catch (err) {
      console.error("[onboarding-v3] L6 revoke failed", err);
      setError("Couldn't revoke the share. Try again or skip this step.");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div data-step-id="L6" className="space-y-4">
      <SpeechBubble>
        Sharing is a yes-and-no kind of thing. You can pull back access
        any time. {revoked
          ? "Right, gone from my view. Got the memo."
          : "Hit Revoke below and watch me lose my view of your experiment."}
      </SpeechBubble>

      {taskId === null ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Skipped the share-back step? Go back to L5 if you want to try
          revoking, otherwise just hit Next.
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
          <div className="text-sm text-gray-800">
            <div className="font-medium">
              {revoked
                ? `${BEAKERBOT_DISPLAY_NAME} can no longer see this experiment.`
                : `Currently shared with ${BEAKERBOT_DISPLAY_NAME} (edit).`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleRevoke()}
            disabled={revoking || revoked}
            data-l6-revoke
            className="px-3 py-1.5 text-xs font-medium border border-rose-300 text-rose-700 rounded-md hover:bg-rose-50 disabled:opacity-50"
          >
            {revoked ? "Revoked" : revoking ? "Revoking..." : "Revoke access"}
          </button>
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
