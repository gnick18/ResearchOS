/**
 * Method template catalog (Extension Store Phase U1).
 *
 * A STATIC, data-only catalog of prebuilt protocol TEMPLATES that ships in the
 * reviewed app build under `frontend/public/method-catalog/`. A template is
 * pure data (no code, no runtime execution): a small typed payload that maps
 * onto an existing `method_type`'s create shape. The user browses these
 * templates and, on "Use template", a NORMAL method is created in their own
 * folder via the same `methodsApi.create` + per-type `*Api.create` path the
 * `CreateMethodModal` already uses. The created method is owned, editable, and
 * fully decoupled from the catalog afterwards; the catalog template stays
 * read-only.
 *
 * The catalog is fetched client-side exactly like `wiki-search-index.json`
 * (`frontend/src/lib/wiki/search.ts`) and `demo-data/`
 * (`frontend/src/lib/demo/lab-demo-data.ts`): plain `fetch` of static JSON from
 * the Vercel deploy, no server, no proxy. A manifest lists the curated order;
 * each template lives in its own file so the manifest stays light.
 *
 * Security / scope (per plans/EXTENSION_STORE_DESIGN.md §1.5-1.6 and
 * plans/METHOD_LIBRARY_DESIGN.md §2): templates are DATA, not code, so none of
 * the runtime-code-execution constraints apply. No persisted-data-shape change:
 * a template becomes an ordinary `Method` record (plus the type's structured
 * sidecar) through the existing create APIs.
 */

import {
  methodsApi,
  pcrApi,
  lcGradientApi,
  plateApi,
  cellCultureApi,
  massSpecApi,
} from "@/lib/local-api";
import { filesApi } from "@/lib/local-api";
import { createNewFileContent } from "@/lib/stamp-utils";
import type {
  Method,
  PCRGradient,
  PCRIngredient,
  LCGradientStep,
  LCGradientColumn,
  LCIngredient,
  PlateSize,
  PlateRegionLabel,
  CellCultureCellLine,
  CellCultureMedia,
  CellCulturePlannedEvent,
  IonizationMode,
  MassSpecSourceParams,
  MassSpecScanParams,
  MassSpecCalibration,
} from "@/lib/types";
import type { MethodTypeId } from "@/lib/methods/method-type-registry";

// ── Where the catalog lives ──────────────────────────────────────────────────

/** Public path the static catalog is served from (Vercel deploy + dev). */
export const METHOD_CATALOG_BASE = "/method-catalog";
export const METHOD_CATALOG_MANIFEST = `${METHOD_CATALOG_BASE}/manifest.json`;

// ── Per-type template payloads ───────────────────────────────────────────────
//
// Each payload mirrors the matching `*Create` shape so instantiation can pass
// it almost verbatim into the per-type API. Phase U1 ships templates for the
// types whose create shape is pure-data (markdown + the structured pcr / plate
// / lc_gradient / cell_culture). PDF is intentionally excluded (a PDF template
// would need to ship a binary asset, out of scope for the data-only slice).

export interface MarkdownTemplatePayload {
  /** Markdown body inserted below the auto-generated method stamp + H1. */
  body: string;
}

export interface PcrTemplatePayload {
  gradient: PCRGradient;
  ingredients: PCRIngredient[];
  notes?: string | null;
}

export interface LcGradientTemplatePayload {
  description?: string | null;
  gradient_steps: LCGradientStep[];
  column: LCGradientColumn;
  detection_wavelength_nm?: number | null;
  ingredients: LCIngredient[];
}

export interface PlateTemplatePayload {
  description?: string | null;
  plate_size: PlateSize;
  region_labels: PlateRegionLabel[];
}

export interface CellCultureTemplatePayload {
  description?: string | null;
  cell_line: CellCultureCellLine;
  media: CellCultureMedia;
  planned_events: CellCulturePlannedEvent[];
}

/** Mirrors the structured part of `MassSpecProtocolCreate` (name + folder +
 *  is_public are supplied at instantiation, not in the template). Pairs with an
 *  `lc_gradient` template to describe a full LC-MS kit. */
export interface MassSpecTemplatePayload {
  description?: string | null;
  /** Instrument model, e.g. "Q Exactive HF". */
  instrument?: string | null;
  /** Required, mirroring `MassSpecProtocolCreate.ionization_mode` (non-null). */
  ionization_mode: IonizationMode;
  ionization_label?: string | null;
  source: MassSpecSourceParams;
  scan: MassSpecScanParams;
  calibration: MassSpecCalibration;
}

/** The method types a template can instantiate. A subset of `MethodTypeId`:
 *  only the pure-data create shapes. */
export type CatalogMethodType =
  | "markdown"
  | "pcr"
  | "lc_gradient"
  | "plate"
  | "cell_culture"
  | "mass_spec";

// ── The template + manifest schema ───────────────────────────────────────────

interface MethodCatalogTemplateBase {
  /** Stable, URL-safe identifier. The per-template file is
   *  `templates/<slug>.json` and the manifest entry keys on it. */
  slug: string;
  /** Display title shown on the browse card and used as the created
   *  method's name. */
  title: string;
  /** One-line summary for the browse card. */
  description: string;
  /** Grouping label for the browse surface (e.g. "Molecular biology"). */
  category: string;
  /** Optional searchable keywords. */
  tags?: string[];
}

export type MethodCatalogTemplate = MethodCatalogTemplateBase &
  (
    | { method_type: "markdown"; payload: MarkdownTemplatePayload }
    | { method_type: "pcr"; payload: PcrTemplatePayload }
    | { method_type: "lc_gradient"; payload: LcGradientTemplatePayload }
    | { method_type: "plate"; payload: PlateTemplatePayload }
    | { method_type: "cell_culture"; payload: CellCultureTemplatePayload }
    | { method_type: "mass_spec"; payload: MassSpecTemplatePayload }
  );

/** Lightweight per-entry metadata in `manifest.json` (the browse list). The
 *  full payload is fetched lazily per-template by `slug` on "Use template". */
export interface MethodCatalogManifestEntry {
  slug: string;
  title: string;
  description: string;
  category: string;
  method_type: CatalogMethodType;
  tags?: string[];
}

export interface MethodCatalogManifest {
  /** Catalog format version; bump on a breaking schema change. */
  version: number;
  /** ISO timestamp the catalog was authored. Informational. */
  generatedAt: string;
  /** Curated order (newest / most useful first). */
  templates: MethodCatalogManifestEntry[];
}

// ── Parsing / validation ─────────────────────────────────────────────────────
//
// The catalog ships in the build, so parsing is a light shape guard rather than
// a hostile-input defense: it catches an author typo (a missing field, a wrong
// method_type) before it reaches a create call.

const CATALOG_METHOD_TYPES: ReadonlySet<string> = new Set<CatalogMethodType>([
  "markdown",
  "pcr",
  "lc_gradient",
  "plate",
  "cell_culture",
  "mass_spec",
]);

export function isCatalogMethodType(value: unknown): value is CatalogMethodType {
  return typeof value === "string" && CATALOG_METHOD_TYPES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parse + validate the manifest JSON. Throws on a malformed manifest. */
export function parseMethodCatalogManifest(raw: unknown): MethodCatalogManifest {
  if (!isRecord(raw)) {
    throw new Error("method-catalog manifest is not an object");
  }
  if (typeof raw.version !== "number") {
    throw new Error("method-catalog manifest is missing a numeric `version`");
  }
  if (!Array.isArray(raw.templates)) {
    throw new Error("method-catalog manifest is missing a `templates` array");
  }
  const templates: MethodCatalogManifestEntry[] = raw.templates.map(
    (entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`manifest template #${index} is not an object`);
      }
      const { slug, title, description, category, method_type, tags } = entry;
      if (typeof slug !== "string" || slug.length === 0) {
        throw new Error(`manifest template #${index} is missing a string slug`);
      }
      if (typeof title !== "string" || typeof description !== "string") {
        throw new Error(`manifest template "${slug}" is missing title/description`);
      }
      if (typeof category !== "string") {
        throw new Error(`manifest template "${slug}" is missing a category`);
      }
      if (!isCatalogMethodType(method_type)) {
        throw new Error(
          `manifest template "${slug}" has an unsupported method_type`,
        );
      }
      return {
        slug,
        title,
        description,
        category,
        method_type,
        tags: Array.isArray(tags)
          ? tags.filter((t): t is string => typeof t === "string")
          : undefined,
      };
    },
  );
  return {
    version: raw.version,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    templates,
  };
}

/** Parse + validate a single template payload file. Throws if the declared
 *  `method_type` is unsupported or required identity fields are absent. The
 *  per-type payload itself is trusted (build-shipped data) beyond a presence
 *  check, mirroring how the demo-data loader trusts its fixtures. */
export function parseMethodCatalogTemplate(raw: unknown): MethodCatalogTemplate {
  if (!isRecord(raw)) {
    throw new Error("method-catalog template is not an object");
  }
  const { slug, title, description, category, method_type, payload, tags } = raw;
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error("template is missing a string slug");
  }
  if (typeof title !== "string" || typeof description !== "string") {
    throw new Error(`template "${slug}" is missing title/description`);
  }
  if (typeof category !== "string") {
    throw new Error(`template "${slug}" is missing a category`);
  }
  if (!isCatalogMethodType(method_type)) {
    throw new Error(`template "${slug}" has an unsupported method_type`);
  }
  if (!isRecord(payload)) {
    throw new Error(`template "${slug}" is missing a payload object`);
  }
  // The per-type payload is build-shipped data trusted beyond the presence
  // check above (mirrors the demo-data loader). Cast through `unknown` to land
  // on the discriminated union: method_type is already narrowed to a
  // CatalogMethodType and payload is confirmed an object.
  return {
    slug,
    title,
    description,
    category,
    method_type,
    payload,
    tags: Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === "string")
      : undefined,
  } as unknown as MethodCatalogTemplate;
}

// ── Fetching ─────────────────────────────────────────────────────────────────

/** A swappable fetch impl so the loader is testable without a real network. */
type FetchLike = (input: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function resolveFetch(custom?: FetchLike): FetchLike {
  if (custom) return custom;
  if (typeof fetch === "function") {
    return (input) => fetch(input) as unknown as ReturnType<FetchLike>;
  }
  throw new Error("no fetch implementation available for the method catalog");
}

/** Fetch + parse the catalog manifest. Rejects on a network error or a
 *  malformed manifest; the browse surface can show an offline state. */
export async function fetchMethodCatalogManifest(
  customFetch?: FetchLike,
): Promise<MethodCatalogManifest> {
  const doFetch = resolveFetch(customFetch);
  const res = await doFetch(METHOD_CATALOG_MANIFEST);
  if (!res.ok) {
    throw new Error(
      `method-catalog manifest fetch failed (status ${res.status})`,
    );
  }
  return parseMethodCatalogManifest(await res.json());
}

/** Fetch + parse one template payload by slug. */
export async function fetchMethodCatalogTemplate(
  slug: string,
  customFetch?: FetchLike,
): Promise<MethodCatalogTemplate> {
  const doFetch = resolveFetch(customFetch);
  const res = await doFetch(`${METHOD_CATALOG_BASE}/templates/${slug}.json`);
  if (!res.ok) {
    throw new Error(
      `method-catalog template "${slug}" fetch failed (status ${res.status})`,
    );
  }
  return parseMethodCatalogTemplate(await res.json());
}

// ── Instantiation ("Use template") ───────────────────────────────────────────
//
// Mirrors the per-type create branches in CreateMethodModal.tsx exactly: for a
// structured type, write the sidecar via the per-type API, then create the
// method row pointing at it via `source_path`. `methodsApi.create` stamps the
// current user as `owner` (it derives owner from the current user when no
// whole-lab "*" sentinel is present), so the result is a normal private method
// the user owns and can edit. Templates always instantiate PRIVATE (the user
// can publish afterward through the unified sharing primitive).

/** Slugify a method title the same way CreateMethodModal does, for the
 *  markdown source-file path. */
function slugifyTitle(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

export interface InstantiateTemplateOptions {
  /** Destination folder (category) for the new method. Empty = uncategorized. */
  folderPath?: string | null;
  /** Override the created method's name. Defaults to the template title. */
  name?: string;
  /** Tags to stamp on the method row. Defaults to the template's tags. */
  tags?: string[];
}

/** Dependency seam so the instantiation logic is unit-testable against
 *  in-memory fakes (mirrors the methodsApi mock pattern in
 *  methods-api-create.test.ts). Defaults to the real local APIs. */
export interface InstantiateTemplateDeps {
  methodsApi: Pick<typeof methodsApi, "create">;
  pcrApi: Pick<typeof pcrApi, "create">;
  lcGradientApi: Pick<typeof lcGradientApi, "create">;
  plateApi: Pick<typeof plateApi, "create">;
  cellCultureApi: Pick<typeof cellCultureApi, "create">;
  massSpecApi: Pick<typeof massSpecApi, "create">;
  filesApi: Pick<typeof filesApi, "writeFile">;
}

const DEFAULT_DEPS: InstantiateTemplateDeps = {
  methodsApi,
  pcrApi,
  lcGradientApi,
  plateApi,
  cellCultureApi,
  massSpecApi,
  filesApi,
};

/**
 * Create a new, user-owned method from a catalog template. Returns the created
 * `Method` row. The method lands in the current user's namespace (owner stamped
 * by `methodsApi.create`), in `folderPath`, and is fully editable + decoupled
 * from the catalog.
 */
export async function instantiateMethodFromTemplate(
  template: MethodCatalogTemplate,
  options: InstantiateTemplateOptions = {},
  deps: InstantiateTemplateDeps = DEFAULT_DEPS,
): Promise<Method> {
  const name = (options.name ?? template.title).trim();
  const folderPath =
    options.folderPath && options.folderPath.trim().length > 0
      ? options.folderPath.trim()
      : null;
  const tags = options.tags ?? template.tags ?? [];

  switch (template.method_type) {
    case "markdown": {
      const slug = slugifyTitle(name) || "method";
      const sourcePath = `methods/${slug}/${slug}.md`;
      const stamp = createNewFileContent(name, folderPath || "Methods", "method");
      const body = template.payload.body
        ? `${stamp}\n${template.payload.body}`
        : stamp;
      await deps.filesApi.writeFile(sourcePath, body, `Create method: ${name}`);
      return deps.methodsApi.create({
        name,
        source_path: sourcePath,
        method_type: "markdown",
        folder_path: folderPath,
        tags,
        shared_with: [],
      });
    }
    case "pcr": {
      const protocol = await deps.pcrApi.create({
        name,
        gradient: template.payload.gradient,
        ingredients: template.payload.ingredients,
        notes: template.payload.notes ?? null,
        folder_path: folderPath,
        is_public: false,
      });
      return deps.methodsApi.create({
        name,
        source_path: `pcr://protocol/${protocol.id}`,
        method_type: "pcr",
        folder_path: folderPath,
        tags,
        shared_with: [],
      });
    }
    case "lc_gradient": {
      const protocol = await deps.lcGradientApi.create({
        name,
        description: template.payload.description ?? null,
        gradient_steps: template.payload.gradient_steps,
        column: template.payload.column,
        detection_wavelength_nm: template.payload.detection_wavelength_nm ?? null,
        ingredients: template.payload.ingredients,
        folder_path: folderPath,
        is_public: false,
      });
      return deps.methodsApi.create({
        name,
        source_path: `lc_gradient://protocol/${protocol.id}`,
        method_type: "lc_gradient",
        folder_path: folderPath,
        tags,
        shared_with: [],
      });
    }
    case "plate": {
      const protocol = await deps.plateApi.create({
        name,
        description: template.payload.description ?? null,
        plate_size: template.payload.plate_size,
        region_labels: template.payload.region_labels,
        folder_path: folderPath,
        is_public: false,
      });
      return deps.methodsApi.create({
        name,
        source_path: `plate://protocol/${protocol.id}`,
        method_type: "plate",
        folder_path: folderPath,
        tags,
        shared_with: [],
      });
    }
    case "cell_culture": {
      const schedule = await deps.cellCultureApi.create({
        name,
        description: template.payload.description ?? null,
        cell_line: template.payload.cell_line,
        media: template.payload.media,
        planned_events: template.payload.planned_events,
        folder_path: folderPath,
        is_public: false,
      });
      return deps.methodsApi.create({
        name,
        source_path: `cell_culture://protocol/${schedule.id}`,
        method_type: "cell_culture",
        folder_path: folderPath,
        tags,
        shared_with: [],
      });
    }
    case "mass_spec": {
      const protocol = await deps.massSpecApi.create({
        name,
        instrument: template.payload.instrument ?? null,
        description: template.payload.description ?? null,
        ionization_mode: template.payload.ionization_mode,
        ionization_label: template.payload.ionization_label ?? null,
        source: template.payload.source,
        scan: template.payload.scan,
        calibration: template.payload.calibration,
        folder_path: folderPath,
        is_public: false,
      });
      return deps.methodsApi.create({
        name,
        source_path: `mass_spec://protocol/${protocol.id}`,
        method_type: "mass_spec",
        folder_path: folderPath,
        tags,
        shared_with: [],
      });
    }
    default: {
      // Exhaustiveness guard: a new CatalogMethodType must add a branch above.
      const _exhaustive: never = template;
      throw new Error(
        `unsupported template method_type: ${
          (_exhaustive as MethodCatalogTemplate).method_type as MethodTypeId
        }`,
      );
    }
  }
}
