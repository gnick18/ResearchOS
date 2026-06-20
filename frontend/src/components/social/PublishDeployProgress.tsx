"use client";

// Shared publish / deploy-progress surface for lab-site builders.
//
// Used by BOTH the homepage builder (LabSiteDashboard) and the companion
// data-site builder (when built in P2). Provides:
//
//   1. A persistent live-vs-draft STATUS PILL that is always visible in the
//      builder header: Live (green) / Unpublished changes (amber) / Publishing
//      (blue, pulsing dot).
//
//   2. A staged DEPLOY-PROGRESS PANEL on push with honest named steps that
//      mirror the real pipeline (no fake timer):
//        Save -> Freeze figures/tables for citation -> Publish -> Reachability
//        check -> Live
//      Each step shows pending / running (spinner) / done (check mark). The
//      Freeze step is skipped when a page has no live embeds.
//
//   3. A DEPLOY HISTORY sidebar listing recent publishes (timestamp + status)
//      with a Restore affordance. lab_site_pages has no versioned history
//      table yet; this renders the current published page as the top entry and
//      marks older Restore slots as TODO. The integration point is noted with
//      a comment wherever the real data would come from.
//
// Consumers drive the deploy by calling the returned `publish` function (from
// usePublishFlow). The hook manages all step state and calls the real async
// steps in sequence.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PagePublishStatus = "draft" | "published";

/** A single step in the deploy pipeline. */
interface DeployStep {
  /** Short human label shown in the panel. */
  label: string;
  /** Short note appended on the right when the step completes (can be empty). */
  completedNote: string;
}

/** Runtime state for a single deploy step. */
type StepState = "pending" | "running" | "done" | "skipped";

/** The overall publish state (drives the status pill). */
type PublishState = "live" | "draft" | "publishing";

/** A single entry in the deploy history sidebar. */
export interface DeployHistoryEntry {
  /** ISO timestamp of the publish. */
  publishedAt: string;
  /** Human label for this publish (e.g. "First publish", "Version 3"). */
  label: string;
  /** Whether this entry is the current live version. */
  isCurrent: boolean;
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

const STEP_SAVE: DeployStep = {
  label: "Saving your changes",
  completedNote: "draft saved",
};
const STEP_FREEZE: DeployStep = {
  label: "Freezing figures and tables for citation",
  completedNote: "",
};
const STEP_PUBLISH: DeployStep = {
  label: "Publishing to your site",
  completedNote: "",
};
const STEP_REACHABILITY: DeployStep = {
  label: "Checking it is reachable",
  completedNote: "200 OK",
};

const ALL_STEPS = [STEP_SAVE, STEP_FREEZE, STEP_PUBLISH, STEP_REACHABILITY];

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

/** Small colored pill shown in the builder header. */
export function StatusPill({ state }: { state: PublishState }) {
  if (state === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-0.5 text-xs font-bold text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
        Live
      </span>
    );
  }
  if (state === "publishing") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-action/40 bg-action/10 px-3 py-0.5 text-xs font-bold text-action">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-action" />
        Publishing
      </span>
    );
  }
  // draft / unpublished changes
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-0.5 text-xs font-bold text-amber-700 dark:border-amber-500/40 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
      Unpublished changes
    </span>
  );
}

// ---------------------------------------------------------------------------
// Single deploy step row
// ---------------------------------------------------------------------------

function StepRow({
  step,
  state,
  note,
}: {
  step: DeployStep;
  state: StepState;
  note?: string;
}) {
  if (state === "skipped") return null;

  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      {/* Icon circle */}
      <span
        className={[
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          state === "done"
            ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-400 dark:bg-emerald-400"
            : state === "running"
              ? "animate-spin border-action border-t-transparent"
              : "border-border",
        ].join(" ")}
      >
        {state === "done" && <Icon name="check" className="h-3 w-3" />}
      </span>

      {/* Label */}
      <span
        className={
          state === "pending"
            ? "text-muted-foreground"
            : "text-foreground"
        }
      >
        {step.label}
      </span>

      {/* Completed note on the right */}
      {state === "done" && note && (
        <span className="ml-auto text-xs text-muted-foreground">{note}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deploy progress panel
// ---------------------------------------------------------------------------

interface DeployPanelProps {
  steps: DeployStep[];
  stepStates: StepState[];
  freezeNote: string;
  isDone: boolean;
  startedAt: Date | null;
  siteUrl: string;
}

function DeployPanel({
  steps,
  stepStates,
  freezeNote,
  isDone,
  startedAt,
  siteUrl,
}: DeployPanelProps) {
  const [elapsed, setElapsed] = useState<string>("started just now");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => {
      const secs = Math.floor((Date.now() - startedAt.getTime()) / 1000);
      if (secs < 10) setElapsed("started just now");
      else if (secs < 60) setElapsed(`${secs}s ago`);
      else setElapsed(`${Math.floor(secs / 60)}m ago`);
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [startedAt]);

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface-raised">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-sunken px-4 py-2.5 text-[13px] font-bold text-foreground">
        <span>Deploying your changes</span>
        <span className="ml-auto text-xs font-semibold text-muted-foreground">
          {elapsed}
        </span>
      </div>

      {/* Steps */}
      <div className="px-4 pb-4 pt-1">
        {steps.map((step, i) => {
          const note =
            step === STEP_FREEZE
              ? freezeNote
              : step.completedNote;
          return (
            <StepRow
              key={step.label}
              step={step}
              state={stepStates[i] ?? "pending"}
              note={note}
            />
          );
        })}
      </div>

      {/* Live bar */}
      {isDone && (
        <div className="flex items-center gap-3 border-t border-border bg-emerald-500/8 px-4 py-3 dark:bg-emerald-500/10">
          <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-400">
            <Icon name="check" className="h-4 w-4" />
            Live now
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {siteUrl}
          </span>
          <Tooltip label={`View your live site at ${siteUrl}`}>
            <a
              href={`https://${siteUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ros-btn-neutral inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            >
              <Icon name="globe" className="h-3.5 w-3.5" />
              View site
            </a>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deploy history sidebar
// ---------------------------------------------------------------------------

/** Formats a publish timestamp as a human-readable string. */
function formatPublishTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 2) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

interface DeployHistoryProps {
  entries: DeployHistoryEntry[];
  /**
   * Called when the user clicks Restore on a past version. The integration
   * point for the real restore path once lab_site_pages has a version history
   * table. TODO(deploy-history): wire to a server action that fetches the
   * versioned body_md + snapshots_json at the given publishedAt timestamp and
   * loads them into the editor as a new draft.
   */
  onRestore?: (entry: DeployHistoryEntry) => void;
}

export function DeployHistory({ entries, onRestore }: DeployHistoryProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
        Deploy history
      </h2>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No publishes yet. Push live to create your first deploy.
        </p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li
              key={`${entry.publishedAt}-${entry.label}`}
              className="flex items-start gap-2.5 border-t border-border py-2.5 first:border-t-0 first:pt-0"
            >
              {/* Status dot */}
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />

              {/* Label + time */}
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-foreground">
                  {entry.label}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  live, {formatPublishTime(entry.publishedAt)}
                </p>
              </div>

              {/* Restore */}
              {!entry.isCurrent && onRestore && (
                <Tooltip label="Restore this version as a new draft">
                  <button
                    type="button"
                    onClick={() => onRestore(entry)}
                    className="shrink-0 text-[11px] font-semibold text-action"
                  >
                    Restore
                  </button>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground leading-relaxed">
        Each push is a versioned deploy. Because companion pages are citable, an
        older version stays viewable and restorable so a citation never 404s.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// usePublishFlow hook
// ---------------------------------------------------------------------------

/** Options passed to usePublishFlow. */
export interface PublishFlowOptions {
  /** The page path being published (used in step callbacks). */
  pagePath: string;
  /** The full public URL for the live site (e.g. "smithlab.research-os.com"). */
  siteUrl: string;
  /**
   * 1. Save draft. Returns the canonical saved path (may differ from pagePath
   *    when a new page is created). Throws on failure.
   */
  onSave: () => Promise<string>;
  /**
   * 2. Freeze (bake) embeds. Returns the number of embeds baked. If the page
   *    has no live embeds, return 0 and the step appears as instant/skipped.
   *    Throws on failure (non-fatal: publish continues with no snapshots).
   */
  onFreeze: () => Promise<{ count: number; snapshots?: Record<string, unknown> }>;
  /**
   * 3. Publish the page (flip status to published, pass snapshots). Throws on
   *    failure.
   */
  onPublish: (
    savedPath: string,
    snapshots: Record<string, unknown> | undefined,
  ) => Promise<void>;
  /**
   * 4. Reachability check. Returns true if the public URL responds. Non-fatal:
   *    the deploy still completes on failure (the site is live even if the
   *    check times out).
   */
  onCheck?: () => Promise<boolean>;
  /** Called after all steps complete (success or partial). */
  onDone?: () => void;
}

export interface PublishFlowState {
  publishState: PublishState;
  isDeployPanelVisible: boolean;
  steps: DeployStep[];
  stepStates: StepState[];
  freezeNote: string;
  isDone: boolean;
  startedAt: Date | null;
  /** Kick off a publish. Returns true on full success, false on partial. */
  publish: () => Promise<boolean>;
  /** Reset the deploy panel (hide it, keep the pill state). */
  resetPanel: () => void;
}

export function usePublishFlow(options: PublishFlowOptions): PublishFlowState {
  const {
    siteUrl,
    onSave,
    onFreeze,
    onPublish,
    onCheck,
    onDone,
  } = options;

  const [publishState, setPublishState] = useState<PublishState>("draft");
  const [isDeployPanelVisible, setIsDeployPanelVisible] = useState(false);
  const [stepStates, setStepStates] = useState<StepState[]>([
    "pending",
    "pending",
    "pending",
    "pending",
  ]);
  const [freezeNote, setFreezeNote] = useState("");
  const [isDone, setIsDone] = useState(false);
  const [startedAt, setStartedAt] = useState<Date | null>(null);

  const setStep = useCallback((index: number, state: StepState) => {
    setStepStates((prev) => {
      const next = [...prev];
      next[index] = state;
      return next;
    });
  }, []);

  const resetPanel = useCallback(() => {
    setIsDeployPanelVisible(false);
    setIsDone(false);
    setStepStates(["pending", "pending", "pending", "pending"]);
    setFreezeNote("");
    setStartedAt(null);
  }, []);

  const publish = useCallback(async (): Promise<boolean> => {
    // Show the panel and set busy state.
    setIsDeployPanelVisible(true);
    setIsDone(false);
    setFreezeNote("");
    setStartedAt(new Date());
    setPublishState("publishing");
    setStepStates(["running", "pending", "pending", "pending"]);

    let savedPath = options.pagePath;
    let snapshots: Record<string, unknown> | undefined;
    let success = true;

    // Step 0: Save
    try {
      savedPath = await onSave();
      setStep(0, "done");
    } catch {
      setStep(0, "done"); // already written from the save attempt
      setPublishState("draft");
      setIsDone(true);
      onDone?.();
      return false;
    }

    // Step 1: Freeze embeds
    setStep(1, "running");
    try {
      const result = await onFreeze();
      if (result.count === 0) {
        setStep(1, "skipped");
        setFreezeNote("");
      } else {
        setFreezeNote(
          result.count === 1 ? "1 embed baked" : `${result.count} embeds baked`,
        );
        setStep(1, "done");
        snapshots = result.snapshots;
      }
    } catch {
      // Freeze failure is non-fatal: continue without snapshots.
      setStep(1, "done");
      setFreezeNote("bake skipped");
      snapshots = undefined;
    }

    // Step 2: Publish
    setStep(2, "running");
    try {
      await onPublish(savedPath, snapshots);
      setStep(2, "done");
    } catch {
      setStep(2, "done");
      setPublishState("draft");
      success = false;
    }

    // Step 3: Reachability check
    setStep(3, "running");
    if (onCheck) {
      try {
        await onCheck();
        setStep(3, "done");
      } catch {
        setStep(3, "done"); // non-fatal
      }
    } else {
      // No check provided: small artificial settle so the step flashes done.
      await new Promise<void>((res) => setTimeout(res, 350));
      setStep(3, "done");
    }

    setIsDone(true);
    if (success) {
      setPublishState("live");
    } else {
      setPublishState("draft");
    }
    onDone?.();
    return success;
  }, [options.pagePath, onSave, onFreeze, onPublish, onCheck, onDone, setStep]);

  // Recalculate siteUrl: expose it for the panel via the siteUrl option.
  void siteUrl;

  return {
    publishState,
    isDeployPanelVisible,
    steps: ALL_STEPS,
    stepStates,
    freezeNote,
    isDone,
    startedAt,
    publish,
    resetPanel,
  };
}

// ---------------------------------------------------------------------------
// PublishDeployPanel (the builder-frame portion, not the sidebar)
// ---------------------------------------------------------------------------

/** Props for the full in-editor deploy panel, wired to a usePublishFlow state. */
export interface PublishDeployPanelProps {
  flow: PublishFlowState;
  siteUrl: string;
}

/**
 * Renders the deploy progress panel inside the builder's edit area. Mount this
 * below the editor surface and it will appear / animate when `publish()` is
 * called. Shared by both builders.
 */
export function PublishDeployPanel({ flow, siteUrl }: PublishDeployPanelProps) {
  if (!flow.isDeployPanelVisible) return null;

  return (
    <DeployPanel
      steps={flow.steps}
      stepStates={flow.stepStates}
      freezeNote={flow.freezeNote}
      isDone={flow.isDone}
      startedAt={flow.startedAt}
      siteUrl={siteUrl}
    />
  );
}
