import { describe, it, expect } from "vitest";
import {
  saveTourProgress,
  readTourProgress,
  clearTourProgress,
  hasTourProgress,
  progressFromState,
  stateFromProgress,
  type TourProgress,
  type StorageLike,
} from "./tour-progress";
import {
  initialTutorState,
  tutorReducer,
  resumeTutorState,
  type TutorState,
} from "./tutor-machine";

function memStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function run(actions: Parameters<typeof tutorReducer>[1][]): TutorState {
  return actions.reduce(tutorReducer, initialTutorState);
}

describe("tour-progress, durable persistence", () => {
  it("round-trips a saved record", () => {
    const s = memStorage();
    const p: TourProgress = { phase: "picking", role: "pi", goals: ["analyze", "trees"], beatIndex: 0 };
    saveTourProgress(p, s);
    expect(readTourProgress(s)).toEqual(p);
    expect(hasTourProgress(s)).toBe(true);
  });

  it("reads null when nothing is stored", () => {
    expect(readTourProgress(memStorage())).toBeNull();
    expect(hasTourProgress(memStorage())).toBe(false);
  });

  it("clear removes the record (so the walkthrough does not reopen)", () => {
    const s = memStorage();
    saveTourProgress({ phase: "welcome", role: null, goals: [], beatIndex: 0 }, s);
    clearTourProgress(s);
    expect(readTourProgress(s)).toBeNull();
    expect(hasTourProgress(s)).toBe(false);
  });

  it("ignores a malformed / bad-phase record instead of crashing", () => {
    expect(readTourProgress(memStorage({ "ros.onboardingTutor.progress.v1": "not json" }))).toBeNull();
    expect(
      readTourProgress(memStorage({ "ros.onboardingTutor.progress.v1": JSON.stringify({ phase: "done" }) })),
    ).toBeNull();
  });
});

describe("tour-progress, progressFromState", () => {
  it("captures welcome, picking, and playing", () => {
    const welcome = progressFromState(initialTutorState);
    expect(welcome).toEqual({ phase: "welcome", role: null, goals: [], beatIndex: 0 });

    const picking = progressFromState(
      run([{ type: "start" }, { type: "setRole", role: "grad" }, { type: "toggleGoal", goal: "trees" }]),
    );
    expect(picking).toMatchObject({ phase: "picking", role: "grad", goals: ["trees"] });

    const playing = progressFromState(
      run([
        { type: "start" },
        { type: "setRole", role: "pi" },
        { type: "toggleGoal", goal: "analyze" },
        { type: "beginReel" },
      ]),
    );
    expect(playing?.phase).toBe("playing");
    expect(playing?.role).toBe("pi");
  });

  it("returns null for terminal states (done / skipped), so the caller clears", () => {
    const skipped = run([{ type: "start" }, { type: "skip" }]);
    expect(progressFromState(skipped)).toBeNull();
  });
});

describe("tour-progress, stateFromProgress (exact resume)", () => {
  it("resumes welcome with the picks preserved", () => {
    const st = stateFromProgress({ phase: "welcome", role: "pi", goals: ["trees"], beatIndex: 0 });
    expect(st.phase).toBe("welcome");
    expect(st.role).toBe("pi");
    expect(st.goals).toEqual(["trees"]);
  });

  it("resumes the picker with the role + goals intact", () => {
    const st = stateFromProgress({ phase: "picking", role: "grad", goals: ["analyze", "trees"], beatIndex: 0 });
    expect(st.phase).toBe("picking");
    expect(st.role).toBe("grad");
    expect(st.goals).toEqual(["analyze", "trees"]);
  });

  it("resumes a playing beat by rebuilding the same reel", () => {
    const fresh = run([
      { type: "start" },
      { type: "setRole", role: "pi" },
      { type: "toggleGoal", goal: "analyze" },
      { type: "toggleGoal", goal: "trees" },
      { type: "beginReel" },
      { type: "next" },
    ]);
    const st = stateFromProgress({ phase: "playing", role: "pi", goals: ["analyze", "trees"], beatIndex: fresh.beatIndex });
    expect(st.phase).toBe("playing");
    expect(st.beatIndex).toBe(fresh.beatIndex);
    expect(st.reel?.beats.map((b) => b.kind)).toEqual(fresh.reel?.beats.map((b) => b.kind));
  });

  it("falls back to the picker when a playing record has no role (cannot rebuild a reel)", () => {
    const st = stateFromProgress({ phase: "playing", role: null, goals: ["trees"], beatIndex: 3 });
    expect(st.phase).toBe("picking");
    expect(st.goals).toEqual(["trees"]);
  });
});

describe("tour-progress, full round-trip state -> progress -> state", () => {
  it("preserves a mid-playing position exactly", () => {
    const playing = run([
      { type: "start" },
      { type: "setRole", role: "postdoc" },
      { type: "toggleGoal", goal: "analyze" },
      { type: "toggleGoal", goal: "trees" },
      { type: "beginReel" },
      { type: "next" },
      { type: "next" },
    ]);
    const p = progressFromState(playing)!;
    const back = stateFromProgress(p);
    expect(back.phase).toBe("playing");
    expect(back.role).toBe("postdoc");
    expect(back.goals).toEqual(["analyze", "trees"]);
    expect(back.beatIndex).toBe(playing.beatIndex);
    // Same reel the live run would resume into.
    const expected = resumeTutorState({ role: "postdoc", goals: ["analyze", "trees"], beatIndex: playing.beatIndex });
    expect(back.beatIndex).toBe(expected.beatIndex);
  });
});
