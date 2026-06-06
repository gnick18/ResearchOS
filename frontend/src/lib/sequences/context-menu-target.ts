// sequence editor master. PURE helpers for the context-aware right-click menu.
//
// The editor's right-click menu is now SMART. It shows the FEATURE menu when the
// click landed on a feature, and the BASES menu otherwise. Two pieces of that
// are pure (and therefore unit-tested here) so the React view stays a thin shell:
//
//   1. The feature-id round trip. We stamp a stable, index-encoding DOM id onto
//      every SeqViz annotation (SeqViz keeps an `id` we pass and renders it as the
//      element id + class). On right-click we read that id back off the element
//      under the cursor and decode the doc-feature index. This is the reliable
//      hook (no name matching, no coordinate math), and it works in both the
//      linear and circular renderers because both use the annotation id as the
//      element id.
//   2. The menu chooser. Given whether a feature was hit, pick the feature items
//      or the bases items. Kept pure so the routing is testable without a DOM.

/** The prefix on the DOM id we stamp onto each annotation. The number after it is
 *  the 0-based index into `doc.features`. Chosen to be a valid id AND class token
 *  (alphanumerics + hyphen only) so SeqViz can use it as both. */
export const FEATURE_DOM_ID_PREFIX = "roidx-";

/** Build the stable annotation id for a given doc-feature index. */
export function featureDomId(index: number): string {
  return `${FEATURE_DOM_ID_PREFIX}${index}`;
}

/** Decode a doc-feature index from a stamped annotation id, or null if the id is
 *  not one of ours (or malformed). */
export function decodeFeatureDomId(id: string | null | undefined): number | null {
  if (!id || !id.startsWith(FEATURE_DOM_ID_PREFIX)) return null;
  const raw = id.slice(FEATURE_DOM_ID_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Walk up from a right-click target to the nearest SeqViz annotation element and
 *  decode its doc-feature index. Returns null when the click was not on a feature
 *  (bare track, ruler, primer, translation, empty viewer). The annotation path /
 *  rect carries the `la-vz-annotation` class; its label carries
 *  `la-vz-annotation-label`. Both share the stamped id, so we accept either. */
export function featureIndexFromEventTarget(
  target: EventTarget | null,
): number | null {
  if (!target || !(target instanceof Element)) return null;
  const hit = target.closest(".la-vz-annotation, .la-vz-annotation-label");
  if (!hit) return null;
  return decodeFeatureDomId(hit.getAttribute("id"));
}

/** Which context menu a right-click should open. The router picks the most
 *  SPECIFIC menu the hit supports, in priority order.
 *
 *    "primer"    a feature of type primer_bind was hit (primer-specific actions)
 *    "feature"   any other feature was hit (the feature menu; CDS features add a
 *                protein group on top of it, see chooseContextMenuKind notes)
 *    "selection" no feature, but a base range IS selected (selection-aware ops)
 *    "bases"     no feature, no range (today's plain bases menu)
 *
 *  Pure so the routing is testable on its own. */
export type ContextMenuKind = "primer" | "feature" | "selection" | "bases";

/** Inputs the router needs beyond the hit-test feature index. */
export interface ContextMenuHit {
  /** The doc-feature index under the cursor, or null when the click missed every
   *  feature (decoded from the stamped annotation id by featureIndexFromEventTarget). */
  hitFeatureIndex: number | null;
  /** The (lowercased) type of the hit feature, when a feature was hit. Used to
   *  split primer_bind off into its own menu. Ignored when no feature was hit. */
  hitFeatureType?: string | null;
  /** Whether a base range is currently selected. Lets a right-click on bare DNA
   *  open the selection-aware menu instead of the plain bases menu. */
  hasRange?: boolean;
}

/** Choose the menu kind from the hit-test result. A feature hit wins over the
 *  selection (you right-clicked a thing), and a primer_bind feature gets its own
 *  primer menu. Off a feature, a live selection opens the selection menu;
 *  otherwise the plain bases menu (today's default) is shown.
 *
 *  CDS / coding features still resolve to "feature" here: the protein actions are
 *  ADDED onto the feature menu by the view (the menu kind stays "feature"), so the
 *  classifier only needs to separate primers from the rest. */
export function chooseContextMenuKind(hit: ContextMenuHit): ContextMenuKind {
  if (hit.hitFeatureIndex != null) {
    const type = (hit.hitFeatureType || "").trim().toLowerCase();
    return type === "primer_bind" ? "primer" : "feature";
  }
  return hit.hasRange ? "selection" : "bases";
}

/** Build a one-record FASTA block for a copy action. The header line is the
 *  given name (defaulting to "sequence" when blank), prefixed with ">"; the bases
 *  follow on the next line. We keep it single-line (no 60/70-col wrapping) so the
 *  payload round-trips cleanly into other editors; trailing newline is omitted so
 *  pasting does not leave a dangling blank line. Pure so it is unit-tested. */
export function toFasta(name: string, bases: string): string {
  const header = (name || "").trim() || "sequence";
  return `>${header}\n${bases}`;
}
