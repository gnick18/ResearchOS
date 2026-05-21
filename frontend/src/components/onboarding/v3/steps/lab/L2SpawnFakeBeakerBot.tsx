import { useEffect, useState } from "react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import { appendArtifact } from "../walkthrough/lib/wizard-artifacts";
import {
  BEAKERBOT_DISPLAY_NAME,
  BEAKERBOT_USERNAME,
  spawnBeakerBotUser,
} from "./lib/beakerbot-user";
import {
  encodeLabTaskId,
  encodeLabUserId,
  findLabTask,
  findLabUser,
} from "./lib/lab-artifacts";

/**
 * L2: Spawn the fake BeakerBot teammate (L19 lock).
 *
 * - Creates the BeakerBot user folder + `_user_metadata` entry with
 *   `is_tutorial: true` (the new optional flag P3a adds to
 *   `UserMetadataEntry`, matching the W12 `tutorial_test` precedent).
 * - Registers the user as a `lab_user` artifact in
 *   `wizard_resume_state.artifacts_created` with `cleanup_default:
 *   "discard"` per the brief — the temporary teammate should be torn
 *   down by default at Phase 4, and L11 may flip it to "keep" if the
 *   user wants to keep BeakerBot around.
 * - Registers a `lab_task` artifact for the edit-permission demo task
 *   shown later at L3 / L4. The task is simulated inside the wizard
 *   for P3a scope (see `lab-artifacts.ts` rationale); the artifact id
 *   is `"edit-demo:1"` so Phase 4 cleanup knows which role the entry
 *   represents.
 *
 * Speech copy follows L14 (funny + playful) and the proposal §9
 * example: "Hi! I'm a fake user for the next two minutes."
 */

interface L2Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

export default function L2SpawnFakeBeakerBot({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: L2Props) {
  const existingUser = findLabUser(sidecar);
  const existingTask = findLabTask(sidecar, "edit-demo");
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(existingUser === null);
  }, [existingUser, setNextDisabled]);

  const handleSpawn = async () => {
    if (spawning || existingUser) return;
    setSpawning(true);
    setError(null);
    try {
      await spawnBeakerBotUser();
      await patchSidecar((cur) => {
        let next = cur;
        next = appendArtifact(next, {
          type: "lab_user",
          id: encodeLabUserId(BEAKERBOT_USERNAME),
          cleanup_default: "discard",
        });
        next = appendArtifact(next, {
          type: "lab_task",
          id: encodeLabTaskId("edit-demo"),
          cleanup_default: "discard",
        });
        return next;
      });
    } catch (err) {
      console.error("[onboarding-v3] L2 spawn failed", err);
      setError("Couldn't spin up the fake teammate. Try again or skip this step.");
    } finally {
      setSpawning(false);
    }
  };

  return (
    <div data-step-id="L2" className="space-y-4">
      <SpeechBubble>
        Hi! I&apos;m a fake user for the next two minutes. I&apos;ll
        spin up under the name {BEAKERBOT_DISPLAY_NAME}, share an
        experiment with you, and pretend to be a perfectly normal
        colleague who definitely is not a mascot.
      </SpeechBubble>

      {existingUser ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-medium">
              {BEAKERBOT_DISPLAY_NAME} joined the lab.
            </div>
            <div className="text-xs mt-1 text-emerald-700">
              You&apos;ll see them in Lab Mode&apos;s user list and on
              the shared workbench.
            </div>
          </div>
          {existingTask && (
            <div className="rounded-lg border border-sky-200 bg-white px-4 py-3 text-sm text-gray-800 flex items-center gap-3">
              <div
                aria-hidden
                className="w-2.5 h-2.5 rounded-full bg-sky-500 flex-shrink-0"
              />
              <div className="flex-1">
                <div className="font-medium">
                  Experiment from {BEAKERBOT_DISPLAY_NAME}
                </div>
                <div className="text-xs text-gray-500">
                  Shared with you, edit permission
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void handleSpawn()}
            disabled={spawning}
            className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {spawning ? "Spinning up..." : `Add ${BEAKERBOT_DISPLAY_NAME} to the lab`}
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
