// sequence Phase 2c bot — PURE feature CRUD on the editable document model.
//
// These are the only ways the FEATURE LIST mutates (the bases never change
// here; that is the insert/delete/replace path in edit-model.ts). Each function
// returns a NEW document so it slots straight into the undo-snapshot stack via
// `applyDocEdit`. Coordinates are the same 0-based [start, end) the rest of the
// model uses; `end` is exclusive.

import type { EditFeature, SeqDocument } from "./edit-model";

/** A single segment row in the editor's segment table. 0-based [start, end). */
export interface FeatureSegment {
  start: number;
  end: number;
  /** Optional per-segment color override (hex). */
  color?: string;
}

/** A single GenBank qualifier the dialog edits: a key plus one value string.
 *  bio-parsers stores qualifiers as `notes[key] = string[]`; the editor flattens
 *  multi-value qualifiers into one row per value (see qualifiersFromNotes). */
export interface QualifierRow {
  key: string;
  value: string;
}

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
  /** Multi-segment join() ranges. Single-segment features omit this (or pass one
   *  row); >1 row persists as a GenBank join() via jsonToGenbank. */
  segments?: FeatureSegment[];
  /** GenBank qualifiers (/product, /note, /gene, ...) as flat key/value rows. */
  qualifiers?: QualifierRow[];
  /** Per-feature "Translate in sequence view" toggle. */
  translate?: boolean;
  /** Per-feature "Prioritize display in maps" toggle. */
  prioritize?: boolean;
}

// --- TOGGLE QUALIFIER KEYS --------------------------------------------------
// The two per-feature display toggles persist as ordinary GenBank qualifiers so
// the on-disk shape stays standard (no sidecar). They are namespaced so they do
// not collide with biological qualifiers and are filtered out of the visible
// qualifier table.
export const TRANSLATE_NOTE_KEY = "ResearchOS_translate";
export const PRIORITIZE_NOTE_KEY = "ResearchOS_prioritize";

/** Qualifier keys the editor owns/derives and therefore hides from the table. */
export const RESERVED_NOTE_KEYS = new Set<string>([
  TRANSLATE_NOTE_KEY,
  PRIORITIZE_NOTE_KEY,
  // Color is edited via the color picker, not the qualifier table.
  "ApEinfo_fwdcolor",
  "ApEinfo_revcolor",
  "ApEinfo_label",
  "color",
  "labelColor",
]);

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

// ---------------------------------------------------------------------------
// PUBLIC BOUNDS VALIDATION — used by the editor dialog + tests
// ---------------------------------------------------------------------------

/** Result of validating a single segment's [start, end) coordinates (0-based
 *  internal representation; the dialog displays 1-based inclusive values). */
export interface SegmentValidation {
  /** True when both bounds are in [0, seqLen] and start < end. */
  ok: boolean;
  /** Clamped start (0-based). */
  start: number;
  /** Clamped end (0-based exclusive). */
  end: number;
  /** A human-readable message when !ok, otherwise undefined. */
  message?: string;
}

/**
 * Validate and clamp a single segment's bounds.
 *
 * The dialog stores coordinates in 0-based half-open [start, end) internally.
 * Clamping rules (matching `normalizeRange`):
 *   - start clamped to [0, seqLen]
 *   - end   clamped to [0, seqLen]
 *   - if start >= end after clamping, that is flagged as invalid (zero/negative length)
 *
 * @param start 0-based inclusive start
 * @param end   0-based exclusive end
 * @param seqLen sequence length in bp
 */
export function validateSegmentCoords(
  start: number,
  end: number,
  seqLen: number,
): SegmentValidation {
  const clampedStart = Math.max(0, Math.min(start, seqLen));
  const clampedEnd = Math.max(0, Math.min(end, seqLen));
  if (clampedStart >= clampedEnd) {
    return {
      ok: false,
      start: clampedStart,
      end: clampedEnd,
      message:
        clampedStart >= seqLen
          ? `Start (${clampedStart + 1}) must be less than the sequence length (${seqLen} bp).`
          : `End (${clampedEnd}) must be greater than start (${clampedStart + 1}).`,
    };
  }
  const messages: string[] = [];
  if (start < 0) messages.push(`Start was clamped to 1 (was ${start + 1}).`);
  if (end > seqLen)
    messages.push(`End was clamped to ${seqLen} (was ${end}; sequence is ${seqLen} bp).`);
  if (start > end)
    messages.push(`Start and end were swapped.`);
  return {
    ok: true,
    start: clampedStart,
    end: clampedEnd,
    message: messages.length ? messages.join(" ") : undefined,
  };
}

/**
 * Validate and clamp all segments in the dialog's segment table.
 * Returns per-segment results and a summary `allOk` flag.
 * A "bad" segment (ok:false) must be fixed before the draft can be saved.
 */
export function validateAllSegments(
  segments: FeatureSegment[],
  seqLen: number,
): { results: SegmentValidation[]; allOk: boolean } {
  const results = segments.map((s) => validateSegmentCoords(s.start, s.end, seqLen));
  return { results, allOk: results.every((r) => r.ok) };
}

// --- SEGMENTS (multi-segment join() editing) --------------------------------

/** A feature's segments as editable rows: its `locations` if multi-segment,
 *  else a single row from its [start, end). Always at least one row. */
export function segmentsOf(f: {
  start: number;
  end: number;
  locations?: { start: number; end: number }[];
}): FeatureSegment[] {
  if (f.locations && f.locations.length > 1) {
    return f.locations.map((l) => ({ start: l.start, end: l.end }));
  }
  return [{ start: f.start, end: f.end }];
}

/** Normalize, clamp, and sort a list of segments; returns at least one row and
 *  the overall [start, end) span. Empty/zero-length segments are dropped unless
 *  that would leave nothing (then a single clamped row survives). */
export function normalizeSegments(
  segments: FeatureSegment[],
  seqLen: number,
): { segments: FeatureSegment[]; start: number; end: number } {
  const cleaned = segments
    .map((s) => {
      const { start, end } = normalizeRange(s.start, s.end, seqLen);
      const color = s.color && s.color.trim() ? s.color.trim() : undefined;
      return { start, end, color };
    })
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (cleaned.length === 0) {
    const fallback = normalizeRange(
      segments[0]?.start ?? 0,
      segments[0]?.end ?? 0,
      seqLen,
    );
    const row = { start: fallback.start, end: Math.max(fallback.end, fallback.start + 1) };
    return { segments: [row], start: row.start, end: row.end };
  }
  const start = cleaned[0].start;
  const end = cleaned.reduce((m, s) => Math.max(m, s.end), cleaned[0].end);
  return { segments: cleaned, start, end };
}

/** SPLIT the segment at `index` into two halves at its midpoint, creating a
 *  join(). Returns a NEW segment list. */
export function splitSegment(segments: FeatureSegment[], index: number): FeatureSegment[] {
  if (index < 0 || index >= segments.length) return segments;
  const seg = segments[index];
  const span = seg.end - seg.start;
  if (span < 2) return segments; // cannot split a 1-bp segment
  const mid = seg.start + Math.floor(span / 2);
  const left = { ...seg, start: seg.start, end: mid };
  const right = { ...seg, start: mid, end: seg.end };
  const out = segments.slice();
  out.splice(index, 1, left, right);
  return out;
}

/** MERGE the segment at `index` with the next segment (by position), spanning
 *  from the lower start to the higher end. The merged segment keeps the first
 *  segment's color. Returns a NEW list. */
export function mergeSegment(segments: FeatureSegment[], index: number): FeatureSegment[] {
  if (segments.length < 2) return segments;
  // Merge with the next row in the (display-sorted) list.
  const sorted = segments
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.start - b.s.start || a.s.end - b.s.end);
  const pos = sorted.findIndex((e) => e.i === index);
  if (pos < 0 || pos >= sorted.length - 1) return segments;
  const a = sorted[pos].s;
  const b = sorted[pos + 1].s;
  const merged: FeatureSegment = {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    color: a.color ?? b.color,
  };
  const drop = new Set([sorted[pos].i, sorted[pos + 1].i]);
  const out = segments.filter((_, i) => !drop.has(i));
  out.push(merged);
  return out;
}

/** DELETE the segment at `index`. Never removes the last remaining segment. */
export function deleteSegment(segments: FeatureSegment[], index: number): FeatureSegment[] {
  if (segments.length <= 1) return segments;
  if (index < 0 || index >= segments.length) return segments;
  const out = segments.slice();
  out.splice(index, 1);
  return out;
}

// --- QUALIFIERS (GenBank notes <-> flat editor rows) ------------------------

function noteValuesToStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v === undefined || v === null) return [];
  return [String(v)];
}

/** Flatten a feature's `notes` into editable qualifier rows, skipping the keys
 *  the editor owns (color, the two toggles). One row per value. */
export function qualifiersFromNotes(notes?: Record<string, unknown>): QualifierRow[] {
  if (!notes) return [];
  const rows: QualifierRow[] = [];
  for (const key of Object.keys(notes)) {
    if (RESERVED_NOTE_KEYS.has(key)) continue;
    for (const value of noteValuesToStrings(notes[key])) {
      rows.push({ key, value });
    }
  }
  return rows;
}

/** Fold edited qualifier rows back into a notes object, MERGING over the
 *  reserved keys carried on `prevNotes` (color + toggles are written separately
 *  and must not be clobbered). Empty keys are dropped; same-key rows group into
 *  a string[] (GenBank allows repeated qualifiers). */
export function notesFromQualifiers(
  rows: QualifierRow[],
  prevNotes?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = {};
  // Preserve reserved keys from the previous notes (color/toggles).
  if (prevNotes) {
    for (const key of Object.keys(prevNotes)) {
      if (RESERVED_NOTE_KEYS.has(key)) next[key] = prevNotes[key];
    }
  }
  for (const row of rows) {
    const key = row.key.trim();
    if (!key || RESERVED_NOTE_KEYS.has(key)) continue;
    const arr = (next[key] as string[] | undefined) ?? [];
    if (!Array.isArray(next[key])) next[key] = arr;
    arr.push(row.value);
  }
  return Object.keys(next).length ? next : undefined;
}

/** Read a boolean toggle stored as a GenBank qualifier (value "1"/"true"). */
export function readNoteFlag(notes: Record<string, unknown> | undefined, key: string): boolean {
  if (!notes) return false;
  const v = notes[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s === true || s === "1" || s === "true";
}

/** Write/clear a boolean toggle qualifier onto a notes object (immutable). */
export function withNoteFlag(
  notes: Record<string, unknown> | undefined,
  key: string,
  on: boolean,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...(notes || {}) };
  if (on) next[key] = ["1"];
  else delete next[key];
  return Object.keys(next).length ? next : undefined;
}

/** Build an EditFeature from a draft (used by add + edit). */
function featureFromDraft(draft: FeatureDraft, seqLen: number): EditFeature {
  const strand = draft.strand === -1 ? -1 : 1;

  // Resolve the geometry from the segment table when present, else the range.
  const rawSegments =
    draft.segments && draft.segments.length
      ? draft.segments
      : [{ start: draft.start, end: draft.end }];
  const norm = normalizeSegments(rawSegments, seqLen);
  const multi = norm.segments.length > 1;

  // Fold qualifier rows + the two toggle flags into notes (a standard GenBank
  // construct), preserving any reserved keys the draft does not own.
  let notes = notesFromQualifiers(draft.qualifiers ?? [], undefined);
  notes = withNoteFlag(notes, TRANSLATE_NOTE_KEY, !!draft.translate);
  notes = withNoteFlag(notes, PRIORITIZE_NOTE_KEY, !!draft.prioritize);

  return {
    name: draft.name.trim() || "Untitled",
    type: draft.type.trim() || "misc_feature",
    strand,
    forward: strand === 1,
    start: norm.start,
    end: norm.end,
    color: draft.color && draft.color.trim() ? draft.color.trim() : undefined,
    locations: multi ? norm.segments.map((s) => ({ start: s.start, end: s.end })) : undefined,
    notes,
  };
}

/** ADD a feature from a draft (e.g. after drag-selecting a range). Appended to
 *  the end of the feature list; the caller re-sorts for display. */
export function addFeature(doc: SeqDocument, draft: FeatureDraft): SeqDocument {
  const feature = featureFromDraft(draft, doc.seq.length);
  return { ...doc, features: [...doc.features, feature] };
}

/** EDIT the feature at `index` from a draft. The enriched dialog now carries the
 *  feature's FULL state — segments, qualifiers, and the two display toggles — so
 *  geometry and notes are rebuilt from the draft (lossless round-trip). Any
 *  non-draft notes the user kept are preserved because the dialog seeds the
 *  qualifier rows from the live feature; color + toggle qualifiers are re-derived
 *  from the draft's color / translate / prioritize fields. */
export function updateFeature(
  doc: SeqDocument,
  index: number,
  draft: FeatureDraft,
): SeqDocument {
  if (index < 0 || index >= doc.features.length) return doc;
  const prev = doc.features[index];
  const updated = featureFromDraft(draft, doc.seq.length);

  // Geometry: when the draft carries an explicit segment table, that wins. When
  // it does NOT (the simple-range edit path / legacy callers), keep prev's
  // multi-segment locations if the overall range did not change, else drop a now-
  // stale locations array.
  let locations = updated.locations;
  if (draft.segments === undefined) {
    // Legacy / simple-range path: keep prev's multi-segment locations when the
    // overall range is unchanged, else drop a now-stale locations array.
    const rangeChanged = updated.start !== prev.start || updated.end !== prev.end;
    locations =
      prev.locations && prev.locations.length > 1 && !rangeChanged
        ? prev.locations
        : undefined;
  }

  // Notes: when the draft carries qualifier rows, that is the full set. When it
  // does NOT (legacy callers), keep prev.notes but still apply the toggle flags.
  let notes = updated.notes;
  if (!draft.qualifiers) {
    notes = withNoteFlag(prev.notes, TRANSLATE_NOTE_KEY, !!draft.translate);
    notes = withNoteFlag(notes, PRIORITIZE_NOTE_KEY, !!draft.prioritize);
    // If the legacy caller did not pass toggles either, leave prev.notes intact.
    if (draft.translate === undefined && draft.prioritize === undefined) {
      notes = prev.notes;
    }
  }

  const next: EditFeature = {
    ...prev,
    name: updated.name,
    type: updated.type,
    strand: updated.strand,
    forward: updated.forward,
    start: updated.start,
    end: updated.end,
    color: updated.color,
    locations,
    notes,
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

/** Set just the NAME of the feature at `index` (the quick-rename action on the
 *  feature right-click menu). Mirrors setFeatureColor: a single-field change that
 *  returns a NEW document and touches nothing else (geometry, type, notes, color
 *  all carry over). A blank name falls back to "Untitled" so the feature always
 *  has a label. Out-of-range or no-op (same name) indices return the same doc. */
export function renameFeature(
  doc: SeqDocument,
  index: number,
  name: string,
): SeqDocument {
  if (index < 0 || index >= doc.features.length) return doc;
  const next = name.trim() || "Untitled";
  if (doc.features[index].name === next) return doc;
  const features = doc.features.slice();
  features[index] = { ...features[index], name: next };
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
