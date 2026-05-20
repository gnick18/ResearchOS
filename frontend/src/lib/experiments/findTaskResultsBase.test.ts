// Tests for the stamp-stripping in `getResultsPreview` and the
// migration-sentinel guard in `candidateBases`. The card preview in
// /lab Experiments was rendering the leading `<!-- stamp:start -->` … `<!-- stamp:end -->`
// block as visible text when results.md had no hero image. The fix delegates
// stamp stripping to the canonical `extractUserContent` helper. The probe
// guard skips the legacy global path when the per-user canonical base has the
// `.migrated-from-legacy.json` sentinel — fixes the bug where the hero card
// surfaced orphan legacy images while the popup's per-tab strips showed nothing.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, string>();
const dirIndex = new Map<string, Set<string>>();

function indexDir(dirPath: string, filename: string): void {
  const set = dirIndex.get(dirPath) ?? new Set<string>();
  set.add(filename);
  dirIndex.set(dirPath, set);
}

function setFile(path: string, text: string): void {
  memFs.set(path, text);
  const slash = path.lastIndexOf("/");
  if (slash > 0) indexDir(path.slice(0, slash), path.slice(slash + 1));
}

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readFileAsBlob: vi.fn(async (path: string) => {
      const text = memFs.get(path);
      if (text === undefined) return null;
      return new Blob([text], { type: "text/markdown" });
    }),
    listFiles: vi.fn(async (dirPath: string) => {
      const set = dirIndex.get(dirPath);
      return set ? [...set].sort() : [];
    }),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
  },
}));

vi.mock("../tasks/results-paths", () => ({
  findExistingTaskResultsBase: vi.fn(async () => null),
  legacyTaskResultsBase: (id: number) => `legacy/task-${id}`,
  taskResultsBase: (task: { id: number; owner: string }) =>
    `users/${task.owner}/results/task-${task.id}`,
}));

import { getResultsPreview, probeTaskResults } from "./findTaskResultsBase";

beforeEach(() => {
  memFs.clear();
  dirIndex.clear();
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

describe("probeTaskResults — migration sentinel guard", () => {
  it("ignores legacy global Images/ when the canonical base has the migration marker", async () => {
    // Canonical: marker present, no images anywhere on canonical side.
    setFile(
      "users/grant/results/task-37/.migrated-from-legacy.json",
      JSON.stringify({ version: 1, migratedAt: "2026-05-01T00:00:00Z" })
    );
    // Legacy: orphan image left behind by the per-tab split migration.
    setFile("legacy/task-37/Images/orphan.png", "<binary>");

    const probe = await probeTaskResults({ id: 37, owner: "grant" });
    expect(probe.heroImagePath).toBeNull();
    expect(probe.resultsPreview).toBeNull();
    expect(probe.hasResult).toBe(false);
  });

  it("returns the canonical per-tab image when the marker exists and canonical Images/ is populated", async () => {
    setFile(
      "users/grant/results/task-42/.migrated-from-legacy.json",
      JSON.stringify({ version: 1, migratedAt: "2026-05-01T00:00:00Z" })
    );
    setFile("users/grant/results/task-42/results/Images/blot.png", "<binary>");
    // Legacy still has a stale image — must be ignored.
    setFile("legacy/task-42/Images/stale.png", "<binary>");

    const probe = await probeTaskResults({ id: 42, owner: "grant" });
    expect(probe.heroImagePath).toBe(
      "users/grant/results/task-42/results/Images/blot.png"
    );
    expect(probe.hasResult).toBe(true);
  });

  it("falls back to the legacy global Images/ ONLY for pre-migration tasks (no marker)", async () => {
    // No marker → migration never ran for this task. Legacy is still the
    // source of truth and must surface.
    setFile("legacy/task-50/Images/preserved.png", "<binary>");

    const probe = await probeTaskResults({ id: 50, owner: "grant" });
    expect(probe.heroImagePath).toBe("legacy/task-50/Images/preserved.png");
    expect(probe.hasResult).toBe(true);
  });
});
