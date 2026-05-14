import { fileService } from "@/lib/file-system/file-service";

/**
 * Per-user onboarding sidecar at `users/<u>/_onboarding.json`.
 *
 * Mirrors `_telegram.json` / `_calendar-feeds.json` / `_labarchives.json` —
 * one JSON blob per user that captures whether this user has seen the
 * brand-new tip set, how much active engagement she has accumulated, and
 * which tips have been dismissed. The "brand-new" bit lives here (not in
 * `localStorage`) so a user who opens the same folder from a second
 * machine inherits her dismissal history — see proposal §"What
 * brand-new means here".
 *
 * Schema history:
 *  - v1 (2026-05-14): initial. active_seconds + last_tip_at + tips map +
 *    tips_off + shown_count.
 */

const SCHEMA_VERSION = 1;

/** Per-tip outcome enum. `action-cancel` is the no-fire case: the user
 *  did the thing the tip would have explained before the tip fired, so
 *  we mark it served without ever showing it. */
export type TipOutcome =
  | "x"
  | "later"
  | "got-it"
  | "read"
  | "action-cancel";

export interface TipRecord {
  shown_at: string | null;
  dismissed_at: string | null;
  outcome: TipOutcome;
}

export interface OnboardingSidecar {
  version: number;
  /** ISO timestamp of the first time THIS USER opened this folder under a
   *  build that had the onboarding system. Pure record-keeping. */
  first_seen_at: string;
  /** Total wall-clock seconds the user has spent with at least one
   *  ResearchOS tab visible-and-focused. See active-time.ts. */
  active_seconds: number;
  /** Last time any tip was successfully shown to this user, in
   *  active-seconds (not wall-clock). */
  last_tip_at: number;
  /** Per-tip dismissal record, keyed by tip id. */
  tips: Record<string, TipRecord>;
  /** Global off-switch. Sticky per-user; reset via Settings → Tips
   *  replay button. */
  tips_off: boolean;
  /** Total tips successfully displayed to this user (not counting
   *  action-cancel records). Secondary off-switch at 10. */
  shown_count: number;
}

function sidecarPath(username: string): string {
  return `users/${username}/_onboarding.json`;
}

function makeDefault(): OnboardingSidecar {
  return {
    version: SCHEMA_VERSION,
    first_seen_at: new Date().toISOString(),
    active_seconds: 0,
    last_tip_at: 0,
    tips: {},
    tips_off: false,
    shown_count: 0,
  };
}

/** Back-fill missing fields on records written by older builds. Defensive
 *  — every field defaults to the value a fresh sidecar would carry. */
function normalize(raw: Partial<OnboardingSidecar> | null): OnboardingSidecar {
  if (!raw) return makeDefault();
  const tips: Record<string, TipRecord> = {};
  if (raw.tips && typeof raw.tips === "object") {
    for (const [id, rec] of Object.entries(raw.tips)) {
      if (!rec || typeof rec !== "object") continue;
      const r = rec as Partial<TipRecord>;
      tips[id] = {
        shown_at: typeof r.shown_at === "string" ? r.shown_at : null,
        dismissed_at: typeof r.dismissed_at === "string" ? r.dismissed_at : null,
        outcome: ((): TipOutcome => {
          const o = r.outcome;
          if (
            o === "x" ||
            o === "later" ||
            o === "got-it" ||
            o === "read" ||
            o === "action-cancel"
          ) {
            return o;
          }
          return "x";
        })(),
      };
    }
  }
  return {
    version: SCHEMA_VERSION,
    first_seen_at:
      typeof raw.first_seen_at === "string"
        ? raw.first_seen_at
        : new Date().toISOString(),
    active_seconds:
      typeof raw.active_seconds === "number" && raw.active_seconds >= 0
        ? raw.active_seconds
        : 0,
    last_tip_at:
      typeof raw.last_tip_at === "number" && raw.last_tip_at >= 0
        ? raw.last_tip_at
        : 0,
    tips,
    tips_off: raw.tips_off === true,
    shown_count:
      typeof raw.shown_count === "number" && raw.shown_count >= 0
        ? raw.shown_count
        : 0,
  };
}

/** Read the user's onboarding sidecar. Returns a freshly-defaulted
 *  record if the file is missing — callers shouldn't have to special-
 *  case the first-read. Does NOT persist the default; that happens
 *  lazily on the first `writeOnboarding()` so a tab that only reads
 *  (e.g. wiki-only browsing) doesn't dirty the folder. */
export async function readOnboarding(
  username: string,
): Promise<OnboardingSidecar> {
  const raw = await fileService.readJson<Partial<OnboardingSidecar>>(
    sidecarPath(username),
  );
  return normalize(raw);
}

/** Persist the full sidecar. Callers should pass the complete object;
 *  partial updates happen via `patchOnboarding()`. */
export async function writeOnboarding(
  username: string,
  data: OnboardingSidecar,
): Promise<void> {
  await fileService.writeJson(sidecarPath(username), {
    ...data,
    version: SCHEMA_VERSION,
  });
}

/** Read-modify-write helper. The `patch` callback receives the current
 *  sidecar (or a default) and returns the next one. Single I/O cycle
 *  per call; safe for the orchestrator's flush-on-tick pattern. */
export async function patchOnboarding(
  username: string,
  patch: (current: OnboardingSidecar) => OnboardingSidecar,
): Promise<OnboardingSidecar> {
  const current = await readOnboarding(username);
  const next = patch(current);
  await writeOnboarding(username, next);
  return next;
}

/** Reset state for the Settings "Replay onboarding tips" button. Clears
 *  the `tips` map, flips `tips_off` off, and resets `last_tip_at` to
 *  the current `active_seconds` so the cooldown starts fresh. Leaves
 *  `first_seen_at` and `active_seconds` in place — the freshness taper
 *  still applies. */
export async function replayOnboarding(
  username: string,
): Promise<OnboardingSidecar> {
  return patchOnboarding(username, (cur) => ({
    ...cur,
    tips: {},
    tips_off: false,
    last_tip_at: cur.active_seconds,
    shown_count: 0,
  }));
}
