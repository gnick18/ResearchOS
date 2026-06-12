// Phase 6a (phase6a-foundation bot, 2026-06-12). Unit tests for
// portable-identity.ts: portableIdentityFor and resolveByPortableId.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  portableIdentityFor,
  resolveByPortableId,
} from "@/lib/sharing/portable-identity";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/local-api", () => ({
  sequencesApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  notesApi: {
    list: vi.fn(),
  },
  methodsApi: {
    list: vi.fn(),
  },
  projectsApi: {
    list: vi.fn(),
  },
  fetchAllTasksIncludingShared: vi.fn(),
}));

vi.mock("@/lib/chemistry/molecule-store", () => ({
  moleculeStore: {
    listMetaForUser: vi.fn(),
  },
}));

import {
  sequencesApi,
  notesApi,
  methodsApi,
  projectsApi,
  fetchAllTasksIncludingShared,
} from "@/lib/local-api";
import { moleculeStore } from "@/lib/chemistry/molecule-store";

const mockSeqList = vi.mocked(sequencesApi.list);
const mockSeqGet = vi.mocked(sequencesApi.get);
const mockNoteList = vi.mocked(notesApi.list);
const mockMethodList = vi.mocked(methodsApi.list);
const mockProjectList = vi.mocked(projectsApi.list);
const mockTaskList = vi.mocked(fetchAllTasksIncludingShared);
const mockMolList = vi.mocked(moleculeStore.listMetaForUser);

// ── portableIdentityFor ──────────────────────────────────────────────────────

describe("portableIdentityFor", () => {
  it("returns InChIKey for a molecule fixture", () => {
    const molecule = { id: "mol-1", name: "Aspirin", inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N" };
    expect(portableIdentityFor("molecule", molecule)).toBe("BSYNRYMUTXBXSQ-UHFFFAOYSA-N");
  });

  it("returns null for a molecule without inchikey", () => {
    const molecule = { id: "mol-1", name: "Unknown", inchikey: "" };
    expect(portableIdentityFor("molecule", molecule)).toBeNull();
  });

  it("returns null for a molecule with no inchikey field", () => {
    const molecule = { id: "mol-1", name: "No key" };
    expect(portableIdentityFor("molecule", molecule)).toBeNull();
  });

  it("returns content fingerprint (seqIdentity) for a sequence with seq bases", () => {
    // seqIdentity("ATCG") = "4:h" where h is the djb2 hash. We just verify it
    // returns a non-null string in the expected "length:hash" format.
    const sequence = { id: 1, seq: "ATCGATCG", display_name: "pUC19" };
    const identity = portableIdentityFor("sequence", sequence);
    expect(typeof identity).toBe("string");
    expect(identity).not.toBeNull();
    // Format: "<length>:<uint32hash>"
    expect(identity).toMatch(/^\d+:\d+$/);
  });

  it("returns the same fingerprint for the same sequence bases (deterministic)", () => {
    const seq = { seq: "ATCGATCGATCG" };
    const a = portableIdentityFor("sequence", seq);
    const b = portableIdentityFor("sequence", seq);
    expect(a).toBe(b);
  });

  it("returns different fingerprints for different sequences", () => {
    const a = portableIdentityFor("sequence", { seq: "AAAA" });
    const b = portableIdentityFor("sequence", { seq: "TTTT" });
    expect(a).not.toBe(b);
  });

  it("returns null for a sequence with no bases", () => {
    expect(portableIdentityFor("sequence", { seq: "" })).toBeNull();
    expect(portableIdentityFor("sequence", { id: 1, display_name: "no bases" })).toBeNull();
  });

  it("returns source_uuid for a note fixture", () => {
    const note = { id: 1, source_uuid: "uuid-note-1", title: "My Note" };
    expect(portableIdentityFor("note", note)).toBe("uuid-note-1");
  });

  it("returns source_uuid for a method fixture", () => {
    const method = { id: 2, source_uuid: "uuid-method-2", name: "PCR" };
    expect(portableIdentityFor("method", method)).toBe("uuid-method-2");
  });

  it("returns source_uuid for a project fixture", () => {
    const project = { id: 3, source_uuid: "uuid-project-3", name: "Lab Project" };
    expect(portableIdentityFor("project", project)).toBe("uuid-project-3");
  });

  it("returns source_uuid for a task fixture", () => {
    const task = { id: 4, source_uuid: "uuid-task-4", name: "Run experiment" };
    expect(portableIdentityFor("task", task)).toBe("uuid-task-4");
  });

  it("returns source_uuid for an experiment fixture", () => {
    const experiment = { id: 5, source_uuid: "uuid-exp-5", task_type: "experiment" };
    expect(portableIdentityFor("experiment", experiment)).toBe("uuid-exp-5");
  });

  it("returns null when source_uuid is missing on a note", () => {
    const note = { id: 1, title: "Old note without uuid" };
    expect(portableIdentityFor("note", note)).toBeNull();
  });

  it("returns null for null record", () => {
    expect(portableIdentityFor("note", null)).toBeNull();
  });

  it("returns null for undefined record", () => {
    expect(portableIdentityFor("method", undefined)).toBeNull();
  });

  it("returns null for non-object record", () => {
    expect(portableIdentityFor("project", "not-an-object")).toBeNull();
  });
});

// ── resolveByPortableId ──────────────────────────────────────────────────────

describe("resolveByPortableId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds a note by source_uuid and returns its local id", async () => {
    mockNoteList.mockResolvedValue([
      { id: 10, source_uuid: "uuid-note-10", title: "Note A" } as never,
      { id: 11, source_uuid: "uuid-note-11", title: "Note B" } as never,
    ]);
    const result = await resolveByPortableId("note", "uuid-note-11", "alice");
    expect(result).toEqual({ id: "11" });
  });

  it("returns null when no note matches the portable id", async () => {
    mockNoteList.mockResolvedValue([
      { id: 10, source_uuid: "uuid-note-10", title: "Note A" } as never,
    ]);
    const result = await resolveByPortableId("note", "nonexistent-uuid", "alice");
    expect(result).toBeNull();
  });

  it("finds a method by source_uuid", async () => {
    mockMethodList.mockResolvedValue([
      { id: 20, source_uuid: "uuid-method-20", name: "PCR" } as never,
    ]);
    const result = await resolveByPortableId("method", "uuid-method-20", "alice");
    expect(result).toEqual({ id: "20" });
  });

  it("finds a project by source_uuid", async () => {
    mockProjectList.mockResolvedValue([
      { id: 30, source_uuid: "uuid-project-30", name: "Lab 2026" } as never,
    ]);
    const result = await resolveByPortableId("project", "uuid-project-30", "alice");
    expect(result).toEqual({ id: "30" });
  });

  it("finds a molecule by InChIKey", async () => {
    mockMolList.mockResolvedValue([
      { id: "mol-1", inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N", name: "Aspirin" } as never,
      { id: "mol-2", inchikey: "OTHER-KEY", name: "Other" } as never,
    ]);
    const result = await resolveByPortableId("molecule", "BSYNRYMUTXBXSQ-UHFFFAOYSA-N", "alice");
    expect(result).toEqual({ id: "mol-1" });
  });

  it("finds a sequence by content fingerprint", async () => {
    const bases = "ATCGATCG";
    // Compute the expected fingerprint using the same seqIdentity function.
    const { seqIdentity } = await import("@/lib/sequences/find");
    const expectedFp = seqIdentity(bases);

    mockSeqList.mockResolvedValue([{ id: 5, display_name: "pUC19" } as never]);
    mockSeqGet.mockResolvedValue({ id: 5, seq: bases, display_name: "pUC19" } as never);

    const result = await resolveByPortableId("sequence", expectedFp, "alice");
    expect(result).toEqual({ id: "5" });
  });

  it("returns null when no sequence matches the fingerprint", async () => {
    mockSeqList.mockResolvedValue([{ id: 5, display_name: "pUC19" } as never]);
    mockSeqGet.mockResolvedValue({ id: 5, seq: "AAAA", display_name: "pUC19" } as never);

    const result = await resolveByPortableId("sequence", "9999:99999", "alice");
    expect(result).toBeNull();
  });

  it("returns null for empty portableId", async () => {
    const result = await resolveByPortableId("note", "", "alice");
    expect(result).toBeNull();
  });

  it("returns null for empty currentUser", async () => {
    const result = await resolveByPortableId("note", "some-uuid", "");
    expect(result).toBeNull();
  });

  it("finds a task by source_uuid via fetchAllTasksIncludingShared", async () => {
    mockTaskList.mockResolvedValue([
      { id: 42, source_uuid: "uuid-task-42", task_type: "list", name: "My task" } as never,
    ]);
    const result = await resolveByPortableId("task", "uuid-task-42", "alice");
    expect(result).toEqual({ id: "42" });
  });

  it("returns null for datahub (out of scope)", async () => {
    const result = await resolveByPortableId("datahub", "some-doc-id", "alice");
    expect(result).toBeNull();
  });

  it("returns null for file (out of scope)", async () => {
    const result = await resolveByPortableId("file", "some-file-id", "alice");
    expect(result).toBeNull();
  });
});
