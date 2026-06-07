// Chunk 3 functional test: the relay DO access gate. A doc stays OPEN until its
// first /grant, then ENFORCES per-member Ed25519 connect tokens on /ws and
// /snapshot. Run against `wrangler dev` on PORT. Mirrors canonical-store.mjs.
import { WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const PORT = process.env.PORT || "8802";
const BASE = `http://localhost:${PORT}`;
const WSBASE = `ws://localhost:${PORT}`;

const sign = (msg, priv) => bytesToHex(ed25519.sign(new TextEncoder().encode(msg), priv));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}`);
  if (!cond) pass = false;
};

function keypair() {
  const k = ed25519.keygen();
  return { pub: bytesToHex(k.publicKey), priv: k.secretKey };
}

// Tries to open a /ws socket; resolves { ok } true on 101 upgrade, false on a
// non-101 (e.g. 401) handshake response.
function tryConnect(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve({ ok, ws });
    };
    ws.on("open", () => done(true));
    ws.on("unexpected-response", () => done(false));
    ws.on("error", () => done(false));
  });
}

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

const owner = keypair();
const member = keypair();
const stranger = keypair();
const ownerEmail = "owner@lab.edu";
const memberEmail = "member@lab.edu";

// ---- (a) open doc still connects with no auth -------------------------------
{
  const sid = `open-${Date.now()}`;
  const { ok, ws } = await tryConnect(`${WSBASE}/ws?session=${sid}`);
  check("(a) open doc /ws connects with no auth", ok);
  if (ws) ws.close();
  const snap = await fetch(`${BASE}/snapshot?session=${sid}`);
  check("(a) open doc /snapshot served with no auth", snap.status === 204 || snap.status === 200);
}

// Use ONE enforced session for b-h.
const sid = `enf-${Date.now()}`;

// ---- (b) first valid /grant flips enforced + records members ----------------
{
  const issuedAt = Date.now();
  const members = [{ email: memberEmail, pubkey: member.pub, role: "editor" }];
  const message = `grant\n${sid}\n${ownerEmail}\n${issuedAt}\n${JSON.stringify(members)}`;
  const res = await postJson(`/grant?session=${sid}`, {
    owner: { email: ownerEmail, pubkey: owner.pub },
    members,
    issuedAt,
    signature: sign(message, owner.priv),
  });
  check("(b) valid first /grant returns 200", res.status === 200);
}

// ---- now the doc is enforced. A no-auth connect must be rejected. -----------
{
  const { ok } = await tryConnect(`${WSBASE}/ws?session=${sid}`);
  check("(b) enforced doc rejects no-auth /ws", ok === false);
  const snap = await fetch(`${BASE}/snapshot?session=${sid}`);
  check("(b) enforced doc rejects no-auth /snapshot", snap.status === 401);
}

// Helper to build a member connect token.
function connectParams(email, priv, ts = Date.now()) {
  const message = `connect\n${sid}\n${email}\n${ts}`;
  return `authEmail=${encodeURIComponent(email)}&authTs=${ts}&authSig=${sign(message, priv)}`;
}

// ---- (c) a valid member connects to /ws and /snapshot -----------------------
{
  const { ok, ws } = await tryConnect(`${WSBASE}/ws?session=${sid}&${connectParams(memberEmail, member.priv)}`);
  check("(c) valid member connects to /ws", ok);
  if (ws) ws.close();
  const snap = await fetch(`${BASE}/snapshot?session=${sid}&${connectParams(memberEmail, member.priv)}`);
  check("(c) valid member served /snapshot", snap.status === 204 || snap.status === 200);
}

// ---- (d) a non-member is rejected -------------------------------------------
{
  const { ok } = await tryConnect(`${WSBASE}/ws?session=${sid}&${connectParams("nobody@x.com", stranger.priv)}`);
  check("(d) non-member rejected on /ws", ok === false);
}

// ---- (e) a bad signature is rejected ----------------------------------------
{
  // Real member email + ts, but sign with the wrong (stranger) key.
  const ts = Date.now();
  const msg = `connect\n${sid}\n${memberEmail}\n${ts}`;
  const badSig = sign(msg, stranger.priv);
  const url = `${WSBASE}/ws?session=${sid}&authEmail=${encodeURIComponent(memberEmail)}&authTs=${ts}&authSig=${badSig}`;
  const { ok } = await tryConnect(url);
  check("(e) bad signature rejected on /ws", ok === false);
}

// ---- (f) a stale authTs is rejected -----------------------------------------
{
  const staleTs = Date.now() - 10 * 60 * 1000; // 10 min ago
  const { ok } = await tryConnect(`${WSBASE}/ws?session=${sid}&${connectParams(memberEmail, member.priv, staleTs)}`);
  check("(f) stale authTs rejected on /ws", ok === false);
}

// ---- (g) a /grant signed by a non-owner (after TOFU) is rejected ------------
{
  const issuedAt = Date.now();
  const members = [{ email: "attacker@evil.com", pubkey: stranger.pub, role: "owner" }];
  // stranger pretends to be a new owner; their pubkey != stored owner_pubkey.
  const fakeOwnerEmail = "attacker@evil.com";
  const message = `grant\n${sid}\n${fakeOwnerEmail}\n${issuedAt}\n${JSON.stringify(members)}`;
  const res = await postJson(`/grant?session=${sid}`, {
    owner: { email: fakeOwnerEmail, pubkey: stranger.pub },
    members,
    issuedAt,
    signature: sign(message, stranger.priv),
  });
  check("(g) /grant from a non-owner rejected (403)", res.status === 403);
}

// Also confirm a stale-issuedAt grant is rejected.
{
  const issuedAt = Date.now() - 10 * 60 * 1000;
  const members = [{ email: memberEmail, pubkey: member.pub, role: "editor" }];
  const message = `grant\n${sid}\n${ownerEmail}\n${issuedAt}\n${JSON.stringify(members)}`;
  const res = await postJson(`/grant?session=${sid}`, {
    owner: { email: ownerEmail, pubkey: owner.pub },
    members,
    issuedAt,
    signature: sign(message, owner.priv),
  });
  check("(g) stale-issuedAt /grant rejected (401)", res.status === 401);
}

// ---- (h) /revoke removes a member who can then no longer connect ------------
{
  // Sanity: member can connect right now.
  const before = await tryConnect(`${WSBASE}/ws?session=${sid}&${connectParams(memberEmail, member.priv)}`);
  if (before.ws) before.ws.close();
  check("(h) member can connect before revoke", before.ok);

  const issuedAt = Date.now();
  const message = `revoke\n${sid}\n${ownerEmail}\n${issuedAt}\n${memberEmail}`;
  const res = await postJson(`/revoke?session=${sid}`, {
    owner: { email: ownerEmail, pubkey: owner.pub },
    email: memberEmail,
    issuedAt,
    signature: sign(message, owner.priv),
  });
  check("(h) /revoke returns 200", res.status === 200);

  await sleep(100);
  const after = await tryConnect(`${WSBASE}/ws?session=${sid}&${connectParams(memberEmail, member.priv)}`);
  if (after.ws) after.ws.close();
  check("(h) revoked member can no longer connect", after.ok === false);
}

// ---- (i) /members (external-collab chunk 5) owner-signed read ----------------
// The owner's revoke UI lists who currently has access. Re-grant the member
// first (revoke removed them in (h)) so the list has a known member to assert.
{
  const issuedAt = Date.now();
  const members = [{ email: memberEmail, pubkey: member.pub, role: "editor" }];
  const gmsg = `grant\n${sid}\n${ownerEmail}\n${issuedAt}\n${JSON.stringify(members)}`;
  await postJson(`/grant?session=${sid}`, {
    owner: { email: ownerEmail, pubkey: owner.pub },
    members,
    issuedAt,
    signature: sign(gmsg, owner.priv),
  });

  const li = Date.now();
  const lmsg = `members\n${sid}\n${ownerEmail}\n${li}`;
  const res = await postJson(`/members?session=${sid}`, {
    owner: { email: ownerEmail, pubkey: owner.pub },
    issuedAt: li,
    signature: sign(lmsg, owner.priv),
  });
  const data = await res.json();
  const hasOwner =
    Array.isArray(data.members) &&
    data.members.some((m) => m.email === ownerEmail && m.role === "owner");
  const hasMember =
    Array.isArray(data.members) &&
    data.members.some((m) => m.email === memberEmail && m.pubkey === member.pub);
  check(
    "(i) owner-signed /members returns owner + member",
    res.status === 200 && hasOwner && hasMember,
  );
}

// ---- (j) /members signed by a non-owner is rejected -------------------------
{
  const li = Date.now();
  const lmsg = `members\n${sid}\n${ownerEmail}\n${li}`;
  // stranger claims the owner email but signs with their own key.
  const res = await postJson(`/members?session=${sid}`, {
    owner: { email: ownerEmail, pubkey: stranger.pub },
    issuedAt: li,
    signature: sign(lmsg, stranger.priv),
  });
  check("(j) /members from a non-owner rejected (403)", res.status === 403);
}

// Also a stale-issuedAt /members is rejected.
{
  const li = Date.now() - 10 * 60 * 1000;
  const lmsg = `members\n${sid}\n${ownerEmail}\n${li}`;
  const res = await postJson(`/members?session=${sid}`, {
    owner: { email: ownerEmail, pubkey: owner.pub },
    issuedAt: li,
    signature: sign(lmsg, owner.priv),
  });
  check("(j) stale-issuedAt /members rejected (401)", res.status === 401);
}

console.log(pass ? "\nRESULT: ALL PASS" : "\nRESULT: FAIL");
process.exit(pass ? 0 : 1);
