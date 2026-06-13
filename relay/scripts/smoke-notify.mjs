/**
 * Smoke test for phone push P2 / phase 2.5 / P3 (the offline notification paths).
 *
 * Drives a CaptureInbox DO end to end with NO phone and NO laptop, proving the
 * relay's notify routes + the seal + the gate + the cooldown + the reminder DO
 * alarm from a terminal. Acts as BOTH the recipient's laptop (publishes config +
 * reminder schedule, registers a device) AND a sender (notify-recipient) AND the
 * phone (fetches the sealed notifications-pending lane + openSealed).
 *
 * It verifies the parts that cannot be unit-tested: the worker-side seal matches
 * the real openSealed, the recipient gate (per-category + quiet hours) is honored
 * server-side, the cooldown holds, and the DO alarm delivers a due reminder.
 *
 * The ONLY thing it cannot prove is the actual OS buzz (Expo -> APNs/FCM -> a real
 * device); the push is sent to a placeholder Expo token, which Expo accepts and
 * then drops. Everything up to and including the seal the phone would fetch is
 * exercised for real.
 *
 * Run against a LOCAL relay with the timing gates relaxed so the test does not
 * wait the real 30s cooldown / 3-min dead-man's-switch:
 *   cd relay
 *   npx wrangler dev --port 8787 --var NOTIFY_COOLDOWN_MS:4000 --var REMINDER_STALE_MS:0
 *   # in another shell:
 *   BASE_URL=http://127.0.0.1:8787 node scripts/smoke-notify.mjs
 *
 * Canonical signed strings + the seal are byte-identical to relay/src/worker.ts.
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
function snapshotGetMessage(u, name, device, ts) {
  return `researchos-snapshot-get\nu=${u}\nname=${name}\ndevice=${device}\nts=${ts}`;
}
function notifyConfigMessage(u, ts, sha) {
  return `researchos-notify-config\nu=${u}\nts=${ts}\nsha256=${sha}`;
}
function notifyRecipientMessage(recipient, sender, category, ts) {
  return `researchos-notify-recipient\nu=${recipient}\nsender=${sender}\ncategory=${category}\nts=${ts}`;
}
function registerRemindersMessage(u, ts, sha) {
  return `researchos-register-reminders\nu=${u}\nts=${ts}\nsha256=${sha}`;
}

// ---- Seal / open (VERBATIM port of frontend/src/lib/sharing/encryption.ts) -

const SEAL_INFO = utf8ToBytes("researchos.sharing.seal.v1");
const HEADER_LENGTH = 32 + 24; // epk || nonce

function deriveKey(shared, epk, rpk) {
  return hkdf(sha256, shared, concatBytes(epk, rpk), SEAL_INFO, 32);
}
function openSealed(sealed, rsk) {
  if (sealed.length < HEADER_LENGTH) throw new Error(`too short: ${sealed.length}`);
  const epk = sealed.subarray(0, 32);
  const nonce = sealed.subarray(32, HEADER_LENGTH);
  const ct = sealed.subarray(HEADER_LENGTH);
  const rpk = x25519.getPublicKey(rsk);
  const shared = x25519.getSharedSecret(rsk, epk);
  return xchacha20poly1305(deriveKey(shared, epk, rpk), nonce).decrypt(ct);
}

// ---- helpers --------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();
const sign = (msg, sk) => bytesToHex(ed25519.sign(enc.encode(msg), sk));
const nowIso = () => new Date().toISOString();
async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// A fresh recipient = a fresh CaptureInbox DO, so per-DO cooldown state never
// bleeds across test cases.
function newIdentity() {
  const sk = ed25519.utils.randomSecretKey();
  return { sk, pk: bytesToHex(ed25519.getPublicKey(sk)) };
}
function newDevice() {
  const sk = ed25519.utils.randomSecretKey();
  const xsk = x25519.utils.randomSecretKey();
  const xpk = x25519.getPublicKey(xsk);
  return { sk, pk: bytesToHex(ed25519.getPublicKey(sk)), xsk, xpk, xpkHex: bytesToHex(xpk) };
}

async function registerDevice(user, device, pushToken) {
  const pid = "smoke-" + Math.random().toString(36).slice(2, 10);
  const exp = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const grant = { u: user.pk, pid, exp, url: BASE_URL };
  const sig = sign(capturePairGrantMessage(user.pk, pid, exp, BASE_URL), user.sk);
  const res = await fetch(`${BASE_URL}/capture/register?u=${user.pk}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant, sig, devicePubkey: device.pk, devX25519: device.xpkHex,
      label: "Smoke phone", pushToken,
    }),
  });
  return res.ok;
}

async function publishConfig(user, config) {
  const ts = nowIso();
  const json = JSON.stringify(config);
  const sha = await sha256Hex(enc.encode(json));
  const sig = sign(notifyConfigMessage(user.pk, ts, sha), user.sk);
  const res = await fetch(`${BASE_URL}/capture/notify-config?u=${user.pk}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u: user.pk, config: json, ts, sig }),
  });
  return res.ok;
}

async function notifyRecipientCall(sender, recipientPk, category) {
  const ts = nowIso();
  const sig = sign(notifyRecipientMessage(recipientPk, sender.pk, category, ts), sender.sk);
  const res = await fetch(`${BASE_URL}/capture/notify-recipient?u=${recipientPk}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u: recipientPk, sender: sender.pk, category, ts, sig }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function registerReminders(user, reminders) {
  const ts = nowIso();
  const json = JSON.stringify(reminders);
  const sha = await sha256Hex(enc.encode(json));
  const sig = sign(registerRemindersMessage(user.pk, ts, sha), user.sk);
  const res = await fetch(`${BASE_URL}/capture/register-reminders?u=${user.pk}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ u: user.pk, reminders, ts, sig }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// Fetch + openSealed the named lane as the phone (device-Ed-signed). Returns the
// decoded JSON or null (404 / unseal failure).
async function fetchLane(user, device, name) {
  const ts = nowIso();
  const sig = sign(snapshotGetMessage(user.pk, name, device.pk, ts), device.sk);
  const res = await fetch(
    `${BASE_URL}/capture/snapshot/get?u=${user.pk}&name=${encodeURIComponent(name)}&device=${device.pk}&ts=${encodeURIComponent(ts)}&sig=${sig}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  try {
    return JSON.parse(dec.decode(openSealed(new Uint8Array(await res.arrayBuffer()), device.xsk)));
  } catch {
    return null;
  }
}

const PHONE_ON = { enabled: false, start: "19:00", end: "08:00", weekendsQuiet: false };
const FAKE_TOKEN = "ExponentPushToken[smoke-test-placeholder]";

async function main() {
  console.log(`BASE_URL ${BASE_URL}\n`);

  // ---- Case 1: P2 phone path (seal a generic snapshot the phone can open) ----
  {
    const r = newIdentity();
    const d = newDevice();
    const sender = newIdentity();
    await registerDevice(r, d, FAKE_TOKEN);
    const cfgOk = await publishConfig(r, {
      channels: { shared: { phone: true } },
      quietHours: PHONE_ON,
      tzOffsetMinutes: 0,
    });
    check("notify-config accepted", cfgOk);

    const res = await notifyRecipientCall(sender, r.pk, "shared");
    check("notify-recipient sealed for a routed category", res.body.sealed >= 1, JSON.stringify(res.body));

    const snap = await fetchLane(r, d, "notifications-pending");
    const row = snap && Array.isArray(snap.notifications) ? snap.notifications[0] : null;
    check("phone opens the sealed pending snapshot", !!row, JSON.stringify(snap));
    check(
      "pending body is the GENERIC line, no content leak",
      row && row.body === "Something new was shared with you" && row.category === "shared",
      JSON.stringify(row),
    );
  }

  // ---- Case 2: the recipient gate (a muted category never seals) ----
  {
    const r = newIdentity();
    const d = newDevice();
    const sender = newIdentity();
    await registerDevice(r, d, FAKE_TOKEN);
    await publishConfig(r, {
      channels: { shared: { phone: true } }, // comments left OFF
      quietHours: PHONE_ON,
      tzOffsetMinutes: 0,
    });
    const res = await notifyRecipientCall(sender, r.pk, "comments");
    check(
      "muted category is gated (no push, reason gated)",
      res.body.reason === "gated" && res.body.pushed === 0,
      JSON.stringify(res.body),
    );
  }

  // ---- Case 3: quiet hours silence an otherwise-routed category ----
  {
    const r = newIdentity();
    const d = newDevice();
    const sender = newIdentity();
    await registerDevice(r, d, FAKE_TOKEN);
    // Quiet hours covering the entire day (00:00 wraps to 23:59) at tz offset 0.
    await publishConfig(r, {
      channels: { shared: { phone: true } },
      quietHours: { enabled: true, start: "00:00", end: "23:59", weekendsQuiet: false },
      tzOffsetMinutes: 0,
    });
    const res = await notifyRecipientCall(sender, r.pk, "shared");
    check("quiet hours gate the push", res.body.reason === "gated" && res.body.pushed === 0, JSON.stringify(res.body));
  }

  // ---- Case 4: cooldown (second rapid buzz is dropped) ----
  {
    const r = newIdentity();
    const d = newDevice();
    const sender = newIdentity();
    await registerDevice(r, d, FAKE_TOKEN);
    await publishConfig(r, { channels: { shared: { phone: true } }, quietHours: PHONE_ON, tzOffsetMinutes: 0 });
    const first = await notifyRecipientCall(sender, r.pk, "shared");
    const second = await notifyRecipientCall(sender, r.pk, "shared");
    check("first buzz sealed", first.body.sealed >= 1, JSON.stringify(first.body));
    check("second rapid buzz is cooled down", second.body.reason === "cooldown", JSON.stringify(second.body));
  }

  // ---- Case 5: P3b reminder DO alarm (requires REMINDER_STALE_MS:0) ----
  {
    const r = newIdentity();
    const d = newDevice();
    await registerDevice(r, d, FAKE_TOKEN);
    await publishConfig(r, { channels: { reminders: { phone: true } }, quietHours: PHONE_ON, tzOffsetMinutes: 0 });
    // A reminder already due. The DO arms an alarm ~1s out; the dead-man's-switch
    // treats us as offline only when REMINDER_STALE_MS is 0 (set on the dev relay).
    const reg = await registerReminders(r, [{ id: "native:smoke-1", fireAt: Date.now() - 1000 }]);
    check("register-reminders stored the schedule", reg.body.scheduled === 1, JSON.stringify(reg.body));

    let snap = null;
    for (let i = 0; i < 12 && !snap; i++) {
      await sleep(1000);
      snap = await fetchLane(r, d, "notifications-pending");
    }
    const row = snap && Array.isArray(snap.notifications) ? snap.notifications[0] : null;
    check(
      "reminder alarm delivered a generic buzz (needs --var REMINDER_STALE_MS:0)",
      row && row.category === "reminders" && row.body === "You have a reminder",
      JSON.stringify(snap),
    );
  }

  console.log("");
  console.log(`${failed === 0 ? "ALL PASS" : "FAILURES"}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FAIL: smoke test threw", err);
  process.exit(1);
});
