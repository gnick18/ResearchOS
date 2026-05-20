import { describe, it, expect } from "vitest";

import { ValueHistory } from "./value-history";

/**
 * Inject a controllable clock so coalesce-timing tests aren't flaky.
 */
function makeClock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("ValueHistory — basic push/undo/redo", () => {
  it("undoes back to the original value through paste pushes", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    h.push("", "v1", "paste");
    h.push("v1", "v2", "paste");
    h.push("v2", "v3", "paste");

    expect(h.canUndo()).toBe(true);
    expect(h.undo("v3")).toBe("v2");
    expect(h.undo("v2")).toBe("v1");
    expect(h.undo("v1")).toBe("");
    expect(h.canUndo()).toBe(false);
    expect(h.undo("")).toBeNull();
  });

  it("returns null when there is nothing to undo or redo", () => {
    const h = new ValueHistory();
    expect(h.undo("anything")).toBeNull();
    expect(h.redo("anything")).toBeNull();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it("redo restores an undone value", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    h.push("", "a", "paste");
    h.push("a", "ab", "paste");

    expect(h.undo("ab")).toBe("a");
    expect(h.canRedo()).toBe(true);
    expect(h.redo("a")).toBe("ab");
    expect(h.canRedo()).toBe(false);
  });
});

describe("ValueHistory — typing coalescing", () => {
  it("coalesces rapid character inserts within the idle window into one step", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now, coalesceIdleMs: 500 });

    h.push("", "a");
    clock.advance(50);
    h.push("a", "ab");
    clock.advance(50);
    h.push("ab", "abc");
    clock.advance(50);
    h.push("abc", "abcd");

    // Only the initial transition pushed the old value; subsequent typing coalesced.
    expect(h.peek().past).toEqual([""]);
    expect(h.undo("abcd")).toBe("");
    expect(h.canUndo()).toBe(false);
  });

  it("starts a new undo step when the idle window elapses", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now, coalesceIdleMs: 500 });

    h.push("", "Hi");
    clock.advance(50);
    h.push("Hi", "Hil");
    clock.advance(600);
    h.push("Hil", "Hilo");

    expect(h.peek().past).toEqual(["", "Hil"]);
    expect(h.undo("Hilo")).toBe("Hil");
    expect(h.undo("Hil")).toBe("");
  });

  it("treats whitespace as a boundary that ends the current run", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    // Type "Hello world." one char at a time, then verify Cmd+Z removes "world."
    // first and Cmd+Z again removes the rest.
    const sequence = [
      "",
      "H",
      "He",
      "Hel",
      "Hell",
      "Hello",
      "Hello ",
      "Hello w",
      "Hello wo",
      "Hello wor",
      "Hello worl",
      "Hello world",
      "Hello world.",
    ];
    for (let i = 1; i < sequence.length; i++) {
      h.push(sequence[i - 1], sequence[i]);
    }

    // Past holds the values you'd revert to with each Cmd+Z.
    // "Hello world." -> "Hello " -> ""
    expect(h.peek().past).toEqual(["", "Hello "]);
    expect(h.undo("Hello world.")).toBe("Hello ");
    expect(h.undo("Hello ")).toBe("");
    expect(h.canUndo()).toBe(false);
  });

  it("treats punctuation as a boundary mid-word", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    h.push("", "S");
    h.push("S", "So");
    h.push("So", "Sov"); // typo!
    h.push("Sov", "So"); // delete the 'v'
    h.push("So", "Sov"); // actually meant to type the v
    h.push("Sov", "Sove");
    h.push("Sove", "Sovere");
    h.push("Sovere", "Sovereign,"); // multi-char move (e.g. autocomplete)
    h.push("Sovereign,", "Sovereign, R");

    // The comma sets a boundary; typing "R" starts a new step.
    expect(h.canUndo()).toBe(true);
    const first = h.undo("Sovereign, R");
    expect(first).toBe("Sovereign,");
  });

  it("treats the CommonMark soft-break sequence as a boundary so undo is word-level across soft breaks", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    // Type "hello" char by char, simulate the chip-1 soft-break Enter handler
    // (one atomic "type" push that inserts "  \n"), then type "world" char by
    // char. The expected past stack is ["", "hello  \n"] because the
    // soft-break inserts two boundary characters (space and newline) so the
    // run that includes "hello  \n" ends, and the next typed char ("w") opens
    // a new run. Two undo steps fully unwind: "hello  \nworld" -> "hello  \n"
    // -> "".
    h.push("", "h");
    h.push("h", "he");
    h.push("he", "hel");
    h.push("hel", "hell");
    h.push("hell", "hello");
    h.push("hello", "hello  \n");
    h.push("hello  \n", "hello  \nw");
    h.push("hello  \nw", "hello  \nwo");
    h.push("hello  \nwo", "hello  \nwor");
    h.push("hello  \nwor", "hello  \nworl");
    h.push("hello  \nworl", "hello  \nworld");

    expect(h.peek().past).toEqual(["", "hello  \n"]);
    expect(h.undo("hello  \nworld")).toBe("hello  \n");
    expect(h.undo("hello  \n")).toBe("");
    expect(h.canUndo()).toBe(false);
  });
});

describe("ValueHistory — paste behavior", () => {
  it("paste is always one atomic undo step", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    h.push("Hello ", "Hello Some text pasted in", "paste");
    expect(h.peek().past).toEqual(["Hello "]);
    expect(h.undo("Hello Some text pasted in")).toBe("Hello ");
  });

  it("a paste sets a boundary so the next typed char starts a new step", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    h.push("", "pasted", "paste");
    clock.advance(50);
    h.push("pasted", "pastedX");
    clock.advance(50);
    h.push("pastedX", "pastedXY");

    // Past should have ["", "pasted"]: the paste pushed "", and the X (typed
    // after a paste) was forced into a new step which pushed "pasted".
    expect(h.peek().past).toEqual(["", "pasted"]);
    expect(h.undo("pastedXY")).toBe("pasted");
    expect(h.undo("pasted")).toBe("");
  });

  it("typing after a paste does not retroactively merge into the paste step", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    h.push("", "hi", "paste");
    clock.advance(50);
    h.push("hi", "hiX");

    expect(h.undo("hiX")).toBe("hi");
    expect(h.undo("hi")).toBe("");
  });
});

describe("ValueHistory — capacity", () => {
  it("drops the oldest entries when capacity is exceeded", () => {
    const h = new ValueHistory({ capacity: 50 });
    let prev = "v0";
    for (let i = 1; i <= 60; i++) {
      const next = `v${i}`;
      h.push(prev, next, "paste");
      prev = next;
    }
    const { past } = h.peek();
    expect(past.length).toBe(50);
    expect(past[0]).toBe("v10");
    expect(past[past.length - 1]).toBe("v59");
  });
});

describe("ValueHistory — redo clearing", () => {
  it("clears future on any new edit", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    h.push("", "a", "paste");
    h.push("a", "b", "paste");
    expect(h.undo("b")).toBe("a");
    expect(h.canRedo()).toBe(true);

    // A new edit invalidates the redo stack.
    h.push("a", "c", "paste");
    expect(h.canRedo()).toBe(false);
    expect(h.redo("c")).toBeNull();
  });

  it("typing after undo starts a fresh undo step", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    h.push("", "Hello", "paste");
    clock.advance(50);
    h.push("Hello", "Hello ");
    clock.advance(50);
    h.push("Hello ", "Hello W");

    expect(h.undo("Hello W")).toBe("Hello ");

    // Now a brand-new edit. It should NOT merge into "Hello " — it should
    // start its own step.
    clock.advance(50);
    h.push("Hello ", "Hello X");
    expect(h.undo("Hello X")).toBe("Hello ");
  });
});

describe("ValueHistory — flushBoundary", () => {
  it("forces the next push to start a new step", () => {
    const clock = makeClock();
    const h = new ValueHistory({ now: clock.now });

    h.push("", "a");
    clock.advance(50);
    h.push("a", "ab");
    h.flushBoundary();
    clock.advance(50);
    h.push("ab", "abc");

    // Without flushBoundary, "abc" would coalesce with "ab". With it, "ab" is
    // pushed onto past.
    expect(h.peek().past).toEqual(["", "ab"]);
    expect(h.undo("abc")).toBe("ab");
    expect(h.undo("ab")).toBe("");
  });
});

describe("ValueHistory — no-op pushes", () => {
  it("ignores pushes where old and new value are identical", () => {
    const h = new ValueHistory();
    h.push("same", "same");
    expect(h.canUndo()).toBe(false);
    expect(h.peek().past).toEqual([]);
  });
});
