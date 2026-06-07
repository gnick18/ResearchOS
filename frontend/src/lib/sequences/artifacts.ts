// sequence editor master (redesign phase 5). RESULTS AS ARTIFACTS.
//
// Operations that PRODUCE something (an alignment, a domain scan) stop being
// throwaway popups. When one finishes, the editor saves a per-sequence RESULT
// ARTIFACT here, and the History tab surfaces it under a "Results" section so it
// is revisitable. Each artifact carries its LINEAGE (the sequence id, a content
// fingerprint of the sequence at compute time, and the inputs that produced it),
// which is what lets a later view flag a result STALE once the molecule moves on.
//
// PERSISTENCE: a per-sequence JSON sidecar at
//   users/<owner>/sequences/<id>.artifacts.json
// next to the existing <id>.meta.json and <id>.gb, read/written through the same
// `fileService` JSON helpers as `lib/sequences/enzyme-sets.ts`. Local-first,
// survives reload, never bloats the CRDT doc. Saving is best-effort; a failed
// write is the caller's problem to surface (a calm toast), it never throws into
// the operation that produced the result.
//
// SCOPE GUARD: this is its OWN per-sequence sidecar, separate from the on-disk
// sequence shape, history, and settings. Reading or writing it touches nothing
// in the map/editor render, cloning, primers, or import/export.

import { fileService } from "../file-system/file-service";
import type { AlignmentResult, SharedRegionResult } from "@/lib/align";
import type { AlignmentSummary } from "@/lib/sequences/compare-format";
import type { DomainHit } from "@/lib/sequences/interproscan";

/** The two v1 result kinds. The union is the only thing that has to grow when a
 *  later operation (tree snapshot, digest gel) becomes an artifact. */
export type ArtifactType = "alignment" | "domains";

/**
 * The self-contained payload of an ALIGNMENT artifact. Carries everything the
 * Compare dialog needs to re-render the result WITHOUT recomputing: the two
 * sequence ids/names, the run parameters, the summary stats, and either the full
 * `AlignmentResult` (base-level path) or the `SharedRegionResult` (the large-
 * sequence local-homology path), plus the raw bases for the dotplot.
 */
export interface AlignmentArtifactResult {
  aId: number | null;
  bId: number | null;
  aName: string | null;
  bName: string | null;
  mode: "global" | "local";
  scheme: "dna" | "protein";
  iupac: boolean;
  summary: AlignmentSummary;
  /** Set on the base-level alignment path. */
  alignment: AlignmentResult | null;
  /** Set on the large-sequence (shared-region) path. */
  large: SharedRegionResult | null;
  /** The two aligned sequences (for the dotplot). */
  bases: { a: string; b: string } | null;
}

/** The self-contained payload of a DOMAINS artifact. */
export interface DomainsArtifactResult {
  /** The CDS / gene feature scanned. */
  featureName: string;
  /** Its index in the molecule's feature list at scan time (provenance only). */
  featureIndex: number;
  /** Which database backed the scan. */
  source: "ebi" | "local" | "curated";
  /** The hits the scan returned. */
  hits: DomainHit[];
}

/** Lineage: enough to revisit a result and to detect when it has gone stale. */
export interface ArtifactLineage {
  /** The numeric id of the sequence the result was computed against. */
  sequenceId: number;
  /** A content fingerprint of the sequence at compute time. When the live
   *  sequence's fingerprint no longer matches this, the result is STALE. */
  sequenceVersion: string;
  /** The parameters that produced the result (align: reference id/name +
   *  algorithm; domains: the source db + the feature scanned). Free-form so the
   *  model stays extensible. */
  inputs: Record<string, unknown>;
}

/** One saved result. `result` is self-contained so a view can re-render it
 *  WITHOUT recomputing (a snapshot). */
export interface Artifact {
  /** Stable unique id (used for delete addressing). */
  id: string;
  /** Which kind of operation produced this. */
  type: ArtifactType;
  /** A human label for the list row, e.g. "Align to pEGFP-N1" / "Domains in EGFP". */
  title: string;
  /** A one-line readout for the row, e.g. "92% identity, 4 gaps" / "2 Pfam hits". */
  summary: string;
  /** ISO timestamp the result was computed. */
  createdAt: string;
  /** The sequence + version + inputs that produced this result. */
  lineage: ArtifactLineage;
  /** The payload needed to re-render the result without recomputing. */
  result: unknown;
}

/** The on-disk sidecar shape. Versioned so a future migration can grow it
 *  without trashing a user's saved results. */
export interface ArtifactsFile {
  schemaVersion: 1;
  artifacts: Artifact[];
}

/** Keep a sane cap on a per-sequence sidecar; beyond this the oldest drop. */
export const MAX_ARTIFACTS = 50;

export const DEFAULT_ARTIFACTS_FILE: ArtifactsFile = {
  schemaVersion: 1,
  artifacts: [],
};

/** The per-sequence sidecar path, next to <id>.gb / <id>.meta.json. */
export function artifactsPath(username: string, seqId: number): string {
  return `users/${username}/sequences/${seqId}.artifacts.json`;
}

/** Crypto-free, collision-resistant-enough id for a local-first sidecar. */
export function newArtifactId(): string {
  return `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Coerce a single (possibly hand-edited / partial) entry into a valid artifact,
 *  or null if it lacks the fields a row needs. */
function normalizeArtifact(raw: Partial<Artifact> | null | undefined): Artifact | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type !== "alignment" && raw.type !== "domains") return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : newArtifactId();
  const title = typeof raw.title === "string" ? raw.title : "";
  const summary = typeof raw.summary === "string" ? raw.summary : "";
  if (!title) return null;
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt
      ? raw.createdAt
      : new Date().toISOString();
  const rawLineage = (raw.lineage ?? {}) as Partial<ArtifactLineage>;
  const lineage: ArtifactLineage = {
    sequenceId:
      typeof rawLineage.sequenceId === "number" ? rawLineage.sequenceId : -1,
    sequenceVersion:
      typeof rawLineage.sequenceVersion === "string" ? rawLineage.sequenceVersion : "",
    inputs:
      rawLineage.inputs && typeof rawLineage.inputs === "object"
        ? (rawLineage.inputs as Record<string, unknown>)
        : {},
  };
  return {
    id,
    type: raw.type,
    title,
    summary,
    createdAt,
    lineage,
    result: raw.result ?? null,
  };
}

/** Merge a (possibly partial / older-schema) payload with the default, drop
 *  malformed entries, and de-duplicate ids (last-write-wins on a dup id). */
function normalizeFile(raw: Partial<ArtifactsFile> | null | undefined): ArtifactsFile {
  const rawArtifacts = Array.isArray(raw?.artifacts) ? raw!.artifacts : [];
  const byId = new Map<string, Artifact>();
  for (const entry of rawArtifacts) {
    const art = normalizeArtifact(entry);
    if (art) byId.set(art.id, art);
  }
  return { schemaVersion: 1, artifacts: [...byId.values()] };
}

/** Newest first (createdAt descending, id as a stable tiebreaker). */
function sortNewestFirst(artifacts: Artifact[]): Artifact[] {
  return [...artifacts].sort((a, b) => {
    const byTime = b.createdAt.localeCompare(a.createdAt);
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
  });
}

async function readFile(username: string, seqId: number): Promise<ArtifactsFile> {
  if (!fileService.isConnected()) return { ...DEFAULT_ARTIFACTS_FILE, artifacts: [] };
  const raw = await fileService.readJson<Partial<ArtifactsFile>>(
    artifactsPath(username, seqId),
  );
  return normalizeFile(raw);
}

async function writeFile(
  username: string,
  seqId: number,
  file: ArtifactsFile,
): Promise<void> {
  if (!fileService.isConnected()) return;
  await fileService.writeJson(artifactsPath(username, seqId), normalizeFile(file));
}

// ---------------------------------------------------------------------------
// Per-sequence write serialization (mirrors enzyme-sets.ts). A read-modify-write
// store needs each mutation to observe the prior one's result, or two writes in
// the same tick clobber each other (a lost update). Reads are NOT queued.
// ---------------------------------------------------------------------------

const writeQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prior = writeQueues.get(key) ?? Promise.resolve();
  const run = prior.then(task, task);
  writeQueues.set(key, run);
  void run.then(
    () => {
      if (writeQueues.get(key) === run) writeQueues.delete(key);
    },
    () => {
      if (writeQueues.get(key) === run) writeQueues.delete(key);
    },
  );
  return run;
}

// ── public api ───────────────────────────────────────────────────────────────

/** List a sequence's saved result artifacts, newest first. Missing file -> []. */
export async function listArtifacts(
  username: string,
  seqId: number,
): Promise<Artifact[]> {
  const file = await readFile(username, seqId);
  return sortNewestFirst(file.artifacts);
}

/**
 * Append a result artifact for a sequence. Caps the sidecar to MAX_ARTIFACTS,
 * dropping the OLDEST beyond the cap. Routed through the per-sequence write
 * queue so a rapid save-then-save composes (no lost update). Returns the saved
 * artifact (with an id assigned if the caller did not set one).
 */
export async function saveArtifact(
  username: string,
  seqId: number,
  artifact: Artifact,
): Promise<Artifact> {
  const key = artifactsPath(username, seqId);
  const saved: Artifact = {
    ...artifact,
    id: artifact.id && artifact.id.trim() ? artifact.id : newArtifactId(),
  };
  return enqueue(key, async () => {
    const file = await readFile(username, seqId);
    const next = [...file.artifacts.filter((a) => a.id !== saved.id), saved];
    // Keep the newest MAX_ARTIFACTS, dropping the oldest beyond the cap.
    const capped = sortNewestFirst(next).slice(0, MAX_ARTIFACTS);
    await writeFile(username, seqId, { schemaVersion: 1, artifacts: capped });
    return saved;
  });
}

/** Delete an artifact by id. Returns true if one was removed. */
export async function deleteArtifact(
  username: string,
  seqId: number,
  artifactId: string,
): Promise<boolean> {
  const key = artifactsPath(username, seqId);
  return enqueue(key, async () => {
    const file = await readFile(username, seqId);
    const next = file.artifacts.filter((a) => a.id !== artifactId);
    const removed = next.length !== file.artifacts.length;
    if (removed) await writeFile(username, seqId, { schemaVersion: 1, artifacts: next });
    return removed;
  });
}

/**
 * A result is STALE when the live sequence's content fingerprint no longer
 * matches the one recorded in the artifact's lineage. A blank recorded version
 * (a hand-edited / pre-lineage file) is treated as NOT stale so we never nag on
 * incomplete data.
 */
export function isArtifactStale(
  artifact: Artifact,
  currentSequenceVersion: string,
): boolean {
  const recorded = artifact.lineage.sequenceVersion;
  if (!recorded) return false;
  return recorded !== currentSequenceVersion;
}

/** Convenience object mirroring the enzyme-sets `*.list/save/...` call style. */
export const artifactsApi = {
  list: listArtifacts,
  save: saveArtifact,
  delete: deleteArtifact,
};
