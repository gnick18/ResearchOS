// Check-ins Phase 4 (checkins-phase4 bot, 2026-06-12). Pure unit tests for the
// mentorship forest + the skip-level predicate. No I/O, so no file-system mock.

import { describe, expect, it } from "vitest";
import {
  buildMentorEdges,
  buildMentorshipForest,
  directMentorsOf,
  isSkipLevel,
} from "./mentorship-tree";
import type { OneOnOne } from "../types";

let counter = 0;
function space(
  members: string[],
  mentor: string | null,
  id?: string,
): OneOnOne {
  counter += 1;
  const owner = members[0];
  return {
    id: id ?? `s${counter}`,
    members,
    mentor,
    kind: members.length > 2 ? "group" : "pair",
    created_by: owner,
    created_at: new Date(2026, 0, counter).toISOString(),
    owner,
    shared_with: members.map((m) => ({ username: m, level: "edit" as const })),
  };
}

describe("buildMentorEdges", () => {
  it("a mentored pair contributes one mentor -> mentee edge", () => {
    const edges = buildMentorEdges([space(["pi", "student"], "pi")]);
    expect(edges).toEqual([
      { mentor: "pi", mentee: "student", space_id: edges[0].space_id },
    ]);
  });

  it("a peer space (no mentor) contributes no edge", () => {
    expect(buildMentorEdges([space(["a", "b"], null)])).toEqual([]);
  });

  it("a mentored group edges from the mentor to each OTHER member", () => {
    const edges = buildMentorEdges([space(["pi", "x", "y"], "pi")]);
    expect(edges.map((e) => `${e.mentor}->${e.mentee}`).sort()).toEqual([
      "pi->x",
      "pi->y",
    ]);
  });

  it("de-duplicates a repeated mentor -> mentee pair across spaces", () => {
    const edges = buildMentorEdges([
      space(["pi", "student"], "pi"),
      space(["pi", "student"], "pi"),
    ]);
    expect(edges).toHaveLength(1);
  });

  it("skips a self-edge data anomaly (mentor listed as their own mentee)", () => {
    // A degenerate single-member space with itself as mentor.
    const edges = buildMentorEdges([space(["pi"], "pi")]);
    expect(edges).toEqual([]);
  });
});

describe("buildMentorshipForest", () => {
  it("threads a multi-level chain (pi -> postdoc -> student)", () => {
    const forest = buildMentorshipForest([
      space(["pi", "postdoc"], "pi"),
      space(["postdoc", "student"], "postdoc"),
    ]);
    expect(forest).toHaveLength(1);
    expect(forest[0].username).toBe("pi");
    expect(forest[0].children.map((c) => c.username)).toEqual(["postdoc"]);
    expect(forest[0].children[0].children.map((c) => c.username)).toEqual([
      "student",
    ]);
  });

  it("roots are mentors who are not themselves mentored", () => {
    const forest = buildMentorshipForest([
      space(["pi", "a"], "pi"),
      space(["pi", "b"], "pi"),
    ]);
    expect(forest.map((r) => r.username)).toEqual(["pi"]);
    expect(forest[0].children.map((c) => c.username)).toEqual(["a", "b"]);
  });

  it("peer spaces contribute no nodes", () => {
    expect(buildMentorshipForest([space(["a", "b"], null)])).toEqual([]);
  });

  it("guards a cycle (a -> b, b -> a) without infinite-looping", () => {
    const forest = buildMentorshipForest([
      space(["a", "b"], "a"),
      space(["b", "a"], "b"),
    ]);
    // Both are mentors AND mentees, so neither is a root: no infinite recursion
    // and an empty forest (no un-mentored mentor exists).
    expect(forest).toEqual([]);
  });

  it("a person mentors in one space and is mentored in another (threads)", () => {
    const forest = buildMentorshipForest([
      space(["pi", "postdoc"], "pi"),
      space(["postdoc", "ugrad"], "postdoc"),
      space(["pi", "grad"], "pi"),
    ]);
    expect(forest).toHaveLength(1);
    const root = forest[0];
    expect(root.username).toBe("pi");
    expect(root.children.map((c) => c.username)).toEqual(["grad", "postdoc"]);
    const postdoc = root.children.find((c) => c.username === "postdoc")!;
    expect(postdoc.children.map((c) => c.username)).toEqual(["ugrad"]);
  });
});

describe("directMentorsOf", () => {
  it("maps a mentee to its direct mentor(s)", () => {
    const map = directMentorsOf([
      space(["pi", "student"], "pi"),
      space(["postdoc", "student"], "postdoc"),
    ]);
    expect(Array.from(map.get("student") ?? []).sort()).toEqual([
      "pi",
      "postdoc",
    ]);
  });
});

describe("isSkipLevel", () => {
  it("is true when the mentor checks in with a trainee who reports through someone else", () => {
    const closer = space(["postdoc", "student"], "postdoc", "closer");
    const skip = space(["pi", "student"], "pi", "skip");
    expect(isSkipLevel(skip, [closer, skip])).toBe(true);
  });

  it("is false for a direct mentoring relationship with no closer mentor", () => {
    const direct = space(["pi", "student"], "pi", "direct");
    expect(isSkipLevel(direct, [direct])).toBe(false);
  });

  it("is false for a peer space", () => {
    const peer = space(["a", "b"], null, "peer");
    expect(isSkipLevel(peer, [peer])).toBe(false);
  });

  it("is false when the only closer edge IS this space's own edge", () => {
    // The closer mentor is the SAME person as this space's mentor, not a skip.
    const same = space(["pi", "student"], "pi", "same");
    const dup = space(["pi", "student"], "pi", "dup");
    expect(isSkipLevel(same, [same, dup])).toBe(false);
  });
});
