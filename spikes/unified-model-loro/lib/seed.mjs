// Deterministic seed builder: legacyBytes -> a Loro snapshot that is byte-identical
// across independent runs, so two clients importing the SAME legacy file CONVERGE
// instead of forking. This is section 9's "single most important build-time detail".
//
// The fix has three parts:
//   1. fixed peer/actor id (every seeder uses the same SEED_PEER)
//   2. fixed timestamp (the legacy file's own mtime / a constant, never Date.now())
//   3. canonical ordering (one deterministic insert sequence)
// Anchor each doc by its existing stable entity id so re-seeds line up.

import { LoroDoc } from "loro-crdt";

export const SEED_PEER = 0n;       // shared seed actor id
export const SEED_TIMESTAMP = 0;   // fixed; a real impl uses the legacy file mtime

// Deterministic: same legacyMarkdown in -> same snapshot bytes out, every time.
export function deterministicSeed(entityId, legacyMarkdown) {
  const doc = new LoroDoc();
  doc.setPeerId(SEED_PEER);
  // anchor metadata under the stable entity id
  const meta = doc.getMap("meta");
  meta.set("entityId", entityId);
  const body = doc.getText("body");
  body.insert(0, legacyMarkdown);
  doc.commit({ message: "seed from legacy file", timestamp: SEED_TIMESTAMP });
  return doc.export({ mode: "snapshot" });
}

// Non-deterministic: a different peer id per seeder (the fork pitfall). Same content,
// different actor -> the two docs are NOT the same operations and will duplicate on merge.
export function nonDeterministicSeed(entityId, legacyMarkdown, peerId) {
  const doc = new LoroDoc();
  doc.setPeerId(peerId);
  const meta = doc.getMap("meta");
  meta.set("entityId", entityId);
  const body = doc.getText("body");
  body.insert(0, legacyMarkdown);
  doc.commit({ message: "seed from legacy file", timestamp: Date.now() });
  return doc.export({ mode: "snapshot" });
}
