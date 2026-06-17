// Account-scoped settings, the client module (Phase 1).
//
// The orchestration on the BROWSER side: on login, fetch the E2E ciphertext from
// /api/account/settings and decrypt it with the identity key (the server never
// sees plaintext); on change, re-encrypt and write back (debounced). The
// EFFECTIVE settings a folder runs with are the account-scoped fields (cloud)
// merged OVER the folder-local settings.json defaults.
//
// Phase 1 keeps the account-scoped field set TIGHT, just two fields:
//   - external calendar feed subscriptions (Owen Sullivan's exact case), and
//   - the lab-head / PI CAPABILITY.
// Phase 2 adds the rest (theme, animations, AI prefs, notifications, tabs).
//
// The PURE logic (merge, lift, PI resolution) is separated out and unit-tested.
// The IO (identity key access, fetch, debounce) is a thin wrapper around it and
// is guarded by the flag, so when the flag is off this module never touches the
// network and the caller uses folder-local only.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { CalendarFeed } from "@/lib/types";
import type { UserSettings } from "@/lib/settings/user-settings";
import {
  type AccountCalendarFeed,
  type AccountScopedSettings,
  ACCOUNT_BLOB_VERSION,
  decryptAccountBlob,
  encryptAccountBlob,
} from "./account-settings-crypto";
import { isAccountSettingsEnabled } from "./account-settings-config";
import { loadIdentity } from "@/lib/sharing/identity/storage";

// ---------------------------------------------------------------------------
// PURE LOGIC (unit-tested): merge, lift, PI resolution.
// ---------------------------------------------------------------------------

/**
 * The slice of UserSettings the account tier OVERRIDES. Phase 1 owns exactly the
 * lab-head capability (as account_type) of the folder settings shape. Kept as a
 * Partial so the merge stays additive and obviously bounded.
 */
export type AccountOverridableSettings = Pick<UserSettings, "account_type">;

/**
 * Merge the account-scoped settings (cloud) OVER the folder-local settings
 * (settings.json defaults), producing the EFFECTIVE settings the folder runs
 * with. Pure and total, so it is the single source of truth for "which value
 * wins".
 *
 * Phase 1 rule set:
 *   - account.labHead === true PROMOTES account_type to "lab_head" no matter
 *     what the folder said. This is the direct fix for opening a new empty
 *     folder (which lacks the marker) yet still being a PI. It is one-directional:
 *     the account capability can ELEVATE but never DEMOTE (a folder that locally
 *     marks lab_head is honored even if the account flag is unset/false), so a
 *     stale/empty account blob never strips a real PI of their folder role.
 *
 * Everything else passes the folder value through untouched (Phase 2 widens the
 * field set). Returns a new object; never mutates either input.
 */
export function mergeAccountOverFolder(
  folder: UserSettings,
  account: AccountScopedSettings | null,
): UserSettings {
  if (!account) return folder;
  const next: UserSettings = { ...folder };
  if (account.labHead === true && next.account_type !== "lab_head") {
    next.account_type = "lab_head";
  }
  return next;
}

/**
 * Resolve whether the viewer is a PI / lab head, consulting BOTH the per-folder
 * setting AND the account capability. Returns true if EITHER says so. This is the
 * surgical hook the viewer build + the login-screen scan use so a PI is
 * recognized regardless of which folder they open.
 *
 * Pure, so the resolution rule is testable in isolation: account capability OR
 * folder marker. Either being true is sufficient; the account can only add a
 * recognition, never remove one.
 */
export function resolveIsLabHead(
  folderAccountType: string | undefined,
  accountLabHead: boolean | undefined,
): boolean {
  return folderAccountType === "lab_head" || accountLabHead === true;
}

/**
 * Build the account-scoped settings to LIFT out of a folder's current state on
 * first login (idempotent, non-destructive). Phase 1 lifts the two fields:
 *   - the folder's enabled ICS calendar feeds (structurally copied), and
 *   - the lab-head capability (true iff the folder marks the user lab_head).
 *
 * IDEMPOTENT + NON-DESTRUCTIVE: if the account blob ALREADY carries a value for a
 * field, the existing account value WINS (we never overwrite the user's account
 * choice with a folder value on a second login). The folder copy is left in
 * place as a fallback; lifting only POPULATES the account blob, it does not
 * delete from the folder. Returns the NEXT account blob (or the same shape when
 * nothing new is liftable, so the caller can skip the write).
 */
export function liftFolderIntoAccount(
  existingAccount: AccountScopedSettings | null,
  folderFeeds: CalendarFeed[],
  folderAccountType: string | undefined,
): AccountScopedSettings {
  const next: AccountScopedSettings = { ...(existingAccount ?? {}) };

  // calendarFeeds: only seed when the account has none yet (idempotent). An
  // existing account list (even an empty array, a deliberate "no feeds" choice)
  // is left untouched.
  if (next.calendarFeeds === undefined) {
    const lifted = folderFeeds
      .filter((f) => f.kind === "ics" && f.icsUrl)
      .map(
        (f): AccountCalendarFeed => ({
          id: f.id,
          provider: f.provider,
          label: f.label,
          icsUrl: f.icsUrl as string,
          color: f.color,
          enabled: f.enabled,
        }),
      );
    // Only attach the field when the folder actually had feeds, so a folder with
    // no feeds does not lock the account into an empty "already lifted" state and
    // a later folder's feeds can still seed it.
    if (lifted.length > 0) next.calendarFeeds = lifted;
  }

  // labHead: seed true when the folder marks the user as a lab head and the
  // account has not yet recorded the capability. Never DOWNGRADE an existing
  // account true to false from a folder that happens to lack the marker (that is
  // exactly the Owen bug, the lift must not reintroduce it).
  if (next.labHead !== true && folderAccountType === "lab_head") {
    next.labHead = true;
  }

  return next;
}

/** Are two account blobs equal for the purpose of skipping a redundant write?
 *  A shallow structural compare of the Phase 1 fields. Pure. */
export function accountBlobsEqual(
  a: AccountScopedSettings | null,
  b: AccountScopedSettings | null,
): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

// ---------------------------------------------------------------------------
// IO WRAPPER (flag-guarded): identity key access, fetch, write-back.
// ---------------------------------------------------------------------------

const ACCOUNT_SETTINGS_ENDPOINT = "/api/account/settings";

/**
 * The unlocked identity's X25519 encryption private key, the material the blob is
 * sealed to (account-settings-crypto.ts). Null when no identity is unlocked in
 * this session, in which case the account blob cannot be read or written and the
 * caller falls back to folder-local. Never returns a value the sharing layer did
 * not already hold in memory.
 */
async function getIdentityKeyMaterial(): Promise<Uint8Array | null> {
  const stored = await loadIdentity();
  return stored?.keys.encryption.privateKey ?? null;
}

/**
 * Fetch + decrypt the caller's account-scoped settings. Returns null (a clean
 * "no account settings, use folder-local") when:
 *   - the flag is off (the IO never fires),
 *   - no identity is unlocked,
 *   - the API 404s / errors,
 *   - the user has no stored blob yet.
 * Any decrypt failure is swallowed to null so a corrupt/foreign blob can never
 * break login; the caller proceeds folder-local.
 */
export async function fetchAccountSettings(): Promise<AccountScopedSettings | null> {
  if (!isAccountSettingsEnabled()) return null;
  const keyMaterial = await getIdentityKeyMaterial();
  if (!keyMaterial) return null;
  try {
    const res = await fetch(ACCOUNT_SETTINGS_ENDPOINT, { method: "GET" });
    if (!res.ok) return null;
    const body = (await res.json()) as { ciphertext?: string | null };
    if (!body.ciphertext) return null;
    return decryptAccountBlob(body.ciphertext, keyMaterial);
  } catch {
    return null;
  }
}

/**
 * Encrypt + write back the account-scoped settings. No-op (returns false) when
 * the flag is off or no identity is unlocked, so a folder-local-only session
 * never writes. Returns true on a successful store.
 */
export async function writeAccountSettings(
  settings: AccountScopedSettings,
): Promise<boolean> {
  if (!isAccountSettingsEnabled()) return false;
  const keyMaterial = await getIdentityKeyMaterial();
  if (!keyMaterial) return false;
  try {
    const ciphertext = encryptAccountBlob(settings, keyMaterial);
    const res = await fetch(ACCOUNT_SETTINGS_ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ciphertext, blobVersion: ACCOUNT_BLOB_VERSION }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Debounce so a burst of changes coalesces into one encrypted write. Per-process
// (one signed-in user per tab), so a single timer is enough.
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSettings: AccountScopedSettings | null = null;
const DEFAULT_WRITE_DEBOUNCE_MS = 800;

/**
 * Queue an encrypted write-back, coalescing rapid changes. The LATEST settings
 * win. No-op when the flag is off. Exposed so the settings UI (Phase 2) and the
 * lift path can both nudge a save without each managing a timer.
 */
export function scheduleAccountSettingsWrite(
  settings: AccountScopedSettings,
  debounceMs: number = DEFAULT_WRITE_DEBOUNCE_MS,
): void {
  if (!isAccountSettingsEnabled()) return;
  pendingSettings = settings;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const toWrite = pendingSettings;
    pendingSettings = null;
    if (toWrite) void writeAccountSettings(toWrite);
  }, debounceMs);
}

/**
 * One-time, idempotent first-login lift of a folder's account-scoped fields up
 * into the account blob (calendar feeds + the lab-head capability). Reads the
 * current account blob, lifts non-destructively (liftFolderIntoAccount), and
 * writes back ONLY if something new was added. No-op when the flag is off or no
 * identity is unlocked. Returns the (possibly unchanged) account blob so a caller
 * can use it immediately for the merge.
 */
export async function liftFolderSettingsOnLogin(
  folderFeeds: CalendarFeed[],
  folderAccountType: string | undefined,
): Promise<AccountScopedSettings | null> {
  if (!isAccountSettingsEnabled()) return null;
  const existing = await fetchAccountSettings();
  const next = liftFolderIntoAccount(existing, folderFeeds, folderAccountType);
  if (!accountBlobsEqual(existing, next)) {
    await writeAccountSettings(next);
  }
  return next;
}
