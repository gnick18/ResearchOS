import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage/json-store", () => ({
  getCurrentUserCached: () => Promise.resolve("alex"),
}));
const readText = vi.fn();
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: { readText: (...a: unknown[]) => readText(...a) },
}));
const notesList = vi.fn();
const projectsList = vi.fn();
const listByProject = vi.fn();
const methodsList = vi.fn();
vi.mock("@/lib/local-api", () => ({
  notesApi: { list: (...a: unknown[]) => notesList(...a) },
  projectsApi: { list: (...a: unknown[]) => projectsList(...a) },
  tasksApi: { listByProject: (...a: unknown[]) => listByProject(...a) },
  methodsApi: { list: (...a: unknown[]) => methodsList(...a) },
}));

import { scanBacklinks } from "./object-backlinks";

beforeEach(() => {
  vi.clearAllMocks();
  notesList.mockResolvedValue([]);
  projectsList.mockResolvedValue([]);
  listByProject.mockResolvedValue([]);
  methodsList.mockResolvedValue([]);
  readText.mockResolvedValue("");
});

describe("scanBacklinks", () => {
  it("finds a note that references the object by deep link (mention or embed)", async () => {
    notesList.mockResolvedValue([
      {
        id: 7,
        title: "Cloning note",
        entries: [{ content: "We used [pUC19](/sequences?seq=5#ros=map) here." }],
      },
    ]);
    const r = await scanBacklinks("sequence", "5");
    expect(r).toEqual([{ type: "note", id: "7", title: "Cloning note", href: "/notes/7" }]);
  });

  it("does not match a longer id (seq=5 must not match seq=50)", async () => {
    notesList.mockResolvedValue([
      { id: 7, title: "x", entries: [{ content: "[a](/sequences?seq=50)" }] },
    ]);
    expect(await scanBacklinks("sequence", "5")).toEqual([]);
  });

  it("scans markdown method bodies via the file service", async () => {
    methodsList.mockResolvedValue([
      { id: 3, name: "Gibson", method_type: "markdown", source_path: "methods/gibson/m.md" },
    ]);
    readText.mockResolvedValue("dosed with [Resveratrol](/chemistry?molecule=9)");
    const r = await scanBacklinks("molecule", "9");
    expect(r).toEqual([{ type: "method", id: "3", title: "Gibson", href: "/methods?openMethod=3" }]);
  });

  it("scans experiment notes.md / results.md and dedups one entry per task", async () => {
    projectsList.mockResolvedValue([{ id: 1 }]);
    listByProject.mockResolvedValue([{ id: 10, name: "Run 10" }]);
    readText.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("results.md") ? "[OD](/datahub?doc=2#ros=plot)" : ""),
    );
    const r = await scanBacklinks("datahub", "2");
    expect(r).toEqual([{ type: "experiment", id: "10", title: "Run 10", href: "/?openTask=10" }]);
  });

  it("returns nothing when an object is referenced nowhere", async () => {
    notesList.mockResolvedValue([{ id: 1, title: "n", entries: [{ content: "no refs here" }] }]);
    expect(await scanBacklinks("method", "99")).toEqual([]);
  });
});
