// sequence editor master. PURE helpers for the CONTEXTUAL inspector (sequences
// redesign phase 3). The right-edge inspector adapts to what the user has
// selected on the map. These helpers turn the editor's live selection state
// into one SELECTION KIND plus the human context-bar text, kept pure so the
// classification and the copy are unit-tested without a DOM.
//
// The selection kind is finer than the right-click router's ContextMenuKind
// (which collapses every non-primer feature to "feature"): the inspector needs
// to tell a CODING feature (Protein tools) apart from any other feature, and to
// know when only a base region is selected (Primers tools). The right-click
// router stays the source of truth for the menu; this is the visible-panel
// form of the same idea.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

/** Which contextual scope the inspector is acting on.
 *
 *   "none"          nothing selected, the inspector acts on the whole sequence
 *   "region"        a base range is selected, no feature
 *   "feature-cds"   a coding feature (CDS / gene / mat_peptide / sig_peptide)
 *   "feature-primer" a primer_bind feature
 *   "feature-other" any other annotated feature
 */
export type SelectionKind =
  | "none"
  | "region"
  | "feature-cds"
  | "feature-primer"
  | "feature-other";

/** The inputs the classifier needs from the editor's live state. */
export interface SelectionKindInput {
  /** Whether a base RANGE is currently selected (sel.hasRange). */
  hasRange: boolean;
  /** The selected feature's (lowercased-or-raw) type, or null when no feature
   *  is selected. */
  selectedFeatureType?: string | null;
  /** Whether the selected feature is coding (the view passes isCodingFeature,
   *  which knows the full coding-type set). Ignored when no feature selected. */
  selectedFeatureIsCoding?: boolean;
}

/** Classify the live selection into one inspector selection kind. A selected
 *  FEATURE wins over a bare range (you picked a thing), and we split coding /
 *  primer / other so each gets its own contextual panel. */
export function deriveSelectionKind(input: SelectionKindInput): SelectionKind {
  const hasFeature =
    input.selectedFeatureType != null && input.selectedFeatureType !== "";
  if (hasFeature) {
    const type = (input.selectedFeatureType || "").trim().toLowerCase();
    if (type === "primer_bind") return "feature-primer";
    if (input.selectedFeatureIsCoding) return "feature-cds";
    return "feature-other";
  }
  return input.hasRange ? "region" : "none";
}

/** Which rail operation a fresh selection of this kind should auto-open. Null
 *  means do not auto-switch (the inspector keeps whatever the user had open).
 *  Organism is deliberately NOT here: it is whole-sequence scope, not a fresh
 *  selection, so it never yanks the inspector onto Tree on mount. */
export function autoOpenOpForKind(kind: SelectionKind): string | null {
  switch (kind) {
    case "region":
      // A bare region highlight is something users do constantly while reading
      // the map, so it must NOT yank the Primers panel open (it was annoying in
      // the demo). Clicking an annotated feature below is a deliberate pick, so
      // those still auto-open their tool.
      return null;
    case "feature-cds":
      // Picking a gene of interest no longer yanks the protein analysis open.
      // Instead the rail's protein op SHIMMERS to invite the user to click it,
      // so the heavy panel only mounts on a deliberate pick. See the nudge wired
      // in SequenceEditView and the ros-nudge-shimmer style.
      return null;
    case "feature-primer":
      return "primers";
    default:
      return null;
  }
}

/** The data the context bar reads (beyond the kind itself). */
export interface ContextBarInput {
  kind: SelectionKind;
  /** 1-based inclusive coordinates of the region (from the readout). */
  lo?: number;
  hi?: number;
  /** Region length in nt. */
  len?: number;
  /** The selected feature's name, when a feature is selected. */
  featureName?: string | null;
  /** Amino-acid count for a CDS, when the view can supply it; else the bar
   *  falls back to floor(len / 3). */
  aa?: number | null;
  /** The attached organism display name, when the sequence carries one. Only
   *  surfaces in the bar when nothing else is selected (whole-sequence scope). */
  organism?: string | null;
}

/** The rendered context bar: whether something is selected (filled vs hollow
 *  marker) and the line of text. Pure so the strings are unit-tested. */
export interface ContextBar {
  /** true draws the filled marker (acting on a selection); false the hollow
   *  marker (whole-sequence scope). */
  selected: boolean;
  text: string;
}

/** Format an integer with thousands separators for the bar copy. */
function group(n: number): string {
  return Math.round(n).toLocaleString();
}

/** Build the context-bar line for the current selection. Strings follow the
 *  mockup intent. The organism line only appears when NOTHING is selected, so
 *  the bar reads "Acting on selection" the moment the user picks a region or a
 *  feature, never competing with it. */
export function buildContextBar(input: ContextBarInput): ContextBar {
  const { kind } = input;
  if (kind === "region") {
    const lo = input.lo ?? 0;
    const hi = input.hi ?? 0;
    const len = input.len ?? 0;
    return {
      selected: true,
      text: `Acting on selection, ${group(lo)}..${group(hi)} (${group(len)} nt)`,
    };
  }
  if (kind === "feature-cds") {
    const name = (input.featureName || "").trim() || "this CDS";
    const aa =
      input.aa != null && input.aa > 0
        ? input.aa
        : input.len != null
          ? Math.floor(input.len / 3)
          : null;
    const aaPart = aa != null && aa > 0 ? `, ${group(aa)} aa` : "";
    return { selected: true, text: `A CDS is selected, ${name}${aaPart}` };
  }
  if (kind === "feature-primer") {
    const name = (input.featureName || "").trim() || "this primer";
    return { selected: true, text: `A primer is selected, ${name}` };
  }
  if (kind === "feature-other") {
    const name = (input.featureName || "").trim() || "this feature";
    return { selected: true, text: `A feature is selected, ${name}` };
  }
  // kind === "none". Surface the organism (whole-sequence scope) when present,
  // otherwise the calm whole-sequence default.
  const organism = (input.organism || "").trim();
  if (organism) {
    return { selected: false, text: `Organism attached, ${organism}` };
  }
  return { selected: false, text: "Nothing selected, whole sequence" };
}
