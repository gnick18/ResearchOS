/**
 * THROWAWAY headless convergence proof for Loro live editing. No DOM, no server.
 *
 * This is the load-bearing proof of the live-binding spike. It mirrors the Yjs
 * spike's test (spikes/collab-yjs/test/convergence.mjs) one for one, but on Loro:
 *
 * Two LoroDocs (A and B) exchange updates through an IN-MEMORY relay that is the
 * same dumb byte-pipe a Cloudflare Durable Object would be (it just fans every
 * update out to the other peer, it never understands the bytes). The text
 * container is "codemirror", the exact name loro-codemirror's defaultGetTextFromDoc
 * binds, so this models the real editor path.
 *
 * Asserted:
 *   1. A seeds text, relays to B, both converge.
 *   2. B appends, relays to A, both converge.
 *   3. CONCURRENT edits from both (the real CRDT test) converge deterministically.
 *   4. OFFLINE-then-merge: a peer goes dark, both edit independently, then the
 *      buffered updates are flushed OUT OF ORDER, and both still converge.
 *   5. A standalone third doc importing the same update bytes lands on the same text
 *      (order independence / idempotent re-apply).
 *
 * Run:  node test/convergence.mjs   (or: npm run convergence)
 */

import { LoroDoc } from "loro-crdt";

// --- In-memory relay: the dumb byte-pipe a Durable Object would be -----------
// Each peer registers an inbox. relay.broadcast(fromId, bytes) hands the bytes
// to every OTHER peer's inbox. A peer can be "offline" (buffer, do not deliver)
// and later flushed, optionally out of order.
function makeRelay() {
  const peers = new Map(); // id -> { online, inbox(bytes), buffer: [] }
  return {
    join(id, onBytes) {
      peers.set(id, { online: true, onBytes, buffer: [] });
    },
    setOnline(id, online) {
      const p = peers.get(id);
      p.online = online;
      if (online) {
        // flush buffered-for-this-peer messages (caller controls order via flush)
      }
    },
    broadcast(fromId, bytes) {
      for (const [id, p] of peers) {
        if (id === fromId) continue;
        if (p.online) p.onBytes(bytes);
        else p.buffer.push(bytes);
      }
    },
    // Flush a peer's buffered messages. `order` lets us deliver out of order.
    flush(id, order = "fifo") {
      const p = peers.get(id);
      const msgs = order === "reverse" ? [...p.buffer].reverse() : p.buffer;
      for (const bytes of msgs) p.onBytes(bytes);
      p.buffer = [];
    },
  };
}

// A peer = a LoroDoc wired to the relay. Out: subscribeLocalUpdates -> broadcast.
// In: relay delivers bytes -> doc.import(bytes). This is exactly the wiring a
// LoroSyncPlugin + websocket provider does, minus the editor.
function makePeer(relay, id, peerIdNum) {
  const doc = new LoroDoc();
  doc.setPeerId(peerIdNum);
  relay.join(id, (bytes) => doc.import(bytes));
  doc.subscribeLocalUpdates((bytes) => relay.broadcast(id, bytes));
  return { id, doc, text: () => doc.getText("codemirror") };
}

const textOf = (peer) => peer.text().toString();

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log("  PASS  " + msg);
  } else {
    failures++;
    console.log("  FAIL  " + msg);
  }
}

function main() {
  console.log("Loro headless convergence proof (in-memory relay, no server)\n");

  const relay = makeRelay();
  const A = makePeer(relay, "A", 1n);
  const B = makePeer(relay, "B", 2n);

  // 1. A seeds text, expect it to relay to B.
  console.log("[1] A types a PCR recipe line, expect B to receive it");
  A.text().insert(0, "PCR master mix: 25uL 2x, 1uL primer F");
  A.doc.commit();
  assert(textOf(B).includes("PCR master mix"), "B received A's edit");
  assert(textOf(A) === textOf(B), "A and B converged after A edit");

  // 2. B appends, expect it to relay back to A.
  console.log("\n[2] B appends, expect A to receive it + converge");
  B.text().insert(textOf(B).length, " | 1uL primer R");
  B.doc.commit();
  assert(textOf(A).includes("primer R"), "A received B's edit");
  assert(textOf(A) === textOf(B), "A and B converged after B edit");

  // 3. Concurrent edits: both edit, both commit, both fan out. CRDT must merge.
  console.log("\n[3] Concurrent edits from both, expect deterministic merge");
  A.text().insert(0, "[A] ");
  B.text().insert(0, "[B] ");
  A.doc.commit();
  B.doc.commit();
  assert(textOf(A) === textOf(B), "A and B converged after CONCURRENT edits");
  console.log("      converged text: " + JSON.stringify(textOf(A)));

  // 4. OFFLINE then merge, flushed OUT OF ORDER.
  console.log("\n[4] B goes offline, both edit, buffered updates flush in REVERSE order");
  relay.setOnline("B", false);
  // A makes two separate committed edits while B is dark (two buffered messages).
  A.text().insert(textOf(A).length, " #step1");
  A.doc.commit();
  A.text().insert(textOf(A).length, " #step2");
  A.doc.commit();
  // B edits locally while offline.
  B.text().insert(0, "OFFLINE-B ");
  B.doc.commit();
  // A and B have diverged now (B never saw A's two messages; A never saw B's).
  const aBeforeFlush = textOf(A);
  const bBeforeFlush = textOf(B);
  assert(aBeforeFlush !== bBeforeFlush, "A and B diverged while B offline (expected)");
  // Reconnect. Flush A->B buffer in REVERSE (step2 update before step1 update).
  relay.setOnline("B", true);
  relay.flush("B", "reverse");
  assert(textOf(A) === textOf(B), "A and B reconverged after out-of-order offline flush");
  console.log("      reconverged text: " + JSON.stringify(textOf(A)));

  // 5. A fresh third doc importing the SAME update bytes (captured) lands identical.
  console.log("\n[5] Fresh doc importing A's full state lands identical (idempotent re-apply)");
  const C = new LoroDoc();
  C.setPeerId(3n);
  // import full state twice to also prove re-apply is idempotent
  const snap = A.doc.export({ mode: "update" });
  C.import(snap);
  C.import(snap);
  assert(C.getText("codemirror").toString() === textOf(A),
    "C matches A after importing + re-importing update bytes");

  console.log("\n" + (failures === 0
    ? "ALL ASSERTIONS PASSED"
    : failures + " ASSERTION(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
}

main();
