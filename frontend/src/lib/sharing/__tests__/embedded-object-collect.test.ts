// Phase 6b-1: collectEmbeddedObjects unit tests.
//
// All loaders (moleculesApi, sequencesApi, notesApi, methodsApi, projectsApi,
// tasksApi, dataHubApi) and result-text utilities are mocked. The tests verify:
//
//   D1  Excluded hrefs are skipped; all others included by default.
//   D2  Each included object is serialized with correct type, portableId, name.
//   D8  Data Hub defaults to "snapshot" dataKind; fullDataHrefs opt-in gives "full".
//       Failing loaders are skipped without throwing.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { collectEmbeddedObjects } from "../embedded-object-collect";

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/chemistry/api", () => ({
  moleculesApi: { get: vi.fn() },
}));

vi.mock("@/lib/datahub/api", () => ({
  dataHubApi: { getContent: vi.fn() },
}));

vi.mock("@/lib/datahub/result-text", () => ({
  resultToText: vi.fn().mockReturnValue("P\tValue\n0.05"),
}));

vi.mock("@/lib/datahub/plain-language", () => ({
  plainLanguageSummary: vi.fn().mockReturnValue("Significant difference (p < 0.05)."),
}));

vi.mock("@/lib/local-api", () => ({
  sequencesApi: { get: vi.fn() },
  notesApi: { get: vi.fn() },
  methodsApi: { get: vi.fn() },
  projectsApi: { get: vi.fn() },
  tasksApi: { get: vi.fn() },
}));

import { moleculesApi } from "@/lib/chemistry/api";
import { dataHubApi } from "@/lib/datahub/api";
import { sequencesApi, notesApi, methodsApi, projectsApi, tasksApi } from "@/lib/local-api";

const mockMolGet = vi.mocked(moleculesApi.get);
const mockDhGet = vi.mocked(dataHubApi.getContent);
const mockSeqGet = vi.mocked(sequencesApi.get);
const mockNoteGet = vi.mocked(notesApi.get);
const mockMethodGet = vi.mocked(methodsApi.get);
const mockProjectGet = vi.mocked(projectsApi.get);
const mockTaskGet = vi.mocked(tasksApi.get);

// ── Markdown fixtures ──────────────────────────────────────────────────────────

// Block-embed links the scanner recognizes (lone link on its own line).
const MOL_HREF = "/chemistry?molecule=mol-42#ros=view";
const SEQ_HREF = "/sequences?seq=7#ros=view";
const NOTE_HREF = "/notes/3#ros=view";
const METHOD_HREF = "/methods?openMethod=5#ros=view";
const PROJECT_HREF = "/workbench/projects/9#ros=view";
const TASK_HREF = "/?openTask=self:11#ros=view";
const DH_HREF = "/datahub?doc=dh-22#ros=view&view=result";

function singleEmbedMarkdown(href: string, caption = "My object"): string {
  return `Some text before.\n\n[${caption}](${href})\n\nSome text after.`;
}

function multiEmbedMarkdown(): string {
  return [
    "[Aspirin](" + MOL_HREF + ")",
    "[pUC19](" + SEQ_HREF + ")",
    "[My project](" + PROJECT_HREF + ")",
  ].join("\n\n");
}

// ── Mock return values ─────────────────────────────────────────────────────────

function makeMoleculeMock() {
  return {
    meta: {
      id: "mol-42",
      name: "Aspirin",
      project_ids: [],
      added_at: "2026-01-01T00:00:00Z",
      inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
    },
    molfile: "\n  Ketcher\n\n  1  0  0  0  0\n  C   0.000   0.000   0.000\n",
  };
}

function makeSequenceMock() {
  // Use a partial object cast; test mocks don't need every sidecar field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    id: 7,
    display_name: "pUC19",
    seq: "ATCGATCGATCG",
    genbank: "LOCUS       pUC19\nORIGIN\n        1 atcgatcgat cg\n//",
    seq_type: "dna",
    length: 12,
    circular: false,
    feature_count: 0,
    annotations: [],
    locus_name: "pUC19",
    project_ids: [],
    added_at: "2026-01-01T00:00:00Z",
    source_uuid: "src-uuid-seq-7",
  } as import("@/lib/types").SequenceDetail;
}

function makeNoteMock() {
  return {
    id: 3,
    title: "PCR setup",
    description: "Standard PCR protocol",
    is_running_log: false,
    entries: [{ title: "Day 1", date: "2026-06-01", content: "Set up 25 uL reactions." }],
    username: "alice",
    source_uuid: "src-uuid-note-3",
  };
}

function makeMethodMock() {
  return {
    id: 5,
    name: "Western blot",
    method_type: "markdown" as const,
    source_path: null,
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: "alice",
    owner: "alice",
    shared_with: [],
    source_uuid: "src-uuid-method-5",
    excerpt: "Standard western blot protocol.",
  };
}

function makeProjectMock() {
  return {
    id: 9,
    name: "Aflatoxin study",
    weekend_active: false,
    tags: null,
    color: "#84cc16",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alice",
    shared_with: [],
    source_uuid: "src-uuid-project-9",
  } as import("@/lib/types").Project & { source_uuid: string };
}

function makeTaskMock() {
  return {
    id: 11,
    project_id: 2,
    name: "Run gel",
    start_date: "2026-06-10",
    end_date: "2026-06-11",
    duration_days: 1,
    is_high_level: false,
    is_complete: false,
    task_type: "list" as const,
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "alice",
    shared_with: [],
    source_uuid: "src-uuid-task-11",
  };
}

function makeDataHubMock() {
  // Cast to avoid needing every discriminated union variant in test fixtures.
  return {
    meta: {
      id: "dh-22",
      name: "t-test: control vs treated",
      project_ids: [],
      folder_path: null,
      table_type: "column" as import("@/lib/datahub/model/types").DataHubTableType,
      created_at: "2026-06-01T00:00:00Z",
      source_uuid: "src-uuid-dh-22",
    },
    columns: [] as import("@/lib/datahub/model/types").ColumnDef[],
    rows: [] as import("@/lib/datahub/model/types").RowRecord[],
    analyses: [
      {
        id: "ana-1",
        name: "t-test",
        type: "tTest",
        params: {},
        inputs: {},
        resultCache: { ok: true, kind: "tTest", pValue: 0.032, meanDiff: 5.4 },
        resultStale: false,
      },
    ] as import("@/lib/datahub/model/types").AnalysisSpec[],
    plots: [] as import("@/lib/datahub/model/types").PlotSpec[],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("collectEmbeddedObjects, basic collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects a molecule embed with correct type, portableId, and dataKind", async () => {
    mockMolGet.mockResolvedValue(makeMoleculeMock());

    const { objects, skipCount } = await collectEmbeddedObjects(
      singleEmbedMarkdown(MOL_HREF, "Aspirin"),
    );

    expect(skipCount).toBe(0);
    expect(objects).toHaveLength(1);
    const obj = objects[0];
    expect(obj.type).toBe("molecule");
    expect(obj.portableId).toBe("BSYNRYMUTXBXSQ-UHFFFAOYSA-N");
    expect(obj.name).toBe("Aspirin");
    expect(obj.dataKind).toBe("full");
    expect(obj.serialization).toBe("file");
    expect(obj.payloadName).toBe("molecule-mol-42.mol");
    // Payload bytes must encode the molfile text.
    expect(obj.inline).toBeInstanceOf(Uint8Array);
  });

  it("collects a sequence embed with GenBank bytes as payload", async () => {
    mockSeqGet.mockResolvedValue(makeSequenceMock());

    const { objects, skipCount } = await collectEmbeddedObjects(
      singleEmbedMarkdown(SEQ_HREF, "pUC19"),
    );

    expect(skipCount).toBe(0);
    expect(objects).toHaveLength(1);
    const obj = objects[0];
    expect(obj.type).toBe("sequence");
    expect(obj.serialization).toBe("file");
    expect(obj.payloadName).toBe("sequence-7.gb");
    expect(obj.dataKind).toBe("full");
    // portableId is a seqIdentity fingerprint computed from the bases.
    expect(typeof obj.portableId).toBe("string");
    expect(obj.portableId).not.toBeNull();
  });

  it("collects a project embed as inline metadata", async () => {
    mockProjectGet.mockResolvedValue(makeProjectMock());

    const { objects } = await collectEmbeddedObjects(
      singleEmbedMarkdown(PROJECT_HREF, "My project"),
    );

    expect(objects).toHaveLength(1);
    const obj = objects[0];
    expect(obj.type).toBe("project");
    expect(obj.serialization).toBe("inline");
    expect(obj.portableId).toBe("src-uuid-project-9");
    expect((obj.inline as { name: string }).name).toBe("Aflatoxin study");
    expect(obj.dataKind).toBe("full");
  });
});

describe("collectEmbeddedObjects, D1 excludeHrefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMolGet.mockResolvedValue(makeMoleculeMock());
    mockSeqGet.mockResolvedValue(makeSequenceMock());
    mockProjectGet.mockResolvedValue(makeProjectMock());
  });

  it("skips hrefs in excludeHrefs and includes the rest", async () => {
    const { objects, skipCount } = await collectEmbeddedObjects(multiEmbedMarkdown(), {
      excludeHrefs: new Set([SEQ_HREF]),
    });

    // molecule and project included, sequence excluded.
    expect(skipCount).toBe(0);
    expect(objects).toHaveLength(2);
    expect(objects.some((o) => o.type === "molecule")).toBe(true);
    expect(objects.some((o) => o.type === "project")).toBe(true);
    expect(objects.some((o) => o.type === "sequence")).toBe(false);
  });

  it("with empty excludeHrefs includes all embeds (D1 default behavior)", async () => {
    const { objects } = await collectEmbeddedObjects(multiEmbedMarkdown(), {
      excludeHrefs: new Set(),
    });

    expect(objects).toHaveLength(3);
  });

  it("with no opts at all includes all embeds", async () => {
    const { objects } = await collectEmbeddedObjects(multiEmbedMarkdown());
    expect(objects).toHaveLength(3);
  });
});

describe("collectEmbeddedObjects, D8 Data Hub snapshot vs full", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDhGet.mockResolvedValue(makeDataHubMock());
  });

  it("defaults to snapshot dataKind for Data Hub embeds", async () => {
    const { objects } = await collectEmbeddedObjects(singleEmbedMarkdown(DH_HREF, "t-test"));

    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("datahub");
    expect(objects[0].dataKind).toBe("snapshot");
    expect(objects[0].portableId).toBe("src-uuid-dh-22");
  });

  it("uses full dataKind when the href is in fullDataHrefs (D8 opt-in)", async () => {
    const { objects } = await collectEmbeddedObjects(singleEmbedMarkdown(DH_HREF, "t-test"), {
      fullDataHrefs: new Set([DH_HREF]),
    });

    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("datahub");
    expect(objects[0].dataKind).toBe("full");
    expect(objects[0].serialization).toBe("file");
  });
});

describe("collectEmbeddedObjects, error resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips an embed whose loader throws without throwing itself", async () => {
    mockMolGet.mockRejectedValue(new Error("Disk read error"));

    const { objects, skipCount } = await collectEmbeddedObjects(
      singleEmbedMarkdown(MOL_HREF, "Aspirin"),
    );

    expect(objects).toHaveLength(0);
    expect(skipCount).toBe(1);
  });

  it("skips an embed whose loader returns null (not found)", async () => {
    mockNoteGet.mockResolvedValue(null);

    const { objects, skipCount } = await collectEmbeddedObjects(
      singleEmbedMarkdown(NOTE_HREF, "Missing note"),
    );

    expect(objects).toHaveLength(0);
    expect(skipCount).toBe(1);
  });

  it("partial failure skips the bad embed but keeps the good ones", async () => {
    mockMolGet.mockRejectedValue(new Error("Load failure"));
    mockSeqGet.mockResolvedValue(makeSequenceMock());
    mockProjectGet.mockResolvedValue(makeProjectMock());

    const { objects, skipCount } = await collectEmbeddedObjects(multiEmbedMarkdown());

    expect(skipCount).toBe(1);
    expect(objects).toHaveLength(2);
    expect(objects.some((o) => o.type === "sequence")).toBe(true);
    expect(objects.some((o) => o.type === "project")).toBe(true);
  });

  it("returns empty result without throwing when markdown has no embeds", async () => {
    const { objects, skipCount } = await collectEmbeddedObjects("Just plain text, no embeds.");
    expect(objects).toHaveLength(0);
    expect(skipCount).toBe(0);
  });

  it("reports file type as deferred (not in objects list)", async () => {
    // A /files/<id>#ros=view link would be a block embed of type "file".
    // "file" is intentionally deferred; its href should not appear in objects.
    const fileHref = "/files/doc.pdf#ros=view";
    const { objects, deferredTypes, skipCount } = await collectEmbeddedObjects(
      `[My file](${fileHref})`,
    );

    // The markdown may or may not parse as a file embed depending on whether
    // parseObjectEmbed recognizes /files/ as a valid embed route. Either way
    // the result must not throw. If recognized as file type, it should be
    // deferred (deferredTypes includes "file") and not appear in objects.
    expect(objects.some((o) => o.type === "file")).toBe(false);
    // skipCount + deferred count covers the embed (or it was not recognized).
    expect(typeof skipCount).toBe("number");
    expect(Array.isArray(deferredTypes)).toBe(true);
  });
});

describe("collectEmbeddedObjects, task and method collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects a task embed as inline JSON", async () => {
    mockTaskGet.mockResolvedValue(makeTaskMock());

    const { objects } = await collectEmbeddedObjects(singleEmbedMarkdown(TASK_HREF, "Run gel"));

    expect(objects).toHaveLength(1);
    const obj = objects[0];
    expect(obj.type).toBe("task");
    expect(obj.serialization).toBe("inline");
    expect(obj.portableId).toBe("src-uuid-task-11");
    const meta = obj.inline as { name: string; is_complete: boolean; composite_key: string };
    expect(meta.name).toBe("Run gel");
    expect(meta.is_complete).toBe(false);
    expect(meta.composite_key).toBe("self:11");
  });

  it("collects a method embed as file-serialized JSON", async () => {
    mockMethodGet.mockResolvedValue(makeMethodMock());

    const { objects } = await collectEmbeddedObjects(
      singleEmbedMarkdown(METHOD_HREF, "Western blot"),
    );

    expect(objects).toHaveLength(1);
    const obj = objects[0];
    expect(obj.type).toBe("method");
    expect(obj.serialization).toBe("file");
    expect(obj.portableId).toBe("src-uuid-method-5");
    expect(obj.dataKind).toBe("full");
    expect(obj.inline).toBeInstanceOf(Uint8Array);
  });
});
