/**
 * THROWAWAY spike convergence proof. No browser required.
 *
 * Opens TWO WebSocket connections to the locally running `wrangler dev` worker
 * as two independent Yjs clients (A and B), through the SAME blind Durable
 * Object relay the browser uses. It then:
 *
 *   1. asserts initial sync (B sees A's seed text),
 *   2. edits A's Y.Doc and asserts the change relays to B + both converge,
 *   3. edits B's Y.Doc and asserts the change relays back to A + both converge,
 *   4. sets an awareness (cursor) state on A and asserts it relays to B.
 *
 * This is the objective proof that the relay + CRDT convergence + awareness
 * fan-out mechanic works through the real local worker. Run AFTER `wrangler
 * dev` is up:  node test/convergence.mjs  (override URL with WS_URL=...).
 */

import { WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const WS_URL = process.env.WS_URL || "ws://127.0.0.1:8787/ws";
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// Inlined RelayProvider (same protocol as src/relay-provider.ts) so the test
// is a single self-contained .mjs with no build step.
function makeClient(url, label) {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  let synced = false;

  const send = (data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  ws.on("open", () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    send(encoding.toUint8Array(enc));
  });

  ws.on("message", (raw) => {
    const data = new Uint8Array(raw);
    const dec = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(dec);
    if (messageType === MESSAGE_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      const t = syncProtocol.readSyncMessage(dec, enc, doc, client);
      if (encoding.length(enc) > 1) send(encoding.toUint8Array(enc));
      if (
        (t === syncProtocol.messageYjsSyncStep2 ||
          t === syncProtocol.messageYjsUpdate) &&
        !synced
      ) {
        synced = true;
      }
    } else if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(dec),
        "remote",
      );
    }
  });

  doc.on("update", (update, origin) => {
    if (origin === client) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    send(encoding.toUint8Array(enc));
  });

  awareness.on("update", ({ added, updated, removed }, origin) => {
    if (origin === "remote") return;
    const changed = added.concat(updated).concat(removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    );
    send(encoding.toUint8Array(enc));
  });

  const client = { doc, awareness, ws, label, get synced() { return synced; } };
  return client;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (c) => c.doc.getText("note").toString();

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log("  PASS  " + msg);
  } else {
    failures++;
    console.log("  FAIL  " + msg);
  }
}

async function main() {
  console.log("Connecting two Yjs clients to " + WS_URL + " ...");
  const A = makeClient(WS_URL, "A");
  const B = makeClient(WS_URL, "B");

  // Wait for both sockets open.
  await Promise.all([
    new Promise((res, rej) => {
      A.ws.on("open", res);
      A.ws.on("error", rej);
    }),
    new Promise((res, rej) => {
      B.ws.on("open", res);
      B.ws.on("error", rej);
    }),
  ]);
  console.log("Both sockets open.");
  await wait(300); // let the initial sync handshake settle

  // 1. A seeds text, expect it to relay to B.
  console.log("\n[1] A types a PCR recipe line, expect B to receive it");
  A.doc.getText("note").insert(0, "PCR master mix: 25uL 2x, 1uL primer F");
  await wait(400);
  assert(text(B).includes("PCR master mix"), "B received A's edit");
  assert(text(A) === text(B), "A and B converged after A edit");

  // 2. B appends concurrently, expect it to relay back to A.
  console.log("\n[2] B appends, expect A to receive it + converge");
  B.doc.getText("note").insert(text(B).length, " | 1uL primer R");
  await wait(400);
  assert(text(A).includes("primer R"), "A received B's edit");
  assert(text(A) === text(B), "A and B converged after B edit");

  // 3. Concurrent edits (the CRDT real test): both edit before sync settles.
  console.log("\n[3] Concurrent edits from both, expect deterministic merge");
  A.doc.getText("note").insert(0, "[A] ");
  B.doc.getText("note").insert(0, "[B] ");
  await wait(500);
  assert(text(A) === text(B), "A and B converged after CONCURRENT edits");
  console.log("      converged text: " + JSON.stringify(text(A)));

  // 4. Awareness (cursor) relay.
  console.log("\n[4] A sets awareness (cursor), expect B to see it");
  A.awareness.setLocalStateField("user", { name: "tab-A", color: "#1e90ff" });
  A.awareness.setLocalStateField("cursor", { anchor: 3, head: 3 });
  await wait(400);
  const remoteOnB = [...B.awareness.getStates().entries()].filter(
    ([id]) => id !== B.doc.clientID,
  );
  assert(remoteOnB.length > 0, "B sees a remote awareness state");
  const sawCursor = remoteOnB.some(([, s]) => s.cursor || s.user);
  assert(sawCursor, "B sees A's cursor/user awareness payload");
  if (remoteOnB.length > 0) {
    console.log("      B's view of A awareness: " +
      JSON.stringify(remoteOnB[0][1]));
  }

  A.ws.close();
  B.ws.close();

  console.log("\n" + (failures === 0
    ? "ALL ASSERTIONS PASSED"
    : failures + " ASSERTION(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(2);
});
