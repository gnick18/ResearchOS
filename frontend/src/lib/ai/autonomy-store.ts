// BeakerBot autonomy setting (ai click bot, 2026-06-11).
//
// The per-user choice of how BeakerBot handles ACTION tools (tools that change
// something, starting with click_element). Two modes.
//   - "ask" (the DEFAULT), BeakerBot proposes the action and waits for the user
//     to allow it. The user sees exactly what will happen before it happens.
//   - "auto", BeakerBot performs reversible in-app actions without asking. Even
//     in this mode the destructive hard-stop in the agent loop still forces a
//     confirm for dangerous or outward-facing actions, so "auto" is never a
//     blanket "do anything".
//
// Why a tiny zustand store with localStorage, not the file-backed user-settings.
// The agent loop runs OUTSIDE React (the tool dispatch is a plain async call),
// so it needs to read the current mode synchronously without a hook and without
// a folder read. A localStorage-mirrored store gives both, a hook for the panel
// toggle and a plain getter the loop calls. It mirrors how panel-store.ts holds
// the open/closed flag, kept out of per-route React state on purpose.
//
// Persistence is per-browser-profile (localStorage), which is the right grain
// for a UI safety preference, the same machine the user clicks "auto" on is the
// machine that then auto-clicks. Default is "ask" whenever the stored value is
// missing or has been hand-edited to something unknown, so a corrupted value can
// never silently widen autonomy.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { create } from "zustand";

export type BeakerBotAutonomy = "ask" | "auto";

// The default the whole feature falls back to. MUST be "ask", the safer mode,
// so a fresh user (and any unreadable stored value) always gets propose-then-
// approve, never silent auto-clicking.
export const DEFAULT_AUTONOMY: BeakerBotAutonomy = "ask";

// The localStorage key. Namespaced like the editor prefs (ros.*) so it is easy
// to spot and clear.
const STORAGE_KEY = "ros.beakerbot.autonomy";

/** Coerce an arbitrary stored value to a legal autonomy mode, falling back to
 *  the safe default for anything unknown. So a hand-edited or stale value can
 *  never widen autonomy past "ask". */
function coerce(value: string | null | undefined): BeakerBotAutonomy {
  return value === "auto" ? "auto" : DEFAULT_AUTONOMY;
}

/** Read the persisted mode synchronously, defaulting to "ask". SSR-safe (no
 *  window means the default). Used to seed the store on first load. */
function readPersisted(): BeakerBotAutonomy {
  if (typeof window === "undefined") return DEFAULT_AUTONOMY;
  try {
    return coerce(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // localStorage can throw in locked-down privacy modes, fall back safely.
    return DEFAULT_AUTONOMY;
  }
}

function writePersisted(mode: BeakerBotAutonomy): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Best-effort, a failed persist just means the choice does not survive a
    // reload. Never throw out of a setter.
  }
}

interface AutonomyStore {
  /** The current autonomy mode. Seeded from localStorage, defaults to "ask". */
  mode: BeakerBotAutonomy;
  /** Set the mode and persist it. */
  setMode: (mode: BeakerBotAutonomy) => void;
  /** Flip ask <-> auto. The header control calls this. */
  toggle: () => void;
}

export const useBeakerBotAutonomy = create<AutonomyStore>((set, get) => ({
  mode: readPersisted(),
  setMode: (mode) => {
    const safe = coerce(mode);
    writePersisted(safe);
    set({ mode: safe });
  },
  toggle: () => {
    const next: BeakerBotAutonomy = get().mode === "auto" ? "ask" : "auto";
    writePersisted(next);
    set({ mode: next });
  },
}));

/** Read the current autonomy mode WITHOUT a React hook. The agent loop runs
 *  outside React and needs the live value at dispatch time, so it calls this.
 *  Reads the store's current state, which stays in sync with the toggle, and
 *  falls back to localStorage / the default if the store has not initialized. */
export function getAutonomyMode(): BeakerBotAutonomy {
  try {
    return useBeakerBotAutonomy.getState().mode;
  } catch {
    return readPersisted();
  }
}
