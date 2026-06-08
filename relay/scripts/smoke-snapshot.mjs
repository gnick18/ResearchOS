/**
 * Smoke test for the mobile DOWNLOAD path (piece A): E2E-encrypted snapshots.
 *
 * Drives the deployed CaptureInbox DO end to end with NO phone and NO laptop
 * folder, proving the FULL download loop from a terminal:
 *   1. generate a user Ed25519 key + a device Ed25519 key + a device X25519 key
 *   2. register the device WITH devX25519 (user-signed grant)  -> POST /capture/register
 *   3. assert /capture/devices returns the device's x25519Pubkey -> GET /capture/devices
 *   4. seal a sample JSON payload to the device X25519 pub key (sealToRecipient)
 *   5. publish the sealed blob (USER-signed) to name="today"   -> POST /capture/snapshot/publish
 *   6. GET the snapshot (DEVICE-Ed-signed), then openSealed and -> GET  /capture/snapshot/get
 *      ASSERT the decrypted JSON equals the original
 *   7. revoke the device, then GET the snapshot -> 404 (revoke cleanup)
 *
 * The seal/open construction is a VERBATIM port of
 * frontend/src/lib/sharing/encryption.ts (sealToRecipient / openSealed): raw
 * X25519 ECDH, HKDF-SHA256 with salt = epk || rpk and info
 * "researchos.sharing.seal.v1", XChaCha20-Poly1305, output epk(32)||nonce(24)||ct.
 * This is exactly what the real laptop seals with and the real phone opens with.
 *
 * The canonical signed strings below are byte-identical to relay/src/worker.ts.
 * If you change one, change both.
 *
 * Usage: BASE_URL=https://researchos-collab-relay.<acct>.workers.dev node scripts/smoke-snapshot.mjs
 *        (or pass the URL as argv[2]). Requires @noble/curves, @noble/hashes and
 *        @noble/ciphers (relay deps) and a Node with global fetch + WebCrypto.
 */

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/curves/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const BASE_URL = (process.argv[2] || process.env.BASE_URL || "").replace(/\/+$/, "");
if (!BASE_URL) {
  console.error("FAIL: provide the Worker URL via BASE_URL=... or argv[2]");
  process.exit(1);
}

// ---- Canonical signed-byte strings (MUST match worker.ts verbatim) --------

function capturePairGrantMessage(u, pid, exp, url) {
  return `researchos-pair-grant\nu=${u}\npid=${pid}\nexp=${exp}\nurl=${url}`;
}
function captureReadMessage(action, u, ts, extra) {
  const base = `researchos-capture-${action}\nu=${u}\nts=${ts}`;
  return extra ? `${base}\n${extra}` : base;
}
function snapshotPublishMessage(u, name, device, ts, sha256hex) {
  return `researchos-snapshot-publish\nu=${u}\nname=${name}\ndevice=${device}\nts=${ts}\nsha256=${sha256hex}`;
}
function snapshotGetMessage(u, name, device, ts) {
  return `researchos-snapshot-get\nu=${u}\nname=${name}\ndevice=${device}\nts=${ts}`;
}

// ---- Seal / open (VERBATIM port of frontend/src/lib/sharing/encryption.ts) -

const SEAL_INFO = utf8ToBytes("researchos.sharing.seal.v1");
const X25519_KEY_LENGTH = 32;
const NONCE_LENGTH = 24;
const DERIVED_KEY_LENGTH = 32;
const HEADER_LENGTH = X25519_KEY_LENGTH + NONCE_LENGTH; // epk || nonce

function deriveKey(shared, ephemeralPublicKey, recipientPublicKey) {
  const salt = concatBytes(ephemeralPublicKey, recipientPublicKey);
  return hkdf(sha256, shared, salt, SEAL_INFO, DERIVED_KEY_LENGTH);
}

function sealToRecipient(plaintext, recipientX25519PublicKey) {
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(ephemeral.secretKey, recipientX25519PublicKey);
  const key = deriveKey(shared, ephemeral.publicKey, recipientX25519PublicKey);
  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return concatBytes(ephemeral.publicKey, nonce, ciphertext);
}

function openSealed(sealed, recipientX25519PrivateKey) {
  if (sealed.length < HEADER_LENGTH) {
    throw new Error(`openSealed: input too short, got ${sealed.length}`);
  }
  const ephemeralPublicKey = sealed.subarray(0, X25519_KEY_LENGTH);
  const nonce = sealed.subarray(X25519_KEY_LENGTH, HEADER_LENGTH);
  const ciphertext = sealed.subarray(HEADER_LENGTH);
  const recipientPublicKey = x25519.getPublicKey(recipientX25519PrivateKey);
  const shared = x25519.getSharedSecret(recipientX25519PrivateKey, ephemeralPublicKey);
  const key = deriveKey(shared, ephemeralPublicKey, recipientPublicKey);
  return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}

// ---- Crypto + helpers -----------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

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
  // User identity Ed25519 + device Ed25519 (signing) + device X25519 (sealing).
  const userSk = ed25519.utils.randomSecretKey();
  const userPk = bytesToHex(ed25519.getPublicKey(userSk));
  const deviceSk = ed25519.utils.randomSecretKey();
  const devicePk = bytesToHex(ed25519.getPublicKey(deviceSk));
  const devX25519Sk = x25519.utils.randomSecretKey();
  const devX25519Pk = x25519.getPublicKey(devX25519Sk); // Uint8Array
  const devX25519PkHex = bytesToHex(devX25519Pk);

  console.log(`BASE_URL ${BASE_URL}`);
  console.log(`user     ${userPk.slice(0, 16)}...`);
  console.log(`device   ${devicePk.slice(0, 16)}...`);
  console.log(`devX25519 ${devX25519PkHex.slice(0, 16)}...`);
  console.log("");

  // 1. register the device WITH devX25519 via a user-signed grant.
  const pid = "smoke-" + Math.random().toString(36).slice(2, 10);
  const exp = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const grant = { u: userPk, pid, exp, url: BASE_URL };
  const grantSig = sign(capturePairGrantMessage(userPk, pid, exp, BASE_URL), userSk);
  {
    const res = await fetch(`${BASE_URL}/capture/register?u=${userPk}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant,
        sig: grantSig,
        devicePubkey: devicePk,
        label: "Smoke phone",
        devX25519: devX25519PkHex,
      }),
    });
    const body = await res.json().catch(() => ({}));
    check("register device (with devX25519)", res.ok && body.ok === true, `status ${res.status} ${JSON.stringify(body)}`);
  }

  // 2. devices() returns the x25519 pubkey.
  {
    const ts = new Date().toISOString();
    const sig = sign(captureReadMessage("devices", userPk, ts), userSk);
    const res = await fetch(`${BASE_URL}/capture/devices?u=${userPk}&ts=${encodeURIComponent(ts)}&sig=${sig}`);
    const body = await res.json().catch(() => ({}));
    const dev = Array.isArray(body.devices) ? body.devices.find((d) => d.devicePubkey === devicePk) : null;
    check(
      "devices returns x25519Pubkey",
      res.ok && dev && dev.x25519Pubkey === devX25519PkHex,
      `status ${res.status} ${JSON.stringify(body)}`,
    );
  }

  // 3. seal a sample payload to the device X25519 pub key.
  const payload = {
    kind: "today",
    generatedAt: new Date().toISOString(),
    tasks: [
      { id: "t1", name: "Inoculate overnight cultures", start_date: "2026-06-07", end_date: "2026-06-07", task_type: "culture" },
      { id: "t2", name: "Run gel on PCR screen", start_date: "2026-06-06", end_date: "2026-06-08", task_type: "pcr" },
    ],
    overdue: 1,
    upcoming: 3,
  };
  const plaintext = enc.encode(JSON.stringify(payload));
  const sealed = sealToRecipient(plaintext, devX25519Pk);

  // sanity: the local seal/open round-trips before we even hit the relay.
  {
    const localOpen = openSealed(sealed, devX25519Sk);
    const same = JSON.stringify(JSON.parse(dec.decode(localOpen))) === JSON.stringify(payload);
    check("local seal/open round-trips", same, "openSealed(sealToRecipient(x)) !== x");
  }

  // 4. publish the sealed blob (USER-signed) to name="today".
  const name = "today";
  const sealedSha = await sha256Hex(sealed);
  {
    const ts = new Date().toISOString();
    const sig = sign(snapshotPublishMessage(userPk, name, devicePk, ts, sealedSha), userSk);
    const form = new FormData();
    form.set("blob", new Blob([sealed], { type: "application/octet-stream" }), "snapshot.bin");
    form.set("meta", JSON.stringify({ u: userPk, name, device: devicePk, ts, sig }));
    const res = await fetch(`${BASE_URL}/capture/snapshot/publish`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    check("publish snapshot", res.ok && body.ok === true, `status ${res.status} ${JSON.stringify(body)}`);
  }

  // 5. GET the snapshot (DEVICE-Ed-signed), openSealed, assert plaintext matches.
  {
    const ts = new Date().toISOString();
    const sig = sign(snapshotGetMessage(userPk, name, devicePk, ts), deviceSk);
    const res = await fetch(
      `${BASE_URL}/capture/snapshot/get?u=${userPk}&name=${encodeURIComponent(name)}&device=${devicePk}&ts=${encodeURIComponent(ts)}&sig=${sig}`,
    );
    const got = new Uint8Array(await res.arrayBuffer());
    let same = false;
    try {
      const opened = openSealed(got, devX25519Sk);
      same = JSON.stringify(JSON.parse(dec.decode(opened))) === JSON.stringify(payload);
    } catch (e) {
      same = false;
    }
    check("get + openSealed matches original", res.ok && same, `status ${res.status} got ${got.length} bytes`);
  }

  // 6. revoke the device, then GET the snapshot -> 404 (revoke cleanup).
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

    // After revoke the device is no longer bound, so the get is rejected before
    // it can read R2 (403), and the snapshot blob is also deleted. Either way
    // the phone can no longer fetch it. We assert a non-200.
    const ts2 = new Date().toISOString();
    const sig2 = sign(snapshotGetMessage(userPk, name, devicePk, ts2), deviceSk);
    const res2 = await fetch(
      `${BASE_URL}/capture/snapshot/get?u=${userPk}&name=${encodeURIComponent(name)}&device=${devicePk}&ts=${encodeURIComponent(ts2)}&sig=${sig2}`,
    );
    check("snapshot unreadable after revoke", res2.status === 403 || res2.status === 404, `status ${res2.status}`);
  }

  console.log("");
  console.log(`${failed === 0 ? "ALL PASS" : "FAILURES"}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FAIL: smoke test threw", err);
  process.exit(1);
});
