// sequence editor master. On-device HMMER CLIENT (typed worker wrapper).
//
// runLocalHmmer spins up the classic WebWorker at /hmmer/hmmer-worker.js, hands
// it the user's Pfam .hmm bytes and OUR translated CDS protein (as FASTA), awaits
// the --domtblout table, and terminates the worker. Everything stays on the
// machine; the only network traffic is the worker's one-time static fetch of the
// cached engine. Cancelable via an AbortSignal.
//
// The actual hmmsearch run lives in the worker script (public/hmmer/
// hmmer-worker.js, a classic worker so it can importScripts the Emscripten UMD
// glue under Turbopack with no bundler worker resolution). This module is the
// typed bridge the panel calls.
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

/**
 * The HMMER command flags the on-device search runs with. The MSV/SSV prefilter
 * now works on the WASM build (the float-to-uint8 conversion in biased_byteify
 * was fixed for WASM; see tools/hmmer-wasm/prefilter-simd-fix.patch), so default
 * mode (prefilter ON) is both correct AND fast at full-database scale. No flags
 * needed; `--max` (prefilter off) is no longer required.
 */
export const HMMER_FLAGS: string[] = [];

/** Where the static engine + worker live (served from frontend/public). */
const WORKER_URL = "/hmmer/hmmer-worker.js";

/** A failure surfaced to the UI from an on-device run. */
export class LocalHmmerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalHmmerError";
  }
}

interface WorkerOk {
  domtblout: string;
}
interface WorkerErr {
  error: string;
}
type WorkerReply = WorkerOk | WorkerErr;

export interface RunLocalHmmerOptions {
  /** Cancel the run; rejects with an AbortError and terminates the worker. */
  signal?: AbortSignal;
}

/**
 * Run hmmsearch on the user's machine, the user's `.hmm` library against OUR
 * single translated CDS protein, and resolve with the raw `--domtblout` text
 * (feed it to parseDomtblout). The worker is created fresh and terminated when
 * the run settles or is cancelled, so nothing leaks across calls.
 *
 * @param hmmBytes      The bytes of the user's chosen Pfam / HMM file.
 * @param proteinFasta  OUR translated CDS as FASTA, e.g. ">cds\nMENF...".
 */
export function runLocalHmmer(
  hmmBytes: Uint8Array,
  proteinFasta: string,
  opts: RunLocalHmmerOptions = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(
        new LocalHmmerError(
          "This browser cannot run the on-device engine (no Web Worker support).",
        ),
      );
      return;
    }
    if (opts.signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    let worker: Worker;
    try {
      worker = new Worker(WORKER_URL);
    } catch {
      reject(
        new LocalHmmerError("Could not start the on-device domain engine."),
      );
      return;
    }

    const cleanup = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      cleanup();
      if (reply && "domtblout" in reply) {
        resolve(reply.domtblout);
      } else {
        reject(
          new LocalHmmerError(
            (reply as WorkerErr)?.error ||
              "The on-device domain search returned nothing.",
          ),
        );
      }
    };
    worker.onerror = (event) => {
      cleanup();
      reject(
        new LocalHmmerError(
          event?.message || "The on-device domain engine crashed.",
        ),
      );
    };

    opts.signal?.addEventListener("abort", onAbort, { once: true });

    // Hand the bytes to the worker. We pass a fresh copy's buffer as a transfer
    // so the large .hmm payload is moved, not cloned, into the worker.
    const copy = hmmBytes.slice();
    worker.postMessage(
      { hmmBytes: copy, proteinFasta, flags: HMMER_FLAGS },
      [copy.buffer],
    );
  });
}
