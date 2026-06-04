// NoteStore models one ResearchOS note on the locked B-plus-graceful-C on-disk model.
//
// - A Loro doc is the merge/history source of truth.
// - On every save we persist TWO artifacts:
//     1. a binary sidecar  (.researchos/<id>.loro)   = Loro snapshot export
//     2. a readable mirror (<id>.md)                 = deterministic plain-text projection
// - Formatting (bold/italic) lives as Loro Peritext marks on the text container,
//   NOT as markdown control characters inside the text. The mirror renders marks to
//   markdown only at projection time.
// - External edits to the mirror are ingested as ONE snapshot-commit version, never
//   reverse-engineered into fine-grained ops.

import fs from "node:fs";
import path from "node:path";
import { LoroDoc } from "loro-crdt";

// Stable per-note actor id for in-app edits (deterministic, see gate 5 fork rule).
export const APP_PEER = 1n;

export class NoteStore {
  // root is a scratch directory standing in for the user's data folder.
  constructor(root, id) {
    this.root = root;
    this.id = id;
    this.sidecarDir = path.join(root, ".researchos");
    this.sidecarPath = path.join(this.sidecarDir, `${id}.loro`);
    this.mirrorPath = path.join(root, `${id}.md`);
    this.doc = new LoroDoc();
    this.doc.setPeerId(APP_PEER);
  }

  text() {
    return this.doc.getText("body");
  }

  // In-app edit, committed as one granular CRDT change with a message + timestamp.
  appEdit(fn, message, timestamp) {
    fn(this.text());
    this.doc.commit({ message, timestamp });
    return this.doc.frontiers();
  }

  // Deterministic readable projection: plain body text with marks rendered to markdown.
  // Peritext marks are read from the delta and wrapped, so control chars never live in the CRDT.
  renderMarkdown() {
    const delta = this.text().toDelta();
    let out = "";
    for (const span of delta) {
      if (typeof span.insert !== "string") continue;
      let s = span.insert;
      const attrs = span.attributes || {};
      if (attrs.italic) s = `*${s}*`;
      if (attrs.bold) s = `**${s}**`;
      out += s;
    }
    return out;
  }

  // Persist both artifacts. Returns the byte sizes for reporting.
  save() {
    fs.mkdirSync(this.sidecarDir, { recursive: true });
    const snapshot = this.doc.export({ mode: "snapshot" });
    fs.writeFileSync(this.sidecarPath, snapshot);
    const md = this.renderMarkdown();
    fs.writeFileSync(this.mirrorPath, md, "utf8");
    return { sidecarBytes: snapshot.length, mirrorBytes: Buffer.byteLength(md) };
  }

  // Load doc from the binary sidecar (normal open path).
  load() {
    const bytes = fs.readFileSync(this.sidecarPath);
    this.doc = new LoroDoc();
    this.doc.setPeerId(APP_PEER);
    this.doc.import(new Uint8Array(bytes));
    return this;
  }

  sidecarExists() {
    return fs.existsSync(this.sidecarPath);
  }

  // Graceful degradation: reseed the doc from the readable mirror alone.
  // Mirrors the deterministic-seed idea (gate 5): fixed peer, fixed timestamp,
  // single insert so a reseed is reproducible.
  reseedFromMirror(seedTimestamp = 0) {
    const md = fs.readFileSync(this.mirrorPath, "utf8");
    this.doc = new LoroDoc();
    this.doc.setPeerId(APP_PEER);
    // Plain reseed: strip markdown emphasis back to plain text for the body layer.
    const plain = md.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
    this.doc.getText("body").insert(0, plain);
    this.doc.commit({ message: "reseed from readable mirror", timestamp: seedTimestamp });
    return this;
  }

  // --- External-edit ingest: the locked B-plus-graceful-C policy ---
  //
  // The mirror was changed outside ResearchOS while the doc was closed. We ingest the
  // new content as ONE snapshot-commit version. We classify the change:
  //   - "clean"  : small/followable text change -> apply as a text update, a normal diff exists.
  //   - "whack"  : body reshaped beyond a similarity floor -> store FULL COPY of new content
  //                as that version and flag "edited outside, clean diff unavailable".
  // Either way the version tree stays walkable across the boundary.
  ingestExternalEdit(newBody, timestamp) {
    const oldBody = this.text().toString();
    const followable = isCleanlyFollowable(oldBody, newBody);
    const t = this.text();
    // Loro's text.update() computes a minimal text diff for us. We use it for the clean
    // case (granular-ish followable) and ALSO for the whack case, but the whack version
    // is marked so the UI knows a clean cross-boundary diff is not meaningful.
    t.update(newBody);
    const message = followable
      ? "edited outside ResearchOS (clean diff)"
      : "edited outside ResearchOS, clean diff unavailable";
    this.doc.setNextCommitOrigin("external-edit");
    this.doc.commit({ message, timestamp });
    return {
      followable,
      message,
      // For the whack case the stored snapshot IS the full new copy (CRDT holds full state),
      // so a rollback target before the boundary still exists and is walkable.
      fullCopyStored: !followable,
      frontiers: this.doc.frontiers(),
    };
  }
}

// Similarity heuristic deciding clean vs whack. A real impl would tune this; for the
// spike we use a character-bigram Dice coefficient with a 0.5 floor.
export function isCleanlyFollowable(a, b) {
  if (a === b) return true;
  if (a.length === 0 || b.length === 0) return false;
  const big = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ma = big(a), mb = big(b);
  let inter = 0;
  for (const [g, ca] of ma) {
    const cb = mb.get(g) || 0;
    inter += Math.min(ca, cb);
  }
  const total = (a.length - 1) + (b.length - 1);
  const dice = (2 * inter) / total;
  return dice >= 0.5;
}
