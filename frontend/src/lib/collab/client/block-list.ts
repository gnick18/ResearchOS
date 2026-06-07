// External-collab chunk 5, PIECE 3: the recipient's LOCAL sender block list.
//
// A recipient can BLOCK a sender so their invites never surface again. This is a
// LOCAL-FIRST setting, keyed by the sender's canonical email, stored in the
// recipient's own browser. There is no server-side moderation backend, by
// design: the relay stays a blind transport, and a recipient's "do not show me
// this person" choice is the recipient's own preference, not a global ban.
//
// HOW IT IS ENFORCED.
//   - listInvites (lib/collab/client/inbox.ts) filters out any invite whose
//     fromEmail is blocked, and best-effort dismisses it on the relay so a
//     blocked sender's pending row does not linger.
//   - The "Shared with me" pending list reads the same filtered list, so a
//     blocked sender's invites are auto-hidden.
//
// "REPORT" maps to BLOCK. With no moderation backend, reporting a sender does the
// same local thing as blocking, plus a console acknowledgement. We never invent a
// server report endpoint.
//
// STORAGE (data-shape FLAG). One localStorage key, "researchos.collab.blocked",
// holding a JSON array of canonical email strings. It is purely client-local,
// never synced, never sent to any server. Reading is resilient: a missing or
// corrupt value reads back as an empty list.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { canonicalizeEmail } from "@/lib/sharing/directory/email";

const STORAGE_KEY = "researchos.collab.blocked";

/** Listeners notified whenever the block list changes (so a mounted UI can
 *  re-render without polling). */
type BlockListener = () => void;
const listeners = new Set<BlockListener>();

/** In-memory cache of the blocked set, loaded lazily from localStorage. Kept in
 *  sync on every mutation so reads are cheap and SSR-safe (empty before load). */
let cache: Set<string> | null = null;

function hasStorage(): boolean {
  return typeof globalThis !== "undefined" &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";
}

function load(): Set<string> {
  if (cache) return cache;
  const set = new Set<string>();
  if (hasStorage()) {
    try {
      const raw = globalThis.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const e of parsed) {
            if (typeof e === "string" && e) set.add(canonicalizeEmail(e));
          }
        }
      }
    } catch {
      // Corrupt or unreadable value: start with an empty list.
    }
  }
  cache = set;
  return set;
}

function persist(set: Set<string>): void {
  if (!hasStorage()) return;
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Storage full / unavailable: the in-memory cache still reflects the change
    // for this session.
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // A listener throwing must not block the others.
    }
  }
}

/** True when this sender email is blocked. A null/empty email is never blocked
 *  (we cannot identify the sender, so we do not filter it). */
export function isBlocked(email: string | null | undefined): boolean {
  if (!email) return false;
  return load().has(canonicalizeEmail(email));
}

/** Blocks a sender by canonical email. Idempotent. No-op on an empty email. */
export function blockSender(email: string | null | undefined): void {
  if (!email) return;
  const canonical = canonicalizeEmail(email);
  const set = load();
  if (set.has(canonical)) return;
  set.add(canonical);
  persist(set);
  notify();
}

/** Unblocks a sender by canonical email. Idempotent. */
export function unblockSender(email: string | null | undefined): void {
  if (!email) return;
  const canonical = canonicalizeEmail(email);
  const set = load();
  if (!set.delete(canonical)) return;
  persist(set);
  notify();
}

/** "Report" maps to block plus a console acknowledgement (no server moderation
 *  backend exists). Returns nothing; the effect is identical to blockSender. */
export function reportSender(email: string | null | undefined): void {
  if (!email) return;
  // Acknowledge the report locally. There is no server to receive it; blocking
  // is the actionable outcome.
  console.warn(
    `[collab] reported sender ${canonicalizeEmail(email)} (blocked locally; no server moderation backend)`,
  );
  blockSender(email);
}

/** A snapshot of the currently-blocked canonical emails. */
export function listBlocked(): string[] {
  return [...load()];
}

/** Filters a list of items by their sender email, dropping blocked senders. The
 *  selector returns the item's sender email (null when unknown). */
export function filterBlocked<T>(
  items: T[],
  emailOf: (item: T) => string | null | undefined,
): T[] {
  if (load().size === 0) return items;
  return items.filter((item) => !isBlocked(emailOf(item)));
}

/** Subscribe to block-list changes. Returns an unsubscribe function. */
export function onBlockListChange(fn: BlockListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test-only reset of the in-memory cache + listeners (does not clear
 *  localStorage; tests stub or clear that directly). */
export function _resetBlockListCache(): void {
  cache = null;
  listeners.clear();
}
