// Gentle, infrequent upgrade nudge for FREE users who reach a paid produce
// feature (send, co-edit, the companion app). Restraint is the whole point
// (Grant): only on a real user-initiated action, AT MOST once per cooldown,
// dismissible, never a banner or interrupt. It explains the feature the user
// just reached for, so it reads as helpful, not a sales pitch.
//
// Dormant until billing is live on the client (NEXT_PUBLIC_BILLING_LIVE), so it
// never fires during the free beta. The cooldown logic is pure and unit-tested;
// the store is localStorage, guarded for SSR.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** Minimum days between nudges. A few weeks, so it is rare and never nagging. */
export const NUDGE_COOLDOWN_DAYS = 21;

export const NUDGE_STORAGE_KEY = "researchos-upgrade-nudge-v1";

/** The produce feature the free user reached for. Drives the copy. */
export type NudgeFeature = "send" | "coedit" | "app";

export interface NudgeRecord {
  /** Epoch ms of the last time the nudge was shown. */
  lastShownMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pure: whether enough time has passed since the last nudge to show another. */
export function shouldShowNudge(
  now: number,
  record: NudgeRecord | null,
  cooldownDays: number = NUDGE_COOLDOWN_DAYS,
): boolean {
  if (!record) return true;
  return now - record.lastShownMs >= cooldownDays * DAY_MS;
}

/** Read the last-shown record from localStorage (null on SSR or if unset). */
export function readNudgeRecord(): NudgeRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NUDGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NudgeRecord;
    return typeof parsed?.lastShownMs === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function writeNudgeRecord(record: NudgeRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NUDGE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore (private mode / quota)
  }
}

// ---- tiny pub/sub so the mounted host renders when a trigger fires ----
type Listener = (feature: NudgeFeature) => void;
const listeners = new Set<Listener>();

export function subscribeUpgradeNudge(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the nudge is active at all (billing live on the client). Dormant in
 *  beta, so callers at produce-feature paywalls can fire freely without guarding. */
export function isUpgradeNudgeActive(): boolean {
  // Accept both "1" and "true" so the flag value never has to match exactly one
  // form, the WelcomePage check reads it the same way.
  const v = process.env.NEXT_PUBLIC_BILLING_LIVE;
  return v === "1" || v === "true";
}

/**
 * Call this at a paid produce-feature paywall when a FREE user reaches it (send,
 * co-edit, app pairing). Returns true if a nudge was shown. No-ops when dormant
 * (beta), on SSR, or inside the cooldown, so it is always safe to call and never
 * nags. It does NOT block the action; it only surfaces the upgrade.
 */
export function triggerUpgradeNudge(
  feature: NudgeFeature,
  now: number = Date.now(),
): boolean {
  if (!isUpgradeNudgeActive()) return false;
  if (typeof window === "undefined") return false;
  if (!shouldShowNudge(now, readNudgeRecord())) return false;
  writeNudgeRecord({ lastShownMs: now });
  listeners.forEach((l) => l(feature));
  return true;
}
