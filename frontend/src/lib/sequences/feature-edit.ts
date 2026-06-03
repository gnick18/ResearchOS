// sequence Phase 2c bot — PURE feature CRUD on the editable document model.
//
// These are the only ways the FEATURE LIST mutates (the bases never change
// here; that is the insert/delete/replace path in edit-model.ts). Each function
// returns a NEW document so it slots straight into the undo-snapshot stack via
// `applyDocEdit`. Coordinates are the same 0-based [start, end) the rest of the
// model uses; `end` is exclusive.

import type { EditFeature, SeqDocument } from "./edit-model";

/** The editable fields of a feature, as the Add/Edit dialog collects them. */
export interface FeatureDraft {
  name: string;
  type: string;
  strand: 1 | -1;
  /** 0-based inclusive start. */
  start: number;
  /** 0-based EXCLUSIVE end. */
  end: number;
  /** Explicit color (hex). Empty/undefined => fall back to the type default. */
  color?: string;
}

/** Clamp a [start, end) range into the sequence and guarantee start <= end. */
function normalizeRange(
  start: number,
  end: number,
  seqLen: number,
): { start: number; end: number } {
  let lo = Math.max(0, Math.min(start, end));
  let hi = Math.min(seqLen, Math.max(start, end));
  if (lo > seqLen) lo = seqLen;
  if (hi < lo) hi = lo;
  return { start: lo, end: hi };
}

/** Build an EditFeature from a draft (used by add + edit). */
function featureFromDraft(draft: FeatureDraft, seqLen: number): EditFeature {
  const { start, end } = normalizeRange(draft.start, draft.end, seqLen);
  const strand = draft.strand === -1 ? -1 : 1;
  return {
    name: draft.name.trim() || "Untitled",
    type: draft.type.trim() || "misc_feature",
    strand,
    forward: strand === 1,
    start,
    end,
    color: draft.color && draft.color.trim() ? draft.color.trim() : undefined,
  };
}

/** ADD a feature from a draft (e.g. after drag-selecting a range). Appended to
 *  the end of the feature list; the caller re-sorts for display. */
export function addFeature(doc: SeqDocument, draft: FeatureDraft): SeqDocument {
  const feature = featureFromDraft(draft, doc.seq.length);
  return { ...doc, features: [...doc.features, feature] };
}

/** EDIT the feature at `index` from a draft. Preserves any fields the draft does
 *  not own (notes, multi-segment `locations`) UNLESS the range changed, in which
 *  case a stale single-range `locations` would conflict, so we drop a
 *  single-segment `locations` and keep multi-segment ones (the segment editor,
 *  a noted follow-up, owns those). */
export function updateFeature(
  doc: SeqDocument,
  index: number,
  draft: FeatureDraft,
): SeqDocument {
  if (index < 0 || index >= doc.features.length) return doc;
  const prev = doc.features[index];
  const updated = featureFromDraft(draft, doc.seq.length);
  const rangeChanged = updated.start !== prev.start || updated.end !== prev.end;
  const keepLocations =
    prev.locations && prev.locations.length > 1 && !rangeChanged
      ? prev.locations
      : undefined;
  const next: EditFeature = {
    ...prev,
    name: updated.name,
    type: updated.type,
    strand: updated.strand,
    forward: updated.forward,
    start: updated.start,
    end: updated.end,
    color: updated.color,
    locations: keepLocations,
  };
  const features = doc.features.slice();
  features[index] = next;
  return { ...doc, features };
}

/** Set just the COLOR of the feature at `index` (the per-feature color picker). */
export function setFeatureColor(
  doc: SeqDocument,
  index: number,
  color: string | undefined,
): SeqDocument {
  if (index < 0 || index >= doc.features.length) return doc;
  const features = doc.features.slice();
  const c = color && color.trim() ? color.trim() : undefined;
  features[index] = { ...features[index], color: c };
  return { ...doc, features };
}

/** Apply a default color to EVERY feature of a given type that has no explicit
 *  color of its own (the per-type palette change). Features that have been hand-
 *  recolored keep their override. Returns the same doc if nothing changed. */
export function setTypeColor(
  doc: SeqDocument,
  type: string,
  color: string,
): SeqDocument {
  const key = (type || "").trim().toLowerCase();
  let changed = false;
  const features = doc.features.map((f) => {
    if ((f.type || "").trim().toLowerCase() !== key) return f;
    if (f.color && f.color.trim()) return f; // respect a per-feature override
    changed = true;
    return { ...f, color: color.trim() };
  });
  return changed ? { ...doc, features } : doc;
}

/** DUPLICATE the feature at `index`. The copy is named "<name> copy" and is
 *  inserted right after the original. */
export function duplicateFeature(doc: SeqDocument, index: number): SeqDocument {
  if (index < 0 || index >= doc.features.length) return doc;
  const src = doc.features[index];
  const copy: EditFeature = {
    ...src,
    name: `${src.name} copy`,
    locations: src.locations ? src.locations.map((l) => ({ ...l })) : undefined,
    notes: src.notes ? { ...src.notes } : undefined,
  };
  const features = doc.features.slice();
  features.splice(index + 1, 0, copy);
  return { ...doc, features };
}

/** DELETE the feature at `index` (does not touch the bases). */
export function deleteFeature(doc: SeqDocument, index: number): SeqDocument {
  if (index < 0 || index >= doc.features.length) return doc;
  const features = doc.features.slice();
  features.splice(index, 1);
  return { ...doc, features };
}

/** The set of distinct feature types present in the document, lowercased and
 *  sorted, for the view-control "feature types" list + the type selector. */
export function featureTypes(doc: SeqDocument): string[] {
  const set = new Set<string>();
  for (const f of doc.features) {
    const t = (f.type || "misc_feature").trim().toLowerCase();
    if (t) set.add(t);
  }
  return Array.from(set).sort();
}

/** A feature's display length in bp, summing multi-segment locations when
 *  present (an intron-containing gene's "length" is its exon total). */
export function featureLength(f: EditFeature): number {
  if (f.locations && f.locations.length > 1) {
    return f.locations.reduce((sum, l) => sum + Math.max(0, l.end - l.start), 0);
  }
  return Math.max(0, f.end - f.start);
}
