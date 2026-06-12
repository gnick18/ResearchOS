// BeakerBot review mode (ai review-mode bot, 2026-06-12).
//
// Replaces the old ask/auto autonomy store. There is no silent unattended mode
// anymore. The per-user choice is now HOW BeakerBot shows its work, with two
// modes.
//   - "step" (the DEFAULT, the most transparent). Every meaningful step shows
//     its own preview-and-confirm block and waits for the user to approve before
//     it runs. Both action tools (write_note, transforms) and the run-immediately
//     analysis/plot tools (marked previewable) gate in this mode, so "approve
//     each step" is finally true end to end.
//   - "plan". The model proposes the whole pipeline up front, the user confirms
//     once, then every step runs start to finish without per-step interruption.
//     A lone single-step request is just a one-line plan. The instant
//     analysis/plot tools run free in this mode, preserving today's behavior.
//
// In both modes the destructive / outward-facing hard-stop still fires its own
// final confirm at the moment it runs (delete, send, share, pay), in the agent
// loop gate. Choosing a review mode never removes that.
//
// Why a tiny zustand store with localStorage, not the file-backed user-settings.
// The agent loop runs OUTSIDE React (the tool dispatch is a plain async call),
// so it needs to read the current mode synchronously without a hook and without
// a folder read. A localStorage-mirrored store gives both, a hook for the header
// control and a plain getter the loop calls.
//
// Persistence is per-browser-profile (localStorage), the right grain for a UI
// transparency preference. Default is "step" whenever the stored value is missing
// or has been hand-edited to something unknown, so a corrupted value can never
// silently widen to whole-plan running.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { create } from "zustand";

export type BeakerBotReviewMode = "step" | "plan";

// The default the whole feature falls back to. MUST be "step", the most
// transparent mode, so a fresh user (and any unreadable stored value) always
// reviews every step rather than running a whole plan unattended.
export const DEFAULT_REVIEW_MODE: BeakerBotReviewMode = "step";

// The localStorage key. Namespaced like the editor prefs (ros.*) so it is easy
// to spot and clear.
const STORAGE_KEY = "ros.beakerbot.reviewMode";

/** Coerce an arbitrary stored value to a legal review mode, falling back to the
 *  safe default for anything unknown. So a hand-edited or stale value can never
 *  silently widen to whole-plan running. */
function coerce(value: string | null | undefined): BeakerBotReviewMode {
  return value === "plan" ? "plan" : DEFAULT_REVIEW_MODE;
}

/** Read the persisted mode synchronously, defaulting to "step". SSR-safe (no
 *  window means the default). Used to seed the store on first load. */
function readPersisted(): BeakerBotReviewMode {
  if (typeof window === "undefined") return DEFAULT_REVIEW_MODE;
  try {
    return coerce(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // localStorage can throw in locked-down privacy modes, fall back safely.
    return DEFAULT_REVIEW_MODE;
  }
}

function writePersisted(mode: BeakerBotReviewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Best-effort, a failed persist just means the choice does not survive a
    // reload. Never throw out of a setter.
  }
}

interface ReviewModeStore {
  /** The current review mode. Seeded from localStorage, defaults to "step". */
  mode: BeakerBotReviewMode;
  /** Set the mode and persist it. */
  setMode: (mode: BeakerBotReviewMode) => void;
  /** Flip step <-> plan. The header control calls this. */
  toggle: () => void;
}

export const useBeakerBotReviewMode = create<ReviewModeStore>((set, get) => ({
  mode: readPersisted(),
  setMode: (mode) => {
    const safe = coerce(mode);
    writePersisted(safe);
    set({ mode: safe });
  },
  toggle: () => {
    const next: BeakerBotReviewMode = get().mode === "plan" ? "step" : "plan";
    writePersisted(next);
    set({ mode: next });
  },
}));

/** Read the current review mode WITHOUT a React hook. The agent loop runs outside
 *  React and needs the live value at dispatch time, so it calls this. Reads the
 *  store's current state, which stays in sync with the header control, and falls
 *  back to localStorage / the default if the store has not initialized. */
export function getReviewMode(): BeakerBotReviewMode {
  try {
    return useBeakerBotReviewMode.getState().mode;
  } catch {
    return readPersisted();
  }
}
