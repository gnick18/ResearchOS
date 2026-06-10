"use client";

// Minimal Ketcher canvas embed (chemistry-workbench Phase 1, embed validation).
//
// This is the de-risking probe for the last open technical question: does the
// real Ketcher React canvas mount inside our Next 16 + React 19 + Turbopack
// setup, including its Indigo wasm struct-service worker, with no backend? It is
// intentionally bare. The full editor (toolbar wiring, save to molecules/{id}.mol,
// the RDKit companion rail) builds on top once this renders clean.
//
// Loaded ONLY via a `dynamic(..., { ssr: false })` boundary, because ketcher-react
// touches `window` at import time and must never run during server rendering.

import "ketcher-react/dist/index.css";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import type { Ketcher } from "ketcher-core";
import { useState } from "react";

// The standalone provider runs Indigo compiled to wasm fully in the browser, so
// there is no server round-trip. One instance is enough for the page.
const structServiceProvider = new StandaloneStructServiceProvider();

export default function KetcherEmbed() {
  const [status, setStatus] = useState("loading Ketcher + Indigo wasm…");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "6px 10px", fontSize: 13, fontFamily: "monospace" }}>
        embed status: {status}
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 480 }}>
        <Editor
          staticResourcesUrl=""
          structServiceProvider={structServiceProvider}
          errorHandler={(message) => {
            // eslint-disable-next-line no-console
            console.error("[ketcher-embed] error:", message);
            setStatus("error: " + String(message));
          }}
          onInit={(ketcher: Ketcher) => {
            // Expose for the validation probe to assert against, and prove the
            // engine round-trips a structure (SMILES -> molfile) in-browser.
            (window as unknown as { __ketcher?: Ketcher }).__ketcher = ketcher;
            ketcher
              .setMolecule("CC(=O)Oc1ccccc1C(=O)O")
              .then(() => setStatus("ready: Ketcher mounted, Indigo wasm live, aspirin loaded"))
              .catch((e) => setStatus("setMolecule failed: " + String(e)));
          }}
        />
      </div>
    </div>
  );
}
