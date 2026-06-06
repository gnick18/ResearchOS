// sequence editor master. PURE builders for the editor's CONTEXT-SPECIFIC
// right-click menus. The editor (SequenceEditView) is a thin shell that wires
// selection / undo / clipboard callbacks; the ITEM LISTS per menu kind live here
// so the routing is unit-tested without a DOM (sibling to context-menu-target.ts,
// which classifies WHICH menu opens; this builds WHAT is in it).
//
// Each builder takes the hit feature (or null) plus the small set of editor
// callbacks it fires, and returns the shared EditMenuItem list. Enablement is
// recomputed from the passed feature (not a selection-state flag), so the editor
// can pass the HIT index straight through on right-click (openMenu snapshots the
// items at click time, before a selectFeature state update would land).
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";
import type { EditFeature } from "./edit-model";

/** True when a feature's type is the primer-binding type. */
export function isPrimerFeature(f: { type?: string } | null | undefined): boolean {
  return !!f && (f.type || "").trim().toLowerCase() === "primer_bind";
}

// --- FEATURE MENU -----------------------------------------------------------

/** Callbacks the feature menu fires. The view supplies these bound to its state. */
export interface FeatureMenuDeps {
  /** The doc-feature index the menu acts on, or null for the greyed shell. */
  idx: number | null;
  /** The feature at idx, or null. Drives enablement + the protein group. */
  feature: EditFeature | null;
  /** True when the feature is protein-coding (adds the protein group). */
  isCoding: boolean;
  /** The recolor swatch colors offered (a calm subset of the palette). */
  swatchColors: string[];
  recolor: (idx: number, color: string) => void;
  rename: (idx: number) => void;
  add: () => void;
  edit: (idx: number) => void;
  duplicate: (idx: number) => void;
  remove: (idx: number) => void;
  /** Open the protein drawer for a coding feature (translate / find domains). */
  openProtein: (idx: number) => void;
}

/** Build the FEATURE menu. Quick ops first (recolor swatch + rename), then Add /
 *  Edit / Duplicate, a protein group for a coding feature, then Remove as the
 *  destructive group. A null feature greys every feature-bound row. */
export function buildFeatureMenuItems(deps: FeatureMenuDeps): EditMenuItem[] {
  const { idx, feature } = deps;
  const isFeature = !!feature && !isPrimerFeature(feature);
  return [
    {
      id: "feat-recolor",
      label: "Set color",
      enabled: isFeature,
      swatches: {
        colors: deps.swatchColors,
        current: feature?.color,
        onPick: (color) => {
          if (idx != null) deps.recolor(idx, color);
        },
      },
      onRun: () => {},
    },
    {
      id: "feat-rename",
      label: "Rename…",
      enabled: isFeature,
      onRun: () => {
        if (idx != null) deps.rename(idx);
      },
    },
    { id: "feat-add", label: "Add Feature…", enabled: true, group: true, onRun: deps.add },
    {
      id: "feat-edit",
      label: "Edit Feature…",
      enabled: isFeature,
      group: true,
      onRun: () => {
        if (idx != null) deps.edit(idx);
      },
    },
    {
      id: "feat-dup",
      label: "Duplicate Feature",
      enabled: isFeature,
      onRun: () => {
        if (idx != null) deps.duplicate(idx);
      },
    },
    // PROTEIN group, only for a CODING feature. Both actions open the right-docked
    // protein drawer for this CDS; "Find domains" points the user at the drawer's
    // Annotate-domains control (the InterProScan hand-off lives in the drawer
    // footer). Omitted entirely for non-coding features.
    ...(isFeature && deps.isCoding
      ? [
          {
            id: "feat-translate",
            label: "Translate to protein…",
            enabled: true,
            group: true,
            onRun: () => {
              if (idx != null) deps.openProtein(idx);
            },
          } as EditMenuItem,
          {
            id: "feat-find-domains",
            label: "Find domains…",
            enabled: true,
            onRun: () => {
              if (idx != null) deps.openProtein(idx);
            },
          } as EditMenuItem,
        ]
      : []),
    {
      id: "feat-remove",
      label: "Remove Feature",
      enabled: isFeature,
      destructive: true,
      group: true,
      onRun: () => {
        if (idx != null) deps.remove(idx);
      },
    },
  ];
}

// --- PRIMER MENU ------------------------------------------------------------

/** Callbacks the primer right-click menu fires. */
export interface PrimerMenuDeps {
  idx: number | null;
  feature: EditFeature | null;
  /** The primer's oligo bases (already derived by the view). */
  oligo: string;
  /** The primer's Tm in Celsius, or null when the oligo is too short to score. */
  tm: number | null;
  readOnly: boolean;
  edit: (idx: number) => void;
  copyOligo: (oligo: string) => void;
  remove: (idx: number) => void;
}

/** Build the PRIMER menu (opened in place of the feature menu on a primer_bind
 *  feature). Edit / Copy the oligo / a calm Tm read-out (a disabled informational
 *  row), then Delete as the destructive group. Edit and Delete are hidden on a
 *  read-only surface. */
export function buildPrimerMenuItems(deps: PrimerMenuDeps): EditMenuItem[] {
  const { idx, feature, oligo, tm, readOnly } = deps;
  const isPrimer = isPrimerFeature(feature);
  const items: EditMenuItem[] = [
    {
      id: "primer-ctx-edit",
      label: "Edit primer…",
      enabled: isPrimer && !readOnly,
      onRun: () => {
        if (idx != null) deps.edit(idx);
      },
    },
    {
      id: "primer-ctx-copy",
      label: "Copy primer sequence",
      enabled: isPrimer && oligo.length > 0,
      onRun: () => {
        if (oligo) deps.copyOligo(oligo);
      },
    },
    {
      id: "primer-ctx-tm",
      // A calm READ-OUT row (disabled, informational). A plain placeholder when
      // the oligo is too short to score a Tm.
      label: tm != null ? `Tm ${tm.toFixed(1)} C` : "Tm not available",
      enabled: false,
      group: true,
      onRun: () => {},
    },
  ];
  if (!readOnly) {
    items.push({
      id: "primer-ctx-delete",
      label: "Delete primer",
      enabled: isPrimer,
      destructive: true,
      group: true,
      onRun: () => {
        if (idx != null) deps.remove(idx);
      },
    });
  }
  return items;
}

// --- SELECTION MENU ---------------------------------------------------------

/** Callbacks the selection right-click menu fires. */
export interface SelectionMenuDeps {
  hasRange: boolean;
  readOnly: boolean;
  /** True for DNA / RNA (reverse-complement is meaningful). */
  isNucleotide: boolean;
  seqLength: number;
  createFeature: () => void;
  designPrimers: () => void;
  proteinProps: () => void;
  reverseComplementInPlace: () => void;
  copyAsFasta: () => void;
  /** The full standard bases menu, appended verbatim below the selection ops. */
  basesMenu: EditMenuItem[];
}

/** Build the SELECTION menu. Leads with the selection-aware power moves (create a
 *  feature here, design primers here, protein properties, reverse complement in
 *  place, copy as FASTA), then a divider, then the FULL standard bases menu so
 *  Cut / Copy / Paste / case / find all stay. Reverse complement is DNA / RNA only
 *  and is omitted on a protein or read-only surface (a destructive edit). */
export function buildSelectionMenuItems(deps: SelectionMenuDeps): EditMenuItem[] {
  const top: EditMenuItem[] = [
    {
      id: "sel-create-feature",
      label: "Create feature from selection…",
      enabled: deps.hasRange,
      onRun: deps.createFeature,
    },
    {
      id: "sel-design-primers",
      label: "Design primers here…",
      enabled: deps.hasRange,
      onRun: deps.designPrimers,
    },
    {
      id: "sel-protein-props",
      label: "Protein properties…",
      enabled: deps.hasRange,
      onRun: deps.proteinProps,
    },
  ];
  if (!deps.readOnly && deps.isNucleotide) {
    top.push({
      id: "sel-rev-comp-inplace",
      label: "Reverse complement in place",
      enabled: deps.hasRange,
      onRun: deps.reverseComplementInPlace,
    });
  }
  top.push({
    id: "sel-copy-fasta",
    label: "Copy as FASTA",
    enabled: deps.seqLength > 0,
    onRun: deps.copyAsFasta,
  });
  // The standard bases menu follows after a divider (its first item opens the
  // new group). The bases menu carries its own internal grouping.
  const rest = deps.basesMenu.map((it, i) =>
    i === 0 ? ({ ...it, group: true } as EditMenuItem) : it,
  );
  return [...top, ...rest];
}
