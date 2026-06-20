// Lab tier Phase 2 functional test: the per-lab record store DO (LabRecordDO).
// A head creates a lab (genesis create entry + gen-0 envelope), a duplicate
// create is rejected, the head appends an add-member entry (verified signature +
// chain), a non-head-signed append is rejected, a broken-chain append is
// rejected, a rotate bumps the generation, and /lab/get returns the record + a
// member's sealed copy. Run against `wrangler dev` on PORT. Mirrors inbox.mjs.
//
// Section (q) covers POST /lab/discover-memberships: signature verification,
// freshness window, bad-sig rejection, missing-param rejection, and correct
// canonical-message format. KV lookup returns [] in local dev without KV binding.
//
// The relay is BLIND to the lab key: this test only ever sends head-signed log
// entries + sealed envelopes (random opaque "sealed" bytes stand in for the real
// X25519 sealed boxes, which the DO never inspects). No lab key is ever sent.
//
// No emojis, no em-dashes, no mid-sentence colons.
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

const PORT = process.env.PORT || "8803";
const BASE = `http://localhost:${PORT}`;

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}`);
  if (!cond) pass = false;
};

function keypair() {
  const k = ed25519.keygen();
  return { pub: bytesToHex(k.publicKey), priv: k.secretKey };
}

function member(username, role) {
  const sign = keypair();
  const enc = keypair(); // stand-in x25519 pubkey hex; the DO never opens it
  return {
    member: {
      username,
      x25519PublicKey: enc.pub,
      ed25519PublicKey: sign.pub,
      role,
    },
    priv: sign.priv,
  };
}

// Byte-identical to canonicalEntryMessage (lab-membership.ts) and the DO's
// labLogCanonicalMessage. THE CONTRACT.
function canonical(entry) {
  return [
    "lab-log",
    String(entry.seq),
    entry.type,
    String(entry.keyGeneration),
    JSON.stringify(entry.roster),
    JSON.stringify(entry.subject ?? null),
    String(entry.issuedAt),
    entry.prevHash,
  ].join("\n");
}

function hashSig(sigHex) {
  return bytesToHex(sha256(Buffer.from(sigHex, "hex")));
}

function signEntry(body, headPriv) {
  const sig = bytesToHex(
    ed25519.sign(new TextEncoder().encode(canonical(body)), headPriv),
  );
  return { ...body, signature: sig };
}

async function postJson(path, body) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const labId = `lab-${Date.now()}`;
const head = member("pi", "head");
const alice = member("alice", "member");
const bob = member("bob", "member");

// A genesis create entry. The create roster lists the non-head members.
const genesis = signEntry(
  {
    seq: 0,
    type: "create",
    keyGeneration: 0,
    roster: [alice.member],
    issuedAt: Date.now(),
    prevHash: "",
  },
  head.priv,
);

// Gen-0 envelope. The DO never opens "sealed"; opaque hex stands in.
const gen0Envelope = {
  generation: 0,
  copies: [
    { username: "pi", sealed: "aa".repeat(48) },
    { username: "alice", sealed: "bb".repeat(48) },
  ],
};

// ---- (a) create stores the lab + verifies the head signature ----------------
{
  const res = await postJson(`/lab/create?lab=${labId}`, {
    entry: genesis,
    envelope: gen0Envelope,
    head: head.member,
  });
  check("(a) create returns 200", res.status === 200);
}

// ---- (b) duplicate create is rejected (409) ---------------------------------
{
  const res = await postJson(`/lab/create?lab=${labId}`, {
    entry: genesis,
    envelope: gen0Envelope,
    head: head.member,
  });
  check("(b) duplicate create rejected (409)", res.status === 409);
}

// ---- (c) create with a signature that does NOT verify under head is rejected -
{
  const lab2 = `lab2-${Date.now()}`;
  const forgedGenesis = { ...genesis, signature: "00".repeat(64) };
  const res = await postJson(`/lab/create?lab=${lab2}`, {
    entry: forgedGenesis,
    envelope: gen0Envelope,
    head: head.member,
  });
  check("(c) create with bad head signature rejected (401)", res.status === 401);
}

// ---- (d) append an add-member entry (verified sig + chain) -------------------
const addEntry = signEntry(
  {
    seq: 1,
    type: "add",
    keyGeneration: 0,
    roster: [alice.member, bob.member],
    subject: bob.member,
    issuedAt: Date.now(),
    prevHash: hashSig(genesis.signature),
  },
  head.priv,
);
{
  const res = await postJson(`/lab/append?lab=${labId}`, {
    entry: addEntry,
    copy: { username: "bob", sealed: "cc".repeat(48) },
  });
  check("(d) add-member append returns 200", res.status === 200);
}

// ---- (e) a non-head-signed append is rejected (401) -------------------------
{
  const attacker = keypair();
  const forged = signEntry(
    {
      seq: 2,
      type: "add",
      keyGeneration: 0,
      roster: [alice.member, bob.member, member("eve", "member").member],
      subject: member("eve", "member").member,
      issuedAt: Date.now(),
      prevHash: hashSig(addEntry.signature),
    },
    attacker.priv, // not the head
  );
  const res = await postJson(`/lab/append?lab=${labId}`, {
    entry: forged,
    copy: { username: "eve", sealed: "dd".repeat(48) },
  });
  check("(e) non-head-signed append rejected (401)", res.status === 401);
}

// ---- (f) a broken-chain append is rejected (400) ----------------------------
{
  const broken = signEntry(
    {
      seq: 2,
      type: "add",
      keyGeneration: 0,
      roster: [alice.member, bob.member],
      subject: bob.member,
      issuedAt: Date.now(),
      prevHash: "00".repeat(32), // wrong prevHash
    },
    head.priv,
  );
  const res = await postJson(`/lab/append?lab=${labId}`, {
    entry: broken,
    copy: { username: "x", sealed: "ee".repeat(48) },
  });
  check("(f) broken-chain append rejected (400)", res.status === 400);
}

// ---- (g) a non-monotonic seq is rejected (400) ------------------------------
{
  const replay = signEntry(
    {
      seq: 1, // already used
      type: "add",
      keyGeneration: 0,
      roster: [alice.member, bob.member],
      subject: bob.member,
      issuedAt: Date.now(),
      prevHash: hashSig(genesis.signature),
    },
    head.priv,
  );
  const res = await postJson(`/lab/append?lab=${labId}`, {
    entry: replay,
    copy: { username: "bob", sealed: "ff".repeat(48) },
  });
  check("(g) non-monotonic seq rejected (400)", res.status === 400);
}

// ---- (h) a rotate bumps the generation (verified sig + chain + envelope) -----
const rotateEntry = signEntry(
  {
    seq: 2,
    type: "rotate",
    keyGeneration: 1, // bumps by exactly one
    roster: [alice.member], // bob departs
    subject: bob.member,
    issuedAt: Date.now(),
    prevHash: hashSig(addEntry.signature),
  },
  head.priv,
);
const gen1Envelope = {
  generation: 1,
  copies: [
    { username: "pi", sealed: "11".repeat(48) },
    { username: "alice", sealed: "22".repeat(48) },
  ],
  seedLink: "33".repeat(60), // encryptLabData(oldKey,newKey), opaque to the DO
};
{
  const res = await postJson(`/lab/append?lab=${labId}`, {
    entry: rotateEntry,
    envelope: gen1Envelope,
  });
  check("(h) rotate append returns 200", res.status === 200);
}

// ---- (i) rotate with a mismatched envelope generation is rejected (400) ------
{
  const lab3 = `lab3-${Date.now()}`;
  const g = signEntry(
    { seq: 0, type: "create", keyGeneration: 0, roster: [alice.member], issuedAt: Date.now(), prevHash: "" },
    head.priv,
  );
  await postJson(`/lab/create?lab=${lab3}`, {
    entry: g,
    envelope: { generation: 0, copies: [] },
    head: head.member,
  });
  const rot = signEntry(
    { seq: 1, type: "rotate", keyGeneration: 1, roster: [], subject: alice.member, issuedAt: Date.now(), prevHash: hashSig(g.signature) },
    head.priv,
  );
  const res = await postJson(`/lab/append?lab=${lab3}`, {
    entry: rot,
    envelope: { generation: 5, copies: [] }, // wrong generation
  });
  check("(i) rotate with mismatched envelope generation rejected (400)", res.status === 400);
}

// ---- (j) get returns the record + envelopes (incl. a member's sealed copy) ---
{
  const res = await postJson(`/lab/get?lab=${labId}`, {});
  const data = await res.json();
  const ok =
    res.status === 200 &&
    data.record &&
    data.record.labId === labId &&
    data.record.head &&
    data.record.head.username === "pi" &&
    data.record.keyGeneration === 1 &&
    Array.isArray(data.record.log) &&
    data.record.log.length === 3 && // create + add + rotate
    // The final roster is alice only (bob rotated out).
    data.record.members.length === 1 &&
    data.record.members[0].username === "alice" &&
    Array.isArray(data.envelopes) &&
    data.envelopes.length === 2 &&
    // A member's sealed copy is present in the gen-1 envelope.
    data.envelopes[1].generation === 1 &&
    data.envelopes[1].copies.some((c) => c.username === "alice") &&
    data.envelopes[1].seedLink === "33".repeat(60);
  check("(j) get returns the record + envelopes with a member sealed copy", ok);

  // The server is BLIND: nothing in the response is a 32-byte plaintext lab key.
  // Every "sealed" copy is an opaque hex string the DO never opened.
  const noPlainKey = JSON.stringify(data).indexOf("labKey") === -1;
  check("(j) response carries no plaintext lab key field", noPlainKey);
}

// ---- (k) get on a non-existent lab returns 404 ------------------------------
{
  const res = await postJson(`/lab/get?lab=nope-${Date.now()}`, {});
  check("(k) get on a missing lab returns 404", res.status === 404);
}

// ---- (k2) a "role" append (Lab Manager Phase 1) on a fresh lab ---------------
// A "role" entry flips a member's admin flag. It carries NO envelope and NO copy
// (no key effect), keeps the generation put, and must verify under the head. A
// member-signed "role" must be rejected, so a member cannot self-promote.
{
  const labR = `lab-role-${Date.now()}`;
  const rHead = member("pi", "head");
  const rAlice = member("alice", "member");
  const g = signEntry(
    { seq: 0, type: "create", keyGeneration: 0, roster: [rAlice.member], issuedAt: Date.now(), prevHash: "" },
    rHead.priv,
  );
  await postJson(`/lab/create?lab=${labR}`, {
    entry: g,
    envelope: { generation: 0, copies: [] },
    head: rHead.member,
  });

  // Head promotes alice to Lab Manager (admin), seq 1, generation stays 0, no side data.
  const promoted = { ...rAlice.member, admin: true };
  const roleEntry = signEntry(
    { seq: 1, type: "role", keyGeneration: 0, roster: [promoted], subject: promoted, issuedAt: Date.now(), prevHash: hashSig(g.signature) },
    rHead.priv,
  );
  {
    const res = await postJson(`/lab/append?lab=${labR}`, { entry: roleEntry });
    check("(k2) head-signed role append returns 200", res.status === 200);
  }

  // The stored roster now carries the admin flag.
  {
    const res = await postJson(`/lab/get?lab=${labR}`, {});
    const data = await res.json();
    const ok =
      res.status === 200 &&
      data.record.keyGeneration === 0 &&
      data.record.log.length === 2 && // create + role
      data.record.members.length === 1 &&
      data.record.members[0].username === "alice" &&
      data.record.members[0].admin === true;
    check("(k2) get reflects the materialized admin flag, generation unchanged", ok);
  }

  // A member-signed "role" (alice trying to keep/grant admin herself) is rejected.
  {
    const forged = signEntry(
      { seq: 2, type: "role", keyGeneration: 0, roster: [promoted], subject: promoted, issuedAt: Date.now(), prevHash: hashSig(roleEntry.signature) },
      rAlice.priv, // not the head
    );
    const res = await postJson(`/lab/append?lab=${labR}`, { entry: forged });
    check("(k2) member-signed role append rejected (401)", res.status === 401);
  }
}

// ---- accept queue: ONE reusable invite link admits MANY members -------------
// The relay only shape-validates the accept on push (the crypto is the head's
// job at finalize). What matters at the storage layer is that the queue is keyed
// by the member's Ed25519 pubkey, NOT the invite nonce, so two members opening
// the SAME link (same nonce, different member pubkeys) both get a pending row.
//
// Build a minimally well-formed accept the push handler accepts. The `invite`
// only has to be an object here; head verification of its signature happens
// client-side at finalize, which is out of scope for the relay.
function buildAccept(labId, nonce, memberPubHex) {
  return {
    labId,
    nonce,
    invite: { labId, nonce }, // shape-only; head verifies it at finalize
    memberUsername: `m-${memberPubHex.slice(0, 6)}`,
    memberX25519Pub: "ab".repeat(32),
    memberEd25519Pub: memberPubHex,
    sealedEmail: "cd".repeat(48),
    memberSig: "ef".repeat(64),
  };
}

// Use a fresh lab so this section is independent of the earlier roster state.
const labQ = `lab-accept-q-${Date.now()}`;
const qHead = keypair();
{
  const g = signEntry(
    { seq: 0, type: "create", keyGeneration: 0, roster: [{ username: "pi", x25519PublicKey: "11".repeat(32), ed25519PublicKey: qHead.pub, role: "head" }], subject: null, issuedAt: Date.now(), prevHash: "" },
    qHead.priv,
  );
  const res = await postJson(`/lab/create?lab=${labQ}`, {
    entry: g,
    envelope: { generation: 0, copies: [], seedLink: "22".repeat(60) },
  });
  check("(l) accept-queue: lab create returns 200", res.status === 200);
}

const sharedNonce = "nonce-shared-link";
const memberA = keypair();
const memberB = keypair();

// Two members open the SAME link (same nonce) but sign in as DIFFERENT identities.
{
  const ra = await postJson(`/lab/accept?lab=${labQ}`, { accept: buildAccept(labQ, sharedNonce, memberA.pub) });
  const rb = await postJson(`/lab/accept?lab=${labQ}`, { accept: buildAccept(labQ, sharedNonce, memberB.pub) });
  check("(m) accept-queue: member A push returns 200", ra.status === 200);
  check("(m) accept-queue: member B push (same nonce) returns 200", rb.status === 200);
}

function signQ(message) {
  return bytesToHex(ed25519.sign(new TextEncoder().encode(message), qHead.priv));
}

// Head lists: BOTH pending accepts persist, proving a reusable link admits many.
{
  const issuedAt = Date.now();
  const signature = signQ(`lab-accept-list\n${labQ}\n${issuedAt}`);
  const res = await postJson(`/lab/accept/list?lab=${labQ}`, { issuedAt, signature });
  const data = await res.json();
  const pubs = (data.accepts ?? []).map((a) => a.memberEd25519Pub).sort();
  const ok =
    res.status === 200 &&
    data.accepts.length === 2 &&
    pubs.includes(memberA.pub) &&
    pubs.includes(memberB.pub);
  check("(n) accept-queue: same-nonce, different-member accepts BOTH persist", ok);
}

// Dismiss member A by their pubkey; member B's pending accept must remain.
{
  const issuedAt = Date.now();
  const signature = signQ(`lab-accept-dismiss\n${labQ}\n${memberA.pub}\n${issuedAt}`);
  const res = await postJson(`/lab/accept/dismiss?lab=${labQ}`, { memberPubkey: memberA.pub, issuedAt, signature });
  check("(o) accept-queue: dismiss member A by pubkey returns 200", res.status === 200);
}
{
  const issuedAt = Date.now();
  const signature = signQ(`lab-accept-list\n${labQ}\n${issuedAt}`);
  const res = await postJson(`/lab/accept/list?lab=${labQ}`, { issuedAt, signature });
  const data = await res.json();
  const ok =
    res.status === 200 &&
    data.accepts.length === 1 &&
    data.accepts[0].memberEd25519Pub === memberB.pub;
  check("(o) accept-queue: dismissing one member leaves the other pending", ok);
}

// Dismiss without memberPubkey is a 400.
{
  const issuedAt = Date.now();
  const signature = signQ(`lab-accept-dismiss\n${labQ}\n\n${issuedAt}`);
  const res = await postJson(`/lab/accept/dismiss?lab=${labQ}`, { issuedAt, signature });
  check("(p) accept-queue: dismiss without memberPubkey returns 400", res.status === 400);
}

// ---- (q) POST /lab/discover-memberships: signature verification + happy path --
//
// NOTE: the KV binding (LAB_MEMBERSHIP_INDEX) is not available in local `wrangler
// dev` without manual KV setup, so the discovery endpoint returns { labIds: [] }
// when the KV binding is absent. These tests verify:
//   (q1) valid signature + fresh issuedAt -> 200 (labIds may be [] without KV)
//   (q2) stale issuedAt -> 401
//   (q3) bad signature -> 401
//   (q4) missing pubkey query param -> 400
//   (q5) missing body fields -> 400
//   (q6) canonical message format byte-matches the client
//
// The canonical message format is: "lab-discover-memberships\n<pubkey>\n<issuedAt>"
// This matches discoverMembershipsCanonicalMessage in
// frontend/src/lib/lab/lab-membership-discovery.ts.
{
  const disco = keypair();

  // Helper: sign a discovery request.
  function signDiscover(pubkeyHex, issuedAt, privKey) {
    const msg = new TextEncoder().encode(`lab-discover-memberships\n${pubkeyHex}\n${issuedAt}`);
    return bytesToHex(ed25519.sign(msg, privKey));
  }

  // (q1) Valid signature, fresh issuedAt -> 200 { labIds: [] }
  {
    const issuedAt = Date.now();
    const signature = signDiscover(disco.pub, issuedAt, disco.priv);
    const res = await fetch(`${BASE}/lab/discover-memberships?pubkey=${encodeURIComponent(disco.pub)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuedAt, signature }),
    });
    const data = await res.json();
    check("(q1) discover: valid sig returns 200 with labIds array", res.status === 200 && Array.isArray(data.labIds));
  }

  // (q2) Stale issuedAt (6 minutes ago) -> 401
  {
    const issuedAt = Date.now() - 6 * 60 * 1000;
    const signature = signDiscover(disco.pub, issuedAt, disco.priv);
    const res = await fetch(`${BASE}/lab/discover-memberships?pubkey=${encodeURIComponent(disco.pub)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuedAt, signature }),
    });
    check("(q2) discover: stale issuedAt returns 401", res.status === 401);
  }

  // (q3) Bad signature (sign with a different key) -> 401
  {
    const issuedAt = Date.now();
    const imposter = keypair();
    const signature = signDiscover(disco.pub, issuedAt, imposter.priv);
    const res = await fetch(`${BASE}/lab/discover-memberships?pubkey=${encodeURIComponent(disco.pub)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuedAt, signature }),
    });
    check("(q3) discover: bad signature returns 401", res.status === 401);
  }

  // (q4) Missing pubkey query param -> 400
  {
    const issuedAt = Date.now();
    const signature = signDiscover(disco.pub, issuedAt, disco.priv);
    const res = await fetch(`${BASE}/lab/discover-memberships`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuedAt, signature }),
    });
    check("(q4) discover: missing pubkey param returns 400", res.status === 400);
  }

  // (q5) Missing body fields -> 400
  {
    const res = await fetch(`${BASE}/lab/discover-memberships?pubkey=${encodeURIComponent(disco.pub)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuedAt: "not-a-number" }),
    });
    check("(q5) discover: malformed body returns 400", res.status === 400);
  }

  // (q6) Wrong HTTP method -> 405
  {
    const res = await fetch(`${BASE}/lab/discover-memberships?pubkey=${encodeURIComponent(disco.pub)}`, {
      method: "GET",
    });
    check("(q6) discover: GET returns 405", res.status === 405);
  }
}

console.log(pass ? "\nRESULT: ALL PASS" : "\nRESULT: FAIL");
process.exit(pass ? 0 : 1);
