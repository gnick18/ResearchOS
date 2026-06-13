// Phase 6b-2 (sender dependency panel, 2026-06-12). The "This note references"
// panel shown inside SendForm when a note has block-embed dependencies.
//
// When a user sends a note outside their lab, this panel lists every embedded
// object so they can deselect any before sending (D1, default all included).
// For Data Hub embeds, a secondary "send full dataset" checkbox lets them opt
// into the full dataset instead of a snapshot (D8, default snapshot).
//
// The panel is ADDITIVE: if the note has no embeds, it does not render and
// the send flow is unchanged.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import { useMemo, useCallback, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import Tooltip from "@/components/Tooltip";
import type { NoteDependency } from "@/lib/sharing/note-dependencies";
import type { IconName } from "@/components/icons/registry";
import type { ObjectRefType } from "@/lib/references";

// ── Icon mapping ─────────────────────────────────────────────────────────────
// Maps each ObjectRefType to the closest existing registry icon. We use only
// existing registry names; no new icons may be added (icon-guard enforces this).

const TYPE_ICON: Record<ObjectRefType, IconName> = {
  sequence: "sequence",
  collection: "list",
  method: "book",
  note: "book",
  file: "file",
  project: "folder",
  molecule: "moleculeCircular",
  datahub: "table",
  phylo: "tree",
  task: "check",
  experiment: "vial",
};

const TYPE_LABEL: Record<ObjectRefType, string> = {
  sequence: "Sequence",
  collection: "Sequence collection",
  method: "Method",
  note: "Note",
  file: "File",
  project: "Project",
  molecule: "Molecule",
  datahub: "Data Hub",
  phylo: "Phylogenetic tree",
  task: "Task",
  experiment: "Experiment",
};

// ── Selection state ───────────────────────────────────────────────────────────

export interface DependencySelectionState {
  /** Set of hrefs the user has EXCLUDED (deselected). Empty = include all. */
  excludeHrefs: Set<string>;
  /** Set of datahub hrefs the user wants to send as FULL dataset. */
  fullDataHrefs: Set<string>;
}

/** Pure helper: derive the selection state from a list of row states. Extracted
 *  as a named function so the unit test can import and exercise it directly
 *  without mounting any component. */
export function deriveSelectionSets(
  deps: NoteDependency[],
  included: Record<string, boolean>,
  fullData: Record<string, boolean>,
): DependencySelectionState {
  const excludeHrefs = new Set<string>();
  const fullDataHrefs = new Set<string>();

  for (const dep of deps) {
    if (!included[dep.href]) {
      excludeHrefs.add(dep.href);
    }
    if (dep.type === "datahub" && fullData[dep.href]) {
      fullDataHrefs.add(dep.href);
    }
  }

  return { excludeHrefs, fullDataHrefs };
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface NoteDependencyPanelProps {
  deps: NoteDependency[];
  /** Controlled: which hrefs are included (true) or excluded (false). */
  included: Record<string, boolean>;
  /** Controlled: which datahub hrefs are opted into full-dataset mode. */
  fullData: Record<string, boolean>;
  onToggleIncluded: (href: string, next: boolean) => void;
  onToggleFullData: (href: string, next: boolean) => void;
}

export function NoteDependencyPanel({
  deps,
  included,
  fullData,
  onToggleIncluded,
  onToggleFullData,
}: NoteDependencyPanelProps) {
  const includedCount = useMemo(
    () => deps.filter((d) => included[d.href]).length,
    [deps, included],
  );
  const total = deps.length;

  // Do not render the panel at all when there are no embeds.
  if (total === 0) return null;

  return (
    <div
      className="rounded-lg border border-border bg-surface-overlay"
      aria-label="Referenced objects"
    >
      {/* Header row */}
      <div className="px-3 py-2 border-b border-border">
        <p className="text-meta font-medium text-foreground">
          This note references
        </p>
        <p
          className="text-meta text-foreground-muted mt-0.5"
          aria-live="polite"
          aria-atomic="true"
        >
          {includedCount} of {total} referenced{" "}
          {total === 1 ? "object" : "objects"} will be included
        </p>
      </div>

      {/* Dependency rows */}
      <ul className="divide-y divide-border" role="list">
        {deps.map((dep) => {
          const isIncluded = included[dep.href] ?? true;
          const isDatahub = dep.type === "datahub";
          const isFull = fullData[dep.href] ?? false;
          const iconName: IconName = TYPE_ICON[dep.type] ?? "file";
          const typeLabel = TYPE_LABEL[dep.type] ?? dep.type;

          return (
            <li key={dep.href} className="px-3 py-2.5 space-y-1.5">
              {/* Main row: icon + name + include toggle */}
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 text-foreground-muted">
                  <Icon
                    name={iconName}
                    className="w-4 h-4"
                    title={typeLabel}
                  />
                </span>
                <span
                  className={`flex-1 text-body truncate ${isIncluded ? "text-foreground" : "text-foreground-muted line-through"}`}
                  title={dep.caption || dep.id}
                >
                  {dep.caption || dep.id}
                </span>
                <Tooltip
                  label={isIncluded ? "Exclude from send" : "Include in send"}
                  placement="left"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isIncluded}
                    onClick={() => onToggleIncluded(dep.href, !isIncluded)}
                    className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      isIncluded
                        ? "border-brand-action bg-brand-action text-white"
                        : "border-border bg-transparent"
                    }`}
                    aria-label={`${isIncluded ? "Exclude" : "Include"} ${dep.caption || dep.id}`}
                  >
                    {isIncluded && (
                      <Icon name="check" className="w-3 h-3" />
                    )}
                  </button>
                </Tooltip>
              </div>

              {/* Secondary row (datahub only): full-data opt-in */}
              {isDatahub && isIncluded && (
                <div className="flex items-center gap-2 pl-6">
                  <input
                    id={`full-data-${dep.href}`}
                    type="checkbox"
                    checked={isFull}
                    onChange={(e) =>
                      onToggleFullData(dep.href, e.target.checked)
                    }
                    className="w-3.5 h-3.5 rounded border-border text-blue-500 cursor-pointer"
                    aria-label={`Send full dataset for ${dep.caption || dep.id}`}
                  />
                  <label
                    htmlFor={`full-data-${dep.href}`}
                    className="text-meta text-foreground-muted cursor-pointer select-none"
                  >
                    Send full dataset instead of snapshot
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Hook: useDependencySelection ──────────────────────────────────────────────
// Encapsulates the selection state for use in SendForm.

export function useDependencySelection(deps: NoteDependency[]) {
  // Default: all deps included, no full-data flags set.
  // useState lazy-init so the initial maps are computed once from the dep list.
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(deps.map((d) => [d.href, true])),
  );
  const [fullData, setFullData] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      deps.filter((d) => d.type === "datahub").map((d) => [d.href, false]),
    ),
  );

  const handleToggleIncluded = useCallback((href: string, next: boolean) => {
    setIncluded((prev) => ({ ...prev, [href]: next }));
  }, []);

  const handleToggleFullData = useCallback((href: string, next: boolean) => {
    setFullData((prev) => ({ ...prev, [href]: next }));
  }, []);

  const selectionSets = useMemo(
    () => deriveSelectionSets(deps, included, fullData),
    [deps, included, fullData],
  );

  return {
    included,
    fullData,
    selectionSets,
    handleToggleIncluded,
    handleToggleFullData,
  };
}
