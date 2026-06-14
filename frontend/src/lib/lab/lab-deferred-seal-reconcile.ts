// Cloud-accounts Phase 4A: the deferred-seal RECONCILIATION orchestration.
//
// The post-join hook. An existing key-holder (the lab head, the only signer of the
// roster log) runs this when they open the lab. It finds members who joined via a
// Phase 4B server token, who have since published an X25519 pubkey, but who have
// no sealed copy of the lab key yet, and seals the lab key to each of them, end to
// end. The seal is a client-side sealToRecipient against the member's PUBLIC key
// plus a head-signed "add" log entry; the relay only ever stores the sealed bytes
// and the signed public roster.
//
// SECURITY MODEL (the whole point of this file).
//   - The lab DATA KEY lives only in the head's live session here (opened from the
//     head's own sealed envelope copy). It is passed to sealToRecipient and to
//     addMember as an in-memory Uint8Array and is NEVER serialized to the server,
//     logged, or persisted by this code. The only thing that leaves the browser is
//     sealToRecipient's output (an X25519 sealed box openable solely by the target
//     member's private key) and a head-signed public log entry.
//   - We resolve each candidate's pubkey from the PUBLIC directory (lookup by
//     email). A member with no directory binding yet (no device key) is skipped:
//     there is no pubkey to seal to, so they stay "key-pending" until they
//     provision one. No partial or insecure fallback, and never a server escrow.
//   - Idempotent: a member who already has a sealed copy yields no work, so this is
//     safe to run on every lab open. A relay add failure stops the run so the local
//     and server logs never diverge (same discipline as finalizeLabAccepts).
//
// The deterministic roster key for a token-joined member is their CANONICAL EMAIL,
// computable identically on the head side (from the billing label) and the member
// side (from their own OAuth session), so the member can later open the copy keyed
// by that same canonical email (see enterLabViaToken in lab-member-activation.ts).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { canonicalizeEmail } from "@/lib/sharing/directory/email";
import { addMember } from "./lab-key";
import { getLabRemote, appendAddMemberRemote } from "./lab-do-client";
import {
  classifyDataKeyState,
  membersNeedingSeal,
  type MemberSealFacts,
} from "./lab-deferred-seal";
import type { LabMember, LabRecord } from "./lab-membership";

/** The directory lookup response the resolver returns (api/directory/lookup). */
export interface ResolvedPubkeys {
  found: boolean;
  x25519PublicKey?: string;
  ed25519PublicKey?: string;
}

/** Resolves one canonical email to its published directory pubkeys, or not-found.
 *  Injected so the orchestration is unit-testable without the network. */
export type PubkeyResolver = (canonicalEmail: string) => Promise<ResolvedPubkeys>;

/** Fetches the active billing-member emails for the head's lab (server route). */
export type CandidateEmailsLoader = () => Promise<string[]>;

/** One reconciliation outcome per candidate, for a status surface (never throws
 *  the whole run on one member). */
export interface SealOutcome {
  /** The candidate's canonical email (the deterministic roster key). */
  email: string;
  status: "sealed" | "already-active" | "key-pending" | "skipped";
  /** Empty on success, else a short reason. */
  reason: string;
}

/** The live key material the head supplies. Held in memory only; never serialized
 *  by this module. */
export interface HeadSealContext {
  labId: string;
  /** The current lab key, opened from the head's own envelope copy. */
  labKey: Uint8Array;
  /** The head's Ed25519 signing private key, the only roster-log signer. */
  headEd25519Priv: Uint8Array;
}

/** The default network resolver, hitting the directory lookup route. */
export async function resolvePubkeysViaDirectory(
  canonicalEmail: string,
): Promise<ResolvedPubkeys> {
  try {
    const res = await fetch("/api/directory/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: canonicalEmail }),
    });
    if (!res.ok) return { found: false };
    const data = (await res.json()) as {
      found?: boolean;
      x25519PublicKey?: string;
      ed25519PublicKey?: string;
    };
    if (!data.found) return { found: false };
    return {
      found: true,
      x25519PublicKey: data.x25519PublicKey,
      ed25519PublicKey: data.ed25519PublicKey,
    };
  } catch {
    return { found: false };
  }
}

/** The default candidate loader, hitting the head-authed pending-seals route. */
export async function loadCandidateEmailsFromServer(): Promise<string[]> {
  try {
    const res = await fetch("/api/lab/pending-seals");
    if (!res.ok) return [];
    const data = (await res.json()) as { ok?: boolean; emails?: unknown };
    if (!data.ok || !Array.isArray(data.emails)) return [];
    return data.emails.filter((e): e is string => typeof e === "string");
  } catch {
    return [];
  }
}

/**
 * Builds the public seal-facts for each candidate by resolving the current DO
 * roster + the current-generation envelope's sealed-copy set against each
 * candidate's directory pubkey. PURE-ish: no key material, only public reads. The
 * caller passes the already-fetched record + the set of usernames that have a
 * sealed copy in the current generation.
 */
export async function buildSealFacts(params: {
  record: LabRecord;
  sealedUsernames: Set<string>;
  candidateEmails: string[];
  resolve: PubkeyResolver;
}): Promise<MemberSealFacts[]> {
  const { record, sealedUsernames, candidateEmails, resolve } = params;
  const rosterUsernames = new Set<string>([
    record.head.username,
    ...record.members.map((m) => m.username),
  ]);

  const facts: MemberSealFacts[] = [];
  for (const raw of candidateEmails) {
    const email = canonicalizeEmail(raw);
    // A token-joined member is a real member as soon as they redeemed the token
    // (the billing roster is the membership of record in 4B), whether or not the
    // head has yet added a crypto-roster entry for them. So every candidate email
    // returned by the head-authed pending-seals route is in-roster by definition;
    // the rosterUsernames set is read only to keep the copy-set lookup honest.
    void rosterUsernames;
    const hasSealedCopy = sealedUsernames.has(email);
    let publishedX25519Pub: string | null = null;
    // Only resolve a pubkey when there is a seal still to do. If they already have
    // a sealed copy there is nothing to look up.
    if (!hasSealedCopy) {
      const r = await resolve(email);
      publishedX25519Pub = r.found && r.x25519PublicKey ? r.x25519PublicKey : null;
    }
    facts.push({
      username: email,
      publishedX25519Pub,
      hasSealedCopy,
      inRoster: true,
    });
  }
  return facts;
}

/**
 * THE post-join hook. Run by the head on lab open. Finds token-joined members who
 * now have a published pubkey but no sealed copy, and seals the lab key to each via
 * a head-signed add. Returns one outcome per candidate.
 *
 * The lab key in ctx is held in memory only and is NEVER sent to the server: only
 * sealToRecipient output + a head-signed public log entry leave the browser.
 */
export async function reconcileDeferredSeals(params: {
  ctx: HeadSealContext;
  loadCandidates?: CandidateEmailsLoader;
  resolve?: PubkeyResolver;
}): Promise<SealOutcome[]> {
  const { ctx } = params;
  const loadCandidates = params.loadCandidates ?? loadCandidateEmailsFromServer;
  const resolve = params.resolve ?? resolvePubkeysViaDirectory;

  const candidateEmails = await loadCandidates();
  if (candidateEmails.length === 0) return [];

  const remote = await getLabRemote(ctx.labId);
  if (!remote || !remote.envelopes.length) {
    throw new Error("reconcileDeferredSeals: lab not found or has no envelopes");
  }
  const current = remote.envelopes.reduce((a, b) =>
    b.generation > a.generation ? b : a,
  );
  const sealedUsernames = new Set(current.copies.map((c) => c.username));

  const facts = await buildSealFacts({
    record: remote.record,
    sealedUsernames,
    candidateEmails,
    resolve,
  });

  const factByEmail = new Map(facts.map((f) => [f.username, f]));
  const targets = membersNeedingSeal(facts);
  const targetEmails = new Set(targets.map((t) => t.username));

  const outcomes: SealOutcome[] = [];
  let record = remote.record;

  for (const f of facts) {
    const email = f.username;
    if (!targetEmails.has(email)) {
      const state = classifyDataKeyState(f);
      outcomes.push({
        email,
        status: state === "active" ? "already-active" : "key-pending",
        reason:
          state === "key-pending"
            ? "member has no published device key yet"
            : "",
      });
      continue;
    }

    const target = factByEmail.get(email);
    if (!target || !target.publishedX25519Pub) {
      outcomes.push({ email, status: "key-pending", reason: "no pubkey" });
      continue;
    }

    // Resolve the signing pubkey too, for the roster entry (best-effort: the
    // signing key is public roster metadata, not a seal target).
    const resolved = await resolve(email);
    const ed = resolved.found && resolved.ed25519PublicKey
      ? resolved.ed25519PublicKey
      : "";

    const newMember: LabMember = {
      username: email,
      x25519PublicKey: target.publishedX25519Pub,
      ed25519PublicKey: ed,
      role: "member",
    };

    let next;
    try {
      next = addMember(record, ctx.labKey, newMember, ctx.headEd25519Priv);
    } catch (e) {
      outcomes.push({
        email,
        status: "skipped",
        reason: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const entry = next.record.log[next.record.log.length - 1];
    const res = await appendAddMemberRemote(ctx.labId, entry, next.copy);
    if (!res.ok) {
      // Stop so local and server logs stay in lockstep; the rest stay pending.
      outcomes.push({
        email,
        status: "skipped",
        reason: `relay rejected add (HTTP ${res.status})`,
      });
      break;
    }
    record = next.record;
    outcomes.push({ email, status: "sealed", reason: "" });
  }

  return outcomes;
}
