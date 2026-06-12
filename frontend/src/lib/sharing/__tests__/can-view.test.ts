// Phase 6a (phase6a-foundation bot, 2026-06-12). Unit tests for can-view.ts.
//
// Tests the unified canViewObject predicate per type. Mocks the stores and APIs.
// The canRead logic itself is tested by unified.test.ts; here we verify that
// canViewObject wires the right source-of-truth for each type.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { canViewObject } from "@/lib/sharing/can-view";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/local-api", () => ({
  notesApi: { get: vi.fn() },
  methodsApi: { get: vi.fn() },
  projectsApi: { get: vi.fn() },
  tasksApi: { get: vi.fn() },
  sequencesApi: { get: vi.fn() },
  buildCurrentViewer: vi.fn(),
}));

vi.mock("@/lib/chemistry/molecule-store", () => ({
  moleculeStore: {
    getRawForUser: vi.fn(),
  },
}));

vi.mock("@/lib/storage/json-store", () => ({
  getCurrentUserCached: vi.fn(),
}));

import {
  notesApi,
  methodsApi,
  projectsApi,
  tasksApi,
  sequencesApi,
  buildCurrentViewer,
} from "@/lib/local-api";
import { moleculeStore } from "@/lib/chemistry/molecule-store";

const mockNoteGet = vi.mocked(notesApi.get);
const mockMethodGet = vi.mocked(methodsApi.get);
const mockProjectGet = vi.mocked(projectsApi.get);
const mockTaskGet = vi.mocked(tasksApi.get);
const mockSeqGet = vi.mocked(sequencesApi.get);
const mockMolGet = vi.mocked(moleculeStore.getRawForUser);
const mockBuildViewer = vi.mocked(buildCurrentViewer);

const labViewer = (username: string) => ({ username, account_type: "lab" as const });
const headViewer = (username: string) => ({ username, account_type: "lab_head" as const });

// Helpers to build minimal records
function makeNote(owner: string, shared_with: unknown[] = []) {
  return { id: 1, owner, shared_with, title: "Note", is_shared: false, entries: [], updated_at: "" };
}

function makeTask(owner: string, shared_with: unknown[] = []) {
  return { id: 1, owner, shared_with, name: "Task", project_id: 0, start_date: "", duration_days: 1, end_date: "", is_high_level: false, is_complete: false, task_type: "list" as const, weekend_override: null, method_ids: [], deviation_log: null, tags: null, sort_order: 0, experiment_color: null, sub_tasks: null, method_attachments: [] };
}

function makeMethod(owner: string, shared_with: unknown[] = []) {
  return { id: 1, owner, shared_with, name: "PCR", source_path: null, method_type: null, folder_path: null, parent_method_id: null, tags: null, is_public: false, created_by: null };
}

function makeProject(owner: string, shared_with: unknown[] = []) {
  return { id: 1, owner, shared_with, name: "Lab Project", weekend_active: false, tags: null, color: null, created_at: "", sort_order: 0, is_archived: false, archived_at: null };
}

// ── Note access ──────────────────────────────────────────────────────────────

describe("canViewObject note", () => {
  beforeEach(() => vi.clearAllMocks());

  it("owner always sees their own note", async () => {
    const note = makeNote("alice");
    mockNoteGet.mockResolvedValue(note as never);
    mockBuildViewer.mockResolvedValue(labViewer("alice"));
    expect(await canViewObject("note", "1", "alice")).toBe(true);
  });

  it("a user explicitly in shared_with can view the note", async () => {
    const note = makeNote("alice", [{ username: "bob", level: "read" }]);
    mockNoteGet.mockResolvedValue(note as never);
    mockBuildViewer.mockResolvedValue(labViewer("bob"));
    expect(await canViewObject("note", "1", "bob")).toBe(true);
  });

  it("a whole-lab share makes the note visible to any lab member", async () => {
    const note = makeNote("alice", [{ username: "*", level: "read" }]);
    mockNoteGet.mockResolvedValue(note as never);
    mockBuildViewer.mockResolvedValue(labViewer("carol"));
    expect(await canViewObject("note", "1", "carol")).toBe(true);
  });

  it("an unshared note owned by someone else is not visible to others", async () => {
    const note = makeNote("alice");
    mockNoteGet.mockResolvedValue(note as never);
    mockBuildViewer.mockResolvedValue(labViewer("bob"));
    expect(await canViewObject("note", "1", "bob")).toBe(false);
  });

  it("lab_head sees any note", async () => {
    const note = makeNote("alice");
    mockNoteGet.mockResolvedValue(note as never);
    mockBuildViewer.mockResolvedValue(headViewer("head"));
    expect(await canViewObject("note", "1", "head")).toBe(true);
  });

  it("returns false when the note does not exist", async () => {
    mockNoteGet.mockResolvedValue(null);
    expect(await canViewObject("note", "999", "alice")).toBe(false);
  });

  it("returns false for a non-numeric id", async () => {
    expect(await canViewObject("note", "not-a-number", "alice")).toBe(false);
  });
});

// ── Method access ────────────────────────────────────────────────────────────

describe("canViewObject method", () => {
  beforeEach(() => vi.clearAllMocks());

  it("owner sees own method", async () => {
    const method = makeMethod("alice");
    mockMethodGet.mockResolvedValue(method as never);
    mockBuildViewer.mockResolvedValue(labViewer("alice"));
    expect(await canViewObject("method", "1", "alice")).toBe(true);
  });

  it("a public method (owner=public) is visible to any user", async () => {
    const method = { ...makeMethod("public"), owner: "public", is_public: true };
    mockMethodGet.mockResolvedValue(method as never);
    expect(await canViewObject("method", "1", "bob")).toBe(true);
  });

  it("unshared private method is not visible to non-owner", async () => {
    const method = makeMethod("alice");
    mockMethodGet.mockResolvedValue(method as never);
    mockBuildViewer.mockResolvedValue(labViewer("bob"));
    expect(await canViewObject("method", "1", "bob")).toBe(false);
  });

  it("returns false when method does not exist", async () => {
    mockMethodGet.mockResolvedValue(null);
    expect(await canViewObject("method", "999", "alice")).toBe(false);
  });
});

// ── Sequence access ──────────────────────────────────────────────────────────

describe("canViewObject sequence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when the sequence exists in the user's library", async () => {
    mockSeqGet.mockResolvedValue({ id: 1, display_name: "pUC19", seq: "ATCG" } as never);
    expect(await canViewObject("sequence", "1", "alice")).toBe(true);
  });

  it("returns false when the sequence does not exist", async () => {
    mockSeqGet.mockResolvedValue(null);
    expect(await canViewObject("sequence", "999", "alice")).toBe(false);
  });

  it("returns false for a non-numeric sequence id", async () => {
    expect(await canViewObject("sequence", "not-a-number", "alice")).toBe(false);
  });
});

// ── Molecule access ──────────────────────────────────────────────────────────

describe("canViewObject molecule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when the molecule exists in the user's library", async () => {
    mockMolGet.mockResolvedValue({ meta: { id: "mol-1", name: "Aspirin" }, molfile: "" } as never);
    expect(await canViewObject("molecule", "mol-1", "alice")).toBe(true);
  });

  it("returns false when the molecule does not exist", async () => {
    mockMolGet.mockResolvedValue(null);
    expect(await canViewObject("molecule", "mol-999", "alice")).toBe(false);
  });
});

// ── Non-existent object ──────────────────────────────────────────────────────

describe("canViewObject edge cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns false for empty id", async () => {
    expect(await canViewObject("note", "", "alice")).toBe(false);
  });

  it("returns false for empty currentUser", async () => {
    expect(await canViewObject("note", "1", "")).toBe(false);
  });

  it("returns false for file type (out of scope)", async () => {
    expect(await canViewObject("file", "some-file", "alice")).toBe(false);
  });

  it("returns true for datahub type (no gate in Phase 6a)", async () => {
    expect(await canViewObject("datahub", "some-doc", "alice")).toBe(true);
  });

  it("swallows I/O errors and returns false", async () => {
    mockNoteGet.mockRejectedValue(new Error("Folder disconnected"));
    expect(await canViewObject("note", "1", "alice")).toBe(false);
  });
});
