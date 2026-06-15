// Onboarding tutor — the step machine (pure reducer).
//
// Drives the whole guided first-run: welcome -> picking interests -> playing the
// reel (the deep demos, AI demo, montage, memory, recap) -> done. The reel
// itself comes from the pure reel-director; this machine owns PROGRESSION, so
// Next/Back/Skip are deterministic and the user can never be stranded (every
// state has an exit). The presentation can advance beats on a timer, but only
// these transitions move state.
//
// Pure, unit-tested, no app/store/router state. No emojis, no em-dashes, no
// mid-sentence colons.

import { buildReel, type Reel, type Role, type GoalKey, type Beat } from "./reel-director";

export type TutorPhase = "welcome" | "picking" | "playing" | "done" | "skipped";

export interface TutorState {
  phase: TutorPhase;
  role: Role | null;
  goals: GoalKey[];
  reel: Reel | null;
  /** Index into reel.beats while playing. */
  beatIndex: number;
}

export const initialTutorState: TutorState = {
  phase: "welcome",
  role: null,
  goals: [],
  reel: null,
  beatIndex: 0,
};

export type TutorAction =
  | { type: "start" } // welcome -> picking
  | { type: "skip" } // any -> skipped (terminal, the always-available exit)
  | { type: "setRole"; role: Role }
  | { type: "toggleGoal"; goal: GoalKey }
  | { type: "beginReel" } // picking -> playing (build the reel)
  | { type: "next" } // advance one beat; past the last -> done
  | { type: "back" }; // previous beat; before the first playable -> back to picking

/** The reel's first two beats are welcome + interest_picker, which the machine
 *  renders as its own phases. So when we start playing we jump to the first beat
 *  that is neither of those (the first deep demo, or the AI demo if no deep). */
function firstPlayableIndex(reel: Reel): number {
  const i = reel.beats.findIndex(
    (b) => b.kind !== "welcome" && b.kind !== "interest_picker",
  );
  return i === -1 ? reel.beats.length : i;
}

export function tutorReducer(
  state: TutorState,
  action: TutorAction,
): TutorState {
  switch (action.type) {
    case "skip":
      return { ...state, phase: "skipped" };

    case "start":
      return state.phase === "welcome"
        ? { ...state, phase: "picking" }
        : state;

    case "setRole":
      return state.phase === "picking"
        ? { ...state, role: action.role }
        : state;

    case "toggleGoal": {
      if (state.phase !== "picking") return state;
      const has = state.goals.includes(action.goal);
      return {
        ...state,
        goals: has
          ? state.goals.filter((g) => g !== action.goal)
          : [...state.goals, action.goal],
      };
    }

    case "beginReel": {
      // Need a role to tailor + role-gate the reel. No-op until one is chosen.
      if (state.phase !== "picking" || state.role === null) return state;
      const reel = buildReel({ role: state.role, pickedGoals: state.goals });
      return {
        ...state,
        phase: "playing",
        reel,
        beatIndex: firstPlayableIndex(reel),
      };
    }

    case "next": {
      if (state.phase !== "playing" || !state.reel) return state;
      const nextIndex = state.beatIndex + 1;
      if (nextIndex >= state.reel.beats.length) {
        return { ...state, phase: "done" };
      }
      return { ...state, beatIndex: nextIndex };
    }

    case "back": {
      if (state.phase !== "playing" || !state.reel) return state;
      const floor = firstPlayableIndex(state.reel);
      if (state.beatIndex <= floor) {
        // Stepping back off the first playable beat returns to the picker.
        return { ...state, phase: "picking" };
      }
      return { ...state, beatIndex: state.beatIndex - 1 };
    }

    default:
      return state;
  }
}

/** The beat currently on screen while playing, or null otherwise. */
export function currentBeat(state: TutorState): Beat | null {
  if (state.phase !== "playing" || !state.reel) return null;
  return state.reel.beats[state.beatIndex] ?? null;
}

/** Whether the run reached a terminal state (finished or skipped). */
export function isFinished(state: TutorState): boolean {
  return state.phase === "done" || state.phase === "skipped";
}
