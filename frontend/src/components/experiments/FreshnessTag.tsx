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
    className: "bg-emerald-100 text-emerald-700 border-emerald-200",
    defaultLabel: "Fresh",
  },
  "just-completed": {
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    defaultLabel: "Just completed",
  },
  running: {
    className: "bg-blue-100 text-blue-700 border-blue-200",
    defaultLabel: "Running",
  },
  awaiting: {
    className: "bg-amber-100 text-amber-700 border-amber-200",
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
