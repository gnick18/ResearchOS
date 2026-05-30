// frontend/src/lib/methods/method-catalog.test.ts
//
// Phase U1 (Extension Store METHOD TEMPLATE CATALOG) coverage:
//  - the loader parses the manifest + a template payload (and rejects junk)
//  - "Use template" (instantiateMethodFromTemplate) calls the per-type API +
//    methodsApi.create with the expected method_type / source_path / payload
//    and produces a method owned by the current user.
//
// The local-api module is mocked so the instantiation test asserts the create
// calls without touching the real file system. The owner-stamping behavior of
// the real methodsApi.create is already covered by methods-api-create.test.ts;
// here the mock returns owner: <currentUser> so the test asserts the template
// path threads through methodsApi.create (which is the owner-stamping seam) and
// instantiates PRIVATE (no whole-lab "*" sentinel).

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/local-api", () => {
  const created: Array<Record<string, unknown>> = [];
  return {
    __created: created,
    methodsApi: {
      create: vi.fn(async (data: Record<string, unknown>) => {
        created.push(data);
        // Mirror the real api: derive owner from current user when no
        // whole-lab "*" sentinel is present (private), else "public".
        const sharedWith = (data.shared_with ?? []) as Array<{ username: string }>;
        const isPublic = sharedWith.some((s) => s.username === "*");
        return {
          id: 100 + created.length,
          owner: isPublic ? "public" : "alex",
          is_public: isPublic,
          ...data,
        };
      }),
      // Used only by the compound partial-failure path to stamp the
      // incomplete-kit marker on orphaned children.
      update: vi.fn(async (id: number, data: Record<string, unknown>) => ({
        id,
        ...data,
      })),
    },
    pcrApi: { create: vi.fn(async (d: Record<string, unknown>) => ({ id: 1, ...d })) },
    lcGradientApi: {
      create: vi.fn(async (d: Record<string, unknown>) => ({ id: 2, ...d })),
    },
    plateApi: { create: vi.fn(async (d: Record<string, unknown>) => ({ id: 3, ...d })) },
    cellCultureApi: {
      create: vi.fn(async (d: Record<string, unknown>) => ({ id: 4, ...d })),
    },
    massSpecApi: {
      create: vi.fn(async (d: Record<string, unknown>) => ({ id: 5, ...d })),
    },
    filesApi: {
      writeFile: vi.fn(async () => ({ path: "p", sha: "s" })),
      uploadImage: vi.fn(async (path: string) => ({ path, sha: "s" })),
    },
  };
});

vi.mock("@/lib/stamp-utils", () => ({
  createNewFileContent: vi.fn(() => "## stamp\n"),
}));

import {
  parseMethodCatalogManifest,
  parseMethodCatalogTemplate,
  fetchMethodCatalogManifest,
  fetchMethodCatalogTemplate,
  instantiateMethodFromTemplate,
  isCatalogMethodType,
  INCOMPLETE_KIT_TAG,
  type MethodCatalogTemplate,
  type InstantiateTemplateDeps,
} from "./method-catalog";
import {
  methodsApi,
  pcrApi,
  lcGradientApi,
  plateApi,
  cellCultureApi,
  massSpecApi,
  filesApi,
} from "@/lib/local-api";

// ── A minimal fake fetch over an in-memory catalog ───────────────────────────

function makeFetch(files: Record<string, unknown>) {
  return vi.fn(async (input: string) => {
    if (input in files) {
      return {
        ok: true,
        status: 200,
        json: async () => files[input],
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

const SAMPLE_MANIFEST = {
  version: 1,
  generatedAt: "2026-05-29T00:00:00.000Z",
  templates: [
    {
      slug: "q5-pcr-setup",
      title: "Q5 PCR",
      description: "A PCR template",
      category: "Molecular biology",
      method_type: "pcr",
      tags: ["pcr"],
    },
    {
      slug: "general-protocol",
      title: "General",
      description: "A markdown template",
      category: "General",
      method_type: "markdown",
    },
  ],
};

const PCR_TEMPLATE: MethodCatalogTemplate = {
  slug: "q5-pcr-setup",
  title: "Q5 PCR",
  description: "A PCR template",
  category: "Molecular biology",
  method_type: "pcr",
  tags: ["pcr"],
  payload: {
    gradient: {
      initial: [{ name: "Init", temperature: 98, duration: "30 sec" }],
      cycles: [
        {
          repeats: 30,
          steps: [{ name: "Denat", temperature: 98, duration: "10 sec" }],
        },
      ],
      final: [{ name: "Final", temperature: 72, duration: "2 min" }],
      hold: { name: "Hold", temperature: 4, duration: "Indef." },
    },
    ingredients: [
      { id: "1", name: "Buffer", concentration: "5X", amount_per_reaction: "5" },
    ],
    notes: "use the Tm calculator",
  },
};

// ── Parsing ───────────────────────────────────────────────────────────────────

describe("method-catalog parsing", () => {
  it("isCatalogMethodType accepts supported types, rejects others", () => {
    expect(isCatalogMethodType("pcr")).toBe(true);
    expect(isCatalogMethodType("markdown")).toBe(true);
    expect(isCatalogMethodType("cell_culture")).toBe(true);
    expect(isCatalogMethodType("mass_spec")).toBe(true);
    // compound is now a catalog method_type (the combination/kit arm).
    expect(isCatalogMethodType("compound")).toBe(true);
    expect(isCatalogMethodType("pdf")).toBe(false);
    expect(isCatalogMethodType(42)).toBe(false);
  });

  it("parses a well-formed manifest", () => {
    const m = parseMethodCatalogManifest(SAMPLE_MANIFEST);
    expect(m.version).toBe(1);
    expect(m.templates).toHaveLength(2);
    expect(m.templates[0]).toMatchObject({
      slug: "q5-pcr-setup",
      method_type: "pcr",
      category: "Molecular biology",
    });
  });

  it("throws on a manifest missing version", () => {
    expect(() =>
      parseMethodCatalogManifest({ templates: [] }),
    ).toThrow(/version/);
  });

  it("throws on a manifest entry with an unsupported method_type", () => {
    expect(() =>
      parseMethodCatalogManifest({
        version: 1,
        templates: [
          {
            slug: "x",
            title: "x",
            description: "x",
            category: "x",
            method_type: "pdf",
          },
        ],
      }),
    ).toThrow(/method_type/);
  });

  it("parses a well-formed template payload", () => {
    const t = parseMethodCatalogTemplate(PCR_TEMPLATE);
    expect(t.method_type).toBe("pcr");
    expect(t.slug).toBe("q5-pcr-setup");
    expect(t.payload).toBeDefined();
  });

  it("throws on a template missing its payload", () => {
    expect(() =>
      parseMethodCatalogTemplate({
        slug: "x",
        title: "x",
        description: "x",
        category: "x",
        method_type: "pcr",
      }),
    ).toThrow(/payload/);
  });
});

// ── Fetching ────────────────────────────────────────────────────────────────

describe("method-catalog fetching", () => {
  it("fetches + parses the manifest from the catalog path", async () => {
    const fetchFn = makeFetch({ "/method-catalog/manifest.json": SAMPLE_MANIFEST });
    const m = await fetchMethodCatalogManifest(fetchFn);
    expect(m.templates).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledWith("/method-catalog/manifest.json");
  });

  it("fetches + parses a template by slug", async () => {
    const fetchFn = makeFetch({
      "/method-catalog/templates/q5-pcr-setup.json": PCR_TEMPLATE,
    });
    const t = await fetchMethodCatalogTemplate("q5-pcr-setup", fetchFn);
    expect(t.method_type).toBe("pcr");
    expect(fetchFn).toHaveBeenCalledWith(
      "/method-catalog/templates/q5-pcr-setup.json",
    );
  });

  it("rejects when the manifest fetch is not ok", async () => {
    const fetchFn = makeFetch({});
    await expect(fetchMethodCatalogManifest(fetchFn)).rejects.toThrow(/status 404/);
  });
});

// ── Instantiation ("Use template") ────────────────────────────────────────────

describe("instantiateMethodFromTemplate", () => {
  it("PCR template: writes the sidecar then creates an owned pcr method", async () => {
    vi.clearAllMocks();
    const created = await instantiateMethodFromTemplate(PCR_TEMPLATE, {
      folderPath: "Molecular Biology",
    });

    // Sidecar created via pcrApi.create with the template payload, private.
    expect(pcrApi.create).toHaveBeenCalledTimes(1);
    expect(pcrApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Q5 PCR",
        gradient: PCR_TEMPLATE.payload.gradient,
        ingredients: PCR_TEMPLATE.payload.ingredients,
        notes: "use the Tm calculator",
        folder_path: "Molecular Biology",
        is_public: false,
      }),
    );

    // Method row created via methodsApi.create with the right type + source_path.
    expect(methodsApi.create).toHaveBeenCalledTimes(1);
    expect(methodsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Q5 PCR",
        method_type: "pcr",
        source_path: "pcr://protocol/1",
        folder_path: "Molecular Biology",
        // PRIVATE: no whole-lab sentinel, so the real api stamps the
        // current user as owner.
        shared_with: [],
      }),
    );

    // Result is owned by the current user (not "public").
    expect(created.owner).toBe("alex");
    expect(created.is_public).toBe(false);
  });

  it("markdown template: writes the source file then creates a markdown method", async () => {
    vi.clearAllMocks();
    const markdownTemplate: MethodCatalogTemplate = {
      slug: "general-protocol",
      title: "General Protocol",
      description: "x",
      category: "General",
      method_type: "markdown",
      payload: { body: "## Steps\n1. Do the thing\n" },
    };
    const created = await instantiateMethodFromTemplate(markdownTemplate);

    expect(filesApi.writeFile).toHaveBeenCalledTimes(1);
    const [path, body] = (filesApi.writeFile as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(path).toBe("methods/general-protocol/general-protocol.md");
    expect(body).toContain("## Steps");

    expect(methodsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        method_type: "markdown",
        source_path: "methods/general-protocol/general-protocol.md",
        shared_with: [],
      }),
    );
    expect(created.owner).toBe("alex");
  });

  it("plate template: passes plate_size + region_labels to plateApi.create", async () => {
    vi.clearAllMocks();
    const plateTemplate: MethodCatalogTemplate = {
      slug: "p",
      title: "Plate",
      description: "x",
      category: "Cell biology",
      method_type: "plate",
      payload: {
        description: "layout",
        plate_size: 96,
        region_labels: [
          { row_start: 0, row_end: 7, col_start: 0, col_end: 0, role: "blank" },
        ],
      },
    };
    await instantiateMethodFromTemplate(plateTemplate, { name: "My Plate" });

    expect(plateApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Plate",
        plate_size: 96,
        region_labels: plateTemplate.payload.region_labels,
        is_public: false,
      }),
    );
    expect(methodsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        method_type: "plate",
        source_path: "plate://protocol/3",
      }),
    );
  });

  it("mass_spec template: creates the protocol via massSpecApi then a mass_spec method", async () => {
    vi.clearAllMocks();
    const massSpecTemplate: MethodCatalogTemplate = {
      slug: "peptide-ms",
      title: "Peptide LC-MS/MS",
      description: "x",
      category: "LC-MS",
      method_type: "mass_spec",
      payload: {
        instrument: "Q Exactive HF",
        ionization_mode: "esi_pos",
        source: {
          source_temp_c: 320,
          capillary_kv: 2.1,
          nebulizer_gas_lpm: null,
          drying_gas_lpm: null,
          drying_gas_temp_c: null,
          ei_energy_ev: null,
          maldi_laser_nm: null,
          maldi_laser_energy: null,
          maldi_matrix: null,
          other_notes: "Sheath gas 35 au; aux gas 10 au",
        },
        scan: {
          scan_mz_low: 375,
          scan_mz_high: 1500,
          scan_rate_hz: null,
          resolution_r: 60000,
          is_msms: true,
          msms_isolation_window_mz: 1.4,
          msms_collision_energy_ev: null,
        },
        calibration: {
          reference_standard: null,
          calibration_date: null,
          expected_accuracy_ppm: null,
          notes: null,
        },
      },
    };
    const created = await instantiateMethodFromTemplate(massSpecTemplate, {
      folderPath: "LC-MS",
    });

    expect(massSpecApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Peptide LC-MS/MS",
        instrument: "Q Exactive HF",
        ionization_mode: "esi_pos",
        source: massSpecTemplate.payload.source,
        scan: massSpecTemplate.payload.scan,
        folder_path: "LC-MS",
        is_public: false,
      }),
    );
    expect(methodsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        method_type: "mass_spec",
        source_path: "mass_spec://protocol/5",
        folder_path: "LC-MS",
        shared_with: [],
      }),
    );
    expect(created.owner).toBe("alex");
  });

  it("defaults the method name to the template title and tags to the template tags", async () => {
    vi.clearAllMocks();
    await instantiateMethodFromTemplate(PCR_TEMPLATE);
    expect(methodsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Q5 PCR", tags: ["pcr"] }),
    );
  });

  it("does NOT set source_pdf_path for a template without a bundled PDF", async () => {
    vi.clearAllMocks();
    await instantiateMethodFromTemplate(PCR_TEMPLATE);
    expect(filesApi.uploadImage).not.toHaveBeenCalled();
    const arg = (methodsApi.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect("source_pdf_path" in arg).toBe(false);
  });
});

// ── Kit Phase 1: bundled source-PDF copy ──────────────────────────────────────
//
// A kit template carries `source_pdf.bundled: true`. On instantiation the loader
// fetches `sources/<slug>.pdf` BY CONVENTION (not from any caller-supplied path),
// copies it via filesApi.uploadImage to methods/<methodSlug>/source-<file>.pdf,
// and threads `source_pdf_path` onto the methodsApi.create call. The copy is a
// best-effort add-on: a fetch / write failure must NOT fail the structured
// instantiation.

const KIT_PCR_TEMPLATE: MethodCatalogTemplate = {
  ...PCR_TEMPLATE,
  slug: "roche-faststart-taq",
  title: "Roche FastStart Taq PCR",
  source_pdf: {
    bundled: true,
    filename: "ftaq-ro.pdf",
    source_url: "https://example.test/ftaq-ro.pdf",
    sha256: "deadbeef",
  },
};

function makePdfFetch(ok: boolean) {
  return vi.fn(async (input: string) => ({
    ok,
    status: ok ? 200 : 404,
    json: async () => ({}),
    arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
    __input: input,
  }));
}

describe("instantiateMethodFromTemplate — bundled source PDF (kit)", () => {
  it("fetches sources/<slug>.pdf BY CONVENTION, copies it, and sets source_pdf_path", async () => {
    vi.clearAllMocks();
    const pdfFetch = makePdfFetch(true);
    const created = await instantiateMethodFromTemplate(
      KIT_PCR_TEMPLATE,
      { folderPath: "Molecular Biology" },
      undefined,
      pdfFetch,
    );

    // Structured create is unchanged (pcr sidecar still created).
    expect(pcrApi.create).toHaveBeenCalledTimes(1);

    // The PDF was fetched from the slug-derived convention path, NOT from
    // source_url / filename.
    expect(pdfFetch).toHaveBeenCalledWith(
      "/method-catalog/sources/roche-faststart-taq.pdf",
    );

    // Copied via the existing pdf-method primitive into the method folder.
    expect(filesApi.uploadImage).toHaveBeenCalledTimes(1);
    const [copyPath] = (filesApi.uploadImage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(copyPath).toBe(
      "methods/roche-faststart-taq-pcr/source-ftaq-ro.pdf",
    );

    // source_pdf_path threaded onto the method row.
    expect(methodsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        method_type: "pcr",
        source_path: "pcr://protocol/1",
        source_pdf_path: "methods/roche-faststart-taq-pcr/source-ftaq-ro.pdf",
      }),
    );
    expect(created.owner).toBe("alex");
  });

  it("a PDF-copy failure does NOT fail the structured instantiation (best-effort)", async () => {
    vi.clearAllMocks();
    const failingFetch = makePdfFetch(false); // 404 on the asset
    const created = await instantiateMethodFromTemplate(
      KIT_PCR_TEMPLATE,
      {},
      undefined,
      failingFetch,
    );

    // Structured create still happened and a method was returned.
    expect(pcrApi.create).toHaveBeenCalledTimes(1);
    expect(methodsApi.create).toHaveBeenCalledTimes(1);
    expect(created.owner).toBe("alex");

    // No copy, and source_pdf_path is omitted (not set to a broken path).
    expect(filesApi.uploadImage).not.toHaveBeenCalled();
    const arg = (methodsApi.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect("source_pdf_path" in arg).toBe(false);
  });

  it("a thrown uploadImage is swallowed and instantiation still succeeds", async () => {
    vi.clearAllMocks();
    (filesApi.uploadImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("disk full"),
    );
    const okFetch = makePdfFetch(true);
    const created = await instantiateMethodFromTemplate(
      KIT_PCR_TEMPLATE,
      {},
      undefined,
      okFetch,
    );

    expect(methodsApi.create).toHaveBeenCalledTimes(1);
    const arg = (methodsApi.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect("source_pdf_path" in arg).toBe(false);
    expect(created.owner).toBe("alex");
  });
});

// ── Compound combinations ("kit") ─────────────────────────────────────────────
//
// A compound combination template (method_type "compound") bundles other
// catalog templates by slug. On instantiation the loader fetches each child by
// slug (via the fetchTemplate seam), instantiates it (recursing the per-type
// branch), then creates the compound PARENT with source_path: null and a
// components array mapping each created child id. Partial-failure is a
// Grant-locked behavior: leave the orphaned children, tag them "incomplete-kit",
// and throw a descriptive error.

const LC_CHILD_TEMPLATE: MethodCatalogTemplate = {
  slug: "lcms-peptide-rp-lc-thermo",
  title: "Peptide RP-LC (Thermo)",
  description: "LC half",
  category: "LC-MS",
  method_type: "lc_gradient",
  payload: {
    description: "RP gradient",
    gradient_steps: [
      { time_min: 0, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 },
    ],
    column: {
      manufacturer: "Thermo",
      model: "EASY-Spray",
      length_mm: 250,
      inner_diameter_mm: 0.075,
      particle_size_um: 2,
    },
    detection_wavelength_nm: null,
    ingredients: [
      { id: "a", name: "Water + 0.1% FA", role: "solvent_a" },
      { id: "b", name: "ACN + 0.1% FA", role: "solvent_b" },
    ],
  },
};

const MS_CHILD_TEMPLATE: MethodCatalogTemplate = {
  slug: "lcms-peptide-ms-thermo-orbitrap",
  title: "Peptide MS (Thermo Orbitrap)",
  description: "MS half",
  category: "LC-MS",
  method_type: "mass_spec",
  payload: {
    instrument: "Q Exactive HF",
    ionization_mode: "esi_pos",
    source: {
      source_temp_c: 320,
      capillary_kv: 2.1,
      nebulizer_gas_lpm: null,
      drying_gas_lpm: null,
      drying_gas_temp_c: null,
      ei_energy_ev: null,
      maldi_laser_nm: null,
      maldi_laser_energy: null,
      maldi_matrix: null,
      other_notes: null,
    },
    scan: {
      scan_mz_low: 375,
      scan_mz_high: 1500,
      scan_rate_hz: null,
      resolution_r: 60000,
      is_msms: true,
      msms_isolation_window_mz: 1.4,
      msms_collision_energy_ev: null,
    },
    calibration: {
      reference_standard: null,
      calibration_date: null,
      expected_accuracy_ppm: null,
      notes: null,
    },
  },
};

const COMPOUND_TEMPLATE: MethodCatalogTemplate = {
  slug: "lcms-peptide-combo-thermo",
  title: "Thermo peptide LC-MS/MS (kit)",
  description: "A full LC-MS kit",
  category: "LC-MS",
  method_type: "compound",
  tags: ["lc-ms", "kit"],
  payload: {
    description: "LC then MS",
    // Intentionally out of order to prove the loader sorts by `ordering`.
    components: [
      { slug: "lcms-peptide-ms-thermo-orbitrap", ordering: 1 },
      { slug: "lcms-peptide-rp-lc-thermo", ordering: 0, label: "LC inlet" },
    ],
  },
};

/** Build a deps object over the mocked local-api plus a fetchTemplate seam that
 *  resolves children from an in-memory map of slug -> template. */
function makeCompoundDeps(
  childrenBySlug: Record<string, MethodCatalogTemplate>,
): InstantiateTemplateDeps {
  return {
    methodsApi,
    pcrApi,
    lcGradientApi,
    plateApi,
    cellCultureApi,
    massSpecApi,
    filesApi,
    fetchTemplate: vi.fn(async (slug: string) => {
      const t = childrenBySlug[slug];
      if (!t) throw new Error(`no fixture template for slug "${slug}"`);
      return t;
    }),
  };
}

describe("compound parsing", () => {
  it("parses a well-formed compound template payload", () => {
    const t = parseMethodCatalogTemplate(COMPOUND_TEMPLATE);
    expect(t.method_type).toBe("compound");
    expect(t.payload).toMatchObject({
      components: [
        { slug: "lcms-peptide-ms-thermo-orbitrap", ordering: 1 },
        { slug: "lcms-peptide-rp-lc-thermo", ordering: 0, label: "LC inlet" },
      ],
    });
  });

  it("rejects a compound template whose components array is empty", () => {
    expect(() =>
      parseMethodCatalogTemplate({
        slug: "empty-combo",
        title: "x",
        description: "x",
        category: "LC-MS",
        method_type: "compound",
        payload: { components: [] },
      }),
    ).toThrow(/non-empty array/);
  });

  it("rejects a compound component missing its slug", () => {
    expect(() =>
      parseMethodCatalogTemplate({
        slug: "bad-combo",
        title: "x",
        description: "x",
        category: "LC-MS",
        method_type: "compound",
        payload: { components: [{ ordering: 0 }] },
      }),
    ).toThrow(/slug/);
  });

  it("rejects a compound component whose ordering is not a number", () => {
    expect(() =>
      parseMethodCatalogTemplate({
        slug: "bad-combo-2",
        title: "x",
        description: "x",
        category: "LC-MS",
        method_type: "compound",
        payload: { components: [{ slug: "child", ordering: "first" }] },
      }),
    ).toThrow(/ordering/);
  });
});

describe("instantiateMethodFromTemplate: compound (kit)", () => {
  it("creates both children in ordering order, then the compound parent", async () => {
    vi.clearAllMocks();
    const deps = makeCompoundDeps({
      "lcms-peptide-rp-lc-thermo": LC_CHILD_TEMPLATE,
      "lcms-peptide-ms-thermo-orbitrap": MS_CHILD_TEMPLATE,
    });
    const created = await instantiateMethodFromTemplate(
      COMPOUND_TEMPLATE,
      { folderPath: "LC-MS" },
      deps,
    );

    // Three create calls: child LC (ordering 0), child MS (ordering 1), then
    // the compound parent. methodsApi.create is invoked in that exact order.
    expect(methodsApi.create).toHaveBeenCalledTimes(3);
    const calls = (methodsApi.create as ReturnType<typeof vi.fn>).mock.calls;

    // First child created is the LC (ordering 0), even though it is listed
    // second in the payload: the loader sorts by `ordering`.
    expect(calls[0][0]).toMatchObject({
      method_type: "lc_gradient",
      name: "Peptide RP-LC (Thermo)",
      folder_path: "LC-MS",
    });
    // Second child is the MS (ordering 1).
    expect(calls[1][0]).toMatchObject({
      method_type: "mass_spec",
      name: "Peptide MS (Thermo Orbitrap)",
      folder_path: "LC-MS",
    });

    // The created child ids come from the mock's resolved return values (the
    // module-level `created` counter persists across tests, so the absolute id
    // is derived dynamically rather than hardcoded).
    // The mock is async, so `mock.results[i].value` is the returned Promise:
    // await it to read the resolved child id.
    const results = (methodsApi.create as ReturnType<typeof vi.fn>).mock.results;
    const lcChildId = ((await results[0].value) as { id: number }).id;
    const msChildId = ((await results[1].value) as { id: number }).id;

    // The compound PARENT: source_path null, no PDF, components mapped to the
    // created child ids in ordering order.
    const parentArg = calls[2][0] as Record<string, unknown>;
    expect(parentArg).toMatchObject({
      name: "Thermo peptide LC-MS/MS (kit)",
      method_type: "compound",
      source_path: null,
      folder_path: "LC-MS",
      tags: ["lc-ms", "kit"],
      shared_with: [],
    });
    expect(parentArg.components).toEqual([
      // LC child: ordering 0, label override carried through.
      { method_id: lcChildId, owner: null, ordering: 0, label: "LC inlet" },
      // MS child: ordering 1, no label.
      { method_id: msChildId, owner: null, ordering: 1 },
    ]);

    // The returned compound parent is owned by the current user.
    expect(created.method_type).toBe("compound");
    expect(created.owner).toBe("alex");

    // The compound parent never copies a bundled PDF.
    expect("source_pdf_path" in parentArg).toBe(false);

    // Each child fetched by slug via the seam.
    expect(deps.fetchTemplate).toHaveBeenCalledWith("lcms-peptide-rp-lc-thermo");
    expect(deps.fetchTemplate).toHaveBeenCalledWith(
      "lcms-peptide-ms-thermo-orbitrap",
    );
  });

  it("partial failure: leaves the first child as an orphan tagged incomplete-kit and throws", async () => {
    vi.clearAllMocks();
    // The MS child fetch throws, AFTER the LC child has already been created.
    const deps = makeCompoundDeps({
      "lcms-peptide-rp-lc-thermo": LC_CHILD_TEMPLATE,
      // MS slug intentionally absent -> fetchTemplate throws on the 2nd child.
    });

    await expect(
      instantiateMethodFromTemplate(COMPOUND_TEMPLATE, { folderPath: "LC-MS" }, deps),
    ).rejects.toThrow(/lcms-peptide-ms-thermo-orbitrap/);

    // The first (LC) child WAS created (not rolled back).
    const createMock = methodsApi.create as ReturnType<typeof vi.fn>;
    const createCalls = createMock.mock.calls;
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][0]).toMatchObject({ method_type: "lc_gradient" });
    // Async mock: await the returned Promise to read the resolved orphan id.
    const orphanId = ((await createMock.mock.results[0].value) as { id: number })
      .id;

    // The compound parent was NEVER created (instantiation aborted).
    expect(
      createCalls.some(
        (c) => (c[0] as Record<string, unknown>).method_type === "compound",
      ),
    ).toBe(false);

    // The orphaned LC child was tagged "incomplete-kit" for follow-up via update.
    expect(methodsApi.update).toHaveBeenCalledTimes(1);
    const [updatedId, updateData] = (
      methodsApi.update as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(updatedId).toBe(orphanId);
    expect((updateData as { tags: string[] }).tags).toContain(INCOMPLETE_KIT_TAG);
  });

  it("partial-failure error names the kit and counts the orphans left behind", async () => {
    vi.clearAllMocks();
    const deps = makeCompoundDeps({
      "lcms-peptide-rp-lc-thermo": LC_CHILD_TEMPLATE,
    });
    await expect(
      instantiateMethodFromTemplate(COMPOUND_TEMPLATE, {}, deps),
    ).rejects.toThrow(/lcms-peptide-combo-thermo/);
    await expect(
      instantiateMethodFromTemplate(COMPOUND_TEMPLATE, {}, deps),
    ).rejects.toThrow(new RegExp(INCOMPLETE_KIT_TAG));
  });
});
