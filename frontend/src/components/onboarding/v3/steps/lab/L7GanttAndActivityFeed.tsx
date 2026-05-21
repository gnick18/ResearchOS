import { useEffect } from "react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import { BEAKERBOT_DISPLAY_NAME } from "./lib/beakerbot-user";
import { findLabTask, findLabUser } from "./lib/lab-artifacts";

/**
 * L7: Lab Gantt + activity feed pointer.
 *
 * Pure-pointer step: renders a small in-modal mockup of the Gantt and
 * an activity-feed strip that lists the shares + revokes the user
 * walked through at L4 / L5 / L6. No real Gantt or feed component is
 * embedded; the wizard surfaces the concept and points to the Lab Mode
 * Gantt + Activity feed for the real thing.
 */

interface L7Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
}

function hasL5Artifact(sidecar: OnboardingSidecar | null): boolean {
  const entries = sidecar?.wizard_resume_state?.artifacts_created ?? [];
  return entries.some(
    (a) => a.type === "experiment" && a.id.endsWith(":l5-share-back"),
  );
}

export default function L7GanttAndActivityFeed({
  sidecar,
  setNextDisabled,
}: L7Props) {
  const labUser = findLabUser(sidecar);
  const editTask = findLabTask(sidecar, "edit-demo");
  const viewTask = findLabTask(sidecar, "view-demo");
  const sharedBack = hasL5Artifact(sidecar);

  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  const events: string[] = [];
  if (labUser) events.push(`${BEAKERBOT_DISPLAY_NAME} joined the lab.`);
  if (editTask) events.push(`${BEAKERBOT_DISPLAY_NAME} shared an experiment with you (edit).`);
  if (viewTask) events.push(`${BEAKERBOT_DISPLAY_NAME} shared a dataset with you (view only).`);
  if (sharedBack) events.push(`You shared an experiment back with ${BEAKERBOT_DISPLAY_NAME}.`);

  return (
    <div data-step-id="L7" className="space-y-4">
      <SpeechBubble>
        The lab Gantt stacks everyone&apos;s timeline together. The
        activity feed is the running log of who shared what and when.
        Here&apos;s what we&apos;ve done so far.
      </SpeechBubble>

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Activity feed, preview
        </div>
        {events.length === 0 ? (
          <p className="text-xs text-gray-500">
            Nothing yet. Go back and try a step or two to populate this.
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-gray-700">
            {events.map((line, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2"
                data-l7-activity-line
              >
                <span aria-hidden className="text-sky-500 mt-0.5">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
