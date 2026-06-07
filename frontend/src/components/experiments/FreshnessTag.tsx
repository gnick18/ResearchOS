"use client";

export type FreshnessKind =
  | "fresh"
  | "running"
  | "awaiting"
  | "earlier"
  | "just-completed";

interface FreshnessTagProps {
  kind: FreshnessKind;
  label?: string;
}

const STYLES: Record<FreshnessKind, { className: string; defaultLabel: string }> = {
  fresh: {
    className: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
    defaultLabel: "Fresh",
  },
  "just-completed": {
    className: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
    defaultLabel: "Just completed",
  },
  running: {
    className: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30",
    defaultLabel: "Running",
  },
  awaiting: {
    className: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30",
    defaultLabel: "No write-up yet",
  },
  earlier: {
    className: "bg-gray-100 text-gray-600 border-gray-200",
    defaultLabel: "Earlier",
  },
};

/**
 * Small status pill shown on experiment-outcome cards. The `kind` drives
 * the color palette; the `label` lets the caller pass a more specific
 * string (e.g. "Result + 2d", "Day 3 of 7") while keeping the visual
 * treatment consistent. Shared between /lab Experiments and the future
 * /workbench "Recent results" view.
 */
export default function FreshnessTag({ kind, label }: FreshnessTagProps) {
  const cfg = STYLES[kind];
  return (
    <span
      className={
        "inline-flex items-center px-2 py-0.5 text-meta font-medium rounded-full border " +
        cfg.className
      }
    >
      {label ?? cfg.defaultLabel}
    </span>
  );
}
