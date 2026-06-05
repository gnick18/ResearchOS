/**
 * Manual fan-out harness for the ResearchOS collab relay.
 *
 * Run this AGAINST A RUNNING relay (not in CI):
 *
 *   # terminal 1
 *   cd relay && npm install && npm run dev
 *
 *   # terminal 2
 *   node relay/test/fanout.mjs
 *
 * The test opens two WebSocket connections to the same session room, has
 * client A send a binary message, then asserts that client B received it
 * verbatim and that client A did NOT receive its own message (no echo).
 */

import WebSocket from "ws";

const RELAY_URL = "ws://localhost:8787/ws";
const SESSION = "test-room";
const TIMEOUT_MS = 4000;

function connect(sessionId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${RELAY_URL}?session=${sessionId}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitForMessage(ws, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for a message`));
    }, timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log(`Connecting to ${RELAY_URL}?session=${SESSION} ...`);

  let clientA, clientB;
  try {
    clientA = await connect(SESSION);
    clientB = await connect(SESSION);
  } catch (err) {
    console.error("FAIL: could not connect:", err.message);
    console.error("Is the relay running? `cd relay && npm run dev`");
    process.exit(1);
  }

  console.log("Both clients connected.");

  // Track whether A receives any echo.
  let aReceivedEcho = false;
  clientA.on("message", () => { aReceivedEcho = true; });

  // The payload is arbitrary binary (mimics opaque ciphertext).
  const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);

  // Set up B's listener before A sends.
  const bReceived = waitForMessage(clientB, TIMEOUT_MS);

  clientA.send(payload);
  console.log("Client A sent payload:", payload.toString("hex"));

  let received;
  try {
    received = await bReceived;
  } catch (err) {
    console.error("FAIL:", err.message);
    clientA.close();
    clientB.close();
    process.exit(1);
  }

  // Give the event loop a tick to let any echo arrive at A before we check.
  await sleep(100);

  const receivedBuf = Buffer.isBuffer(received) ? received : Buffer.from(received);
  const match = receivedBuf.equals(payload);

  clientA.close();
  clientB.close();

  if (!match) {
    console.error("FAIL: B received wrong payload.");
    console.error("  expected:", payload.toString("hex"));
    console.error("  got:     ", receivedBuf.toString("hex"));
    process.exit(1);
  }

  if (aReceivedEcho) {
    console.error("FAIL: A received its own message (echo detected).");
    process.exit(1);
  }

  console.log("PASS: B received the payload verbatim, A received no echo.");
  process.exit(0);
}

run();
