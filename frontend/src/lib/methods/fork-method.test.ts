import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Method } from "@/lib/types";

// Capture the payloads handed to the create APIs so each test can assert what
// the fork cloned. forkMethod is pure orchestration over these, so mocking the
// API + file layer is enough to lock the per-type behavior.
const created: Record<string, unknown>[] = [];
const pcrCreated: Record<string, unknown>[] = [];
const lcCreated: Record<string, unknown>[] = [];
const plateCreated: Record<string, unknown>[] = [];
const cellCultureCreated: Record<string, unknown>[] = [];
const qpcrCreated: Record<string, unknown>[] = [];
const writes: { path: string; content: string }[] = [];
const blobWrites: string[] = [];

vi.mock("@/lib/local-api", () => {
  const passthroughCreate = () => vi.fn(async () => ({ id: 999 }));
  return {
    methodsApi: {
      create: vi.fn(async (data: Record<string, unknown>) => {
        created.push(data);
        return { ...data, id: 100, owner: "me" };
      }),
    },
    pcrApi: {
      get: vi.fn(async () => ({
        gradient: { stages: ["G"] },
        ingredients: [{ name: "Taq" }],
        notes: "keep cold",
      })),
      create: vi.fn(async (data: Record<string, unknown>) => {
        pcrCreated.push(data);
        return { id: 42 };
      }),
    },
    lcGradientApi: {
      get: vi.fn(async () => ({
        description: "src desc",
        gradient_steps: [{ t: 0 }],
        column: { name: "src col" },
        detection_wavelength_nm: 254,
        ingredients: [{ name: "MeOH" }],
      })),
      create: vi.fn(async (data: Record<string, unknown>) => {
        lcCreated.push(data);
        return { id: 50 };
      }),
    },
    plateApi: {
      get: vi.fn(async () => ({
        description: "src plate",
        plate_size: 96,
        region_labels: [{ row_start: 0, row_end: 0, col_start: 0, col_end: 0, role: "src" }],
      })),
      create: vi.fn(async (data: Record<string, unknown>) => {
        plateCreated.push(data);
        return { id: 60 };
      }),
    },
    cellCultureApi: {
      get: vi.fn(async () => ({
        description: "src cc",
        cell_line: { name: "HEK" },
        media: { name: "DMEM" },
        planned_events: [{ day: 0, event_type: "feed" }],
      })),
      create: vi.fn(async (data: Record<string, unknown>) => {
        cellCultureCreated.push(data);
        return { id: 70 };
      }),
    },
    massSpecApi: { get: vi.fn(), create: passthroughCreate() },
    codingWorkflowApi: { get: vi.fn(), create: passthroughCreate() },
    qpcrAnalysisApi: {
      get: vi.fn(async () => ({
        description: "src qpcr",
        chemistry: "sybr",
        chemistry_label: null,
        references: [{ id: "r1", target: "GAPDH" }],
        standard_curve: [],
        melt_curve: null,
        use_delta_delta_cq: true,
      })),
      create: vi.fn(async (data: Record<string, unknown>) => {
        qpcrCreated.push(data);
        return { id: 80 };
      }),
    },
    filesApi: {
      readFile: vi.fn(async (path: string) => ({
        path,
        content: "# Protocol body",
        sha: "x",
        html_url: "",
      })),
      writeFile: vi.fn(async (path: string, content: string) => {
        writes.push({ path, content });
        return { path, sha: "y" };
      }),
    },
  };
});

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    fileExists: vi.fn(async () => false),
    readFileAsBlob: vi.fn(async () => new Blob(["pdf-bytes"])),
    writeFileFromBlob: vi.fn(async (path: string) => {
      blobWrites.push(path);
    }),
  },
}));

import { forkMethod, forkAttachmentToLibrary } from "./fork-method";
import type { TaskMethodAttachment } from "@/lib/types";

/** A blank attachment with every override null — tests set only the fields
 *  they exercise, mirroring how a real attachment carries one type's edits. */
function attachment(partial: Partial<TaskMethodAttachment>): TaskMethodAttachment {
  return {
    method_id: 1,
    owner: null,
    pcr_gradient: null,
    pcr_ingredients: null,
    lc_gradient: null,
    body_override: null,
    plate_annotation: null,
    cell_culture_schedule: null,
    variation_notes: null,
    compound_snapshots: null,
    qpcr_analysis: null,
    ...partial,
  } as TaskMethodAttachment;
}

function method(partial: Partial<Method>): Method {
  return {
    id: 1,
    name: "Base",
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    owner: "",
    shared_with: [],
    created_by: "me",
    ...partial,
  } as Method;
}

beforeEach(() => {
  created.length = 0;
  pcrCreated.length = 0;
  lcCreated.length = 0;
  plateCreated.length = 0;
  cellCultureCreated.length = 0;
  qpcrCreated.length = 0;
  writes.length = 0;
  blobWrites.length = 0;
});

describe("forkMethod", () => {
  it("clones a markdown body into a new unique file and links the fork", async () => {
    const src = method({
      id: 5,
      name: "Phusion PCR",
      method_type: "markdown",
      source_path: "methods/phusion/phusion.md",
      folder_path: "Molecular Biology",
      tags: ["pcr"],
    });
    await forkMethod(src, "Phusion PCR GC-rich");

    // Body copied verbatim to a slugged path derived from the new name.
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("methods/phusion-pcr-gc-rich/phusion-pcr-gc-rich.md");
    expect(writes[0].content).toBe("# Protocol body");

    // The new method points at the cloned file, links back to the source, is
    // private, and inherits the source's folder.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: "Phusion PCR GC-rich",
      source_path: "methods/phusion-pcr-gc-rich/phusion-pcr-gc-rich.md",
      method_type: "markdown",
      folder_path: "Molecular Biology",
      parent_method_id: 5,
      is_public: false,
    });
  });

  it("clones a PCR protocol into a NEW protocol record (no shared edits)", async () => {
    const src = method({
      id: 9,
      name: "qPCR",
      method_type: "pcr",
      source_path: "pcr://protocol/7",
      owner: "alice",
    });
    await forkMethod(src, "qPCR variant");

    // A fresh protocol was created from the source's content.
    expect(pcrCreated).toHaveLength(1);
    expect(pcrCreated[0]).toMatchObject({
      name: "qPCR variant",
      notes: "keep cold",
      is_public: false,
    });
    // The fork points at the NEW protocol id, not the source's.
    expect(created[0]).toMatchObject({
      source_path: "pcr://protocol/42",
      parent_method_id: 9,
    });
  });

  it("copies the component references for a compound and keeps source_path null", async () => {
    const src = method({
      id: 3,
      name: "Cloning kit",
      method_type: "compound",
      source_path: null,
      components: [{ method_id: 1, owner: null, ordering: 0 }],
    });
    await forkMethod(src, "Cloning kit v2");

    expect(created[0]).toMatchObject({
      source_path: null,
      method_type: "compound",
      parent_method_id: 3,
      components: [{ method_id: 1, owner: null, ordering: 0 }],
    });
  });

  it("rejects an empty name", async () => {
    await expect(forkMethod(method({ id: 1 }), "   ")).rejects.toThrow(/name/i);
  });
});

describe("forkAttachmentToLibrary", () => {
  it("bakes the markdown body_override (not the source file) into the new file", async () => {
    const src = method({
      id: 5,
      name: "Phusion PCR",
      method_type: "markdown",
      source_path: "methods/phusion/phusion.md",
    });
    await forkAttachmentToLibrary(
      src,
      attachment({ body_override: "# Edited body for this experiment" }),
      "Phusion variant",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toBe("# Edited body for this experiment");
  });

  it("appends variation_notes under a labeled heading in the markdown body", async () => {
    const src = method({
      id: 5,
      name: "Phusion PCR",
      method_type: "markdown",
      source_path: "methods/phusion/phusion.md",
    });
    await forkAttachmentToLibrary(
      src,
      attachment({ variation_notes: "Annealed at 62C instead of 58C." }),
      "Phusion variant",
      { variationContextLabel: "Exp 12" },
    );
    expect(writes[0].content).toContain("# Protocol body");
    expect(writes[0].content).toContain('## Variation notes (from experiment "Exp 12")');
    expect(writes[0].content).toContain("Annealed at 62C instead of 58C.");
  });

  it("bakes pcr_gradient + pcr_ingredients overrides into the new protocol", async () => {
    const src = method({
      id: 9,
      name: "qPCR",
      method_type: "pcr",
      source_path: "pcr://protocol/7",
    });
    await forkAttachmentToLibrary(
      src,
      attachment({
        pcr_gradient: JSON.stringify({ stages: ["EDITED"] }),
        pcr_ingredients: JSON.stringify([{ name: "Phusion" }]),
        variation_notes: "used GC buffer",
      }),
      "qPCR variant",
    );
    expect(pcrCreated[0]).toMatchObject({
      gradient: { stages: ["EDITED"] },
      ingredients: [{ name: "Phusion" }],
    });
    // variation notes folded into the protocol notes, source notes preserved.
    expect(pcrCreated[0].notes).toContain("keep cold");
    expect(pcrCreated[0].notes).toContain("used GC buffer");
  });

  it("falls back to source content when an override is absent or corrupt", async () => {
    const src = method({ id: 9, name: "qPCR", method_type: "pcr", source_path: "pcr://protocol/7" });
    await forkAttachmentToLibrary(src, attachment({ pcr_gradient: "{not json" }), "v");
    expect(pcrCreated[0]).toMatchObject({
      gradient: { stages: ["G"] },
      ingredients: [{ name: "Taq" }],
    });
  });

  it("bakes the LC snapshot fields directly (snapshot is a full protocol)", async () => {
    const src = method({ id: 1, method_type: "lc_gradient", source_path: "lc_gradient://protocol/3" });
    await forkAttachmentToLibrary(
      src,
      attachment({
        lc_gradient: JSON.stringify({
          description: "snap desc",
          gradient_steps: [{ t: 5 }],
          column: { name: "snap col" },
          detection_wavelength_nm: null,
          ingredients: [{ name: "ACN" }],
        }),
      }),
      "LC variant",
    );
    expect(lcCreated[0]).toMatchObject({
      gradient_steps: [{ t: 5 }],
      column: { name: "snap col" },
      detection_wavelength_nm: null,
      ingredients: [{ name: "ACN" }],
    });
  });

  it("converts a plate_annotation wells map into region_labels", async () => {
    const src = method({ id: 1, method_type: "plate", source_path: "plate://protocol/3" });
    await forkAttachmentToLibrary(
      src,
      attachment({
        plate_annotation: JSON.stringify({
          wells: { B2: { role: "sample", custom_label: "x" } },
        }),
      }),
      "Plate variant",
    );
    expect(plateCreated[0].region_labels).toEqual([
      { row_start: 1, row_end: 1, col_start: 1, col_end: 1, role: "sample", custom_label: "x" },
    ]);
  });

  it("bakes cell-culture planned-schedule edits but drops the actual_events log", async () => {
    const src = method({ id: 1, method_type: "cell_culture", source_path: "cell_culture://protocol/3" });
    await forkAttachmentToLibrary(
      src,
      attachment({
        cell_culture_schedule: JSON.stringify({
          planned_events: [{ day: 1, event_type: "split" }],
          actual_events: [{ timestamp: "2026-01-01T00:00:00Z", event_type: "feed" }],
          cell_line: { name: "CHO" },
          media: { name: "F12" },
          description: "instance desc",
        }),
      }),
      "CC variant",
    );
    expect(cellCultureCreated[0]).toMatchObject({
      planned_events: [{ day: 1, event_type: "split" }],
      cell_line: { name: "CHO" },
      media: { name: "F12" },
    });
    // The actual_events run log is NOT part of the reusable template.
    expect(cellCultureCreated[0]).not.toHaveProperty("actual_events");
  });

  it("clones the qPCR template only — entered Cq run data is not baked in", async () => {
    const src = method({ id: 1, method_type: "qpcr_analysis", source_path: "qpcr_analysis://protocol/3" });
    await forkAttachmentToLibrary(
      src,
      attachment({
        qpcr_analysis: JSON.stringify({ cqs: { r1: { cq: 22.5 } } }),
        variation_notes: "NTC clean",
      }),
      "qPCR analysis variant",
    );
    // Template fields cloned from source; no Cq data leaks into the template.
    expect(qpcrCreated[0]).toMatchObject({
      chemistry: "sybr",
      references: [{ id: "r1", target: "GAPDH" }],
      use_delta_delta_cq: true,
    });
    expect(JSON.stringify(qpcrCreated[0])).not.toContain("22.5");
    expect(qpcrCreated[0].description).toContain("NTC clean");
  });

  it("links the fork to the source via parent_method_id", async () => {
    const src = method({ id: 42, method_type: "pcr", source_path: "pcr://protocol/7" });
    await forkAttachmentToLibrary(src, attachment({}), "v");
    expect(created[0]).toMatchObject({ parent_method_id: 42, is_public: false });
  });
});
