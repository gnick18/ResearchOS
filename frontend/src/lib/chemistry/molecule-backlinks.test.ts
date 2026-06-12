// Chemistry Phase 3 (2026-06-11). Unit tests for the molecule backlinks scanner.
//
// The scanner is pure in terms of its output given fake API data: it reads note
// bodies (entries[].content), experiment files (notes.md / results.md via
// fileService.readText), and method source_path files. We mock those seams and
// verify that the correct references are returned.
//
// We do NOT test the async lazy-import path end-to-end in jsdom; instead we test
// the two pure helpers:
//   1. moleculeNeedle(id) returns the expected deep link string
//   2. The body-matching logic: given known bodies, backlinks are found or not
//
// The scanner itself is integration-tested by verifying it returns correct types
// for a mocked setup. File-system reads and API calls are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { objectDeepLink } from "@/lib/references";

// ── Unit tests for pure helpers ───────────────────────────────────────────────

describe("objectDeepLink for molecule type", () => {
  it("builds the expected molecule deep link path", () => {
    expect(objectDeepLink("molecule", "14")).toBe("/chemistry?molecule=14");
    expect(objectDeepLink("molecule", "abc")).toBe("/chemistry?molecule=abc");
  });

  it("URL-encodes special characters in ids", () => {
    // Ids are numeric in practice, but the function should be robust.
    expect(objectDeepLink("molecule", "a b")).toBe("/chemistry?molecule=a%20b");
  });
});

// ── Body-matching logic test ──────────────────────────────────────────────────
// The scanner uses a regex with a non-word boundary guard so that molecule=42
// does not match molecule=420. We test both the hit and the false-positive guard.

/** Mirrors the private moleculeNeedleRegex from the scanner module. */
function testNeedleRegex(id: string): RegExp {
  const path = objectDeepLink("molecule", id);
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped + "(?![\\w%-])", "i");
}

describe("molecule reference regex detection in body text", () => {
  const re42 = testNeedleRegex("42");

  it("finds a markdown link form", () => {
    const body = `Here is a reference [Aspirin](/chemistry?molecule=42) in a note.`;
    expect(re42.test(body)).toBe(true);
  });

  it("does not match a different molecule id", () => {
    const body = `Here is a reference [Aspirin](/chemistry?molecule=99) in a note.`;
    expect(re42.test(body)).toBe(false);
  });

  it("finds the needle in a multi-line body", () => {
    const body = [
      "# Protocol heading",
      "",
      "Dissolve compound using the following reagent:",
      `[Acetic acid](/chemistry?molecule=42)`,
      "",
      "Incubate for 30 min.",
    ].join("\n");
    expect(re42.test(body)).toBe(true);
  });

  it("does not false-positive on a partial id match (id=42 vs id=420)", () => {
    const body = `/chemistry?molecule=420`;
    // The regex boundary prevents id=42 from matching inside id=420.
    expect(re42.test(body)).toBe(false);
  });

  it("does not false-positive when id appears as part of a larger alphanumeric token", () => {
    const body = `/chemistry?molecule=42abc`;
    expect(re42.test(body)).toBe(false);
  });
});

// ── Integration-level mock test ───────────────────────────────────────────────
// Mock the lazy imports so we can exercise scanMoleculeBacklinks in isolation.

vi.mock("@/lib/local-api", () => ({
  notesApi: {
    list: vi.fn(),
  },
  tasksApi: {
    listByProject: vi.fn(),
  },
  projectsApi: {
    list: vi.fn(),
  },
  methodsApi: {
    list: vi.fn(),
  },
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readText: vi.fn(),
  },
}));

vi.mock("@/lib/storage/json-store", () => ({
  getCurrentUserCached: vi.fn(() => Promise.resolve("alice")),
}));

describe("scanMoleculeBacklinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a note whose entry body contains the molecule link", async () => {
    const needle = objectDeepLink("molecule", "7");
    const { notesApi, tasksApi, projectsApi, methodsApi } = await import("@/lib/local-api");
    const { fileService } = await import("@/lib/file-system/file-service");

    vi.mocked(notesApi.list).mockResolvedValue([
      {
        id: 1,
        title: "Lab book",
        entries: [{ id: "e1", title: "Day 1", date: "2026-06-11", content: `See [mol](${needle})`, created_at: "", updated_at: "" }],
        description: "",
        is_running_log: false,
        is_shared: false,
        comments: [],
        created_at: "",
        updated_at: "",
        username: "alice",
      } as never,
    ]);
    vi.mocked(projectsApi.list).mockResolvedValue([]);
    vi.mocked(tasksApi.listByProject).mockResolvedValue([]);
    vi.mocked(methodsApi.list).mockResolvedValue([]);
    vi.mocked(fileService.readText).mockResolvedValue(null);

    const { scanMoleculeBacklinks } = await import("./molecule-backlinks");
    const results = await scanMoleculeBacklinks("7");

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("note");
    expect(results[0].id).toBe("1");
    expect(results[0].title).toBe("Lab book");
  });

  it("returns empty when no references found", async () => {
    const { notesApi, tasksApi, projectsApi, methodsApi } = await import("@/lib/local-api");
    const { fileService } = await import("@/lib/file-system/file-service");

    vi.mocked(notesApi.list).mockResolvedValue([
      {
        id: 2,
        title: "Other note",
        entries: [{ id: "e1", title: "Day 1", date: "2026-06-11", content: "Nothing relevant here", created_at: "", updated_at: "" }],
        description: "",
        is_running_log: false,
        is_shared: false,
        comments: [],
        created_at: "",
        updated_at: "",
        username: "alice",
      } as never,
    ]);
    vi.mocked(projectsApi.list).mockResolvedValue([]);
    vi.mocked(tasksApi.listByProject).mockResolvedValue([]);
    vi.mocked(methodsApi.list).mockResolvedValue([]);
    vi.mocked(fileService.readText).mockResolvedValue(null);

    const { scanMoleculeBacklinks } = await import("./molecule-backlinks");
    const results = await scanMoleculeBacklinks("7");

    expect(results).toHaveLength(0);
  });

  it("finds a reference in a method source_path file", async () => {
    const needle = objectDeepLink("molecule", "55");
    const { notesApi, tasksApi, projectsApi, methodsApi } = await import("@/lib/local-api");
    const { fileService } = await import("@/lib/file-system/file-service");

    vi.mocked(notesApi.list).mockResolvedValue([]);
    vi.mocked(projectsApi.list).mockResolvedValue([]);
    vi.mocked(tasksApi.listByProject).mockResolvedValue([]);
    vi.mocked(methodsApi.list).mockResolvedValue([
      {
        id: 10,
        name: "HPLC method",
        source_path: "methods/hplc/body.md",
        method_type: "markdown",
        folder_path: null,
        parent_method_id: null,
        tags: null,
        is_public: false,
        created_by: null,
        owner: "alice",
        shared_with: [],
      } as never,
    ]);
    vi.mocked(fileService.readText).mockImplementation((path: string) => {
      if (path === "methods/hplc/body.md") {
        return Promise.resolve(`Use [compound](${needle}) at 1 mM.`);
      }
      return Promise.resolve(null);
    });

    const { scanMoleculeBacklinks } = await import("./molecule-backlinks");
    const results = await scanMoleculeBacklinks("55");

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("method");
    expect(results[0].title).toBe("HPLC method");
  });
});
