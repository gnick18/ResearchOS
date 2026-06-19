/**
 * One-shot: fire a sender-triggered phone-push (notify-recipient) at a relay, as
 * a manual end-to-end test of P2/2.5/P3 against a live deployment. Generates a
 * throwaway sender identity, signs the canonical message, and POSTs.
 *
 * Usage:
 *   node scripts/fire-notify.mjs <recipientPubkeyHex> [category] [relayUrl]
 * category defaults to "shared"; relayUrl defaults to the prod relay.
 *
 * The recipient must have a paired device (x25519 + push token) AND have synced
 * their notify-config to the relay with this category routed to phone, else the
 * relay returns reason "no config"/"gated" and nothing buzzes (by design).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/curves/utils.js";

const recipient = process.argv[2];
const category = process.argv[3] || "shared";
const relayUrl = (process.argv[4] || "https://researchos-collab-relay.gnick317.workers.dev").replace(/\/+$/, "");
if (!recipient) {
  console.error("usage: node scripts/fire-notify.mjs <recipientPubkeyHex> [category] [relayUrl]");
  process.exit(1);
}

function notifyRecipientMessage(r, s, c, ts) {
  return `researchos-notify-recipient\nu=${r}\nsender=${s}\ncategory=${c}\nts=${ts}`;
}

const senderSk = ed25519.utils.randomSecretKey();
const senderPk = bytesToHex(ed25519.getPublicKey(senderSk));
const ts = new Date().toISOString();
const sig = bytesToHex(
  ed25519.sign(new TextEncoder().encode(notifyRecipientMessage(recipient, senderPk, category, ts)), senderSk),
);

console.log(`relay     ${relayUrl}`);
console.log(`recipient ${recipient.slice(0, 16)}...`);
console.log(`category  ${category}`);

const res = await fetch(`${relayUrl}/capture/notify-recipient?u=${recipient}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ u: recipient, sender: senderPk, category, ts, sig }),
});
const body = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status}`);
console.log(JSON.stringify(body, null, 2));
