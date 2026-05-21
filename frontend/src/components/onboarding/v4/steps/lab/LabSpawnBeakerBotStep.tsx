"use client";

import { useEffect, useState } from "react";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { useTourController } from "../../TourController";
import type { TourStep } from "../../step-types";
import {
  BEAKERBOT_LAB_DISPLAY_NAME,
  spawnBeakerBotLabUser,
  type LabFakeUserHandle,
} from "./lib/lab-fake-user";

/**
 * lab-spawn-beakerbot step body. §6.16a.
 *
 * Side effect on entry: creates the BeakerBot fake user, two
 * placeholder experiments (one for edit, one for view-only), and
 * issues real cross-user shares via the P0 admin-mode
 * `sharingApi.shareTaskAs` API. After the shares land, BeakerBot's
 * two experiments show up in the real user's Workbench / Gantt as
 * shared tasks: the rest of the tour treats them as ordinary
 * surfaces.
 *
 * Speech bubble (no em-dashes per AGENTS.md): "Meet BeakerBot the
 * lab member. They just shared two experiments with you, one you can
 * edit, one is view-only."
 *
 * Completion contract: manual. The user clicks "Got it, next" once
 * the speech bubble has been read. The spawn happens via the
 * registry's `onEnter` hook (not from the speech ReactNode) so the
 * heavy work fires once on step entry rather than once per render.
 *
 * Failure handling: a spawn failure surfaces a status pill in the
 * speech bubble but does NOT block the user from advancing. The
 * permission-practice step gracefully degrades when the handle is
 * absent (see `LabPermissionPracticeStep`).
 */

interface LabSpawnInnerProps {
  /** Override the spawn helper. Tests pass a mock so they don't try
   *  to read the file system. */
  spawnFn?: (recipient: string) => Promise<LabFakeUserHandle>;
}

function LabSpawnInner({ spawnFn }: LabSpawnInnerProps) {
  const [phase, setPhase] = useState<"spawning" | "ready" | "error">(
    "spawning",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [handle, setHandle] = useState<LabFakeUserHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const username = await getCurrentUserCached();
        if (!username) {
          if (!cancelled) {
            setPhase("error");
            setErrorMessage(
              "Couldn't read your username. Try again, or skip this step.",
            );
          }
          return;
        }
        const fn = spawnFn ?? spawnBeakerBotLabUser;
        const result = await fn(username);
        if (!cancelled) {
          setHandle(result);
          setPhase("ready");
        }
      } catch (err) {
        console.error("[onboarding-v4] lab spawn failed", err);
        if (!cancelled) {
          setPhase("error");
          setErrorMessage(
            "Couldn't spin up the fake teammate. The tour can continue, or skip this step.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spawnFn]);

  return (
    <div data-step-id="lab-spawn-beakerbot" className="space-y-2">
      <div className="leading-relaxed">
        Meet {BEAKERBOT_LAB_DISPLAY_NAME} the lab member. They just shared
        two experiments with you, one you can edit, one is view-only.
      </div>
      {phase === "spawning" && (
        <p
          data-testid="lab-spawn-status"
          className="text-xs text-gray-500"
        >
          Spinning up {BEAKERBOT_LAB_DISPLAY_NAME}, the fake lab member...
        </p>
      )}
      {phase === "ready" && handle && (
        <p
          data-testid="lab-spawn-status"
          className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5"
        >
          {BEAKERBOT_LAB_DISPLAY_NAME} joined the lab. Two experiments
          (one edit, one view-only) are now in your Workbench.
        </p>
      )}
      {phase === "error" && errorMessage && (
        <p
          data-testid="lab-spawn-status"
          className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}

/**
 * Build the registry entry for the `lab-spawn-beakerbot` step.
 *
 * The spawn is fired from the React component's `useEffect` rather
 * than from `onEnter`. Reasoning: `onEnter` runs once when the
 * controller flips currentStep, but it has no straightforward way to
 * push the resulting handle into a place the next step can read it
 * (the controller doesn't carry per-step state); the module-level
 * cache in `lab-fake-user.ts` solves the same problem more directly.
 * The component-driven approach also gives us the loading / ready /
 * error pill in the speech bubble.
 */
export interface BuildLabSpawnStepOptions {
  /** Override the spawn helper. Tests use this. */
  spawnFn?: (recipient: string) => Promise<LabFakeUserHandle>;
}

export function buildLabSpawnStep(
  options: BuildLabSpawnStepOptions = {},
): TourStep {
  return {
    id: "lab-spawn-beakerbot",
    speech: () => <LabSpawnInner spawnFn={options.spawnFn} />,
    pose: "pointing",
    completion: {
      type: "manual",
      buttonLabel: "Got it, next",
    },
  };
}

export default LabSpawnInner;
