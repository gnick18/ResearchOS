import { describe, it, expect } from "vitest";
import {
  computePct,
  estimateEtaMs,
  runBoot,
  type BootTask,
  type BootState,
  type TimingStore,
} from "@/lib/page-boot/page-boot";

const T = (id: string, weight: number): BootTask => ({
  id,
  label: id,
  weight,
  run: async () => {},
});

describe("page-boot: computePct (weighted, honest)", () => {
  const tasks = [T("a", 10), T("b", 30), T("c", 10)]; // total 50

  it("is 0 at the very start", () => {
    expect(computePct(tasks, 0, 0)).toBe(0);
  });

  it("counts completed tasks fully and the current task by fraction", () => {
    // a done (10) + half of b (15) = 25 / 50 = 50%
    expect(computePct(tasks, 1, 0.5)).toBeCloseTo(50, 6);
  });

  it("a heavy middle task dominates the bar (weighting works)", () => {
    // a done (10) + all of b would be index 2 frac 0 => 40/50 = 80%
    expect(computePct(tasks, 2, 0)).toBeCloseTo(80, 6);
  });

  it("never exceeds 100 and clamps a bad fraction", () => {
    expect(computePct(tasks, 2, 5)).toBeLessThanOrEqual(100);
  });
});

describe("page-boot: estimateEtaMs", () => {
  const tasks = [T("a", 1), T("b", 1), T("c", 1)];

  it("returns null on first visit (no prior timings)", () => {
    expect(estimateEtaMs(tasks, null, 0, 0)).toBeNull();
  });

  it("returns null if any task lacks a prior timing", () => {
    expect(estimateEtaMs(tasks, { a: 100, b: 100 }, 0, 0)).toBeNull();
  });

  it("sums remaining task durations, discounting the current task by its fraction", () => {
    const prior = { a: 100, b: 200, c: 50 };
    // at task b, half done: half of b (100) + all of c (50) = 150
    expect(estimateEtaMs(tasks, prior, 1, 0.5)).toBeCloseTo(150, 6);
  });

  it("is ~0 at the end", () => {
    const prior = { a: 100, b: 200, c: 50 };
    expect(estimateEtaMs(tasks, prior, 2, 1)).toBeCloseTo(0, 6);
  });
});

function memStore(initial: Record<string, number> | null = null): TimingStore {
  let saved = initial;
  return {
    get: () => saved,
    set: (_id, t) => {
      saved = t;
    },
  };
}

describe("page-boot: runBoot", () => {
  it("runs tasks in order, ends at 100% / done, and records timings", async () => {
    const order: string[] = [];
    const tasks: BootTask[] = [
      { id: "a", label: "A", weight: 1, run: async () => { order.push("a"); } },
      { id: "b", label: "B", weight: 1, run: async () => { order.push("b"); } },
    ];
    const states: BootState[] = [];
    let t = 0;
    const store = memStore();
    await runBoot(tasks, {
      pageId: "test",
      onUpdate: (s) => states.push(s),
      timingStore: store,
      now: () => (t += 10),
    });
    expect(order).toEqual(["a", "b"]);
    const last = states[states.length - 1];
    expect(last.phase).toBe("done");
    expect(last.pct).toBe(100);
    expect(last.etaMs).toBe(0);
    // Durations were recorded for next time.
    expect(store.get("test")).toMatchObject({ a: expect.any(Number), b: expect.any(Number) });
  });

  it("reports streamed sub-progress from a task", async () => {
    const tasks: BootTask[] = [
      {
        id: "dl",
        label: "Downloading",
        weight: 1,
        run: async (onProgress) => {
          onProgress(0.25);
          onProgress(0.5);
          onProgress(1);
        },
      },
    ];
    const pcts: number[] = [];
    await runBoot(tasks, { pageId: "p", onUpdate: (s) => pcts.push(s.pct) });
    // Saw intermediate progress, not just 0 and 100.
    expect(pcts.some((p) => p > 20 && p < 60)).toBe(true);
    expect(pcts[pcts.length - 1]).toBe(100);
  });

  it("emits phase 'error' and rejects when a task throws (caller shows retry)", async () => {
    const boom = new Error("nope");
    const tasks: BootTask[] = [
      { id: "x", label: "X", weight: 1, run: async () => { throw boom; } },
    ];
    const states: BootState[] = [];
    await expect(
      runBoot(tasks, { pageId: "p", onUpdate: (s) => states.push(s) }),
    ).rejects.toThrow("nope");
    expect(states.some((s) => s.phase === "error" && s.error === boom)).toBe(true);
  });

  it("surfaces a real ETA on a repeat visit (prior timings present)", async () => {
    const tasks: BootTask[] = [
      { id: "a", label: "A", weight: 1, run: async () => {} },
      { id: "b", label: "B", weight: 1, run: async () => {} },
    ];
    const store = memStore({ a: 100, b: 200 });
    const etas: (number | null)[] = [];
    await runBoot(tasks, {
      pageId: "p",
      onUpdate: (s) => etas.push(s.etaMs),
      timingStore: store,
    });
    // At least one running update had a numeric ETA (not all null like a first visit).
    expect(etas.some((e) => typeof e === "number" && e > 0)).toBe(true);
  });
});
