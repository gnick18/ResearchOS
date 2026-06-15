import { describe, it, expect } from "vitest";
import {
  emptyUserMemory,
  addEntry,
  removeEntry,
  formatForPrompt,
  MAX_ENTRIES,
  type UserMemory,
} from "./user-memory";

const add = (mem: UserMemory, text: string, n: number) =>
  addEntry(mem, { text, source: "user", id: `e${n}`, createdAt: n });

describe("user-memory", () => {
  it("adds an entry", () => {
    const m = add(emptyUserMemory, "Works on AMR", 1);
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].text).toBe("Works on AMR");
  });

  it("ignores blank and exact-duplicate text (case + whitespace insensitive)", () => {
    let m = add(emptyUserMemory, "Cares about MIC", 1);
    m = add(m, "   ", 2);
    m = add(m, "cares about   mic", 3);
    expect(m.entries).toHaveLength(1);
  });

  it("removes by id", () => {
    let m = add(emptyUserMemory, "a", 1);
    m = add(m, "b", 2);
    m = removeEntry(m, "e1");
    expect(m.entries.map((e) => e.text)).toEqual(["b"]);
  });

  it("caps entry count, keeping the newest", () => {
    let m = emptyUserMemory;
    for (let i = 1; i <= MAX_ENTRIES + 10; i++) m = add(m, `fact ${i}`, i);
    expect(m.entries.length).toBeLessThanOrEqual(MAX_ENTRIES);
    // newest fact survived, oldest evicted
    expect(m.entries.some((e) => e.text === `fact ${MAX_ENTRIES + 10}`)).toBe(true);
    expect(m.entries.some((e) => e.text === "fact 1")).toBe(false);
  });

  it("formatForPrompt is empty when there are no entries", () => {
    expect(formatForPrompt(emptyUserMemory)).toBe("");
  });

  it("formatForPrompt renders a bounded, labeled block", () => {
    let m = add(emptyUserMemory, "Works on AMR", 1);
    m = add(m, "Builds trees", 2);
    const out = formatForPrompt(m);
    expect(out).toContain("never shared");
    expect(out).toContain("- Works on AMR");
    expect(out).toContain("- Builds trees");
  });
});
