// Tests for the stamp-stripping in `getResultsPreview`. The card preview in
// /lab Experiments was rendering the leading `<!-- stamp:start -->` … `<!-- stamp:end -->`
// block as visible text when results.md had no hero image. The fix delegates
// stamp stripping to the canonical `extractUserContent` helper.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, string>();

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readFileAsBlob: vi.fn(async (path: string) => {
      const text = memFs.get(path);
      if (text === undefined) return null;
      return new Blob([text], { type: "text/markdown" });
    }),
    listFiles: vi.fn(async () => []),
  },
}));

vi.mock("../tasks/results-paths", () => ({
  findExistingTaskResultsBase: vi.fn(async () => null),
  legacyTaskResultsBase: (id: number) => `legacy/task-${id}`,
  taskResultsBase: (task: { id: number; owner: string }) =>
    `users/${task.owner}/results/task-${task.id}`,
}));

import { getResultsPreview } from "./findTaskResultsBase";

beforeEach(() => {
  memFs.clear();
});

describe("getResultsPreview", () => {
  it("strips a leading HTML-comment stamp block before slicing the preview", async () => {
    const stamped = [
      "<!-- stamp:start -->",
      "2026-05-14  ",
      "12:07 PM  ",
      "experiment: Western Blot  ",
      "project folder: Protein Research  ",
      "<!-- stamp:end -->",
      "___",
      "",
      "Band intensity matches predicted molecular weight.",
      "Second replicate confirms.",
      "Ready to move to quantification.",
    ].join("\n");

    memFs.set("users/grant/results/task-7/results.md", stamped);

    const preview = await getResultsPreview({ id: 7, owner: "grant" });
    expect(preview).not.toContain("<!--");
    expect(preview).not.toContain("stamp:");
    expect(preview).toBe(
      [
        "Band intensity matches predicted molecular weight.",
        "Second replicate confirms.",
        "Ready to move to quantification.",
      ].join("\n")
    );
  });

  it("strips the legacy `[stamp-start]:` link-reference format too", async () => {
    const stamped = [
      "[stamp-start]: # (hidden)",
      "2026-04-01  ",
      "9:00 AM  ",
      "experiment: Old Format  ",
      "project folder: Legacy  ",
      "[stamp-end]: # (hidden)",
      "___",
      "",
      "Real result content here.",
    ].join("\n");

    memFs.set("users/grant/results/task-9/results.md", stamped);

    const preview = await getResultsPreview({ id: 9, owner: "grant" });
    expect(preview).toBe("Real result content here.");
  });

  it("returns null when the file is stamps-only with no body content", async () => {
    const stampOnly = [
      "<!-- stamp:start -->",
      "2026-05-14  ",
      "12:07 PM  ",
      "experiment: Empty  ",
      "project folder: Foo  ",
      "<!-- stamp:end -->",
      "___",
    ].join("\n");

    memFs.set("users/grant/results/task-11/results.md", stampOnly);

    const preview = await getResultsPreview({ id: 11, owner: "grant" });
    expect(preview).toBeNull();
  });
});
