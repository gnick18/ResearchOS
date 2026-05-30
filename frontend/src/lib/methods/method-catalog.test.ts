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
  type MethodCatalogTemplate,
} from "./method-catalog";
import {
  methodsApi,
  pcrApi,
  plateApi,
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
    expect(isCatalogMethodType("compound")).toBe(false);
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
});
