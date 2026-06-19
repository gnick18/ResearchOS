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
import { bytesToHex } from "@noble/hashes/utils.js";

// ---------------------------------------------------------------------------
// PURE LOGIC (unit-tested): merge, lift, PI resolution.
// ---------------------------------------------------------------------------

/**
 * The slice of UserSettings the account tier OVERRIDES. Phase 1 owned exactly the
 * lab-head capability; Phase 2 widens it to the account-wide preferences below.
 * Kept as a Partial so the merge stays additive and obviously bounded.
 */
export type AccountOverridableSettings = Pick<
  UserSettings,
  | "account_type"
  | "animationType"
  | "beakerBotAnimations"
  | "coloredHeader"
  | "dateFormat"
  | "timeFormat"
  | "professionalMode"
  | "showCompanionButton"
  | "autoPublishSnapshotsToPhones"
  | "notificationPreferences"
  | "displayName"
  | "preferredName"
  | "defaultLandingTab"
  | "visibleTabs"
>;

/**
 * Merge the account-scoped settings (cloud) OVER the folder-local settings
 * (settings.json defaults), producing the EFFECTIVE settings the folder runs
 * with. Pure and total, so it is the single source of truth for "which value
 * wins".
 *
 * Rule set:
 *   - account.labHead === true PROMOTES account_type to "lab_head" no matter
 *     what the folder said. This is the direct fix for opening a new empty
 *     folder (which lacks the marker) yet still being a PI. It is one-directional:
 *     the account capability can ELEVATE but never DEMOTE (a folder that locally
 *     marks lab_head is honored even if the account flag is unset/false), so a
 *     stale/empty account blob never strips a real PI of their folder role.
 *   - The account-WIDE PREFERENCES (appearance, formatting, professional mode,
 *     companion + notification prefs, display name) ELEVATE when present on the
 *     account blob, so a preference set in one folder follows the user to the
 *     next. A field ABSENT from the account blob leaves the folder value intact.
 *   - The NAV defaults (defaultLandingTab + visibleTabs) are account DEFAULTS the
 *     folder can OVERRIDE. They only apply when the folder is still at the system
 *     default (the folder never picked its own), so a class folder that set its
 *     own tab set keeps it. Detection of "folder picked its own" is supplied by
 *     the caller via folderNavIsDefault (the read path knows whether the folder
 *     settings.json carried explicit nav fields).
 *
 * Returns a new object; never mutates either input.
 */
export function mergeAccountOverFolder(
  folder: UserSettings,
  account: AccountScopedSettings | null,
  folderNavIsDefault?: { defaultLandingTab?: boolean; visibleTabs?: boolean },
): UserSettings {
  if (!account) return folder;
  const next: UserSettings = { ...folder };

  // Lab-head capability: ELEVATE only (Phase 1 rule, unchanged).
  if (account.labHead === true && next.account_type !== "lab_head") {
    next.account_type = "lab_head";
  }

  // Account-wide preferences: account value wins when the blob carries one.
  if (account.animationType !== undefined) {
    next.animationType = account.animationType as UserSettings["animationType"];
  }
  if (account.beakerBotAnimations !== undefined) {
    next.beakerBotAnimations = account.beakerBotAnimations;
  }
  if (account.coloredHeader !== undefined) {
    next.coloredHeader = account.coloredHeader;
  }
  if (account.dateFormat !== undefined) {
    next.dateFormat = account.dateFormat as UserSettings["dateFormat"];
  }
  if (account.timeFormat !== undefined) {
    next.timeFormat = account.timeFormat as UserSettings["timeFormat"];
  }
  if (account.professionalMode !== undefined) {
    next.professionalMode = account.professionalMode;
  }
  if (account.showCompanionButton !== undefined) {
    next.showCompanionButton = account.showCompanionButton;
  }
  if (account.autoPublishSnapshotsToPhones !== undefined) {
    next.autoPublishSnapshotsToPhones = account.autoPublishSnapshotsToPhones;
  }
  if (account.notificationPreferences !== undefined) {
    next.notificationPreferences =
      account.notificationPreferences as unknown as UserSettings["notificationPreferences"];
  }
  if (account.displayName !== undefined) {
    next.displayName = account.displayName;
  }
  if (account.preferredName !== undefined) {
    next.preferredName = account.preferredName;
  }

  // Nav defaults: account DEFAULT, folder OVERRIDE. Apply the account value only
  // when the folder is still at the system default for that field.
  if (
    account.defaultLandingTab !== undefined &&
    folderNavIsDefault?.defaultLandingTab === true
  ) {
    next.defaultLandingTab = account.defaultLandingTab;
  }
  if (
    account.visibleTabs !== undefined &&
    folderNavIsDefault?.visibleTabs === true
  ) {
    next.visibleTabs = [...account.visibleTabs];
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
 * The folder-side, account-SCOPABLE preference values the lift reads up into the
 * account blob. All optional, so the caller supplies only what the folder has.
 * These mirror the Phase 2 AccountScopedSettings preference fields (NOT research
 * data). `theme` comes from localStorage (per-device store), the rest from the
 * folder settings.json.
 */
export interface FolderAccountScopablePrefs {
  theme?: string;
  animationType?: string;
  beakerBotAnimations?: boolean;
  coloredHeader?: boolean;
  dateFormat?: string;
  timeFormat?: string;
  professionalMode?: boolean;
  showCompanionButton?: boolean;
  autoPublishSnapshotsToPhones?: boolean;
  notificationPreferences?: Record<string, unknown>;
  displayName?: string | null;
  preferredName?: string | null;
  defaultLandingTab?: string;
  visibleTabs?: string[];
}

/**
 * Build the account-scoped settings to LIFT out of a folder's current state on
 * first login (idempotent, non-destructive). Lifts:
 *   - the folder's enabled ICS calendar feeds (structurally copied),
 *   - the lab-head capability (true iff the folder marks the user lab_head), and
 *   - (Phase 2) the account-wide preferences in `folderPrefs` (appearance,
 *     formatting, professional mode, companion + notification prefs, display
 *     name, nav defaults), each seeded only when the account lacks it.
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
  folderPrefs: FolderAccountScopablePrefs = {},
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

  // Phase 2 account-wide preferences: seed each only when the account blob does
  // not already carry it (the existing account choice always wins). The folder
  // value is structurally copied so a later folder mutation cannot reach into the
  // account blob. A prefs field the caller did not supply (undefined) is skipped.
  seedIfAbsent(next, "theme", folderPrefs.theme);
  seedIfAbsent(next, "animationType", folderPrefs.animationType);
  seedIfAbsent(next, "beakerBotAnimations", folderPrefs.beakerBotAnimations);
  seedIfAbsent(next, "coloredHeader", folderPrefs.coloredHeader);
  seedIfAbsent(next, "dateFormat", folderPrefs.dateFormat);
  seedIfAbsent(next, "timeFormat", folderPrefs.timeFormat);
  seedIfAbsent(next, "professionalMode", folderPrefs.professionalMode);
  seedIfAbsent(next, "showCompanionButton", folderPrefs.showCompanionButton);
  seedIfAbsent(
    next,
    "autoPublishSnapshotsToPhones",
    folderPrefs.autoPublishSnapshotsToPhones,
  );
  seedIfAbsent(
    next,
    "notificationPreferences",
    folderPrefs.notificationPreferences
      ? structuredClone(folderPrefs.notificationPreferences)
      : undefined,
  );
  seedIfAbsent(next, "displayName", folderPrefs.displayName);
  seedIfAbsent(next, "preferredName", folderPrefs.preferredName);
  seedIfAbsent(next, "defaultLandingTab", folderPrefs.defaultLandingTab);
  seedIfAbsent(
    next,
    "visibleTabs",
    folderPrefs.visibleTabs ? [...folderPrefs.visibleTabs] : undefined,
  );

  return next;
}

/** Seed a single account-blob field from a folder value ONLY when the account
 *  blob does not already carry it and the folder value is present. Keeps the lift
 *  idempotent + non-destructive, one field at a time. */
function seedIfAbsent<K extends keyof AccountScopedSettings>(
  blob: AccountScopedSettings,
  key: K,
  folderValue: AccountScopedSettings[K] | undefined,
): void {
  if (blob[key] === undefined && folderValue !== undefined) {
    blob[key] = folderValue;
  }
}

/**
 * Does the folder hold ANY account-scopable setting that the account blob does
 * NOT already carry? This is the popup TRIGGER condition: when true (and the flag
 * is on), the lift-on-connect popup offers to add the folder's settings to the
 * cloud profile; when false (the account already has everything, or the folder
 * has nothing liftable), the popup never shows. Pure, so the trigger rule is
 * testable in isolation. Computed by running the lift and seeing whether it would
 * change the blob.
 */
export function folderHasLiftableSettings(
  existingAccount: AccountScopedSettings | null,
  folderFeeds: CalendarFeed[],
  folderAccountType: string | undefined,
  // Cosmetic preferences (theme, date format, etc.) are intentionally NOT part of
  // the trigger. Every folder's settings.json carries default prefs, so gating on
  // them made a fresh/near-empty folder prompt (the Owen misfire). Prefs still
  // ride along when the popup fires for a substantive reason, they just never
  // trigger it. Kept in the signature for caller symmetry.
  _folderPrefs: FolderAccountScopablePrefs = {},
): boolean {
  const account = existingAccount ?? {};

  // A real ICS calendar feed the account does not yet carry. The lift only seeds
  // calendarFeeds when the account has none, so a "new" feed means the account
  // has no feed list yet AND the folder brings at least one real ics feed.
  const folderHasRealFeeds = folderFeeds.some((f) => f.kind === "ics" && f.icsUrl);
  const bringsNewFeeds = folderHasRealFeeds && account.calendarFeeds === undefined;

  // A real lab-head capability the account has not recorded yet (never a downgrade).
  const bringsLabHead =
    folderAccountType === "lab_head" && account.labHead !== true;

  return bringsNewFeeds || bringsLabHead;
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
 * The unlocked identity, or null when none is unlocked in this session. Wrapped so
 * both the key material AND the cache owner-key derive from the SAME identity read.
 */
async function getUnlockedIdentityKeys(): Promise<{
  privateKey: Uint8Array;
  publicKey: Uint8Array;
} | null> {
  const stored = await loadIdentity();
  const enc = stored?.keys.encryption;
  if (!enc?.privateKey || !enc.publicKey) return null;
  return { privateKey: enc.privateKey, publicKey: enc.publicKey };
}

/**
 * The unlocked identity's X25519 encryption private key, the material the blob is
 * sealed to (account-settings-crypto.ts). Null when no identity is unlocked in
 * this session, in which case the account blob cannot be read or written and the
 * caller falls back to folder-local. Never returns a value the sharing layer did
 * not already hold in memory.
 */
async function getIdentityKeyMaterial(): Promise<Uint8Array | null> {
  return (await getUnlockedIdentityKeys())?.privateKey ?? null;
}

/**
 * A STABLE, non-secret per-account cache key derived from the identity's PUBLIC
 * encryption key. The public key is the same across every folder the account opens
 * and differs per account, so it is the right key to scope the session cache by.
 * Hex of the public key bytes; never the private key. Returns null when no identity
 * is unlocked.
 */
async function getIdentityOwnerKey(): Promise<string | null> {
  const keys = await getUnlockedIdentityKeys();
  if (!keys) return null;
  return bytesToHex(keys.publicKey);
}

// ---------------------------------------------------------------------------
// SESSION CACHE (the pre-flag-flip blocker fix).
//
// fetchAccountSettings decrypts + hits the network on EVERY call, and
// buildCurrentViewer (the hot sharing path) calls it. We memoize the decrypted
// blob for this session, KEYED BY the identity owner key (the public encryption
// key hex), so the cache can NEVER serve one user's settings to another: a
// different identity has a different owner key and misses the cache. The cache is
// populated on first fetch, served synchronously after, written through on
// writeAccountSettings, and cleared on logout / identity change / user switch.
//
// `settings` is stored as the decrypted blob OR null ("fetched, user has no
// blob"). `fetched` distinguishes "never fetched" from "fetched and empty" so a
// genuine no-blob account is not re-fetched on every viewer build.
// ---------------------------------------------------------------------------
interface AccountSettingsCacheEntry {
  ownerKey: string;
  fetched: boolean;
  settings: AccountScopedSettings | null;
}
let accountSettingsCache: AccountSettingsCacheEntry | null = null;

/**
 * Drop the in-memory account-settings cache. MUST be called on logout, identity
 * change, and user switch so a subsequent fetch re-reads for the (possibly
 * different) identity rather than serving the previous user's blob. Idempotent and
 * safe to call when the cache is already empty. Exported so the logout / user
 * switch hooks in local-api can clear it alongside clearCurrentUserCache.
 */
export function clearAccountSettingsCache(): void {
  accountSettingsCache = null;
}

/**
 * The decrypted account settings already cached for the CURRENT identity, or
 * null when nothing is cached for it. Synchronous, so a hot caller that has
 * already warmed the cache can read account defaults without an await. The caller
 * supplies the current owner key (the identity public-key hex) so this never
 * returns a stale OTHER-identity entry. Returns null on an owner-key mismatch,
 * which forces the async path to re-fetch + re-key for the new identity.
 */
export function getCachedAccountSettingsFor(
  ownerKey: string | null,
): AccountScopedSettings | null {
  if (!ownerKey) return null;
  if (!accountSettingsCache || accountSettingsCache.ownerKey !== ownerKey) {
    return null;
  }
  return accountSettingsCache.settings;
}

/**
 * Fetch + decrypt the caller's account-scoped settings, MEMOIZED per identity for
 * the session. Returns null (a clean "no account settings, use folder-local")
 * when:
 *   - the flag is off (the IO never fires),
 *   - no identity is unlocked,
 *   - the API 404s / errors,
 *   - the user has no stored blob yet.
 * Any decrypt failure is swallowed to null so a corrupt/foreign blob can never
 * break login; the caller proceeds folder-local.
 *
 * CACHE: the first call for an identity hits the network + decrypts and caches the
 * result keyed by the identity owner key; subsequent calls for the SAME identity
 * return the cached value without any network or crypto. A call for a DIFFERENT
 * identity (the owner key changed, e.g. a user switch the logout hook missed)
 * misses the cache, re-fetches, and re-keys, so the cache can never cross users.
 */
export async function fetchAccountSettings(): Promise<AccountScopedSettings | null> {
  if (!isAccountSettingsEnabled()) return null;
  const keys = await getUnlockedIdentityKeys();
  if (!keys) return null;
  const ownerKey = bytesToHex(keys.publicKey);

  // Cache hit for THIS identity: serve without network or decrypt.
  if (accountSettingsCache && accountSettingsCache.ownerKey === ownerKey) {
    return accountSettingsCache.settings;
  }

  let settings: AccountScopedSettings | null = null;
  try {
    const res = await fetch(ACCOUNT_SETTINGS_ENDPOINT, { method: "GET" });
    if (res.ok) {
      const body = (await res.json()) as { ciphertext?: string | null };
      if (body.ciphertext) {
        settings = decryptAccountBlob(body.ciphertext, keys.privateKey);
      }
    }
  } catch {
    // Network / decrypt failure: fall through to a null cache entry so the hot
    // path does not re-attempt on every viewer build within the session. A write
    // (write-through) or an identity change still refreshes it.
    settings = null;
  }

  accountSettingsCache = { ownerKey, fetched: true, settings };
  return settings;
}

/**
 * Encrypt + write back the account-scoped settings. No-op (returns false) when
 * the flag is off or no identity is unlocked, so a folder-local-only session
 * never writes. Returns true on a successful store.
 *
 * WRITE-THROUGH: on a successful store the session cache is updated to the
 * just-written blob (keyed by the current identity), so a fetch right after a
 * write returns the new value without a round trip. A failed write leaves the
 * cache untouched (the stored value is unchanged).
 */
export async function writeAccountSettings(
  settings: AccountScopedSettings,
): Promise<boolean> {
  if (!isAccountSettingsEnabled()) return false;
  const keys = await getUnlockedIdentityKeys();
  if (!keys) return false;
  try {
    const ciphertext = encryptAccountBlob(settings, keys.privateKey);
    const res = await fetch(ACCOUNT_SETTINGS_ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ciphertext, blobVersion: ACCOUNT_BLOB_VERSION }),
    });
    if (res.ok) {
      // Write-through: the cache now holds the value we just persisted, keyed by
      // this identity. A structural copy so a later mutation of the caller's
      // object cannot reach into the cache.
      accountSettingsCache = {
        ownerKey: bytesToHex(keys.publicKey),
        fetched: true,
        settings: structuredClone(settings),
      };
    }
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
 * into the account blob (calendar feeds + the lab-head capability + the Phase 2
 * preferences in `folderPrefs`). Reads the current account blob (served from the
 * session cache when warm), lifts non-destructively (liftFolderIntoAccount), and
 * writes back ONLY if something new was added (the write is write-through, so the
 * cache reflects the lift immediately). No-op when the flag is off or no identity
 * is unlocked. Returns the (possibly unchanged) account blob so a caller can use
 * it immediately for the merge.
 */
export async function liftFolderSettingsOnLogin(
  folderFeeds: CalendarFeed[],
  folderAccountType: string | undefined,
  folderPrefs: FolderAccountScopablePrefs = {},
): Promise<AccountScopedSettings | null> {
  if (!isAccountSettingsEnabled()) return null;
  const existing = await fetchAccountSettings();
  const next = liftFolderIntoAccount(
    existing,
    folderFeeds,
    folderAccountType,
    folderPrefs,
  );
  if (!accountBlobsEqual(existing, next)) {
    await writeAccountSettings(next);
  }
  return next;
}

/**
 * The current identity's stable owner key (the encryption public-key hex), or
 * null when no identity is unlocked. Exposed so a synchronous cache reader
 * (getCachedAccountSettingsFor) and the popup-trigger path can key by the same
 * identity the fetch / write use. Never returns secret material.
 */
export async function currentIdentityOwnerKey(): Promise<string | null> {
  return getIdentityOwnerKey();
}
