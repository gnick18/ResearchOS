/**
 * Smoke test for the mobile capture relay (piece A).
 *
 * Drives the deployed CaptureInbox DO end to end with NO phone and NO laptop
 * folder, so Grant can verify the whole backbone from a terminal:
 *   1. generate a fake user keypair + device keypair
 *   2. build + sign a pairing grant (user key) -> POST /capture/register
 *   3. upload a tiny in-memory PNG signed by the device key -> POST /capture/upload
 *   4. list the inbox (assert the capture appears)        -> GET  /capture/inbox
 *   5. fetch the object (assert the bytes round-trip)     -> GET  /capture/object
 *   6. list devices (assert the bound device appears)     -> GET  /capture/devices
 *   7. ack the capture (assert the inbox is then empty)   -> POST /capture/ack
 *   8. revoke the device                                  -> POST /capture/devices/revoke
 *
 * This script is the contract reference implementation: the canonical signed
 * strings below are byte-identical to relay/src/worker.ts. If you change one,
 * change both.
 *
 * Usage: BASE_URL=https://researchos-collab-relay.<acct>.workers.dev node scripts/smoke-capture.mjs
 *        (or pass the URL as argv[2]). Requires @noble/curves (a relay dep) and
 *        a Node with global fetch + WebCrypto (Node 18+).
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/curves/utils.js";

const BASE_URL = (process.argv[2] || process.env.BASE_URL || "").replace(/\/+$/, "");
if (!BASE_URL) {
  console.error("FAIL: provide the Worker URL via BASE_URL=... or argv[2]");
  process.exit(1);
}

// ---- Canonical signed-byte strings (MUST match worker.ts verbatim) --------

function capturePairGrantMessage(u, pid, exp, url) {
  return `researchos-pair-grant\nu=${u}\npid=${pid}\nexp=${exp}\nurl=${url}`;
}
function captureUploadMessage(u, captureId, createdAt, sha256) {
  return `researchos-capture-upload\nu=${u}\ncid=${captureId}\ncreatedAt=${createdAt}\nsha256=${sha256}`;
}
function captureReadMessage(action, u, ts, extra) {
  const base = `researchos-capture-${action}\nu=${u}\nts=${ts}`;
  return extra ? `${base}\n${extra}` : base;
}

// ---- Crypto + helpers -----------------------------------------------------

const enc = new TextEncoder();

function sign(message, secretKey) {
  return bytesToHex(ed25519.sign(enc.encode(message), secretKey));
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail ? "  -> " + detail : ""}`);
  }
}

async function main() {
  // Fake user identity keypair + device keypair.
  const userSk = ed25519.utils.randomSecretKey();
  const userPk = bytesToHex(ed25519.getPublicKey(userSk));
  const deviceSk = ed25519.utils.randomSecretKey();
  const devicePk = bytesToHex(ed25519.getPublicKey(deviceSk));

  console.log(`BASE_URL ${BASE_URL}`);
  console.log(`user     ${userPk.slice(0, 16)}...`);
  console.log(`device   ${devicePk.slice(0, 16)}...`);
  console.log("");

  // 1. register the device via a user-signed grant.
  const pid = "smoke-" + Math.random().toString(36).slice(2, 10);
  const exp = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const grant = { u: userPk, pid, exp, url: BASE_URL };
  const grantSig = sign(capturePairGrantMessage(userPk, pid, exp, BASE_URL), userSk);
  {
    const res = await fetch(`${BASE_URL}/capture/register?u=${userPk}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant, sig: grantSig, devicePubkey: devicePk, label: "Smoke phone" }),
    });
    const body = await res.json().catch(() => ({}));
    check("register device", res.ok && body.ok === true, `status ${res.status} ${JSON.stringify(body)}`);
  }

  // 2. upload a tiny in-memory PNG, signed by the device key.
  // A 1x1 transparent PNG.
  const pngBytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  const captureId = "cap-" + Math.random().toString(36).slice(2, 10);
  const createdAt = new Date().toISOString();
  const contentType = "image/png";
  const sha = await sha256Hex(pngBytes);
  const uploadSig = sign(captureUploadMessage(userPk, captureId, createdAt, sha), deviceSk);
  {
    const form = new FormData();
    form.set("blob", new Blob([pngBytes], { type: contentType }), "capture.png");
    form.set(
      "meta",
      JSON.stringify({
        u: userPk,
        devicePubkey: devicePk,
        captureId,
        caption: "Smoke bench photo",
        createdAt,
        contentType,
        sig: uploadSig,
      }),
    );
    const res = await fetch(`${BASE_URL}/capture/upload`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    check("upload capture", res.ok && body.ok === true && body.captureId === captureId, `status ${res.status} ${JSON.stringify(body)}`);
  }

  // 3. list the inbox (capture should appear).
  {
    const ts = new Date().toISOString();
    const sig = sign(captureReadMessage("inbox", userPk, ts), userSk);
    const res = await fetch(`${BASE_URL}/capture/inbox?u=${userPk}&ts=${encodeURIComponent(ts)}&sig=${sig}`);
    const body = await res.json().catch(() => ({}));
    const found = Array.isArray(body.captures) && body.captures.some((c) => c.captureId === captureId);
    check("inbox lists capture", res.ok && found, `status ${res.status} ${JSON.stringify(body)}`);
  }

  // 4. fetch the object (bytes round-trip).
  {
    const ts = new Date().toISOString();
    const sig = sign(captureReadMessage("object", userPk, ts, `id=${captureId}`), userSk);
    const res = await fetch(
      `${BASE_URL}/capture/object?u=${userPk}&id=${captureId}&ts=${encodeURIComponent(ts)}&sig=${sig}`,
    );
    const got = new Uint8Array(await res.arrayBuffer());
    const same = got.length === pngBytes.length && got.every((b, i) => b === pngBytes[i]);
    check("object bytes match", res.ok && same, `status ${res.status} got ${got.length} bytes`);
  }

  // 5. list devices (bound device appears).
  {
    const ts = new Date().toISOString();
    const sig = sign(captureReadMessage("devices", userPk, ts), userSk);
    const res = await fetch(`${BASE_URL}/capture/devices?u=${userPk}&ts=${encodeURIComponent(ts)}&sig=${sig}`);
    const body = await res.json().catch(() => ({}));
    const found = Array.isArray(body.devices) && body.devices.some((d) => d.devicePubkey === devicePk);
    check("devices lists bound device", res.ok && found, `status ${res.status} ${JSON.stringify(body)}`);
  }

  // 6. ack the capture, then assert the inbox is empty.
  {
    const ts = new Date().toISOString();
    const ids = [captureId].sort();
    const sig = sign(captureReadMessage("ack", userPk, ts, `ids=${ids.join(",")}`), userSk);
    const res = await fetch(`${BASE_URL}/capture/ack?u=${userPk}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ u: userPk, ids, ts, sig }),
    });
    const body = await res.json().catch(() => ({}));
    check("ack capture", res.ok && body.ok === true && body.deleted === 1, `status ${res.status} ${JSON.stringify(body)}`);

    const ts2 = new Date().toISOString();
    const sig2 = sign(captureReadMessage("inbox", userPk, ts2), userSk);
    const res2 = await fetch(`${BASE_URL}/capture/inbox?u=${userPk}&ts=${encodeURIComponent(ts2)}&sig=${sig2}`);
    const body2 = await res2.json().catch(() => ({}));
    const empty = Array.isArray(body2.captures) && body2.captures.length === 0;
    check("inbox empty after ack", res2.ok && empty, `status ${res2.status} ${JSON.stringify(body2)}`);
  }

  // 7. revoke the device.
  {
    const ts = new Date().toISOString();
    const sig = sign(captureReadMessage("revoke", userPk, ts, `device=${devicePk}`), userSk);
    const res = await fetch(`${BASE_URL}/capture/devices/revoke?u=${userPk}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ u: userPk, device: devicePk, ts, sig }),
    });
    const body = await res.json().catch(() => ({}));
    check("revoke device", res.ok && body.ok === true, `status ${res.status} ${JSON.stringify(body)}`);
  }

  console.log("");
  console.log(`${failed === 0 ? "ALL PASS" : "FAILURES"}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FAIL: smoke test threw", err);
  process.exit(1);
});
