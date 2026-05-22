"use client";

import { useCallback } from "react";
import type { WizardArtifact } from "@/lib/onboarding/sidecar";

/**
 * Single artifact row in the Phase 4 cleanup grid. Renders the
 * artifact's display name, a small type icon, and a keep/discard
 * checkbox. The parent grid owns the decision state; this is a pure
 * presentational + onChange surface.
 *
 * Voice rule (Grant standing): no em-dashes anywhere in display copy.
 */

interface ArtifactRowProps {
  artifact: WizardArtifact;
  /** Display name composed by the parent grid (per-type description). */
  label: string;
  /** Optional second-line context (e.g. "auto-created" tag, source
   *  flavor). The grid composes it; the row just renders it inline. */
  tag?: string;
  /** Current decision ("keep" = checkbox checked, "discard" = unchecked). */
  decision: "keep" | "discard";
  /** Toggle handler — the parent flips the decision in its decision
   *  state map. */
  onToggle: (key: string) => void;
}

/** Composite stable key matching the grid's decision map shape. */
export function artifactKey(
  a: Pick<WizardArtifact, "type" | "id">,
): string {
  return `${a.type}:${a.id}`;
}

/**
 * Per-type emoji indicator. Keeps the row light vs importing a full
 * icon set; matches the brief's "a small thumbnail or icon" requirement
 * without coupling to a specific icon library. Substitutable later if
 * P13 polish chip wants real SVGs.
 */
const TYPE_ICON: Readonly<Record<string, string>> = {
  project: "P",
  method: "M",
  experiment: "X",
  task: "T",
  category: "C",
  purchase: "$",
  purchase_item: "$",
  funding_string: "F",
  goal: "G",
  variation_note: "N",
  note_entry: "N",
  hybrid_edit: "N",
  telegram_link: "T",
  telegram_image: "I",
  calendar_feed: "K",
  settings_change: "S",
  lab_user: "L",
  lab_task: "L",
};

function iconFor(type: string): string {
  return TYPE_ICON[type] ?? "?";
}

export default function ArtifactRow({
  artifact,
  label,
  tag,
  decision,
  onToggle,
}: ArtifactRowProps) {
  const key = artifactKey(artifact);
  const keep = decision === "keep";

  const handleChange = useCallback(() => {
    onToggle(key);
  }, [key, onToggle]);

  return (
    <li>
      <label
        data-artifact-id={key}
        data-artifact-type={artifact.type}
        data-artifact-cleanup-default={artifact.cleanup_default}
        data-cleanup-state={decision}
        className="flex items-start gap-2 px-2 py-1.5 rounded-md border border-gray-200 bg-white text-sm text-gray-800 cursor-pointer hover:bg-gray-50"
      >
        <input
          type="checkbox"
          checked={keep}
          onChange={handleChange}
          className="mt-0.5"
          aria-label={`Keep ${label}`}
        />
        <span
          data-artifact-icon=""
          className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-sky-50 text-sky-700 text-xs font-semibold border border-sky-100"
          aria-hidden="true"
        >
          {iconFor(artifact.type)}
        </span>
        <span className="flex-1 min-w-0 leading-snug">
          {label}
          {tag && (
            <span className="ml-2 inline-block text-[10px] font-medium uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
              {tag}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
