// Onboarding tutor — tour-scoped demo session marker (increment 2 foundation).
//
// The tutor drives the REAL pages over field-personalized DEMO fixtures (build
// plan §2). Demo mode's fixture install is INIT-TIME (FileSystemProvider reads
// getDemoMode() once on mount), so the tour enters demo by setting the demo
// sticky and reloading ONCE behind the opaque "Setting the stage" screen, rather
// than swapping the file service under a live tree. That reload would tear down
// the in-memory tutor state, so we persist a small RESUME MARKER first: on the
// next mount TourHost reads it, re-enters at the live-demo beat (skipping
// welcome/picker), and the same marker is what lets a mid-tour refresh resume.
//
// This module owns ONLY that marker (the demo sticky itself is markDemoMode /
// clearDemoMode in wiki-capture-mock.ts). It is PURE, storage-injectable, and
// clockless so it unit-tests with an in-memory stub and never breaks resume.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

/** The sessionStorage key holding the in-flight tour's resume marker. */
export const TOUR_RESUME_KEY = "researchos:onboarding-tour-resume";

/** What the tour needs to pick up exactly where the pre-reload run left off. */
export interface TourResumeState {
  /** The reel beat index to resume at (the first live-demo beat, past the
   *  opaque welcome/picker which are not replayed after the demo reload). */
  beatIndex: number;
  /** The interest picks chosen on the picker, so the resumed reel is the same
   *  field-personalized running order. */
  picks: string[];
  /** Which field-personalized fixture set the demo seeded (e.g. a microbio
   *  resistance flavor), so the resumed surfaces show the same data. */
  fixtureFlavor: string;
}

/** The slice of the Storage API this module needs. Injected so tests pass an
 *  in-memory stub and production passes window.sessionStorage. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The live sessionStorage, or null when unavailable (SSR / privacy mode). */
function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Validate a parsed value into a TourResumeState, or null when it is not one.
 *  Defensive against hand-edited / stale / partial markers. Pure. */
function asResumeState(value: unknown): TourResumeState | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.beatIndex !== "number" || !Number.isFinite(v.beatIndex)) return null;
  if (v.beatIndex < 0) return null;
  if (!Array.isArray(v.picks) || !v.picks.every((p) => typeof p === "string")) {
    return null;
  }
  if (typeof v.fixtureFlavor !== "string") return null;
  return {
    beatIndex: v.beatIndex,
    picks: v.picks as string[],
    fixtureFlavor: v.fixtureFlavor,
  };
}

/** Persist the resume marker for the demo reload. Call this BEFORE setting the
 *  demo sticky + reloading, so the next mount can resume. No-op when storage is
 *  unavailable (the tour then just cannot survive a reload, which is acceptable
 *  degradation, not a crash). */
export function saveTourResume(
  state: TourResumeState,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(TOUR_RESUME_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage can throw when full or in privacy mode; resume just degrades.
  }
}

/** Read the resume marker, or null when absent / malformed. Pure read. */
export function readTourResume(
  storage: StorageLike | null = defaultStorage(),
): TourResumeState | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(TOUR_RESUME_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return asResumeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** True when a valid resume marker is present (the tour is mid-run across a
 *  reload). Thin wrapper over readTourResume for call-site readability. */
export function hasTourResume(
  storage: StorageLike | null = defaultStorage(),
): boolean {
  return readTourResume(storage) !== null;
}

/** Drop the resume marker. Call on tour complete / skip (alongside clearing the
 *  demo sticky + restoring the real workspace), so a later fresh run does not
 *  resume a stale tour. No-op when storage is unavailable. */
export function clearTourResume(
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(TOUR_RESUME_KEY);
  } catch {
    // Best-effort; a stale marker is still gated by the once-per-device done flag.
  }
}
