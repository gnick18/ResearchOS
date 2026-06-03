// seq history bot (2026-06-03): version-control wiring for the SnapGene-style
// sequence editor (/sequences). Each explicit Save in the editor now records a
// permanent, restorable version of the molecule into the shared delta store.
//
// THE GAP this closes: the sequence editor kept only an in-memory undo/redo
// stack (use-sequence-editor) and wrote the .gb file straight through
// sequencesApi.update, recording zero durable checkpoints. The History tab was
// a placeholder empty state. This module adds the missing per-sequence history,
// mirroring task-doc-history.ts (a file-backed document keyed by owner + id).
//
// ENGINE MODEL FIT: the engine versions a CANONICAL STRING (canonicalize.ts
// accepts `unknown`; the row delta is a jsdiff of the canonical). A sequence is
// just another entity kind. We do NOT version the raw GenBank text (a re-export
// can reorder qualifiers / reflow ORIGIN lines, which would churn the diff on a
// no-op save). Instead we version a STRUCTURED PROJECTION of the sequence: name,
// topology, molecule type, the bases, and a normalized feature list. That gives
// a deterministic canonical (same molecule -> same string) and carries every
// field the version summary needs (length / feature-count / topology / name).
//
// A sequence is NOT line-diffable like prose, so the viewer summary is a concise
// DELTA (length bp change, feature-count change, topology / name change), not a
// character diff (summarizeSequenceChange below).
//
// ADDITIVE ONLY: this touches no existing Note / Task / Project versioning and
// migrates no existing files. A sequence whose .gb predates this simply starts
// versioning from its next Save (the genesis row anchors the pre-edit state).

import type { EntityViewerAdapter } from "./entity-viewer";
import { historyEngine } from "./engine";
import { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED } from "./notes-history";
import type { HistoryEditKind } from "./types";

// Re-export the SHARED flags so sequence call sites read them from one place.
// These are the SAME consts the Notes / Task / task-doc pilots use (single
// source of truth); the flag posture is one global pair, not per-entity.
export { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED };

/** History-file namespace for sequences: users/<owner>/_history/sequences/<id>.jsonl */
export const SEQUENCES_ENTITY_TYPE = "sequences";

/**
 * The slice of the editable sequence document we version. Kept structural (not
 * the raw GenBank text) so the canonical is deterministic and the diff is
 * meaningful. `seq` is the bases (the bulk of a base edit's delta); the feature
 * list is normalized to the fields a researcher recognizes (name / type /
 * strand / span), dropping volatile/derived bits so a re-parse round-trip does
 * not churn the diff.
 */
export interface SequenceTrackedState {
  /** Molecule name (the GenBank LOCUS / user display name). */
  name: string;
  /** Molecule kind: "dna" | "rna" | "protein". */
  seqType: string;
  /** Circular (plasmid) vs linear. */
  circular: boolean;
  /** The bases / residues (uppercased). */
  seq: string;
  /** Normalized feature list, in document order (order is content). */
  features: SequenceTrackedFeature[];
}

export interface SequenceTrackedFeature {
  name: string;
  type: string;
  strand: 1 | -1;
  start: number;
  end: number;
}

/**
 * The minimal shape recordSequenceHistory / sequencePayload accept. The editor's
 * SeqDocument is structurally a superset (name / seq / seqType / circular +
 * features with extra fields); we accept the loose shape so callers can pass
 * either a live SeqDocument or a reconstructed plain object without a hard
 * dependency on the editor module from lib/history.
 */
export interface SequenceDocLike {
  name?: unknown;
  seqType?: unknown;
  seq?: unknown;
  circular?: unknown;
  features?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Project an editor document (or any doc-like object) to the tracked state the
 * engine versions. Normalizes the feature list to the recognized fields so the
 * canonical is stable across a parse round-trip.
 */
export function sequencePayload(doc: SequenceDocLike): SequenceTrackedState {
  const rawFeatures = Array.isArray(doc.features) ? doc.features : [];
  const features: SequenceTrackedFeature[] = rawFeatures.map((f) => {
    const ff = (f ?? {}) as Record<string, unknown>;
    const strand = ff.strand === -1 ? -1 : 1;
    return {
      name: asString(ff.name) || "Untitled",
      type: asString(ff.type) || "misc_feature",
      strand,
      start: typeof ff.start === "number" ? ff.start : 0,
      end: typeof ff.end === "number" ? ff.end : 0,
    };
  });
  return {
    name: asString(doc.name),
    seqType: asString(doc.seqType) || "dna",
    circular: doc.circular === true,
    seq: asString(doc.seq).toUpperCase(),
    features,
  };
}

/**
 * Best-effort: append a sequence Save to the delta store. A history-write
 * failure must NEVER throw into the user's save path (PROPOSAL.md 3j), so this
 * swallows every error after logging. The .gb file has already been written by
 * the time this runs; history is a side-channel.
 *
 * No-op when the flag is off. The engine's own empty-delta short-circuit drops a
 * no-op Save (prev === next) once history exists, so re-saving an unchanged
 * molecule never mints a phantom version.
 */
export async function recordSequenceHistory(args: {
  type: HistoryEditKind;
  /** Sequence id (the document key; matches {id}.gb). */
  id: string | number;
  /** Owner folder the history file lives under (the sequence's user). */
  owner: string;
  /** The user performing the edit. */
  actor: string;
  /** Tracked state BEFORE the Save (the on-disk molecule). `null` for brand-new. */
  prevState: SequenceDocLike | null;
  /** Tracked state AFTER the Save (what was just written). */
  nextState: SequenceDocLike;
  /** VC Phase 2 (FLAG-4): target version for a "revert" / "undo-revert" row. */
  revertTargetVersion?: number;
}): Promise<void> {
  if (!HISTORY_ENGINE_ENABLED) return;
  try {
    await historyEngine.appendEdit({
      type: args.type,
      entityType: SEQUENCES_ENTITY_TYPE,
      id: args.id,
      owner: args.owner,
      actor: args.actor,
      prevState: args.prevState ? sequencePayload(args.prevState) : null,
      nextState: sequencePayload(args.nextState),
      revertTargetVersion: args.revertTargetVersion,
    });
  } catch (err) {
    // Swallow: the .gb saved fine; history is best-effort.
    console.warn(
      `[history] recordSequenceHistory failed for ${SEQUENCES_ENTITY_TYPE}/${args.id} (sequence saved, history skipped):`,
      err,
    );
  }
}

// ── Viewer adapter (consumes reconstructed canonical states) ────────────────

/**
 * The projection the version viewer summarizes for a sequence version. Carries
 * the headline metrics (length / feature count / topology / name) plus a `body`
 * to satisfy the generic EntityViewerAdapter contract (sequences are not body-
 * diffed, so `body` is a compact one-line digest used only as a fallback).
 */
export interface SequenceProjection {
  /** Compact digest, e.g. "3,400 bp, 8 features, circular". Satisfies EntityProjection. */
  body: string;
  name: string;
  seqType: string;
  circular: boolean;
  seqLength: number;
  featureCount: number;
  /** The raw bases, so the summary can tell an in-place edit (point mutation,
   *  feature move/recolor) from a no-op. Compared, never rendered as a diff. */
  seq: string;
}

const EMPTY_PROJECTION: SequenceProjection = {
  body: "",
  name: "",
  seqType: "dna",
  circular: false,
  seqLength: 0,
  featureCount: 0,
  seq: "",
};

/** Format a base-count with thousands separators + the "bp" unit. */
export function formatBp(n: number): string {
  return `${n.toLocaleString()} bp`;
}

/**
 * Build the compact one-line digest for a projection, e.g.
 * "3,400 bp, 8 features, circular". Pure string assembly.
 */
export function sequenceDigest(p: SequenceProjection): string {
  const feat = `${p.featureCount.toLocaleString()} ${p.featureCount === 1 ? "feature" : "features"}`;
  return `${formatBp(p.seqLength)}, ${feat}, ${p.circular ? "circular" : "linear"}`;
}

/**
 * Parse a reconstructed canonical state string (canonicalize of a
 * SequenceTrackedState) into a SequenceProjection. Tolerant: a malformed / empty
 * canonical projects to the empty shape so the viewer degrades gracefully.
 */
export function projectSequenceState(
  canonical: string | null | undefined,
): SequenceProjection {
  if (!canonical || canonical.trim().length === 0) {
    return EMPTY_PROJECTION;
  }
  let parsed: SequenceTrackedState;
  try {
    parsed = JSON.parse(canonical) as SequenceTrackedState;
  } catch {
    return EMPTY_PROJECTION;
  }
  const seq = asString(parsed.seq);
  const featureCount = Array.isArray(parsed.features) ? parsed.features.length : 0;
  const proj: SequenceProjection = {
    body: "",
    name: asString(parsed.name),
    seqType: asString(parsed.seqType) || "dna",
    circular: parsed.circular === true,
    seqLength: seq.length,
    featureCount,
    seq,
  };
  proj.body = sequenceDigest(proj);
  return proj;
}

/** Format a signed delta with its unit, e.g. "+12 bp" / "-3 features". Empty when 0. */
function signedDelta(diff: number, singular: string, plural: string): string {
  if (diff === 0) return "";
  const sign = diff > 0 ? "+" : "-";
  const mag = Math.abs(diff);
  const unit = mag === 1 ? singular : plural;
  return `${sign}${mag.toLocaleString()} ${unit}`;
}

/**
 * One-line, sequence-appropriate change summary comparing a version's projection
 * against its predecessor's. A sequence is not line-diffable, so the summary is a
 * concise DELTA: base-length change, feature-count change, topology flip, name
 * change. Restore / undo rows get a distinct label (they look like a plain edit
 * by diff alone). Pure (no Date.now, no engine calls).
 *
 * Precedence:
 *   - restore row (kind "revert")     -> "Restored an earlier version"
 *   - undo row (kind "undo-revert")   -> "Undid a restore"
 *   - first version of a record       -> "created sequence"
 *   - otherwise                       -> the joined deltas, or "saved (no change)"
 *
 * Examples: "+12 bp, +1 feature" / "-340 bp" / "linear to circular" /
 * "renamed to pUC19".
 */
export function summarizeSequenceChange(
  before: SequenceProjection | null,
  after: SequenceProjection,
  kind?: HistoryEditKind,
): string {
  if (kind === "revert") return "Restored an earlier version";
  if (kind === "undo-revert") return "Undid a restore";
  if (before === null) {
    return "created sequence";
  }

  const parts: string[] = [];

  const bpDelta = signedDelta(after.seqLength - before.seqLength, "bp", "bp");
  if (bpDelta) parts.push(bpDelta);

  const featDelta = signedDelta(
    after.featureCount - before.featureCount,
    "feature",
    "features",
  );
  if (featDelta) parts.push(featDelta);

  if (before.circular !== after.circular) {
    parts.push(after.circular ? "linear to circular" : "circular to linear");
  }

  if (before.name !== after.name) {
    parts.push(after.name ? `renamed to ${after.name}` : "cleared name");
  }

  if (parts.length === 0) {
    // Length / count / topology / name all held, so any change is in place:
    // a point mutation (same length) shows the bases moving, otherwise the
    // change was to a feature's details (recolor / rename / move).
    if (before.seq !== after.seq) return "edited bases";
    return "edited features";
  }
  return parts.join(", ");
}

/**
 * The sequence EntityViewerAdapter. Mirrors notesAdapter / taskDocAdapter; the
 * SequenceHistoryPanel consumes projectBody + summarize to build its version
 * list. `projectBody` returns the projection (which carries `body` = the digest),
 * `summarize` returns the delta line.
 */
export const sequenceAdapter: EntityViewerAdapter<SequenceProjection> = {
  projectBody: projectSequenceState,
  summarize: summarizeSequenceChange,
};
