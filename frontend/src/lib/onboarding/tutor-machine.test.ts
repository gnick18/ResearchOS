import { describe, it, expect } from "vitest";
import {
  initialTutorState,
  tutorReducer,
  currentBeat,
  isFinished,
  type TutorState,
} from "./tutor-machine";

// Drive the reducer through a list of actions from a starting state.
function run(
  actions: Parameters<typeof tutorReducer>[1][],
  from: TutorState = initialTutorState,
): TutorState {
  return actions.reduce(tutorReducer, from);
}

describe("tutor-machine — progression", () => {
  it("starts at welcome", () => {
    expect(initialTutorState.phase).toBe("welcome");
  });

  it("start moves welcome -> picking", () => {
    expect(run([{ type: "start" }]).phase).toBe("picking");
  });

  it("skip is always available and terminal", () => {
    expect(run([{ type: "skip" }]).phase).toBe("skipped");
    expect(
      run([{ type: "start" }, { type: "skip" }]).phase,
    ).toBe("skipped");
    expect(isFinished(run([{ type: "skip" }]))).toBe(true);
  });

  it("beginReel needs a role (no-op without one)", () => {
    const s = run([{ type: "start" }, { type: "beginReel" }]);
    expect(s.phase).toBe("picking");
    expect(s.reel).toBeNull();
  });

  it("picking -> playing builds the reel and lands on the first playable beat", () => {
    const s = run([
      { type: "start" },
      { type: "setRole", role: "grad" },
      { type: "toggleGoal", goal: "trees" },
      { type: "beginReel" },
    ]);
    expect(s.phase).toBe("playing");
    expect(s.reel).not.toBeNull();
    // first playable beat is the first deep demo, not welcome/picker
    expect(currentBeat(s)?.kind).toBe("deep_demo");
  });
});

describe("tutor-machine — interest picking", () => {
  it("toggleGoal adds then removes", () => {
    const added = run([{ type: "start" }, { type: "toggleGoal", goal: "analyze" }]);
    expect(added.goals).toEqual(["analyze"]);
    const removed = tutorReducer(added, { type: "toggleGoal", goal: "analyze" });
    expect(removed.goals).toEqual([]);
  });

  it("setRole only applies while picking", () => {
    // before start (welcome) it is a no-op
    expect(run([{ type: "setRole", role: "pi" }]).role).toBeNull();
  });
});

describe("tutor-machine — playing next/back", () => {
  const play = run([
    { type: "start" },
    { type: "setRole", role: "pi" },
    { type: "toggleGoal", goal: "analyze" },
    { type: "toggleGoal", goal: "trees" },
    { type: "beginReel" },
  ]);

  it("next advances through every beat then reaches done", () => {
    let s = play;
    const beats = s.reel!.beats.length;
    // from the first playable index, step until done
    let guard = 0;
    while (s.phase === "playing" && guard < beats + 5) {
      s = tutorReducer(s, { type: "next" });
      guard++;
    }
    expect(s.phase).toBe("done");
    expect(isFinished(s)).toBe(true);
    expect(currentBeat(s)).toBeNull();
  });

  it("back off the first playable beat returns to the picker (no soft-lock)", () => {
    const back = tutorReducer(play, { type: "back" });
    expect(back.phase).toBe("picking");
    // picks are preserved so they can resume
    expect(back.goals).toEqual(["analyze", "trees"]);
  });

  it("back in the middle steps one beat without leaving playing", () => {
    const fwd = tutorReducer(play, { type: "next" });
    const back = tutorReducer(fwd, { type: "back" });
    expect(back.phase).toBe("playing");
    expect(back.beatIndex).toBe(play.beatIndex);
  });
});
