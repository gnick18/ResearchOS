// External-collab chunk 3 functional test: the per-recipient inbox DO. A sender
// pushes a signed invite to a recipient's inbox; the recipient reads it with a
// signed list; a wrong-key read is rejected; a push that tries to rebind the
// recipient pubkey is rejected; dismiss removes the invite. Run against
// `wrangler dev` on PORT. Mirrors access-control.mjs.
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const PORT = process.env.PORT || "8803";
const BASE = `http://localhost:${PORT}`;

const sign = (msg, priv) =>
  bytesToHex(ed25519.sign(new TextEncoder().encode(msg), priv));

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}`);
  if (!cond) pass = false;
};

function keypair() {
  const k = ed25519.keygen();
  return { pub: bytesToHex(k.publicKey), priv: k.secretKey };
}

async function postJson(path, body) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sender = keypair();
const recipient = keypair();
const attacker = keypair();

// A unique inbox per run so reruns do not collide on TOFU state.
const inboxHash = `inbox-${Date.now()}`;
const docId = `doc-${Date.now()}`;
const sessionId = `sess-${Date.now()}`;

// ---- (a) push creates an invite ---------------------------------------------
{
  const issuedAt = Date.now();
  const message = `inbox-push\n${inboxHash}\n${recipient.pub}\nsender@lab.edu\n${docId}\n${sessionId}\nPCR setup\nnote\n${issuedAt}`;
  const res = await postJson(`/inbox/push?to=${inboxHash}`, {
    from: { email: "sender@lab.edu", name: "Sender", pubkey: sender.pub },
    recipientEmailHash: inboxHash,
    recipientPubkey: recipient.pub,
    invite: { collabDocId: docId, sessionId, title: "PCR setup", kind: "note" },
    issuedAt,
    signature: sign(message, sender.priv),
  });
  check("(a) push creates an invite (200)", res.status === 200);
}

// ---- (b) list-by-recipient returns it ---------------------------------------
{
  const issuedAt = Date.now();
  const message = `inbox-list\n${inboxHash}\n${issuedAt}`;
  const res = await postJson(`/inbox/list?owner=${inboxHash}`, {
    email: "recipient@out.org",
    pubkey: recipient.pub,
    issuedAt,
    signature: sign(message, recipient.priv),
  });
  const data = await res.json();
  const found =
    res.status === 200 &&
    Array.isArray(data.invites) &&
    data.invites.length === 1 &&
    data.invites[0].collabDocId === docId &&
    data.invites[0].sessionId === sessionId &&
    data.invites[0].title === "PCR setup" &&
    data.invites[0].fromEmail === "sender@lab.edu" &&
    // from_pubkey (external-collab chunk 4) round-trips through push -> list, so
    // the recipient can confirm the sender's directory binding at accept time.
    data.invites[0].fromPubkey === sender.pub;
  check("(b) recipient list returns the invite with metadata", found);
}

// ---- (c) list signed by the WRONG key returns an EMPTY 200 (no oracle) -------
// Enumeration hardening (external-collab chunk 5): a wrong-key list on an
// ESTABLISHED inbox must look identical to a list on an UNESTABLISHED inbox, so
// an outsider cannot probe established-vs-empty. Both return an empty 200.
{
  const issuedAt = Date.now();
  const message = `inbox-list\n${inboxHash}\n${issuedAt}`;
  // Attacker presents their own pubkey, which is not the established recipient.
  const res = await postJson(`/inbox/list?owner=${inboxHash}`, {
    email: "attacker@evil.com",
    pubkey: attacker.pub,
    issuedAt,
    signature: sign(message, attacker.priv),
  });
  const data = await res.json();
  check(
    "(c) wrong-key list returns empty 200 (no enumeration oracle)",
    res.status === 200 && Array.isArray(data.invites) && data.invites.length === 0,
  );
}

// Also the right pubkey claim with a bad signature returns the same empty 200.
{
  const issuedAt = Date.now();
  const res = await postJson(`/inbox/list?owner=${inboxHash}`, {
    email: "recipient@out.org",
    pubkey: recipient.pub,
    issuedAt,
    signature: sign(`inbox-list\n${inboxHash}\n${issuedAt}`, attacker.priv), // wrong key
  });
  const data = await res.json();
  check(
    "(c) recipient-pubkey claim with bad signature returns empty 200",
    res.status === 200 && Array.isArray(data.invites) && data.invites.length === 0,
  );
}

// ---- (d) push that tries to rebind the recipient pubkey is rejected ----------
{
  const issuedAt = Date.now();
  const message = `inbox-push\n${inboxHash}\n${attacker.pub}\nsender@lab.edu\n${docId}-2\n${sessionId}-2\nx\nnote\n${issuedAt}`;
  const res = await postJson(`/inbox/push?to=${inboxHash}`, {
    from: { email: "sender@lab.edu", name: "Sender", pubkey: sender.pub },
    recipientEmailHash: inboxHash,
    recipientPubkey: attacker.pub, // different from the established recipient
    invite: { collabDocId: `${docId}-2`, sessionId: `${sessionId}-2`, title: "x", kind: "note" },
    issuedAt,
    signature: sign(message, sender.priv),
  });
  check("(d) rebind-recipient-pubkey push rejected (403)", res.status === 403);
}

// ---- (e) dismiss removes the invite -----------------------------------------
{
  const issuedAt = Date.now();
  const message = `inbox-dismiss\n${inboxHash}\n${docId}\n${issuedAt}`;
  const res = await postJson(`/inbox/dismiss?owner=${inboxHash}`, {
    email: "recipient@out.org",
    pubkey: recipient.pub,
    collabDocId: docId,
    issuedAt,
    signature: sign(message, recipient.priv),
  });
  check("(e) dismiss returns 200", res.status === 200);

  // Confirm the list is now empty.
  const li = Date.now();
  const lmsg = `inbox-list\n${inboxHash}\n${li}`;
  const lres = await postJson(`/inbox/list?owner=${inboxHash}`, {
    email: "recipient@out.org",
    pubkey: recipient.pub,
    issuedAt: li,
    signature: sign(lmsg, recipient.priv),
  });
  const ldata = await lres.json();
  check(
    "(e) list empty after dismiss",
    lres.status === 200 && Array.isArray(ldata.invites) && ldata.invites.length === 0,
  );
}

// ---- (f) a stale push is rejected -------------------------------------------
{
  const inbox2 = `inbox2-${Date.now()}`;
  const issuedAt = Date.now() - 10 * 60 * 1000;
  const message = `inbox-push\n${inbox2}\n${recipient.pub}\n${docId}\n${sessionId}\n${issuedAt}`;
  const res = await postJson(`/inbox/push?to=${inbox2}`, {
    from: { email: "sender@lab.edu", pubkey: sender.pub },
    recipientEmailHash: inbox2,
    recipientPubkey: recipient.pub,
    invite: { collabDocId: docId, sessionId, title: "x", kind: "note" },
    issuedAt,
    signature: sign(message, sender.priv),
  });
  check("(f) stale-issuedAt push rejected (401)", res.status === 401);
}

// ---- (g) list on a never-pushed inbox returns an empty list, not an error ----
{
  const empty = `empty-${Date.now()}`;
  const issuedAt = Date.now();
  const message = `inbox-list\n${empty}\n${issuedAt}`;
  const res = await postJson(`/inbox/list?owner=${empty}`, {
    email: "newbie@out.org",
    pubkey: recipient.pub,
    issuedAt,
    signature: sign(message, recipient.priv),
  });
  const data = await res.json();
  check(
    "(g) unestablished inbox returns empty list (200)",
    res.status === 200 && Array.isArray(data.invites) && data.invites.length === 0,
  );
}

console.log(pass ? "\nRESULT: ALL PASS" : "\nRESULT: FAIL");
process.exit(pass ? 0 : 1);
