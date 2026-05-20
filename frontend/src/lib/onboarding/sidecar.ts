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
 *  - v2 (2026-05-14): adds `mode`. Welcome-modal pick:
 *    `tutorial | suggestions | silenced | null`. `null` = the user has
 *    not picked yet → the orchestrator blocks tips and shows the welcome
 *    modal instead. Defaulted to `null` on read so any legacy v1 sidecar
 *    re-triggers the welcome modal once.
 *  - v3 (2026-05-20): adds the Onboarding v2 wizard fields, all additive
 *    and defaulted to `null`: `use_cases` (the picks from the 9-option
 *    use-case wizard, or `null` if the wizard hasn't run for this user),
 *    `wizard_completed_at` (ISO timestamp of Continue on step 7), and
 *    `wizard_skipped_at` (ISO timestamp if the persistent Skip link was
 *    used). The two timestamps are mutually exclusive. v2 records
 *    normalize cleanly: existing `mode` / `tips` / `tips_off` /
 *    `shown_count` / `active_seconds` / `last_tip_at` / `first_seen_at`
 *    are preserved untouched, the three new fields backfill to `null`.
 */

const SCHEMA_VERSION = 3;

/** Per-tip outcome enum. `action-cancel` is the no-fire case: the user
 *  did the thing the tip would have explained before the tip fired, so
 *  we mark it served without ever showing it. */
export type TipOutcome =
  | "x"
  | "later"
  | "got-it"
  | "read"
  | "action-cancel";

/** Welcome-modal pick. `null` = not picked yet (orchestrator shows the
 *  modal and blocks tips). */
export type OnboardingMode = "tutorial" | "suggestions" | "silenced" | null;

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
   *  action-cancel records). Secondary off-switch. */
  shown_count: number;
  /** Welcome-modal pick. `null` = the user has not picked yet, so the
   *  orchestrator blocks tips and renders the welcome modal. */
  mode: OnboardingMode;
  /** Use cases the user selected in the v2 wizard. `null` = wizard
   *  not yet run (or user is migrated from v1/v2 with no wizard pick).
   *  `[]` = wizard run and submitted with no picks (treat as "show
   *  all tabs"). Specific ids = picked use cases. See
   *  `use-case-tab-mapping.ts` for the canonical id list. */
  use_cases: string[] | null;
  /** ISO timestamp of wizard completion (Continue on step 7).
   *  Mutually exclusive with `wizard_skipped_at`. */
  wizard_completed_at: string | null;
  /** ISO timestamp of wizard skip (persistent Skip link). Mutually
   *  exclusive with `wizard_completed_at`. */
  wizard_skipped_at: string | null;
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
    mode: null,
    use_cases: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
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
  const rawMode = (raw as { mode?: unknown }).mode;
  const mode: OnboardingMode =
    rawMode === "tutorial" ||
    rawMode === "suggestions" ||
    rawMode === "silenced"
      ? rawMode
      : null;
  // v3 wizard fields. All three are additive on a v2 record — defended
  // to `null` if missing or malformed so a legacy v2 sidecar reads
  // cleanly without clobbering its other fields.
  const rawUseCases = (raw as { use_cases?: unknown }).use_cases;
  const use_cases: string[] | null =
    Array.isArray(rawUseCases) &&
    rawUseCases.every((id) => typeof id === "string")
      ? (rawUseCases as string[])
      : null;
  const rawCompleted = (raw as { wizard_completed_at?: unknown })
    .wizard_completed_at;
  const wizard_completed_at: string | null =
    typeof rawCompleted === "string" ? rawCompleted : null;
  const rawSkipped = (raw as { wizard_skipped_at?: unknown })
    .wizard_skipped_at;
  const wizard_skipped_at: string | null =
    typeof rawSkipped === "string" ? rawSkipped : null;
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
      typeof raw.last_tip_at === "number"
        ? raw.last_tip_at
        : 0,
    tips,
    tips_off: raw.tips_off === true,
    shown_count:
      typeof raw.shown_count === "number" && raw.shown_count >= 0
        ? raw.shown_count
        : 0,
    mode,
    use_cases,
    wizard_completed_at,
    wizard_skipped_at,
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
 *  `first_seen_at`, `active_seconds`, and `mode` in place — the
 *  freshness taper still applies and the user's mode pick is preserved
 *  (the welcome modal does NOT re-fire on replay). */
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

/** Persist a new onboarding mode pick. After picking, the user
 *  should see the FIRST tip immediately (subject to route-dwell +
 *  target-in-DOM gates) rather than waiting a full cooldown. To
 *  satisfy the orchestrator's `now - last_tip_at >= minGap`
 *  predicate at the moment of pick, this sets `last_tip_at` to
 *  `active_seconds - 999999` (a sentinel that's effectively
 *  -infinity for any sensible minGap). Subsequent tips obey the
 *  real cooldown because `recordShown()` bumps `last_tip_at` to
 *  the current `active_seconds` on each fire.
 *
 *  Also flips `tips_off` off — picking a non-silenced mode after
 *  silenced should unstick the global off-switch. */
export async function setOnboardingMode(
  username: string,
  mode: OnboardingMode,
): Promise<OnboardingSidecar> {
  return patchOnboarding(username, (cur) => ({
    ...cur,
    mode,
    last_tip_at: cur.active_seconds - 999_999,
    tips_off: mode === "silenced" ? cur.tips_off : false,
  }));
}
