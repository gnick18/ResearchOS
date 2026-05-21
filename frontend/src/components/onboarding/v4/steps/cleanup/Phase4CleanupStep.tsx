"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import BeakerBot from "@/components/BeakerBot";
import type {
  OnboardingSidecar,
  WizardArtifact,
} from "@/lib/onboarding/sidecar";
import {
  decodeCalendarFeedId,
  decodeMethodSource,
  decodeTelegramImageLocation,
} from "../../../v3/steps/walkthrough/lib/wizard-artifacts";
import ArtifactRow, { artifactKey } from "./ArtifactRow";
import CleanupSection from "./CleanupSection";
import { cleanupArtifacts, isCleanupExcluded } from "./cleanup-execution";

/**
 * Onboarding v4 Phase 4 cleanup grid — see ONBOARDING_V4_PROPOSAL.md
 * §6.17 + L24 lock.
 *
 * Full-screen review surface (NOT the bottom-right BeakerBot overlay).
 * Lists every artifact the tour created, grouped by entity type per L24:
 *
 *   - Projects
 *   - Methods         (category folder + funny markdown method)
 *   - Experiments
 *   - Tasks           (chained dependency demo tasks)
 *   - Settings changes
 *   - Conditional add-ons
 *
 * Each row has a keep/discard toggle pre-set from the artifact's
 * `cleanup_default`. Collapsible sections per L24. Master "Start fresh"
 * toggle at the top discards everything (via confirm modal). Finish at
 * the bottom-right executes the cleanup sweep + writes
 * `wizard_completed_at` (or `wizard_skipped_at` if entered via
 * "I've got it from here") + exits the tour.
 *
 * Lab tour artifacts (per L21) are excluded by `isCleanupExcluded` so
 * the BeakerBot user + their shared tasks never reach the grid.
 *
 * Voice rule (Grant standing): no em-dashes in display copy.
 */

// ---------------------------------------------------------------------------
// Section ordering + grouping
// ---------------------------------------------------------------------------

/**
 * Canonical section order per L24. Each entry maps a section label to
 * the artifact `type` values that belong in it. Unknown artifact types
 * land in a tail "Other" section so a future arc that adds a new type
 * before its cleanup row lands doesn't vanish the artifact.
 */
const SECTIONS: ReadonlyArray<{
  label: string;
  types: ReadonlyArray<string>;
}> = [
  { label: "Projects", types: ["project"] },
  { label: "Methods", types: ["category", "method"] },
  { label: "Experiments", types: ["experiment"] },
  { label: "Tasks", types: ["task"] },
  {
    label: "Settings changes",
    types: ["settings_change"],
  },
  {
    label: "Conditional add-ons",
    types: [
      "variation_note",
      "note_entry",
      "hybrid_edit",
      "goal",
      "telegram_link",
      "telegram_image",
      "calendar_feed",
      "purchase",
      "purchase_item",
      "funding_string",
    ],
  },
];

// ---------------------------------------------------------------------------
// Per-artifact description (display label for the row)
// ---------------------------------------------------------------------------

/**
 * Human-readable label for an artifact row. Mirrors the v3 shape so a
 * user re-running the tour through v4 sees the same kinds of labels they
 * saw under v3 (project name, method id + flavor, task id, etc.) plus
 * the v4-only entries (category folder, chained-dep tasks).
 */
function describeArtifact(artifact: WizardArtifact): string {
  switch (artifact.type) {
    case "project":
      return `First project (#${artifact.id})`;
    case "method": {
      const decoded = decodeMethodSource(artifact.id);
      if (!decoded) return `Method #${artifact.id}`;
      const flavor =
        decoded.source === "placeholder" ? "placeholder body" : "your file";
      return `Method #${decoded.methodId} (${flavor})`;
    }
    case "category":
      return `Method folder: ${artifact.id}`;
    case "experiment":
      return `Experiment #${artifact.id}`;
    case "task":
      return `Demo task #${artifact.id}`;
    case "purchase":
      return `Purchase request (task #${artifact.id})`;
    case "purchase_item":
      return `Purchase line item #${artifact.id}`;
    case "funding_string":
      return `Funding string: ${artifact.id}`;
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
    case "variation_note":
      return `Variation note on experiment ${artifact.id}`;
    case "note_entry":
      return `Hybrid editor note: ${artifact.id}`;
    case "hybrid_edit":
      return `Note edits (${artifact.id})`;
    default:
      return `${artifact.type} ${artifact.id}`;
  }
}

// ---------------------------------------------------------------------------
// Props + main component
// ---------------------------------------------------------------------------

export interface Phase4CleanupStepProps {
  /** Sidecar carrying `wizard_resume_state.artifacts_created`. */
  sidecar: OnboardingSidecar | null;
  /** True when the user reached this surface via the "I've got it from
   *  here" link (not via natural completion). Finish writes
   *  `wizard_skipped_at` instead of `wizard_completed_at` in that case. */
  enteredViaSkip: boolean;
  /** Current user's username (cleanup sweep needs it for per-user
   *  file paths + settings revert). */
  username: string;
  /** Externalized decision state so the wizard shell can persist mid-
   *  flow and restore via `wizard_resume_state` (P12). Defaults pre-seed
   *  from each artifact's `cleanup_default` on first render. */
  decisions: Record<string, "keep" | "discard">;
  setDecisions: Dispatch<SetStateAction<Record<string, "keep" | "discard">>>;
  /** Called after the cleanup sweep finishes (normal path) — the
   *  controller writes `wizard_completed_at` + exits the tour. */
  onComplete: (summary: {
    attempted: number;
    succeeded: number;
    failed: Array<{ type: string; id: string; error: string }>;
  }) => void | Promise<void>;
  /** Called after the cleanup sweep finishes (I've-got-it path) — the
   *  controller writes `wizard_skipped_at` + exits the tour. */
  onSkip: (summary: {
    attempted: number;
    succeeded: number;
    failed: Array<{ type: string; id: string; error: string }>;
  }) => void | Promise<void>;
}

export default function Phase4CleanupStep({
  sidecar,
  enteredViaSkip,
  username,
  decisions,
  setDecisions,
  onComplete,
  onSkip,
}: Phase4CleanupStepProps) {
  const [confirmFresh, setConfirmFresh] = useState(false);
  const [uiState, setUiState] = useState<
    "idle" | "persisting" | "error"
  >("idle");
  const [partialFailureNotice, setPartialFailureNotice] = useState<
    string | null
  >(null);

  // Pull the live artifact list off the sidecar and drop anything the
  // lab tour marked excluded (L21).
  const artifacts = useMemo<ReadonlyArray<WizardArtifact>>(() => {
    const all = sidecar?.wizard_resume_state?.artifacts_created ?? [];
    return all.filter((a) => !isCleanupExcluded(a));
  }, [sidecar]);

  // Seed decision state from each artifact's `cleanup_default` the first
  // time we see it. Preserves existing decisions (user toggles survive
  // re-seeding) so a back-step into the grid doesn't reset their picks.
  useEffect(() => {
    if (artifacts.length === 0) return;
    setDecisions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const a of artifacts) {
        const key = artifactKey(a);
        if (next[key] === undefined) {
          next[key] = a.cleanup_default;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [artifacts, setDecisions]);

  // Group artifacts into the SECTIONS structure. Unknown types fall into
  // a tail "Other" section.
  const grouped = useMemo(() => {
    const byType = new Map<string, WizardArtifact[]>();
    for (const a of artifacts) {
      const list = byType.get(a.type) ?? [];
      list.push(a);
      byType.set(a.type, list);
    }
    const sections: Array<{
      label: string;
      items: WizardArtifact[];
    }> = [];
    for (const def of SECTIONS) {
      const items: WizardArtifact[] = [];
      for (const t of def.types) {
        const xs = byType.get(t);
        if (xs) {
          items.push(...xs);
          byType.delete(t);
        }
      }
      sections.push({ label: def.label, items });
    }
    // Tail "Other" section for unknown types (defensive).
    const tail: WizardArtifact[] = [];
    for (const xs of byType.values()) tail.push(...xs);
    if (tail.length > 0) sections.push({ label: "Other", items: tail });
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

  const handleFinish = useCallback(async () => {
    if (uiState === "persisting") return;
    setUiState("persisting");
    setPartialFailureNotice(null);
    try {
      const discarded = artifacts.filter(
        (a) => decisions[artifactKey(a)] === "discard",
      );
      const summary =
        discarded.length > 0
          ? await cleanupArtifacts(discarded, username)
          : { attempted: 0, succeeded: 0, failed: [] };

      if (summary.failed.length > 0) {
        // Best-effort: we still complete the tour, but surface a notice
        // so the user knows some discards didn't go through.
        setPartialFailureNotice(
          `${summary.failed.length} of ${summary.attempted} cleanup steps could not finish. The rest were applied.`,
        );
      }

      if (enteredViaSkip) {
        await onSkip(summary);
      } else {
        await onComplete(summary);
      }
      setUiState("idle");
    } catch (err) {
      console.error("[onboarding-v4] cleanup finalize failed", err);
      setUiState("error");
    }
  }, [
    artifacts,
    decisions,
    enteredViaSkip,
    onComplete,
    onSkip,
    uiState,
    username,
  ]);

  const intro = enteredViaSkip
    ? "All good, let's tidy up before I get out of your way. Default is keep everything; uncheck anything you want me to clean up on the way out."
    : "Look at all that we made together. Default is keep everything; uncheck anything you want me to clean up before I take off.";

  const totalCount = artifacts.length;

  return (
    <div
      data-step-id="phase4-cleanup"
      data-tour-cleanup-grid=""
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding cleanup review"
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4"
    >
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header: tiny BeakerBot in the corner per brief option B. */}
        <header className="flex items-start gap-3 p-5 border-b border-gray-100">
          <div className="shrink-0">
            <BeakerBot pose="pointing" className="w-12 h-12 text-sky-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">
              Pick what to keep before we wrap up
            </h2>
            <p className="mt-1 text-sm text-gray-600">{intro}</p>
          </div>
        </header>

        {/* Empty-state short-circuit */}
        {totalCount === 0 ? (
          <div className="flex-1 overflow-y-auto p-5">
            <p
              data-cleanup-empty=""
              className="text-sm text-gray-500"
            >
              No artifacts were created during this run. Click Finish whenever
              you&apos;re ready.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Master "Start fresh" toggle */}
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

            {/* Collapsible sections */}
            <div className="space-y-2">
              {grouped.map((section) => (
                <CleanupSection
                  key={section.label}
                  label={section.label}
                  count={section.items.length}
                >
                  <ul className="space-y-1">
                    {section.items.map((artifact) => (
                      <ArtifactRow
                        key={artifactKey(artifact)}
                        artifact={artifact}
                        label={describeArtifact(artifact)}
                        decision={
                          decisions[artifactKey(artifact)] ??
                          artifact.cleanup_default
                        }
                        onToggle={toggleOne}
                      />
                    ))}
                  </ul>
                </CleanupSection>
              ))}
            </div>

            {/* Start-fresh confirm modal */}
            {confirmFresh && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Confirm start fresh"
                data-cleanup-confirm-fresh=""
                className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2"
              >
                <p className="text-sm text-rose-900">
                  This will discard all artifacts created during the tour.
                  Continue?
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleStartFreshCancel}
                    data-cleanup-action="start-fresh-cancel"
                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleStartFreshConfirm}
                    data-cleanup-action="start-fresh-confirm"
                    className="px-3 py-1.5 text-xs font-medium border border-rose-500 bg-rose-500 text-white rounded-md hover:bg-rose-600"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer: partial-failure notice + Finish */}
        <footer className="flex items-center justify-between gap-3 p-5 border-t border-gray-100">
          <div className="flex-1 min-w-0 text-xs text-gray-500">
            {partialFailureNotice && (
              <span
                role="status"
                data-cleanup-partial-failure=""
                className="text-rose-700"
              >
                {partialFailureNotice}
              </span>
            )}
            {uiState === "error" && !partialFailureNotice && (
              <span role="alert" className="text-rose-700">
                Something went wrong while wrapping up. Please try again.
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleFinish}
            disabled={uiState === "persisting"}
            data-cleanup-action="finish"
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white rounded-full"
          >
            {uiState === "persisting" ? "Wrapping up..." : "Finish setup"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// Re-export the key helper for callers (controller / shell) that need
// to read decisions back out of the externalized state map.
export { artifactKey };
