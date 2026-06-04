// Manual end-to-end smoke test for the cross-boundary sharing identity directory.
//
// It generates a fresh keypair, registers it through the real signup + email-code
// + verify flow, then looks the keys back up, proving the whole directory works
// against live Neon, Upstash, and Resend.
//
// Prereqs, from the frontend/ directory with the dev server running and these in
// frontend/.env.local, SHARING_ENABLED=true, DIRECTORY_HMAC_PEPPER (any string is
// fine for a local test), RESEND_API_KEY (your real key, so the email sends), plus
// DATABASE_URL and KV_REST_API_URL and KV_REST_API_TOKEN (pulled from Vercel).
//
// Run, from frontend/:
//   node scripts/sharing-directory-smoketest.mjs your-email@example.com
//
// Optional, point at a different server with DIRECTORY_BASE_URL.

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const BASE = process.env.DIRECTORY_BASE_URL ?? "http://localhost:3000";
const rawEmail = process.argv[2];
if (!rawEmail) {
  console.error("Usage: node scripts/sharing-directory-smoketest.mjs <email>");
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();

// Must byte-for-byte match buildBindingPayload in
// src/lib/sharing/directory/signature.ts (version v2).
function buildBindingPayload({ email, x25519PublicKey, ed25519PublicKey, issuedAt }) {
  const lines = [
    "researchos.directory.binding.v2",
    `email=${email}`,
    `x25519PublicKey=${x25519PublicKey}`,
    `ed25519PublicKey=${ed25519PublicKey}`,
    `issuedAt=${issuedAt}`,
  ];
  return new TextEncoder().encode(lines.join("\n"));
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, json };
}

const encKeys = x25519.keygen();
const sigKeys = ed25519.keygen();
const x25519PublicKey = bytesToHex(encKeys.publicKey);
const ed25519PublicKey = bytesToHex(sigKeys.publicKey);

console.log(`Directory base : ${BASE}`);
console.log(`Email          : ${email}`);
console.log(`X25519 pubkey  : ${x25519PublicKey.slice(0, 16)}...`);
console.log(`Ed25519 pubkey : ${ed25519PublicKey.slice(0, 16)}...\n`);

console.log("1) Requesting a signup code...");
const signup = await post("/api/directory/signup", { email });
console.log(`   signup -> ${signup.status} ${JSON.stringify(signup.json)}`);
if (signup.status === 404) {
  console.error("   Got 404. SHARING_ENABLED is not 'true' in the running server. Aborting.");
  process.exit(1);
}
if (signup.status !== 200) {
  console.error("   Signup did not return 200 (rate limit, or a server error). Aborting.");
  process.exit(1);
}
console.log("   Sent. Check your inbox for a 6-digit code.\n");

const rl = createInterface({ input, output });
const otp = (await rl.question("Enter the 6-digit code from your email: ")).trim();
rl.close();

const issuedAt = new Date().toISOString();
const payload = buildBindingPayload({ email, x25519PublicKey, ed25519PublicKey, issuedAt });
const signature = bytesToHex(ed25519.sign(payload, sigKeys.secretKey));

console.log("\n2) Verifying the code and binding the keys...");
const verify = await post("/api/directory/verify", {
  email,
  otp,
  x25519PublicKey,
  ed25519PublicKey,
  signature,
  issuedAt,
  keyBackupBlob: JSON.stringify({ smoketest: true }),
});
console.log(`   verify -> ${verify.status} ${JSON.stringify(verify.json)}`);
if (verify.status !== 200 || !verify.json?.ok) {
  console.error("   Verify failed (wrong or expired code, or a signature mismatch). Aborting.");
  process.exit(1);
}

console.log("\n3) Looking the email up...");
const lookup = await post("/api/directory/lookup", { email });
console.log(`   lookup -> ${lookup.status} ${JSON.stringify(lookup.json)}`);

const ok =
  lookup.json?.found &&
  lookup.json.x25519PublicKey === x25519PublicKey &&
  lookup.json.ed25519PublicKey === ed25519PublicKey;

console.log(
  "\n" +
    (ok
      ? "PASS. The directory round trip works end to end, signup emailed a code, verify bound the keys, and lookup returned exactly the keys we generated."
      : "FAIL. Lookup did not return the expected keys, see the output above."),
);
process.exit(ok ? 0 : 1);
