/**
 * useAlignWorker — React hook that drives the alignment Web Worker.
 *
 * For small sequences (both sides under SMALL_SEQ_THRESHOLD bases) the hook
 * skips the worker entirely and runs the alignment synchronously after a
 * single rAF yield, preserving the current behavior for typical primer/
 * plasmid-scale inputs (no added round-trip latency). Above the threshold the
 * compute is handed off to an align.worker.ts module worker so the main thread
 * stays responsive.
 *
 * The hook terminates the worker whenever the dialog closes (workerRef.current
 * .terminate()) so nothing leaks between dialog openings.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */
"use client";

import { useCallback, useRef } from "react";
import { alignGlobal, alignLocal, findSharedRegions } from "./index";
import { dnaScoring, proteinScoring } from "./scoring";
import type { AlignmentResult } from "./types";
import type { SharedRegionResult } from "./local-homology";
import type {
  AlignWorkerRequest,
  AlignWorkerResponse,
  ScoringDescriptor,
} from "./align.worker";

// Below this base count on BOTH sides we keep the alignment synchronous so
// short pairs (the common case) pay no worker-spawn overhead. Above it the
// worker is used. Must be >= MAX_ALIGN_BASES in CompareSequencesDialog to
// ensure large pairs always go off-thread; setting it equal is safe.
export const WORKER_THRESHOLD = 60_000; // bases

/** Serializable description of the scoring scheme chosen by the dialog. */
export type { ScoringDescriptor };

export interface AlignJob {
  aSeq: string;
  bSeq: string;
  mode: "global" | "local";
  scoring: ScoringDescriptor;
}

export interface AlignResult {
  alignment: AlignmentResult | null;
  large: SharedRegionResult | null;
}

/**
 * Run a single alignment job, off-thread for large pairs and synchronously for
 * small ones. Returns a promise that resolves with the result or rejects on
 * error / cancellation.
 *
 * `workerRef` is shared across calls so we can terminate it from the dialog.
 * Each new call terminates any in-flight worker and starts fresh.
 */
export function useAlignWorker() {
  const workerRef = useRef<Worker | null>(null);
  // Monotonically increasing job ID to discard stale responses.
  const jobIdRef = useRef(0);

  /** Terminate any running worker. Call on dialog close or before a new run. */
  const terminate = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  const run = useCallback(
    async (job: AlignJob): Promise<AlignResult> => {
      const { aSeq, bSeq, mode, scoring } = job;
      const large =
        aSeq.length > WORKER_THRESHOLD || bSeq.length > WORKER_THRESHOLD;

      // Small pair: synchronous compute after yielding one animation frame so
      // the "Aligning..." button state can paint before the work starts.
      if (!large) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const scoringFn =
          scoring.type === "protein"
            ? proteinScoring()
            : dnaScoring({ iupac: scoring.iupac });
        const result =
          mode === "global"
            ? alignGlobal(aSeq, bSeq, { scoring: scoringFn })
            : alignLocal(aSeq, bSeq, { scoring: scoringFn });
        return { alignment: result, large: null };
      }

      // Large pair: spin up a module worker, terminate the previous one first.
      terminate();

      return new Promise<AlignResult>((resolve, reject) => {
        // Next.js / Turbopack bundle this as a module worker automatically via
        // the `new URL('./align.worker.ts', import.meta.url)` pattern.
        let worker: Worker;
        try {
          worker = new Worker(
            new URL("./align.worker.ts", import.meta.url),
            { type: "module" },
          );
        } catch (err) {
          reject(
            new Error(
              `Could not start alignment worker: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
          return;
        }
        workerRef.current = worker;

        const id = ++jobIdRef.current;

        worker.onmessage = (event: MessageEvent<AlignWorkerResponse>) => {
          const reply = event.data;
          // Discard responses from a previous (already-terminated) job.
          if (reply.id !== id) return;

          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;

          if (reply.kind === "alignment") {
            resolve({ alignment: reply.result, large: null });
          } else if (reply.kind === "large") {
            resolve({ alignment: null, large: reply.result });
          } else {
            reject(new Error(reply.message));
          }
        };

        worker.onerror = (event) => {
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          reject(
            new Error(
              event?.message ?? "The alignment worker encountered an error.",
            ),
          );
        };

        const req: AlignWorkerRequest = { id, aSeq, bSeq, mode, scoring, large };
        worker.postMessage(req);
      });
    },
    [terminate],
  );

  return { run, terminate };
}
