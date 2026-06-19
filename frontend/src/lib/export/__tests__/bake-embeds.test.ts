// frontend/src/lib/export/__tests__/bake-embeds.test.ts
//
// Unit tests for the Phase 5 export-baking layer (bake-embeds.ts).
//
// Tests run in jsdom (the vitest default). jsdom does NOT implement
// HTMLCanvasElement.getContext, so svgToPngDataUrl throws
// CanvasUnavailableError in all tests, which is intentional. We verify
// that the baker degrades gracefully (card/missing result, no throw) rather
// than requiring a real browser canvas.
//
// All data loaders (moleculesApi.get, dataHubApi.getContent, etc.) are
// vi.mock'd so no filesystem reads or FSA API access is needed.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  scanEmbedRefs,
  bakeAllEmbeds,
  svgToPngDataUrl,
  CanvasUnavailableError,
} from "../bake-embeds";

// ── Mock the data loaders ─────────────────────────────────────────────────────
//
// We mock at the module level so the imported functions inside bake-embeds.ts
// see the mocked versions. Each test can override the mock return value via
// mockResolvedValue / mockRejectedValue.

vi.mock("@/lib/chemistry/api", () => ({
  moleculesApi: {
    get: vi.fn(),
  },
}));

vi.mock("@/lib/chemistry/rdkit", () => ({
  renderSvg: vi.fn(),
}));

vi.mock("@/lib/datahub/api", () => ({
  dataHubApi: {
    getContent: vi.fn(),
  },
}));

vi.mock("@/lib/datahub/plot-spec", () => ({
  renderPlot: vi.fn(),
  readPlotSource: vi.fn(),
}));

vi.mock("@/lib/datahub/result-text", () => ({
  resultToText: vi.fn(),
}));

vi.mock("@/lib/datahub/plain-language", () => ({
  plainLanguageSummary: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  sequencesApi: { get: vi.fn() },
  notesApi: { get: vi.fn() },
  methodsApi: { get: vi.fn() },
  projectsApi: { get: vi.fn() },
  tasksApi: { get: vi.fn() },
}));

// Pull out the mocked modules so tests can configure them.
import { moleculesApi } from "@/lib/chemistry/api";
import type { MoleculeDetail } from "@/lib/chemistry/api";
import { renderSvg as renderMoleculeSvg } from "@/lib/chemistry/rdkit";
import { dataHubApi } from "@/lib/datahub/api";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { renderPlot, readPlotSource } from "@/lib/datahub/plot-spec";
import { resultToText } from "@/lib/datahub/result-text";
import { plainLanguageSummary } from "@/lib/datahub/plain-language";
import { sequencesApi, notesApi, methodsApi, projectsApi, tasksApi } from "@/lib/local-api";
import type { Note, Method, Project, Task, SequenceDetail } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOL_HREF = "/chemistry?molecule=mol-1#ros=card";
const DH_TABLE_HREF = "/datahub?doc=dh-1#ros=table";
const DH_PLOT_HREF = "/datahub?doc=dh-1#ros=plot";
const DH_RESULT_HREF = "/datahub?doc=dh-1#ros=result";
const SEQ_HREF = "/sequences?seq=42#ros=map";
const NOTE_HREF = "/notes/7#ros=card";
const METHOD_HREF = "/methods?openMethod=3#ros=card";
const PROJECT_HREF = "/workbench/projects/9#ros=card";
const TASK_HREF = "/?openTask=self%3A5#ros=card";

// ── scanEmbedRefs ─────────────────────────────────────────────────────────────

describe("scanEmbedRefs", () => {
  it("finds a lone embed-link paragraph", () => {
    const md = `
Some text.

[My molecule](${MOL_HREF})

More text.
`;
    const refs = scanEmbedRefs(md);
    expect(refs).toHaveLength(1);
    expect(refs[0].href).toBe(MOL_HREF);
    expect(refs[0].caption).toBe("My molecule");
    expect(refs[0].descriptor.type).toBe("molecule");
    expect(refs[0].descriptor.isEmbed).toBe(true);
  });

  it("ignores inline mentions (not a lone paragraph)", () => {
    const md = `See [My molecule](${MOL_HREF}) for details.`;
    const refs = scanEmbedRefs(md);
    // The reference appears mid-sentence, not as a lone paragraph, so scanEmbedRefs
    // (which operates line-by-line) still detects the pattern. The inline-mention
    // guard is at the rendered-markdown level. But the lone-link check only fires
    // when the ENTIRE trimmed line is exactly one link. Inline text makes the line
    // different, so it should NOT match.
    // "See [My molecule](...) for details." is not a bare `[...](...)`-only line.
    expect(refs).toHaveLength(0);
  });

  it("ignores plain links (no #ros= fragment)", () => {
    const md = `[No embed](/sequences?seq=42)`;
    const refs = scanEmbedRefs(md);
    expect(refs).toHaveLength(0);
  });

  it("ignores chip-view links (#ros=chip)", () => {
    const md = `[chip](/sequences?seq=42#ros=chip)`;
    const refs = scanEmbedRefs(md);
    expect(refs).toHaveLength(0);
  });

  it("ignores image syntax", () => {
    const md = `![alt text](/images/photo.png)`;
    const refs = scanEmbedRefs(md);
    expect(refs).toHaveLength(0);
  });

  it("returns multiple embeds in document order", () => {
    const md = `
[Mol A](${MOL_HREF})

[Table B](${DH_TABLE_HREF})
`;
    const refs = scanEmbedRefs(md);
    expect(refs).toHaveLength(2);
    expect(refs[0].descriptor.type).toBe("molecule");
    expect(refs[1].descriptor.type).toBe("datahub");
  });

  it("returns empty array for empty input", () => {
    expect(scanEmbedRefs("")).toHaveLength(0);
  });

  it("ignores links that are not internal object routes", () => {
    const md = `[External](https://example.com#ros=map)`;
    const refs = scanEmbedRefs(md);
    expect(refs).toHaveLength(0);
  });
});

// ── svgToPngDataUrl ───────────────────────────────────────────────────────────

describe("svgToPngDataUrl", () => {
  it("throws CanvasUnavailableError in jsdom (no real canvas)", async () => {
    // jsdom does not implement getContext('2d'), so the guard fires.
    const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>`;
    await expect(svgToPngDataUrl(svg)).rejects.toBeInstanceOf(CanvasUnavailableError);
  });
});

// ── bakeAllEmbeds: kind dispatch and label assignment ─────────────────────────

describe("bakeAllEmbeds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("produces kind:card for a molecule when canvas is unavailable (jsdom)", async () => {
    vi.mocked(moleculesApi.get).mockResolvedValue({
      meta: {
        id: "mol-1",
        name: "Aspirin",
        project_ids: [],
        added_at: "2026-01-01",
        smiles: "CC(=O)Oc1ccccc1C(=O)O",
      },
      molfile: "",
    });
    // renderSvg returns a valid SVG, but the canvas will still be unavailable.
    vi.mocked(renderMoleculeSvg).mockResolvedValue(
      `<svg width="260" height="200" xmlns="http://www.w3.org/2000/svg"></svg>`,
    );

    const md = `[Aspirin](${MOL_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(MOL_HREF);
    expect(baked).toBeDefined();
    // Canvas unavailable in jsdom -> falls back to card.
    expect(baked!.kind).toBe("card");
    if (baked!.kind === "card") {
      expect(baked!.title).toMatch(/Aspirin/i);
    }
  });

  it("produces kind:table for a datahub table view", async () => {
    vi.mocked(dataHubApi.getContent).mockResolvedValue({
      meta: { id: "dh-1", name: "My data", table_type: "custom", project_ids: [], created_at: "", updated_at: "" },
      columns: [
        { id: "c1", name: "Group", role: "x" },
        { id: "c2", name: "Value", role: "y" },
      ],
      rows: [
        { id: "r1", cells: { c1: "A", c2: 1.5 } },
        { id: "r2", cells: { c1: "B", c2: 2.3 } },
      ],
      analyses: [],
      plots: [],
    } as unknown as DataHubDocContent);

    const md = `[My data](${DH_TABLE_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(DH_TABLE_HREF);
    expect(baked).toBeDefined();
    expect(baked!.kind).toBe("table");
    if (baked!.kind === "table") {
      expect(baked!.columns).toEqual(["Group", "Value"]);
      expect(baked!.rows[0]).toEqual(["A", "1.5"]);
    }
  });

  it("produces kind:text for a datahub result view", async () => {
    const fakeAnalysis = {
      id: "a1",
      name: "t-test",
      resultCache: { ok: true, kind: "ttest_ind" },
    };
    vi.mocked(dataHubApi.getContent).mockResolvedValue({
      meta: { id: "dh-1", name: "My data", table_type: "custom", project_ids: [], created_at: "", updated_at: "" },
      columns: [],
      rows: [],
      analyses: [fakeAnalysis],
      plots: [],
    } as unknown as DataHubDocContent);
    vi.mocked(plainLanguageSummary).mockReturnValue("The difference is significant.");
    vi.mocked(resultToText).mockReturnValue("The difference is significant.\n\nStat   Value\np      0.03");

    const md = `[t-test result](${DH_RESULT_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(DH_RESULT_HREF);
    expect(baked).toBeDefined();
    expect(baked!.kind).toBe("text");
    if (baked!.kind === "text") {
      expect(baked!.body).toContain("significant");
    }
  });

  it("produces kind:card (or image) for a sequence, no throw", async () => {
    vi.mocked(sequencesApi.get).mockResolvedValue({
      id: 42,
      display_name: "pUC19",
      seq: "ACGT",
      seq_type: "DNA",
      length: 2686,
      circular: true,
      feature_count: 5,
      project_ids: [],
      added_at: "2026-01-01",
      annotations: [],
      genbank: "",
      locus_name: "pUC19",
    } as unknown as SequenceDetail);

    const md = `[pUC19](${SEQ_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(SEQ_HREF);
    expect(baked).toBeDefined();
    // In jsdom the canvas is unavailable, so the sequence bake falls back to card.
    expect(baked!.kind === "card" || baked!.kind === "image").toBe(true);
    if (baked!.kind === "card") {
      expect(baked!.title).toMatch(/pUC19/i);
      expect(baked!.subtitle).toBe("Sequence");
    }
  });

  it("produces kind:card for a note", async () => {
    vi.mocked(notesApi.get).mockResolvedValue({
      id: 7,
      title: "My lab note",
      description: "",
      entries: [{ content: "First entry content." }],
    } as unknown as Note);

    const md = `[My lab note](${NOTE_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(NOTE_HREF);
    expect(baked).toBeDefined();
    expect(baked!.kind).toBe("card");
    if (baked!.kind === "card") {
      expect(baked!.subtitle).toBe("Note");
    }
  });

  it("produces kind:card for a method", async () => {
    vi.mocked(methodsApi.get).mockResolvedValue({
      id: 3,
      name: "Western blot",
      method_type: "markdown",
    } as unknown as Method);

    const md = `[Western blot](${METHOD_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(METHOD_HREF);
    expect(baked).toBeDefined();
    expect(baked!.kind).toBe("card");
    if (baked!.kind === "card") {
      expect(baked!.subtitle).toBe("Method");
      expect(baked!.meta).toContain("markdown");
    }
  });

  it("produces kind:card for a project", async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({
      id: 9,
      name: "Cancer study",
      color: "#ff0000",
    } as unknown as Project);

    const md = `[Cancer study](${PROJECT_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(PROJECT_HREF);
    expect(baked).toBeDefined();
    expect(baked!.kind).toBe("card");
    if (baked!.kind === "card") {
      expect(baked!.subtitle).toBe("Project");
    }
  });

  it("produces kind:card for a task", async () => {
    vi.mocked(tasksApi.get).mockResolvedValue({
      id: 5,
      name: "My task",
      is_complete: false,
      start_date: "2026-01-15",
    } as unknown as Task);

    const md = `[My task](${TASK_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(TASK_HREF);
    expect(baked).toBeDefined();
    expect(baked!.kind).toBe("card");
    if (baked!.kind === "card") {
      expect(baked!.subtitle).toBe("Task");
    }
  });

  it("produces kind:missing when the loader returns null", async () => {
    vi.mocked(moleculesApi.get).mockResolvedValue(null);

    const md = `[Missing mol](${MOL_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(MOL_HREF);
    expect(baked).toBeDefined();
    expect(baked!.kind).toBe("missing");
    if (baked!.kind === "missing") {
      expect(baked!.name).toBe("Missing mol");
    }
  });

  it("produces kind:missing when the loader throws, does not propagate", async () => {
    vi.mocked(notesApi.get).mockRejectedValue(new Error("disk read failed"));

    const md = `[Broken note](${NOTE_HREF})`;
    // This should NOT throw; the error is swallowed per the spec.
    await expect(bakeAllEmbeds([md])).resolves.toBeDefined();
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(NOTE_HREF);
    expect(baked).toBeDefined();
    expect(baked!.kind).toBe("missing");
  });

  it("assigns figure labels when numbering directive is present", async () => {
    vi.mocked(notesApi.get).mockResolvedValue({
      id: 7,
      title: "Note A",
      description: "",
      entries: [],
    } as unknown as Note);
    vi.mocked(moleculesApi.get).mockResolvedValue({
      meta: { id: "mol-1", name: "Aspirin", project_ids: [], added_at: "2026-01-01" },
      molfile: "",
    } as unknown as MoleculeDetail);
    vi.mocked(renderMoleculeSvg).mockResolvedValue("");

    const md = `<!-- ros:number-figures -->

[Note A](${NOTE_HREF})

[Aspirin](${MOL_HREF})
`;
    const result = await bakeAllEmbeds([md]);
    const bakedNote = result.get(NOTE_HREF);
    const bakedMol = result.get(MOL_HREF);
    expect(bakedNote).toBeDefined();
    expect(bakedMol).toBeDefined();
    // Both are Figure-type. Note: first is Figure 1, second is Figure 2.
    expect(bakedNote!.label).toBe("Figure 1");
    expect(bakedMol!.label).toBe("Figure 2");
  });

  it("assigns Table labels for datahub table embeds when numbering is on", async () => {
    vi.mocked(dataHubApi.getContent).mockResolvedValue({
      meta: { id: "dh-1", name: "Data", table_type: "custom", project_ids: [], created_at: "", updated_at: "" },
      columns: [{ id: "c1", name: "Col", role: "x" }],
      rows: [],
      analyses: [],
      plots: [],
    } as unknown as DataHubDocContent);

    const md = `<!-- ros:number-figures -->

[My table](${DH_TABLE_HREF})
`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(DH_TABLE_HREF);
    expect(baked).toBeDefined();
    // datahub table view is a Table, not a Figure.
    expect(baked!.label).toBe("Table 1");
  });

  it("assigns null labels when numbering directive is absent", async () => {
    vi.mocked(notesApi.get).mockResolvedValue({
      id: 7,
      title: "Note A",
      description: "",
      entries: [],
    } as unknown as Note);

    const md = `[Note A](${NOTE_HREF})`;
    const result = await bakeAllEmbeds([md]);
    const baked = result.get(NOTE_HREF);
    expect(baked).toBeDefined();
    expect(baked!.label).toBeNull();
  });

  it("concatenates embeds from multiple markdown strings in order", async () => {
    vi.mocked(notesApi.get).mockResolvedValue({
      id: 7,
      title: "Note",
      description: "",
      entries: [],
    } as unknown as Note);
    vi.mocked(methodsApi.get).mockResolvedValue({
      id: 3,
      name: "Method",
      method_type: "pcr",
    } as unknown as Method);

    const md1 = `<!-- ros:number-figures -->\n[Note](${NOTE_HREF})`;
    const md2 = `[Method](${METHOD_HREF})`;
    const result = await bakeAllEmbeds([md1, md2]);
    // Both should be baked.
    expect(result.has(NOTE_HREF)).toBe(true);
    expect(result.has(METHOD_HREF)).toBe(true);
  });

  it("keyes the map by exact href", async () => {
    vi.mocked(notesApi.get).mockResolvedValue({
      id: 7,
      title: "Note",
      description: "",
      entries: [],
    } as unknown as Note);

    const md = `[Note](${NOTE_HREF})`;
    const result = await bakeAllEmbeds([md]);
    // The key is the full href including the fragment.
    expect(result.has(NOTE_HREF)).toBe(true);
    // Without the fragment it should not be present.
    expect(result.has("/notes/7")).toBe(false);
  });
});
