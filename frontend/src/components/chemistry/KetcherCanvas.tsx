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
// struct service in a worker with no server round-trip.
const structServiceProvider = new StandaloneStructServiceProvider();

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
