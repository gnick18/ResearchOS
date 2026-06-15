import { describe, it, expect } from "vitest";
import {
  initialTutorState,
  tutorReducer,
  resumeTutorState,
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

  it("Back from the picker returns to welcome with picks preserved (no dead end)", () => {
    const s = run([
      { type: "start" },
      { type: "setRole", role: "pi" },
      { type: "toggleGoal", goal: "trees" },
      { type: "back" },
    ]);
    expect(s.phase).toBe("welcome");
    expect(s.role).toBe("pi");
    expect(s.goals).toEqual(["trees"]);
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

describe("tutor-machine — resumeTutorState (post-reload demo resume)", () => {
  it("rebuilds the SAME reel a fresh beginReel would, in playing phase", () => {
    const fresh = run([
      { type: "start" },
      { type: "setRole", role: "pi" },
      { type: "toggleGoal", goal: "analyze" },
      { type: "toggleGoal", goal: "trees" },
      { type: "beginReel" },
    ]);
    const resumed = resumeTutorState({
      role: "pi",
      goals: ["analyze", "trees"],
      beatIndex: fresh.beatIndex,
    });
    expect(resumed.phase).toBe("playing");
    expect(resumed.role).toBe("pi");
    expect(resumed.reel?.beats.map((b) => b.kind)).toEqual(
      fresh.reel?.beats.map((b) => b.kind),
    );
    expect(resumed.beatIndex).toBe(fresh.beatIndex);
    expect(currentBeat(resumed)).not.toBeNull();
  });

  it("resumes at an explicit mid-reel beat", () => {
    const resumed = resumeTutorState({ role: "grad", goals: ["trees"], beatIndex: 3 });
    // 3 is within range for this reel, so it is honored.
    expect(resumed.beatIndex).toBe(3);
    expect(resumed.phase).toBe("playing");
  });

  it("clamps a below-floor beat up to the first playable beat (no welcome/picker)", () => {
    const resumed = resumeTutorState({ role: "pi", goals: ["analyze"], beatIndex: 0 });
    const firstKind = resumed.reel?.beats[resumed.beatIndex]?.kind;
    expect(firstKind).not.toBe("welcome");
    expect(firstKind).not.toBe("interest_picker");
  });

  it("clamps an out-of-range beat to the last beat rather than stranding", () => {
    const resumed = resumeTutorState({ role: "pi", goals: ["analyze"], beatIndex: 9999 });
    expect(resumed.beatIndex).toBe((resumed.reel?.beats.length ?? 1) - 1);
    expect(currentBeat(resumed)).not.toBeNull();
  });
});
