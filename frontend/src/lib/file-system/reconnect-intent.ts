// Boot-time reconnect intent (seamless-reconnect on login, 2026-06-20).
//
// On every load where the app has a stored folder handle, the entry state
// machine in providers.tsx must decide, BEFORE the account-first /account
// redirect fires, whether it can reconnect this device's folder. This module is
// the single pure-ish resolver for that decision. It reads the persisted handle,
// queries its permission, and compares the folder's recorded account against the
// signed-in account, returning one of a small set of intents.
//
// Why this lives apart from file-system-context: the provider's entry chain
// needs to know "is there a reconnectable folder, and is it silent or one-click"
// WITHOUT first flipping isConnected, so the splash can hold across the whole
// transition and the /account redirect never preempts it. The actual reconnect
// (finishConnect) still runs in the provider; this only decides intent.
//
// The account-match gate (design doc Open Question 2, locked YES): a different
// account signing in on this device must NEVER silently open the previous
// account's folder. We gate on the folder->account binding recorded in the handle
// meta (storeDirectoryHandle). When the folder has no recorded account (a local-
// first connect, or a folder connected before this field shipped) there is
// nothing to mismatch, so the reconnect proceeds (the no-account local-first
// story is unchanged). When the folder HAS a recorded account and it does not
// match the current session, we report "mismatch" and the entry chain falls
// through to /account / the picker instead of auto-opening someone else's folder.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { getStoredDirectoryHandle, getStoredDirectoryMeta } from "./indexeddb-store";
import { currentAccountFingerprint } from "./folder-owner-connect";

/**
 * The decision the entry chain acts on.
 * - "silent": a stored handle exists, permission is "granted", and the account
 *   gate passes. The provider reconnects with no click, under the splash.
 * - "lapsed": a stored handle exists and the account gate passes, but Chrome
 *   dropped the readwrite grant (permission "prompt"). The provider renders the
 *   focused one-click "Reconnect <folder>" card instead of routing to /account.
 * - "mismatch": a stored handle exists but its recorded account does not match
 *   the signed-in account. Do NOT reconnect. Fall through to /account / picker.
 * - "none": no usable stored handle (absent, a fixture sentinel, or a browser
 *   without the permission API). Fall through to the normal entry flow.
 */
export type ReconnectIntentKind = "silent" | "lapsed" | "mismatch" | "none";

export interface ReconnectIntent {
  kind: ReconnectIntentKind;
  /** The stored folder's display name, present for silent / lapsed / mismatch so
   *  the one-click card and any copy can name the folder. */
  folderName?: string;
}

/** A FileSystemDirectoryHandle that may expose the permission API (Chrome/Edge). */
interface PermissionableHandle extends FileSystemDirectoryHandle {
  queryPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
}

/** The wiki-capture / demo fixture sentinel handle name. Never reconnectable. */
const FIXTURE_HANDLE_SENTINEL = "wiki-capture-fixture";

/**
 * PURE selector for the account-match gate, unit-tested directly. Given the
 * folder's recorded account fingerprint (or null when none was recorded) and the
 * current session fingerprint (or null when no identity is unlocked), decide
 * whether the recorded folder may be reconnected for this session.
 *
 * Rules:
 * - No recorded account on the folder: ALLOW. The folder was connected without
 *   an account (local-first) or before the field shipped; there is no binding to
 *   violate, so the silent / one-click reconnect proceeds as it always has.
 * - Recorded account present, no current session: ALLOW. The folder has an
 *   owner account but the visitor has not signed in (or the identity is locked).
 *   Reconnecting the local folder does not open it "as" a different account, and
 *   blocking here would strand a local-first reload behind a sign-in. The on-disk
 *   owner record + finishConnect's takeover detection remain the deeper guard.
 * - Recorded account present and equal to the session: ALLOW (the match case).
 * - Recorded account present and DIFFERENT from the session: DENY. A different
 *   person is signed in; never silently open the previous account's folder.
 */
export function accountGateAllowsReconnect(
  recordedFingerprint: string | null | undefined,
  sessionFingerprint: string | null,
): boolean {
  if (!recordedFingerprint) return true;
  if (!sessionFingerprint) return true;
  return recordedFingerprint === sessionFingerprint;
}

/**
 * Resolve the boot-time reconnect intent. Reads the stored handle + meta, queries
 * permission, and applies the account-match gate. Best-effort and never throws:
 * any read / permission failure resolves to "none" so the normal entry flow runs.
 *
 * Intended to be called from the provider's boot effect / entry chain. It does
 * NOT mutate any state or perform the reconnect itself.
 */
export async function resolveReconnectIntent(): Promise<ReconnectIntent> {
  let handle: FileSystemDirectoryHandle | null = null;
  try {
    handle = await getStoredDirectoryHandle();
  } catch {
    return { kind: "none" };
  }
  if (!handle || handle.name === FIXTURE_HANDLE_SENTINEL) {
    return { kind: "none" };
  }

  // Account-match gate. Read the folder->account binding and compare it to the
  // signed-in account. A mismatch reports "mismatch" so the entry chain routes to
  // /account / the picker instead of auto-opening the wrong person's folder.
  let recordedFingerprint: string | null | undefined = undefined;
  try {
    const meta = await getStoredDirectoryMeta();
    recordedFingerprint = meta?.accountFingerprint ?? null;
  } catch {
    recordedFingerprint = null;
  }
  const sessionFingerprint = currentAccountFingerprint();
  if (!accountGateAllowsReconnect(recordedFingerprint, sessionFingerprint)) {
    return { kind: "mismatch", folderName: handle.name };
  }

  // Permission probe. queryPermission is non-mutating and safe to call outside a
  // user gesture (unlike requestPermission). A browser without it cannot do a
  // silent reconnect, so report "none" and let the normal flow handle it.
  const permissionable = handle as PermissionableHandle;
  if (!permissionable.queryPermission) {
    return { kind: "none" };
  }
  try {
    const permission = await permissionable.queryPermission({ mode: "readwrite" });
    if (permission === "granted") {
      return { kind: "silent", folderName: handle.name };
    }
    // "prompt" (or, defensively, "denied"): the grant lapsed. A single Allow
    // re-grants it, so offer the one-click card rather than the generic picker.
    return { kind: "lapsed", folderName: handle.name };
  } catch {
    return { kind: "none" };
  }
}
