import { describe, it, expect } from "vitest";
import { summarize } from "./tutor-summary";

describe("tutor-summary", () => {
  it("builds a warm memory fact from role + goals", () => {
    const s = summarize("pi", ["trees", "analyze"], ["datahub", "phylo"]);
    expect(s.memoryFact).toContain("You lead a lab");
    expect(s.memoryFact.toLowerCase()).toContain("build trees");
    expect(s.memoryFact.toLowerCase()).toContain("analyze data");
  });

  it("recap carries role, interests, and what was shown", () => {
    const s = summarize("grad", ["sequences"], ["sequences", "datahub"]);
    const labels = s.recap.map((r) => r.label);
    expect(labels).toContain("Role");
    expect(labels).toContain("Interested in");
    expect(labels).toContain("Showed you");
    expect(s.recap.find((r) => r.label === "Showed you")?.value).toContain("Sequences");
  });

  it("never invents interests when none were picked", () => {
    const s = summarize("postdoc", [], ["methods", "sequences", "datahub"]);
    expect(s.memoryFact).toContain("still figuring out");
    expect(s.recap.find((r) => r.label === "Interested in")).toBeUndefined();
  });

  it("falls back to a neutral role when none chosen", () => {
    const s = summarize(null, [], []);
    expect(s.memoryFact).toContain("You're a researcher");
  });
});
