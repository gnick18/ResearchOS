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

/** Which context menu a right-click should open. "feature" when a feature was
 *  hit, otherwise "bases". Pure so the routing is testable on its own. */
export type ContextMenuKind = "feature" | "bases";

/** Choose the menu kind from the hit-test result. A non-null feature index means
 *  the click landed on a feature, so the feature menu wins; otherwise the bases
 *  menu (today's default) is shown. */
export function chooseContextMenuKind(
  hitFeatureIndex: number | null,
): ContextMenuKind {
  return hitFeatureIndex != null ? "feature" : "bases";
}
