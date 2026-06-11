/**
 * align worker — off-main-thread alignment compute for CompareSequencesDialog.
 *
 * Receives a serializable AlignWorkerRequest via postMessage, runs either
 * the full DP alignment (alignGlobal / alignLocal) or the seed-and-extend
 * heuristic (findSharedRegions) for large pairs, and posts back an
 * AlignWorkerResponse. All imported functions are pure (no DOM, no React).
 *
 * The ScoringFn is a function and cannot cross the worker boundary, so the
 * caller passes a serializable ScoringDescriptor and the worker reconstructs
 * the real ScoringFn internally. This guarantees byte-identical results.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { alignGlobal, alignLocal, findSharedRegions } from "./index";
import { dnaScoring, proteinScoring } from "./scoring";
import type { AlignmentResult } from "./types";
import type { SharedRegionResult } from "./local-homology";

// ---------------------------------------------------------------------------
// Serializable message types (must survive structuredClone across the boundary)
// ---------------------------------------------------------------------------

/** Describes which scoring matrix to reconstruct in the worker. */
export type ScoringDescriptor =
  | { type: "dna"; iupac: boolean }
  | { type: "protein" };

/** A job posted from the main thread to the worker. */
export interface AlignWorkerRequest {
  /** Identifies this job so the main thread can match responses to requests. */
  id: number;
  aSeq: string;
  bSeq: string;
  /** "global" (Needleman-Wunsch) or "local" (Smith-Waterman). */
  mode: "global" | "local";
  scoring: ScoringDescriptor;
  /**
   * When true the pair exceeds MAX_ALIGN_BASES and the worker runs
   * findSharedRegions instead of the full DP.
   */
  large: boolean;
}

/** Either a normal alignment result, the large-sequence result, or an error. */
export type AlignWorkerResponse =
  | { id: number; kind: "alignment"; result: AlignmentResult }
  | { id: number; kind: "large"; result: SharedRegionResult }
  | { id: number; kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<AlignWorkerRequest>) => {
  const req = event.data;
  try {
    const scoringFn =
      req.scoring.type === "protein"
        ? proteinScoring()
        : dnaScoring({ iupac: req.scoring.iupac });

    if (req.large) {
      const result = findSharedRegions(req.aSeq, req.bSeq, {
        scoring: scoringFn,
      });
      const reply: AlignWorkerResponse = {
        id: req.id,
        kind: "large",
        result,
      };
      self.postMessage(reply);
    } else {
      const result =
        req.mode === "global"
          ? alignGlobal(req.aSeq, req.bSeq, { scoring: scoringFn })
          : alignLocal(req.aSeq, req.bSeq, { scoring: scoringFn });
      const reply: AlignWorkerResponse = {
        id: req.id,
        kind: "alignment",
        result,
      };
      self.postMessage(reply);
    }
  } catch (err) {
    const reply: AlignWorkerResponse = {
      id: req.id,
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(reply);
  }
};
