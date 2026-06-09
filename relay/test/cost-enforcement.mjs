// Cost-enforcement gate test (lab-tier launch gate). Confirms the DO write
// throttle fires: a burst of doc updates past the per-doc token bucket gets a
// MSG_SYNC_BLOCKED signal, while a normal trickle does not. Run against
// `wrangler dev` on PORT (no APP_BASE_URL, so the breaker fail-opens and only
// the throttle is exercised here).
import { WebSocket } from "ws";
import { LoroDoc } from "loro-crdt";

const PORT = process.env.PORT || "8802";
const DOC_UPDATE = 0x01;
const SYNC_BLOCKED = 0x03;

const frame = (type, payload) => {
  const out = new Uint8Array(payload.length + 1);
  out[0] = type;
  out.set(payload, 1);
  return out;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One real Loro update to send repeatedly (each frame counts against the bucket).
const doc = new LoroDoc();
doc.getText("t").insert(0, "x");
const update = doc.export({ mode: "update" });

function run(label, count, gapMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(
      `ws://localhost:${PORT}/ws?session=cost-${label}-${Date.now()}`,
    );
    let blocked = 0;
    ws.on("message", (data) => {
      const b = new Uint8Array(data);
      if (b[0] === SYNC_BLOCKED) blocked++;
    });
    ws.on("open", async () => {
      for (let i = 0; i < count; i++) {
        ws.send(frame(DOC_UPDATE, update));
        if (gapMs) await sleep(gapMs);
      }
      await sleep(700);
      ws.close();
      resolve(blocked);
    });
    ws.on("error", () => resolve(-1));
  });
}

const main = async () => {
  // Burst well past WRITE_BURST (40) with no gap -> throttle must fire.
  const burstBlocked = await run("burst", 70, 0);
  // A slow trickle (10 updates, 120ms apart) stays under the bucket -> no block.
  const trickleBlocked = await run("trickle", 10, 120);

  let ok = true;
  if (burstBlocked >= 1) {
    console.log(`PASS: burst of 70 throttled (${burstBlocked} block signal)`);
  } else {
    console.log(`FAIL: burst not throttled (blocked=${burstBlocked})`);
    ok = false;
  }
  if (trickleBlocked === 0) {
    console.log("PASS: trickle of 10 not throttled");
  } else {
    console.log(`FAIL: trickle throttled unexpectedly (blocked=${trickleBlocked})`);
    ok = false;
  }
  console.log(ok ? "\nRESULT: ALL PASS" : "\nRESULT: FAIL");
  process.exit(ok ? 0 : 1);
};

main();
