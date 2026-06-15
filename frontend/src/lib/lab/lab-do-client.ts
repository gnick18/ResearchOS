// Lab tier (cross-folder group) Phase 2: the relay client for the per-lab
// record store. Thin signed-request builders + fetch calls that ship the
// head-signed log entries and sealed envelopes produced by the Phase 1 crypto
// core (lab-key.ts) to the LabRecordDO in relay/src/worker.ts.
//
// The relay is BLIND to the lab key. Everything this client sends is either a
// head-signed log entry (public roster + pubkeys + a signature) or a sealed
// key envelope (copies sealed to each member's X25519 key, openable only by that
// member). The 32-byte lab key NEVER leaves the browser in plaintext and is
// never an argument to any function here.
//
// Authentication piggybacks on the LOG ENTRY's own head signature. lab-key.ts
// already signs every entry with the head's Ed25519 key over
// canonicalEntryMessage (see lab-membership.ts), and the DO re-verifies that
// SAME canonical message. So there is no separate request token to build, we
// just POST the already-signed artifacts. labLogCanonicalMessage below is a copy
// of the DO's contract, used only so the client tests can assert byte-equality.
//
// ADDITIVE + DORMANT. Every call is gated behind LAB_TIER_ENABLED, mirroring the
// rest of the lab tier. Nothing in the live app invokes this yet.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { COLLAB_RELAY_URL } from "@/lib/loro/config";
import { LAB_TIER_ENABLED } from "./config";
import { rotateLabKey, addMember } from "./lab-key";
import type {
  LabLogEntry,
  LabMember,
  LabRecord,
} from "./lab-membership";
import type {
  CreatedLab,
  LabKeyEnvelope,
  RotationResult,
  SealedKeyCopy,
} from "./lab-key";

/** The relay's HTTP origin. COLLAB_RELAY_URL is ws(s)://host; the /lab/* writes
 *  go over plain HTTP on the same worker, so swap the scheme. Mirrors the helper
 *  in lib/collab/client/inbox.ts and lib/collab/client/external-grant.ts. */
function relayHttpBase(): string {
  return COLLAB_RELAY_URL.replace(/^ws/, "http");
}

/** Throws if the lab tier is off. Every remote call passes through this so the
 *  whole client stays inert until a later phase flips LAB_TIER_ENABLED. */
function ensureEnabled(): void {
  if (!LAB_TIER_ENABLED) {
    throw new Error("lab tier is disabled (LAB_TIER_ENABLED is false)");
  }
}

/**
 * The exact canonical message the head signs for a log entry. A verbatim copy of
 * canonicalEntryMessage in lab-membership.ts AND of labLogCanonicalMessage in
 * relay/src/worker.ts. The three MUST agree byte for byte; the client tests sign
 * with lab-key.ts and verify the DO accepts it, which is what proves they do.
 */
export function labLogCanonicalMessage(
  entry: Omit<LabLogEntry, "signature">,
): string {
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

async function postJson(
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${relayHttpBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The body POSTed to /lab/create. */
export interface CreateLabBody {
  /** The genesis head-signed seq-0 create entry. */
  entry: LabLogEntry;
  /** The gen-0 sealed envelope (no seed link). */
  envelope: LabKeyEnvelope;
  /** The head member, so the DO can bind head_pubkey and verify the genesis
   *  signature under it (the create roster lists only non-head members, so the
   *  head pubkey is not otherwise present in the entry). */
  head: LabMember;
  /** Optional cosmetic lab branding stored in DO meta at create time. NOT part of
   *  the signed log (it never gates access). All optional + backward compatible. */
  labName?: string;
  piTitle?: string;
  piDisplay?: string;
}

/** Optional cosmetic branding carried alongside lab create. */
export interface LabBranding {
  labName?: string;
  piTitle?: string;
  piDisplay?: string;
}

/** The body POSTed to /lab/append. For rotate, envelope is the new generation's
 *  sealed envelope; for add, copy is the newcomer's sealed copy. */
export interface AppendLabBody {
  entry: LabLogEntry;
  envelope?: LabKeyEnvelope;
  copy?: SealedKeyCopy;
}

/**
 * Creates a lab on the relay. The caller has already run createLab (lab-key.ts)
 * to produce the genesis entry + the gen-0 envelope + the lab key; this ships the
 * PUBLIC, sealed artifacts only. The lab key is not an argument and is never
 * sent. POSTs /lab/create?lab=<labId>.
 *
 * @param labId the stable opaque lab id (the DO is addressed by it).
 * @param created the CreatedLab returned by createLab.
 */
export async function createLabRemote(
  labId: string,
  created: CreatedLab,
  branding?: LabBranding,
): Promise<Response> {
  ensureEnabled();
  const body: CreateLabBody = {
    entry: created.record.log[0],
    envelope: created.envelope,
    head: created.record.head,
  };
  // Only attach branding keys that are actually set, so a create with no branding
  // serializes exactly as it did before this feature.
  if (branding?.labName) body.labName = branding.labName;
  if (branding?.piTitle) body.piTitle = branding.piTitle;
  if (branding?.piDisplay) body.piDisplay = branding.piDisplay;
  return postJson(`/lab/create?lab=${encodeURIComponent(labId)}`, body);
}

/**
 * Appends an add-member entry to the lab on the relay. The caller has already run
 * addMember (lab-key.ts) to produce the head-signed "add" entry + the newcomer's
 * sealed copy of the CURRENT lab key. POSTs /lab/append?lab=<labId>.
 *
 * @param labId the lab id.
 * @param entry the new head-signed "add" log entry (the tail of the updated log).
 * @param copy the newcomer's sealed key copy for the current generation.
 */
export async function appendAddMemberRemote(
  labId: string,
  entry: LabLogEntry,
  copy: SealedKeyCopy,
): Promise<Response> {
  ensureEnabled();
  const body: AppendLabBody = { entry, copy };
  return postJson(`/lab/append?lab=${encodeURIComponent(labId)}`, body);
}

/**
 * Appends a rotate entry to the lab on the relay. The caller has already run
 * rotateLabKey (lab-key.ts) to produce the head-signed "rotate" entry + the new
 * generation's sealed envelope (sealed to the remaining members only, with the
 * seed link binding the old key under the new key). The new lab key is not an
 * argument and is never sent. POSTs /lab/append?lab=<labId>.
 *
 * @param labId the lab id.
 * @param rotation the RotationResult returned by rotateLabKey.
 */
export async function appendRotateRemote(
  labId: string,
  rotation: RotationResult,
): Promise<Response> {
  ensureEnabled();
  const entry = rotation.record.log[rotation.record.log.length - 1];
  const body: AppendLabBody = { entry, envelope: rotation.envelope };
  return postJson(`/lab/append?lab=${encodeURIComponent(labId)}`, body);
}

/**
 * General append for a pre-built head-signed entry plus its envelope-or-copy.
 * appendAddMemberRemote and appendRotateRemote are the typed conveniences; this
 * is the raw form when a caller already has the entry + the right side data.
 */
export async function appendLabEntryRemote(
  labId: string,
  entry: LabLogEntry,
  envelopeOrCopy: { envelope?: LabKeyEnvelope; copy?: SealedKeyCopy },
): Promise<Response> {
  ensureEnabled();
  const body: AppendLabBody = {
    entry,
    envelope: envelopeOrCopy.envelope,
    copy: envelopeOrCopy.copy,
  };
  return postJson(`/lab/append?lab=${encodeURIComponent(labId)}`, body);
}

/**
 * Phase C2 (PI re-admit after an identity reset) orchestrator. Re-admits an
 * EXISTING member who reset their identity key and now holds a fresh keypair, so
 * their roster entry's keys are stale. This is the remote, two-append counterpart
 * of the pure readmitMember primitive in lab-key.ts.
 *
 * THE TWO-APPEND MODEL. The relay appends exactly ONE signed log entry per call,
 * and a re-admit is a rotate (evict the stale keys, new generation) THEN an add
 * (re-admit the same username with the new keys). So it is two sequential
 * appends, and they are NOT atomic on the relay. The ordering matters for the
 * partial-failure story:
 *
 *   - If the ROTATE append fails, nothing is committed server-side. The relay
 *     still has the lab at its previous generation with the member's stale entry
 *     intact. The caller can safely retry readmitMemberRemote from scratch.
 *   - If the rotate append SUCCEEDS but the ADD append fails, the member is now
 *     fully removed server-side (the rotate evicted them and bumped the
 *     generation). DO NOT retry readmitMemberRemote: a second rotate would target
 *     a username that is no longer a member and throw. The recovery path is to
 *     re-invite the (now-removed) member through the normal accept flow, which
 *     adds them at the current generation with their new keys.
 *
 * The lab key never leaves the browser; only head-signed entries and sealed
 * copies are sent. The caller must have already verified `record` (the relay is
 * blind, so the client owns verification before trusting the roster it acts on).
 *
 * @param args.labId the lab id (the DO is addressed by it).
 * @param args.record the current, already-verified lab record.
 * @param args.currentLabKey the head's decrypted current lab key (never sent).
 * @param args.username the existing member to re-admit (must be a non-head member).
 * @param args.newKeys the member's NEW public keys, fingerprint-checked by the caller.
 * @param args.headEd25519PrivateKey the PI's signing key, the sole log signer.
 * @returns ok with the final record + envelope + new lab key on success; otherwise
 *   ok:false with the failing stage and relay status. On stage "add" the returned
 *   `record` is the post-rotate record (member already removed) for the caller's UI.
 * @throws if the username is the head or is not currently a member (mirrors
 *   readmitMember), before any network call.
 */
export async function readmitMemberRemote(args: {
  labId: string;
  record: LabRecord;
  currentLabKey: Uint8Array;
  username: string;
  newKeys: { x25519PublicKey: string; ed25519PublicKey: string };
  headEd25519PrivateKey: Uint8Array;
}): Promise<
  | { ok: true; record: LabRecord; envelope: LabKeyEnvelope; newLabKey: Uint8Array }
  | { ok: false; stage: "rotate" | "add"; status: number; record?: LabRecord }
> {
  ensureEnabled();
  const { labId, record, currentLabKey, username, newKeys, headEd25519PrivateKey } =
    args;

  // Validate up front, mirroring the throws in readmitMember, so a bad target
  // never reaches the relay.
  if (username === record.head.username) {
    throw new Error("readmitMemberRemote: cannot re-admit the lab head");
  }
  const existing = record.members.find((m) => m.username === username);
  if (!existing) {
    throw new Error(
      `readmitMemberRemote: ${username} is not a member of this lab`,
    );
  }

  // 1. Rotate the stale keys out (new generation, seed-linked to the past).
  const rotated = rotateLabKey(
    record,
    currentLabKey,
    username,
    headEd25519PrivateKey,
  );

  // 2. Append the rotate. Nothing is committed server-side until this succeeds,
  //    so a failure here is fully safe to retry from scratch.
  const res1 = await appendRotateRemote(labId, rotated);
  if (!res1.ok) {
    return { ok: false, stage: "rotate", status: res1.status };
  }

  // 3. Re-add the same member with their new keys, preserving role + any email
  //    binding (the human-identity layer survives a key reset).
  const readmitted: LabMember = {
    ...existing,
    x25519PublicKey: newKeys.x25519PublicKey,
    ed25519PublicKey: newKeys.ed25519PublicKey,
  };
  const { record: finalRecord, copy } = addMember(
    rotated.record,
    rotated.newLabKey,
    readmitted,
    headEd25519PrivateKey,
  );

  // 4. Append the add. If this fails the rotate IS already committed, so the
  //    member is now fully removed server-side. Do NOT retry readmitMemberRemote
  //    (a second rotate would target a non-member and throw); the recovery path
  //    is to re-invite them through the normal accept flow. Return the post-rotate
  //    record so the caller's UI reflects the removal.
  const addEntry = finalRecord.log[finalRecord.log.length - 1];
  const res2 = await appendAddMemberRemote(labId, addEntry, copy);
  if (!res2.ok) {
    return { ok: false, stage: "add", status: res2.status, record: rotated.record };
  }

  return {
    ok: true,
    record: finalRecord,
    envelope: { ...rotated.envelope, copies: [...rotated.envelope.copies, copy] },
    newLabKey: rotated.newLabKey,
  };
}

/** The shape the DO returns from /lab/get. The client re-runs
 *  verifyMembershipLog over record before trusting it. */
export interface GetLabResult {
  record: LabRecord;
  envelopes: LabKeyEnvelope[];
}

/**
 * Reads the full lab record + every generation's sealed envelope from the relay.
 * The sealed copies are crypto-gated (only the right member's X25519 key opens
 * theirs), so this open read leaks no lab key. The caller should re-run
 * verifyMembershipLog(result.record) before trusting the roster, then open its
 * own sealed copy with openLabKeyCopy. POSTs /lab/get?lab=<labId>.
 *
 * @returns { record, envelopes } on 200, or null on 404 (no such lab).
 * @throws on a non-200, non-404 response.
 */
export async function getLabRemote(
  labId: string,
): Promise<GetLabResult | null> {
  ensureEnabled();
  const res = await postJson(`/lab/get?lab=${encodeURIComponent(labId)}`, {});
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`getLabRemote: relay returned ${res.status}`);
  }
  return (await res.json()) as GetLabResult;
}

/**
 * Asks the relay to re-report this lab's current roster to the Vercel billing
 * reconcile endpoint, without any membership change. POSTs /lab/resync?lab=<id>.
 *
 * A member calls this right after their directory auto-bind lands on their first
 * lab login, so the billing pool reconciles again now that their pubkey resolves
 * to an email hash (the initial reconcile, fired when the head added them, ran
 * before the binding existed and skipped them). Best-effort: it never throws, so
 * a relay hiccup can never block the login flow that triggers it.
 */
export async function resyncLabRemote(labId: string): Promise<boolean> {
  try {
    ensureEnabled();
    const res = await postJson(`/lab/resync?lab=${encodeURIComponent(labId)}`, {});
    return res.ok;
  } catch {
    return false;
  }
}
