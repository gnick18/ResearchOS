/**
 * THROWAWAY headless awareness/cursor proof for Loro. No DOM, no server.
 *
 * loro-codemirror relays cursors NOT as raw integer offsets but as Loro stable
 * Cursors (text.getCursor(pos).encode()) carried in an EphemeralStore under the
 * keys `${peerIdStr}-cm-cursor` and `${peerIdStr}-cm-user`. The receiver decodes
 * the Cursor and resolves it to a live offset with doc.getCursorPos(). The win
 * over Yjs awareness: a stable Cursor auto-tracks the right spot even after the
 * text shifts under it, so a remote caret does not drift when others type.
 *
 * This test reproduces that exact wiring (same keys, same encode/decode, same
 * EphemeralStore transport) WITHOUT CodeMirror, and asserts:
 *   1. A's user + cursor ephemeral state relays to B.
 *   2. B can decode A's stable cursor to a concrete offset.
 *   3. After A inserts text BEFORE its own cursor, B re-resolving the SAME stable
 *      cursor tracks the shifted position (the anti-drift property).
 *
 * Run:  node test/awareness.mjs   (or: npm run awareness)
 */

import { LoroDoc, EphemeralStore, Cursor } from "loro-crdt";

// In-memory relay for ephemeral bytes (the dumb byte-pipe a DO would be).
function makeEphemeralRelay() {
  const peers = new Map();
  return {
    join(id, onBytes) { peers.set(id, onBytes); },
    broadcast(fromId, bytes) {
      for (const [id, onBytes] of peers) if (id !== fromId) onBytes(bytes);
    },
  };
}

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log("  PASS  " + msg);
  else { failures++; console.log("  FAIL  " + msg); }
}

function main() {
  console.log("Loro headless awareness/cursor proof (EphemeralStore, no server)\n");

  // --- Shared document (already converged on some text) ---------------------
  // Mirror the doc-sync relay too so both docs hold the same text, since a
  // stable Cursor only resolves against a doc that has the referenced ops.
  const docRelay = makeEphemeralRelay();
  const docA = new LoroDoc(); docA.setPeerId(1n);
  const docB = new LoroDoc(); docB.setPeerId(2n);
  docRelay.join("A", (b) => docA.import(b));
  docRelay.join("B", (b) => docB.import(b));
  docA.subscribeLocalUpdates((b) => docRelay.broadcast("A", b));
  docB.subscribeLocalUpdates((b) => docRelay.broadcast("B", b));

  const textA = docA.getText("codemirror");
  textA.insert(0, "gel ladder: 100bp");
  docA.commit();

  // --- Ephemeral (cursor/user) relay ----------------------------------------
  const ephRelay = makeEphemeralRelay();
  const ephA = new EphemeralStore();
  const ephB = new EphemeralStore();
  // join(id, onBytes): onBytes is how THIS peer receives bytes from others.
  // broadcast(fromId) fans out to every OTHER peer's onBytes.
  ephRelay.join("A", (b) => ephA.apply(b)); // bytes destined for A land on ephA
  ephRelay.join("B", (b) => ephB.apply(b)); // bytes destined for B land on ephB
  ephA.subscribeLocalUpdates((b) => ephRelay.broadcast("A", b));
  ephB.subscribeLocalUpdates((b) => ephRelay.broadcast("B", b));

  // A places its caret at offset 12 (inside "100bp"), exactly as the plugin does:
  // encode a stable Cursor and store it under the cm-cursor key.
  const peerA = docA.peerIdStr;
  const aAnchorOffset = 12;
  const aCursor = textA.getCursor(aAnchorOffset); // stable Loro Cursor
  ephA.set(`${peerA}-cm-cursor`, { anchor: aCursor.encode() });
  ephA.set(`${peerA}-cm-user`, { name: "tab-A", colorClassName: "user1" });

  // 1. The user + cursor ephemeral state relayed to B.
  console.log("[1] A sets cursor + user ephemeral state, expect B to see it");
  const bStates = ephB.getAllStates();
  const remoteKeys = Object.keys(bStates).filter((k) => k.startsWith(peerA));
  assert(remoteKeys.some((k) => k.endsWith("-cm-cursor")), "B sees A's cursor key");
  assert(remoteKeys.some((k) => k.endsWith("-cm-user")), "B sees A's user key");
  const userOnB = bStates[`${peerA}-cm-user`];
  assert(userOnB && userOnB.name === "tab-A", "B sees A's user payload (name tab-A)");
  console.log("      B's view of A user: " + JSON.stringify(userOnB));

  // 2. B decodes A's stable cursor to a concrete offset (what the plugin renders).
  console.log("\n[2] B decodes A's stable cursor to a live offset");
  const cursorStateOnB = bStates[`${peerA}-cm-cursor`];
  const decoded = Cursor.decode(new Uint8Array(cursorStateOnB.anchor));
  const resolvedB = docB.getCursorPos(decoded).offset;
  assert(resolvedB === aAnchorOffset,
    `B resolves A's caret to offset ${resolvedB} (expected ${aAnchorOffset})`);

  // 3. ANTI-DRIFT: A inserts 6 chars BEFORE its caret. The SAME stable cursor,
  //    re-resolved on B after the edit relays, should now point 6 further right.
  console.log("\n[3] A inserts text before its caret, B's resolved caret tracks the shift");
  textA.insert(0, "lane1 "); // 6 chars at the very start
  docA.commit();
  const resolvedAfter = docB.getCursorPos(decoded).offset;
  assert(resolvedAfter === aAnchorOffset + 6,
    `B re-resolves the same cursor to ${resolvedAfter} (expected ${aAnchorOffset + 6}) -> no drift`);
  console.log("      text now: " + JSON.stringify(docB.getText("codemirror").toString()));

  console.log("\n" + (failures === 0
    ? "ALL ASSERTIONS PASSED"
    : failures + " ASSERTION(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
}

main();
