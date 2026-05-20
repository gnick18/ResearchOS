import { useEffect, useState } from "react";
import { projectsApi } from "@/lib/local-api";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import {
  appendArtifact,
  findArtifact,
} from "./lib/wizard-artifacts";

/**
 * W1: Create your first project (universal walkthrough).
 *
 * BeakerBot prompts for a project name (default "My First Project"),
 * the user clicks Create, and the project lands in their real
 * Workbench via `projectsApi.create`. The artifact is logged with
 * `cleanup_default: "keep"` so the Phase 4 grid pre-checks it.
 *
 * Next is gated until the project exists. Skip-this-step is handled
 * by the shell (logs the bare id to `skipped_steps`); the
 * auto-prerequisite machinery in `lib/auto-prerequisite.ts` fills in
 * a placeholder lazily when W3 / W4 / W5 / W7 mounts.
 *
 * Re-entry: if the user back-stepped from W2 and forward again, this
 * step renders the existing artifact name in a "Done" state rather
 * than letting them create a duplicate.
 */

interface W1Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const DEFAULT_NAME = "My First Project";

export default function W1CreateProjectStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W1Props) {
  const existing = findArtifact(sidecar, "project");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(existing === null);
  }, [existing, setNextDisabled]);

  const handleCreate = async () => {
    if (creating || existing) return;
    setCreating(true);
    setError(null);
    try {
      const finalName = name.trim() || DEFAULT_NAME;
      const project = await projectsApi.create({ name: finalName });
      await patchSidecar((cur) =>
        appendArtifact(cur, {
          type: "project",
          id: String(project.id),
          cleanup_default: "keep",
        }),
      );
    } catch (err) {
      console.error("[onboarding-v3] W1 project create failed", err);
      setError("Couldn't create the project. Try again or skip this step.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-step-id="W1" className="space-y-4">
      <SpeechBubble>
        Every great experiment starts with a project. Or a snack, but mostly
        a project. Pick a name and I&apos;ll spin one up in your Workbench.
      </SpeechBubble>

      {existing ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Project created. You&apos;re good to keep going.
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            Project name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={DEFAULT_NAME}
            disabled={creating}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create project"}
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
