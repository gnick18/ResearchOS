import { useEffect, useState } from "react";
import { sharingApi, tasksApi } from "@/lib/local-api";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import {
  appendArtifact,
  findArtifact,
} from "../walkthrough/lib/wizard-artifacts";
import { BEAKERBOT_DISPLAY_NAME, BEAKERBOT_USERNAME } from "./lib/beakerbot-user";

/**
 * L5: User shares an experiment back to BeakerBot.
 *
 * This direction (current user → BeakerBot) is the one sharingApi
 * natively supports, so we use the real API:
 *  - Create a new experiment via tasksApi.create (parent: W1's project
 *    artifact when present, else null for a personal experiment).
 *  - Call sharingApi.shareTask with permission="edit".
 *
 * Artifacts:
 *  - `{ type: "experiment", id: "<task-id>:l5-share-back", cleanup_default: "keep" }`
 *    The colon-suffix distinguishes the L5 experiment from W3's so
 *    Phase 4 can render distinct rows; the parsing pattern matches
 *    the existing wizard-artifacts encoding rules.
 *
 * Re-entry safety: if the L5 artifact already exists (back-step +
 * forward), the API calls are skipped.
 */

interface L5Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const DEFAULT_EXPERIMENT_NAME = "Sample share-back experiment";
const L5_SUFFIX = "l5-share-back";

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function findL5Artifact(sidecar: OnboardingSidecar | null) {
  const entries = sidecar?.wizard_resume_state?.artifacts_created ?? [];
  for (const entry of entries) {
    if (entry.type !== "experiment") continue;
    if (entry.id.endsWith(`:${L5_SUFFIX}`)) return entry;
  }
  return null;
}

export default function L5UserSharesBack({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: L5Props) {
  const existing = findL5Artifact(sidecar);
  const projectArtifact = findArtifact(sidecar, "project");
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(existing === null);
  }, [existing, setNextDisabled]);

  const handleShare = async () => {
    if (sharing || existing) return;
    setSharing(true);
    setError(null);
    try {
      const finalName = name.trim() || DEFAULT_EXPERIMENT_NAME;
      const experiment = await tasksApi.create({
        project_id: projectArtifact ? Number(projectArtifact.id) : null,
        name: finalName,
        start_date: todayLocal(),
        duration_days: 1,
        task_type: "experiment",
      });
      await sharingApi.shareTask(experiment.id, {
        username: BEAKERBOT_USERNAME,
        permission: "edit",
      });
      await patchSidecar((cur) =>
        appendArtifact(cur, {
          type: "experiment",
          id: `${experiment.id}:${L5_SUFFIX}`,
          cleanup_default: "keep",
        }),
      );
    } catch (err) {
      console.error("[onboarding-v3] L5 share-back failed", err);
      setError("Couldn't share the experiment. Try again or skip this step.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <div data-step-id="L5" className="space-y-4">
      <SpeechBubble>
        Now your turn. Make a quick experiment and share it back to me
        with edit permission. I&apos;ll act suitably delighted.
      </SpeechBubble>

      {existing ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="font-medium">Shared!</div>
          <div className="text-xs mt-1 text-emerald-700">
            {BEAKERBOT_DISPLAY_NAME}: Ooh, thanks! I&apos;ll go pretend
            to read it.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            Experiment name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={DEFAULT_EXPERIMENT_NAME}
            disabled={sharing}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleShare()}
            disabled={sharing}
            className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {sharing ? "Sharing..." : `Create and share with ${BEAKERBOT_DISPLAY_NAME}`}
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
