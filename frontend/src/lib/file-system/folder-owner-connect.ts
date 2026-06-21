// Account-centric folder identity, the CONNECT-time owner resolution (Phase B).
//
// finishConnect calls resolveOwnerAction after discovering users to decide what
// to do about folder ownership for the signed-in account. The decision is split
// into a PURE selector (decideOwnerAction, unit-tested) and a thin runtime
// wrapper (resolveOwnerAction) that reads the session fingerprint + owner record
// and may write the adopt record.
//
// EVERYTHING here runs only behind MULTI_FOLDER_ENABLED and only when an
// OAuth/session identity is present. With the flag OFF or no session, finishConnect
// never calls in here, so flag-off behavior is byte-identical to today.
//
// KEY DATA-SAFETY GUARD (repeat of folder-owner.ts): rebind-on-takeover is
// data-safe ONLY while DEVICE_KEY_V2 at-rest encryption stays OFF. If at-rest
// encryption ships, the takeover flow must be re-reviewed before a blind rebind.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fingerprint as computeFingerprint } from "../sharing/identity/keys";
import { getSessionIdentity } from "../sharing/identity/session-key";
import { countForeignShares } from "../sharing/foreign-share-sweep";
import {
  type FolderOwnerRecord,
  adoptRecord,
  isForeignTakeover,
  isOwnedBy,
  readFolderOwner,
  writeFolderOwner,
} from "./folder-owner";

/**
 * What finishConnect should do about ownership for the connecting account.
 * - "none" the flag is off or there is no session, do nothing owner-aware (the
 *   legacy connect path runs unchanged).
 * - "adopt" the folder had no owner record, the connecting account is now the
 *   sole exclusive owner (D4), proceed normally.
 * - "owned" the folder is already owned by the connecting account, proceed
 *   normally (resolve to the account's own user, no "who are you" prompt).
 * - "takeover" the folder is owned by a DIFFERENT account, do NOT rebind, surface
 *   the takeover warning (D2).
 */
export type OwnerActionKind = "none" | "adopt" | "owned" | "takeover";

/** The state finishConnect surfaces so the UI can render the takeover warning. */
export interface PendingTakeover {
  ownerEmail?: string;
  ownerFingerprint: string;
  foreignShareCount: number;
}

export interface OwnerAction {
  kind: OwnerActionKind;
  /** Present only for kind === "takeover". */
  pendingTakeover?: PendingTakeover;
  /** The connecting account's fingerprint, present for adopt/owned/takeover. */
  myFingerprint?: string;
}

/**
 * PURE selector. Given the current owner record (or null), the connecting
 * account fingerprint (or null when no session), and the flag, pick the action.
 * No IO, unit-tested directly.
 */
export function decideOwnerAction(
  rec: FolderOwnerRecord | null,
  myFingerprint: string | null,
  flagEnabled: boolean,
): OwnerActionKind {
  if (!flagEnabled || !myFingerprint) return "none";
  if (rec === null) return "adopt";
  if (isOwnedBy(rec, myFingerprint)) return "owned";
  if (isForeignTakeover(rec, myFingerprint)) return "takeover";
  // Defensive, should be unreachable (owned + foreign are exhaustive for a
  // non-null record). Treat as owned so we never block a connect on a logic gap.
  return "owned";
}

/**
 * The connecting account's signing-key fingerprint for THIS session, or null
 * when locked / no session. Uses the same fingerprint() the sidecar uses so the
 * comparison against owner_fingerprint matches Phase B.
 */
export function currentAccountFingerprint(): string | null {
  const session = getSessionIdentity();
  if (!session) return null;
  try {
    return computeFingerprint(session.keys.signing.publicKey);
  } catch {
    return null;
  }
}

/**
 * Runtime owner resolution for finishConnect. Reads the session fingerprint and
 * the on-disk owner record, picks the action, and for "adopt" WRITES the fresh
 * owner record (D4, silent). For "takeover" it computes the foreign-share count
 * for the warning copy but writes nothing and does NOT rebind. Returns "none"
 * (and writes nothing) when the flag is off or there is no session.
 *
 * @param flagEnabled pass MULTI_FOLDER_ENABLED so the call is a clean no-op when off.
 * @param currentUser the connecting account's canonical user dir, used to scope the
 *   foreign-share count. When null we report 0 (nothing to sweep yet).
 * @param myEmail optional human-readable label written into the adopt record.
 */
export async function resolveOwnerAction(
  flagEnabled: boolean,
  currentUser: string | null,
  myEmail?: string,
): Promise<OwnerAction> {
  const myFingerprint = currentAccountFingerprint();
  if (!flagEnabled || !myFingerprint) return { kind: "none" };

  const rec = await readFolderOwner();
  const kind = decideOwnerAction(rec, myFingerprint, flagEnabled);

  if (kind === "adopt") {
    // D4, silent adopt. Even a folder that already has multiple users/ dirs is
    // adopted (no warning) when it has no owner record yet.
    await writeFolderOwner(adoptRecord(myFingerprint, myEmail));
    return { kind, myFingerprint };
  }

  if (kind === "takeover" && rec) {
    const foreignShareCount = currentUser
      ? await countForeignShares(currentUser, myFingerprint)
      : 0;
    return {
      kind,
      myFingerprint,
      pendingTakeover: {
        ownerEmail: rec.owner_email,
        ownerFingerprint: rec.owner_fingerprint,
        foreignShareCount,
      },
    };
  }

  return { kind, myFingerprint };
}
