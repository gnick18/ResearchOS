import { fileService } from "@/lib/file-system/file-service";

/**
 * Per-user tutorial-state sidecar at `users/<u>/_telegram_tutorial.json`.
 *
 * Mirrors `_telegram.json` shape (single read/write helper, lazy default
 * on missing file, normalize-on-read for forward-compat). Decoupled from
 * `_telegram.json` because the tutorial flag is policy state, not bot
 * credentials, and the two have very different write cadences (the
 * pairing file is written once at pair time; the tutorial file flips on
 * the first-photo step mount and off on advance / skip / End).
 *
 * The polling tab reads this on every `routeTelegramMessage` invocation
 * to decide whether the bot's per-photo reply uses tutorial copy. The
 * tutorial sequencer (running in the demo tab) writes it on first-photo
 * step mount and clears on the user advancing past, skipping, or ending.
 *
 * Why a sidecar (not localStorage): a user might run the demo tutorial
 * in one browser and have their real ResearchOS folder open in another
 * (Chrome at work, Safari at home, etc.). The polling tab needs to see
 * the flag regardless of which browser opened the tutorial. Sidecar
 * lives in the user's data folder; both tabs read the same disk.
 */

const SCHEMA_VERSION = 1;

/** Active step the user is currently on inside the guided tour. Today
 *  only `"first-photo"` is meaningful (the photo-arrival step). Future
 *  expansion would add more steps without changing the on-disk format. */
export type TelegramTutorialStep = "first-photo";

export interface TelegramTutorialState {
  version: number;
  /** Whether the tutorial is currently active. When false, the bot
   *  ignores `active_step` and falls through to its normal per-photo
   *  reply copy. */
  tutorial_active: boolean;
  /** Which step the tutorial is on. `null` whenever `tutorial_active`
   *  is false. */
  active_step: TelegramTutorialStep | null;
  /** ISO timestamp of when the active step started. Used by the polling
   *  tab to apply a soft TTL (defensive, in case the sequencer crashes
   *  before clearing). Cleared when `tutorial_active` flips to false. */
  active_since: string | null;
}

function tutorialPath(username: string): string {
  return `users/${username}/_telegram_tutorial.json`;
}

function makeDefault(): TelegramTutorialState {
  return {
    version: SCHEMA_VERSION,
    tutorial_active: false,
    active_step: null,
    active_since: null,
  };
}

/** Forward-compat normalizer. Treats unrecognized `active_step` values
 *  as null (mirrors `sidecar.ts:normalize`). Returns the default shape
 *  when the file is missing or malformed. */
function normalize(raw: Partial<TelegramTutorialState> | null): TelegramTutorialState {
  if (!raw) return makeDefault();
  const tutorialActive = raw.tutorial_active === true;
  const rawStep = (raw as { active_step?: unknown }).active_step;
  const activeStep: TelegramTutorialStep | null =
    rawStep === "first-photo" ? "first-photo" : null;
  const activeSince =
    typeof raw.active_since === "string" ? raw.active_since : null;
  return {
    version: SCHEMA_VERSION,
    // If the flag is off, force the step + timestamp to null so a stale
    // step value can't bleed through. The sequencer always writes both
    // together but a partial write from a future build shouldn't trip
    // the polling tab.
    tutorial_active: tutorialActive,
    active_step: tutorialActive ? activeStep : null,
    active_since: tutorialActive ? activeSince : null,
  };
}

/** Read the user's tutorial sidecar. Returns the default (everything
 *  off) if the file is missing. Does NOT persist the default; that
 *  happens lazily on the first write so a tab that only reads (the
 *  polling loop on every photo) doesn't dirty the folder. */
export async function readTelegramTutorial(
  username: string,
): Promise<TelegramTutorialState> {
  const raw = await fileService.readJson<Partial<TelegramTutorialState>>(
    tutorialPath(username),
  );
  return normalize(raw);
}

/** Persist the full tutorial state. Always re-writes `version` to the
 *  current schema so a future migration sees a known starting point. */
export async function writeTelegramTutorial(
  username: string,
  state: TelegramTutorialState,
): Promise<void> {
  await fileService.writeJson(tutorialPath(username), {
    ...state,
    version: SCHEMA_VERSION,
  });
}

/** Convenience: flip the tutorial on at a given step. Stamps
 *  `active_since` with the current ISO time. */
export async function startTelegramTutorialStep(
  username: string,
  step: TelegramTutorialStep,
): Promise<TelegramTutorialState> {
  const next: TelegramTutorialState = {
    version: SCHEMA_VERSION,
    tutorial_active: true,
    active_step: step,
    active_since: new Date().toISOString(),
  };
  await writeTelegramTutorial(username, next);
  return next;
}

/** Convenience: flip the tutorial off, clearing step + timestamp.
 *  Idempotent (writes the default shape every time). */
export async function clearTelegramTutorial(
  username: string,
): Promise<TelegramTutorialState> {
  const next = makeDefault();
  await writeTelegramTutorial(username, next);
  return next;
}
