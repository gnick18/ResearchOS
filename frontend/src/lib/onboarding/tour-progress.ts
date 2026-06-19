// Onboarding tutor — durable full-state progress (storage-injectable).
//
// Grant's requirement: the walkthrough must ALWAYS reopen to exactly where the
// user was (welcome, picker with their picks, or any playing beat) across any
// refresh, folder reconnect, or tab close-and-reopen-later, and may ONLY go away
// when the user finishes it or skips it.
//
// localStorage (not sessionStorage) is deliberate: sessionStorage dies on tab
// close, which would violate "close and reopen later". We persist the WHOLE
// machine state needed to rebuild the run, write it on every state change
// (OnboardingTutor drives that through an injected callback), and clear it only
// on done/skip. The reducer stays pure; this module owns the persistence.
//
// progressFromState / stateFromProgress are pure, so the round-trip is fully
// unit-tested without a browser. No emojis, no em-dashes, no mid-sentence colons.

import {
  resumeTutorState,
  type TutorState,
} from "./tutor-machine";
import type { Role, GoalKey } from "./reel-director";

const PROGRESS_KEY = "ros.onboardingTutor.progress.v1";

/** A resumable phase. done/skipped are terminal, so they are never persisted
 *  (they clear the record instead). */
export type TourProgressPhase = "welcome" | "picking" | "playing";

export interface TourProgress {
  phase: TourProgressPhase;
  /** The chosen role, preserved even at welcome so Back to welcome keeps it. */
  role: Role | null;
  /** The picked interest goals, preserved across reloads. */
  goals: GoalKey[];
  /** The reel beat index, meaningful only while playing. */
  beatIndex: number;
}

/** The slice of the Storage API this module needs. Injected so tests pass an
 *  in-memory stub and production passes window.localStorage. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const PHASES: ReadonlySet<string> = new Set(["welcome", "picking", "playing"]);

/** Defensive parse of a stored record, so a hand-edited or stale value cannot
 *  crash the resume. Returns null on anything that is not a valid progress. */
function asProgress(value: unknown): TourProgress | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.phase !== "string" || !PHASES.has(v.phase)) return null;
  const role = v.role === null || typeof v.role === "string" ? (v.role as Role | null) : null;
  const goals = Array.isArray(v.goals)
    ? v.goals.filter((g): g is GoalKey => typeof g === "string")
    : [];
  const beatIndex = typeof v.beatIndex === "number" && v.beatIndex >= 0 ? v.beatIndex : 0;
  return { phase: v.phase as TourProgressPhase, role, goals, beatIndex };
}

/** Persist the full resumable state. No-op without storage. */
export function saveTourProgress(
  progress: TourProgress,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // best-effort; private-mode failure just means the run will not survive a reload
  }
}

/** Read the persisted progress, or null when absent / invalid. */
export function readTourProgress(
  storage: StorageLike | null = defaultStorage(),
): TourProgress | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    return asProgress(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Whether a resumable run is persisted. */
export function hasTourProgress(
  storage: StorageLike | null = defaultStorage(),
): boolean {
  return readTourProgress(storage) !== null;
}

/** Drop the progress, so the walkthrough does not reopen. Called on done/skip. */
export function clearTourProgress(
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(PROGRESS_KEY);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Pure converters (machine state <-> persisted progress)
// ---------------------------------------------------------------------------

/** Project a machine state to the persistable progress, or null when the run is
 *  terminal (done/skipped) so the caller clears the record instead of saving. */
export function progressFromState(state: TutorState): TourProgress | null {
  if (state.phase !== "welcome" && state.phase !== "picking" && state.phase !== "playing") {
    return null;
  }
  return {
    phase: state.phase,
    role: state.role,
    goals: state.goals,
    beatIndex: state.beatIndex,
  };
}

/** Rebuild a machine state from persisted progress so the run resumes exactly:
 *  welcome and picking keep the picks; playing rebuilds the SAME reel and clamps
 *  to the stored beat (resumeTutorState). A playing record with no role cannot
 *  rebuild a reel, so it falls back to the picker with the picks intact. */
export function stateFromProgress(progress: TourProgress): TutorState {
  if (progress.phase === "playing" && progress.role) {
    return resumeTutorState({
      role: progress.role,
      goals: progress.goals,
      beatIndex: progress.beatIndex,
    });
  }
  const phase = progress.phase === "playing" ? "picking" : progress.phase;
  return {
    phase,
    role: progress.role,
    goals: progress.goals,
    reel: null,
    beatIndex: 0,
  };
}
