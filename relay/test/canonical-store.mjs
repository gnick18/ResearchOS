// Phase 1 chunk 1 functional test: the relay DO persists doc updates and
// serves a catch-up snapshot to a new peer (durable + offline reconcile), and
// still fans out live updates. Run against `wrangler dev` on PORT.
import { WebSocket } from "ws";
import { LoroDoc } from "loro-crdt";

const PORT = process.env.PORT || "8802";
const URL = `ws://localhost:${PORT}/ws?session=canon-test-${Date.now()}`;
const DOC_UPDATE = 0x01;

const frame = (type, payload) => {
  const out = new Uint8Array(payload.length + 1);
  out[0] = type;
  out.set(payload, 1);
  return out;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.binaryType = "arraybuffer";
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function onDocUpdate(ws, into) {
  ws.on("message", (data) => {
    const bytes = new Uint8Array(data);
    if (bytes.length === 0) return;
    if (bytes[0] === DOC_UPDATE) {
      try { into.import(bytes.subarray(1)); } catch {}
    }
  });
}

let pass = true;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${name}`); if (!cond) pass = false; };

// 1. Client A connects and types "alpha", sends the update.
const a = await connect("A");
const aDoc = new LoroDoc();
aDoc.getText("body").insert(0, "alpha");
aDoc.commit();
a.send(frame(DOC_UPDATE, aDoc.export({ mode: "update" })));
await sleep(600); // let the DO persist

// 2. Client B connects AFTER A's update -> must receive a catch-up snapshot.
const bDoc = new LoroDoc();
const b = await connect("B");
onDocUpdate(b, bDoc);
await sleep(600);
check("B catch-up from storage shows A's text (persist + offline reconcile)",
  bDoc.getText("body").toString() === "alpha");

// 3. Live fan-out: A appends "beta"; B (already connected) receives it live.
aDoc.getText("body").insert(5, "beta");
aDoc.commit();
a.send(frame(DOC_UPDATE, aDoc.export({ mode: "update" })));
await sleep(600);
check("B receives live update (fan-out)",
  bDoc.getText("body").toString() === "alphabeta");

// 4. A brand-new client C also catches up to the full current state.
const cDoc = new LoroDoc();
const c = await connect("C");
onDocUpdate(c, cDoc);
await sleep(600);
check("late joiner C catches up to full state",
  cDoc.getText("body").toString() === "alphabeta");

a.close(); b.close(); c.close();
console.log(pass ? "\nRESULT: ALL PASS" : "\nRESULT: FAIL");
process.exit(pass ? 0 : 1);
