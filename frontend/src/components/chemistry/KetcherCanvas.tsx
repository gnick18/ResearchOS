"use client";

// Reusable Ketcher canvas for the chemistry structure editor (chemistry-workbench
// Phase 1). Generalized from KetcherEmbed (the de-risking probe): it takes an
// optional initial structure to open and hands the live Ketcher instance back to
// the parent, which reads getMolfile() on save and recomputes the RDKit identity
// on change.
//
// Ketcher's standalone struct service runs Indigo compiled to wasm in a Web
// Worker, fully in the browser, no backend. ketcher-react touches `window` at
// import time, so this component MUST be loaded via dynamic(..., { ssr: false }).
// The Indigo worker needs 'unsafe-eval' in the CSP (its Emscripten glue bootstraps
// via new Function); that is in next.config.ts and was verified live.

import "ketcher-react/dist/index.css";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import type { Ketcher } from "ketcher-core";

// One Indigo-backed provider for the page; the standalone provider runs the wasm
// struct service in a worker with no server round-trip. The worker itself is a
// module-level singleton inside ketcher-standalone (one `new WorkerFactory()`),
// shared by every service this provider creates and reused by the Editor below.
const structServiceProvider = new StandaloneStructServiceProvider();

// Warm the Indigo wasm AHEAD of the first editor open. Importing this module
// already spawns the shared worker; `info()` posts it a trivial request, which
// forces the worker to compile + instantiate the wasm and answer. Because the
// worker is the shared singleton the Editor reuses, the open then skips that cost.
// Best-effort and idempotent (a second call just re-asks a warm worker). We do
// NOT terminate the worker on teardown: destroy() kills the shared singleton,
// which would break the next editor open, and it cannot cleanly respawn.
let warmStarted = false;
export async function warmKetcher(): Promise<void> {
  if (warmStarted) return;
  warmStarted = true;
  try {
    await structServiceProvider.createStructService({}).info();
  } catch {
    // The editor still instantiates the engine on open as usual.
    warmStarted = false;
  }
}

export default function KetcherCanvas({
  initialStructure,
  onReady,
  onChange,
}: {
  /** A SMILES string or an MDL Molfile to open on mount. Blank = empty canvas. */
  initialStructure?: string;
  /** Called once with the live Ketcher instance after it mounts + loads. */
  onReady?: (ketcher: Ketcher) => void;
  /** Called after any edit, so the parent can refresh the identity readout. */
  onChange?: () => void;
}) {
  return (
    <Editor
      staticResourcesUrl=""
      structServiceProvider={structServiceProvider}
      errorHandler={(message) => {
        // eslint-disable-next-line no-console
        console.error("[KetcherCanvas] error:", message);
      }}
      onInit={(ketcher: Ketcher) => {
        const finish = () => {
          onReady?.(ketcher);
          // Ketcher fires CHANGE on every structural edit. We debounce-free relay
          // it; the parent throttles the (cheap, wasm) identity recompute.
          try {
            ketcher.editor.subscribe("change", () => onChange?.());
          } catch {
            // older ketcher builds expose subscribe differently; identity then
            // refreshes on save instead of live, which is acceptable.
          }
        };
        if (initialStructure) {
          ketcher
            .setMolecule(initialStructure)
            .then(finish)
            .catch(finish);
        } else {
          finish();
        }
      }}
    />
  );
}
