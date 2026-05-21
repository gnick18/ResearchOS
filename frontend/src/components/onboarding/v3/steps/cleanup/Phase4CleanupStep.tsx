"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type {
  OnboardingSidecar,
  WizardArtifact,
} from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import {
  decodeCalendarFeedId,
  decodeMethodSource,
  decodeTelegramImageLocation,
  isAutoSentinel,
} from "../walkthrough/lib/wizard-artifacts";
import { decodeLabTaskRole } from "../lab/lib/lab-artifacts";

/**
 * Phase 4 cleanup grid (ONBOARDING_V3_PROPOSAL.md §7 + L24 lock).
 *
 * Renders one checkbox per artifact the W / L steps registered in
 * `wizard_resume_state.artifacts_created`, grouped by category. Default
 * state per L24: every checkbox starts CHECKED (keep), with two
 * exceptions driven by upstream contracts:
 *   - Auto-prerequisite artifacts (L9): the auto-creator already wrote
 *     `cleanup_default: "discard"` on the artifact, so those rows render
 *     unchecked + tagged "(auto-created)".
 *   - L11's "Decide at the end" pick on the BeakerBot teammate / demo
 *     tasks: L11BeakerBotCleanupOption flips `cleanup_default` on the
 *     lab_user / lab_task entries to the user's pick BEFORE the user
 *     reaches this step.
 *
 * A master "Start fresh" button at the top opens a confirm sub-modal
 * ("This wipes everything BeakerBot and you made during onboarding.
 * Continue?"). Confirm flips every row to discard; cancel reverts.
 *
 * The shell owns the Finish button (the footer's Next on phase4-cleanup
 * renders as "Finish setup"). The shell reads `decisions` and dispatches
 * each discarded artifact through `cleanupArtifacts` before calling
 * `onComplete` (normal end) or `onSkip` (I've-got-it-from-here jump).
 *
 * Voice: BeakerBot funny + playful (L14), no em-dashes (Grant rule).
 */

const CATEGORY_ORDER: ReadonlyArray<{
  type: string;
  label: string;
}> = [
  { type: "project", label: "Project" },
  { type: "method", label: "Method" },
  { type: "experiment", label: "Experiment" },
  { type: "hybrid_edit", label: "Note edits" },
  { type: "settings_change", label: "Settings changes" },
  { type: "purchase", label: "Purchase request" },
  { type: "goal", label: "Goal" },
  { type: "telegram_link", label: "Telegram link" },
  { type: "telegram_image", label: "Telegram images" },
  { type: "calendar_feed", label: "Calendar feed" },
  { type: "lab_user", label: "Lab Mode teammate" },
  { type: "lab_task", label: "Lab Mode demo tasks" },
];

interface Phase4CleanupStepProps {
  sidecar: OnboardingSidecar | null;
  enteredViaSkip: boolean;
  decisions: Record<string, "keep" | "discard">;
  setDecisions: Dispatch<SetStateAction<Record<string, "keep" | "discard">>>;
  setNextDisabled: (disabled: boolean) => void;
}

export function artifactKey(
  a: Pick<WizardArtifact, "type" | "id">,
): string {
  return `${a.type}:${a.id}`;
}

function autoStepIdFor(
  type: WizardArtifact["type"],
): "W1" | "W2" | "W3" | null {
  if (type === "project") return "W1";
  if (type === "method") return "W2";
  if (type === "experiment") return "W3";
  return null;
}

function isAutoCreated(
  artifact: WizardArtifact,
  skippedSteps: ReadonlyArray<string>,
): boolean {
  const stepId = autoStepIdFor(artifact.type);
  if (!stepId) return false;
  const sentinel = `auto:${stepId}`;
  return skippedSteps.some(
    (entry) => isAutoSentinel(entry) && entry === sentinel,
  );
}

function describeArtifact(artifact: WizardArtifact): string {
  switch (artifact.type) {
    case "project":
      return `My First Project (#${artifact.id})`;
    case "method": {
      const decoded = decodeMethodSource(artifact.id);
      if (!decoded) return `Method #${artifact.id}`;
      const flavor =
        decoded.source === "placeholder"
          ? "placeholder body"
          : "your file";
      return `Method #${decoded.methodId} (${flavor})`;
    }
    case "experiment":
      return `Experiment #${artifact.id}`;
    case "purchase":
      return `Sample reagent order (task #${artifact.id})`;
    case "goal":
      return `Goal #${artifact.id}`;
    case "telegram_link":
      return "Telegram pairing";
    case "telegram_image": {
      const decoded = decodeTelegramImageLocation(artifact.id);
      if (!decoded) return artifact.id;
      if (decoded.location === "inbox") {
        return `${decoded.filename} (in image inbox)`;
      }
      return `${decoded.filename} (attached to task #${decoded.location.taskId})`;
    }
    case "calendar_feed": {
      const decoded = decodeCalendarFeedId(artifact.id);
      if (!decoded) return `Calendar feed #${artifact.id}`;
      return `Feed #${decoded.feedId}: ${decoded.icsUrl}`;
    }
    case "lab_user":
      return `BeakerBot teammate (${artifact.id})`;
    case "lab_task": {
      const role = decodeLabTaskRole(artifact.id);
      if (role === "edit-demo") return "Editable demo task";
      if (role === "view-demo") return "View-only demo task";
      if (role === "purchase-demo") return "Demo purchase request";
      return `Demo task (${artifact.id})`;
    }
    case "settings_change": {
      const colonIdx = artifact.id.indexOf(":");
      if (colonIdx < 0) return `Setting change: ${artifact.id}`;
      const field = artifact.id.slice(0, colonIdx);
      const rest = artifact.id.slice(colonIdx + 1);
      const arrowIdx = rest.indexOf("→");
      if (arrowIdx < 0) return `Setting change: ${field}`;
      const from = rest.slice(0, arrowIdx);
      const to = rest.slice(arrowIdx + 1);
      return `${field}: ${from} to ${to}`;
    }
    case "hybrid_edit":
      return `Note edits (${artifact.id})`;
    default:
      return `${artifact.type} ${artifact.id}`;
  }
}

export default function Phase4CleanupStep({
  sidecar,
  enteredViaSkip,
  decisions,
  setDecisions,
  setNextDisabled,
}: Phase4CleanupStepProps) {
  const [confirmFresh, setConfirmFresh] = useState(false);

  // Finish is always enabled on this step; cleanup is best-effort and
  // even an empty artifact list resolves immediately on Finish.
  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  const artifacts = useMemo<ReadonlyArray<WizardArtifact>>(
    () => sidecar?.wizard_resume_state?.artifacts_created ?? [],
    [sidecar],
  );
  const skippedSteps = useMemo<ReadonlyArray<string>>(
    () => sidecar?.wizard_resume_state?.skipped_steps ?? [],
    [sidecar],
  );

  // Group artifacts by CATEGORY_ORDER. Unknown categories fall into an
  // "Other" bucket at the end so a stray artifact written by a future
  // step body still shows up rather than vanishing silently.
  const grouped = useMemo(() => {
    const byType = new Map<string, WizardArtifact[]>();
    for (const a of artifacts) {
      const list = byType.get(a.type) ?? [];
      list.push(a);
      byType.set(a.type, list);
    }
    const sections: Array<{
      type: string;
      label: string;
      items: WizardArtifact[];
    }> = [];
    for (const cat of CATEGORY_ORDER) {
      const items = byType.get(cat.type);
      if (items && items.length > 0) {
        sections.push({ type: cat.type, label: cat.label, items });
        byType.delete(cat.type);
      }
    }
    for (const [type, items] of byType) {
      sections.push({ type, label: `Other (${type})`, items });
    }
    return sections;
  }, [artifacts]);

  const toggleOne = useCallback(
    (key: string) => {
      setDecisions((prev) => ({
        ...prev,
        [key]: prev[key] === "keep" ? "discard" : "keep",
      }));
    },
    [setDecisions],
  );

  const applyAll = useCallback(
    (next: "keep" | "discard") => {
      setDecisions((prev) => {
        const updated = { ...prev };
        for (const a of artifacts) {
          updated[artifactKey(a)] = next;
        }
        return updated;
      });
    },
    [artifacts, setDecisions],
  );

  const handleStartFreshClick = useCallback(() => {
    setConfirmFresh(true);
  }, []);

  const handleStartFreshConfirm = useCallback(() => {
    applyAll("discard");
    setConfirmFresh(false);
  }, [applyAll]);

  const handleStartFreshCancel = useCallback(() => {
    setConfirmFresh(false);
  }, []);

  const intro = enteredViaSkip
    ? "All good, let's tidy up before I get out of your way. Default is keep everything; uncheck anything you want me to clean up on the way out."
    : "Look at all that. Default is keep everything you and I made together; uncheck anything you want me to clean up before I take off.";

  const totalCount = artifacts.length;

  if (totalCount === 0) {
    return (
      <div data-step-id="phase4-cleanup" className="space-y-4">
        <SpeechBubble>
          Nothing on disk to tidy up, so I&apos;ll just show myself out. Click
          Finish whenever you&apos;re ready.
        </SpeechBubble>
        <p
          data-cleanup-empty=""
          className="text-sm text-gray-500"
        >
          No artifacts were created during this run.
        </p>
      </div>
    );
  }

  return (
    <div data-step-id="phase4-cleanup" className="space-y-4">
      <SpeechBubble>{intro}</SpeechBubble>

      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-amber-200 bg-amber-50">
        <p className="text-xs text-amber-900">
          Want a clean slate? I&apos;ll uncheck everything for you.
        </p>
        <button
          type="button"
          onClick={handleStartFreshClick}
          data-cleanup-action="start-fresh"
          className="px-3 py-1.5 text-xs font-medium border border-amber-300 bg-white text-amber-900 rounded-md hover:bg-amber-100 transition-colors"
        >
          Start fresh
        </button>
      </div>

      <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
        {grouped.map((section) => (
          <div key={section.type} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {section.label}
            </h3>
            <ul className="space-y-1">
              {section.items.map((artifact) => {
                const key = artifactKey(artifact);
                const decision =
                  decisions[key] ?? artifact.cleanup_default;
                const keep = decision === "keep";
                const auto = isAutoCreated(artifact, skippedSteps);
                return (
                  <li key={key}>
                    <label
                      data-artifact-id={key}
                      data-cleanup-state={decision}
                      data-cleanup-auto={auto ? "true" : "false"}
                      className="flex items-start gap-2 px-2 py-1.5 rounded-md border border-gray-200 bg-white text-sm text-gray-800 cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={keep}
                        onChange={() => toggleOne(key)}
                        className="mt-0.5"
                      />
                      <span className="flex-1 min-w-0 leading-snug">
                        {describeArtifact(artifact)}
                        {auto && (
                          <span className="ml-2 inline-block text-[10px] font-medium uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
                            auto-created
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {confirmFresh && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm start fresh"
          data-cleanup-confirm-fresh=""
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2"
        >
          <p className="text-sm text-rose-900">
            This wipes everything BeakerBot and you made during onboarding.
            Continue?
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleStartFreshCancel}
              data-cleanup-action="start-fresh-cancel"
              className="px-3 py-1.5 text-xs font-medium border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50"
            >
              Never mind
            </button>
            <button
              type="button"
              onClick={handleStartFreshConfirm}
              data-cleanup-action="start-fresh-confirm"
              className="px-3 py-1.5 text-xs font-medium border border-rose-500 bg-rose-500 text-white rounded-md hover:bg-rose-600"
            >
              Yes, wipe it all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
