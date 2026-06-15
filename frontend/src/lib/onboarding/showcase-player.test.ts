import { describe, it, expect } from "vitest";
import { choreographyFor, CHOREOGRAPHIES } from "./showcase-choreography";
import {
  initPlayer,
  playerReducer,
  currentStep,
  cursorTarget,
  isClicking,
  isRevealed,
  narration,
  type PlayerState,
} from "./showcase-player";

const tick = (s: PlayerState, ms: number) =>
  playerReducer(s, { type: "tick", deltaMs: ms });

// Total duration of a choreography, to drive a run to completion.
const totalMs = (surface: Parameters<typeof choreographyFor>[0]) =>
  CHOREOGRAPHIES[surface].steps.reduce((n, s) => n + s.durationMs, 0);

describe("showcase choreography — shape", () => {
  it("every surface has the five-phase spine in order", () => {
    for (const surface of Object.keys(CHOREOGRAPHIES) as Array<
      keyof typeof CHOREOGRAPHIES
    >) {
      const kinds = CHOREOGRAPHIES[surface].steps.map((s) => s.kind);
      expect(kinds).toEqual([
        "arrive",
        "seed",
        "cursor_move",
        "click",
        "reveal",
        "narrate",
      ]);
    }
  });

  it("every choreography has a route, a seed, a cursor target, and a narration line", () => {
    for (const c of Object.values(CHOREOGRAPHIES)) {
      expect(c.route.startsWith("/")).toBe(true);
      expect(c.seedKind.length).toBeGreaterThan(0);
      expect(c.steps.find((s) => s.kind === "click")?.target).toBeTruthy();
      expect(c.steps.find((s) => s.kind === "narrate")?.line?.length).toBeGreaterThan(0);
    }
  });
});

describe("showcase player — stepping", () => {
  it("starts on the arrive step, playing", () => {
    const s = initPlayer(choreographyFor("datahub"));
    expect(currentStep(s)?.kind).toBe("arrive");
    expect(s.status).toBe("playing");
    expect(cursorTarget(s)).toBeNull(); // cursor not shown yet
  });

  it("ticks advance through the steps and reach done", () => {
    let s = initPlayer(choreographyFor("datahub"));
    s = tick(s, totalMs("datahub") + 50);
    expect(s.status).toBe("done");
    expect(currentStep(s)).toBeNull();
  });

  it("a large delta after a dropped frame advances multiple steps without overshoot bugs", () => {
    let s = initPlayer(choreographyFor("phylo"));
    // jump past arrive+seed in one big tick
    const past = CHOREOGRAPHIES.phylo.steps[0].durationMs +
      CHOREOGRAPHIES.phylo.steps[1].durationMs + 10;
    s = tick(s, past);
    expect(currentStep(s)?.kind).toBe("cursor_move");
  });

  it("cursorTarget appears at the cursor_move step and persists through click", () => {
    let s = initPlayer(choreographyFor("datahub"));
    const [arrive, seed] = CHOREOGRAPHIES.datahub.steps;
    s = tick(s, arrive.durationMs + seed.durationMs + 10); // now on cursor_move
    expect(currentStep(s)?.kind).toBe("cursor_move");
    expect(cursorTarget(s)).toBe("datahub-plot-button");
    s = tick(s, CHOREOGRAPHIES.datahub.steps[2].durationMs + 10); // now on click
    expect(isClicking(s)).toBe(true);
    expect(cursorTarget(s)).toBe("datahub-plot-button");
  });

  it("isRevealed flips at the reveal step and narration shows at the end", () => {
    let s = initPlayer(choreographyFor("methods"));
    expect(isRevealed(s)).toBe(false);
    s = tick(s, totalMs("methods") + 50);
    expect(isRevealed(s)).toBe(true);
    expect(narration(s)).toContain("phone");
  });
});

describe("showcase player — control (no soft-lock)", () => {
  it("pause stops advancement, resume continues", () => {
    let s = initPlayer(choreographyFor("datahub"));
    s = playerReducer(s, { type: "pause" });
    const frozen = tick(s, 99_999);
    expect(frozen.stepIndex).toBe(s.stepIndex); // no movement while paused
    const resumed = playerReducer(frozen, { type: "resume" });
    expect(resumed.status).toBe("playing");
  });

  it("skip jumps straight to done", () => {
    let s = initPlayer(choreographyFor("chemistry"));
    s = playerReducer(s, { type: "skip" });
    expect(s.status).toBe("done");
    expect(isRevealed(s)).toBe(true);
  });

  it("restart returns to the first step", () => {
    let s = initPlayer(choreographyFor("datahub"));
    s = tick(s, 5_000);
    s = playerReducer(s, { type: "restart" });
    expect(s.stepIndex).toBe(0);
    expect(s.status).toBe("playing");
  });
});
