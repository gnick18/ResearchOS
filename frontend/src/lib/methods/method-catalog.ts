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

/** A single child reference inside a COMPOUND combination template. The child
 *  is itself a catalog template, named here by its `slug` (no method ids exist
 *  at browse time). On instantiation the loader fetches the child template by
 *  slug, instantiates it (recursing the per-type branch), and records the
 *  resulting method id in the compound parent's `components` array. */
export interface CompoundTemplateComponent {
  /** Another catalog template slug (the child to instantiate). */
  slug: string;
  /** 0-based position; the loader sorts components by this before creating the
   *  children, so a kit instantiates its children in a stable order
   *  (e.g. LC at 0, MS at 1: sample flows LC -> MS). */
  ordering: number;
  /** Optional label override carried onto the created `CompoundComponent`.
   *  When unset, the compound renderer falls back to the child method's name. */
  label?: string;
}

/** Payload for a COMPOUND combination template. A combination bundles multiple
 *  leaf templates (each a normal single-type template that keeps its own
 *  `source_pdf`); the combination parent itself has no structured sidecar and no
 *  PDF (`source_path: null`). `components` must be non-empty. */
export interface CompoundTemplatePayload {
  description?: string | null;
  components: CompoundTemplateComponent[];
}

/** The method types a template can instantiate. A subset of `MethodTypeId`:
 *  only the pure-data create shapes, plus the `compound` combination type whose
 *  payload references other catalog templates by slug. */
export type CatalogMethodType =
  | "markdown"
  | "pcr"
  | "lc_gradient"
  | "plate"
  | "cell_culture"
  | "mass_spec"
  | "compound";

// ── Bundled source PDF ("kit" templates) ─────────────────────────────────────
//
// Kit Phase 1: a template MAY declare a BUNDLED source PDF, shipped in the build
// under `${METHOD_CATALOG_BASE}/sources/<slug>.pdf`. The kit stays ONE
// structured method (its native pcr / lc_gradient / etc.) with this PDF attached
// via the existing pdf-method storage + iframe viewer (no compound machinery).
// The descriptor below is pure provenance metadata: the loader resolves the
// fetch URL BY CONVENTION from the slug (never from `filename` / `source_url`),
// so a template cannot point a fetch at an arbitrary file. `bundled: true` means
// the PDF ships in-build and is copied on instantiation; `source_url` alone
// (no bundle) is a link-only reference; absent means no PDF at all.
export interface MethodCatalogSourcePdf {
  /** Whether the PDF is shipped in-build at `sources/<slug>.pdf` and should be
   *  copied alongside the method on instantiation. */
  bundled: boolean;
  /** The vendor's original filename, used only to name the copied attachment
   *  (`source-<filename>.pdf`) and for display. Never used to build a fetch URL. */
  filename: string;
  /** Optional upstream URL the PDF was sourced from (provenance / link-only). */
  source_url?: string;
  /** Optional SHA-256 of the bundled asset, for an integrity check in the
   *  coverage test. */
  sha256?: string;
}

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
  /** Kit Phase 1: optional bundled / linked source PDF (vendor pack insert). */
  source_pdf?: MethodCatalogSourcePdf;
}

export type MethodCatalogTemplate = MethodCatalogTemplateBase &
  (
    | { method_type: "markdown"; payload: MarkdownTemplatePayload }
    | { method_type: "pcr"; payload: PcrTemplatePayload }
    | { method_type: "lc_gradient"; payload: LcGradientTemplatePayload }
    | { method_type: "plate"; payload: PlateTemplatePayload }
    | { method_type: "cell_culture"; payload: CellCultureTemplatePayload }
    | { method_type: "mass_spec"; payload: MassSpecTemplatePayload }
    | { method_type: "compound"; payload: CompoundTemplatePayload }
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
  /** Kit Phase 1: optional bundled / linked source PDF, mirrored from the
   *  template so the browse surface can show a "kit" badge without fetching the
   *  full payload. */
  source_pdf?: MethodCatalogSourcePdf;
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
  "compound",
]);

export function isCatalogMethodType(value: unknown): value is CatalogMethodType {
  return typeof value === "string" && CATALOG_METHOD_TYPES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Shape-check an optional `source_pdf` descriptor. Returns `undefined` when the
 *  field is absent (the common case), the validated descriptor when present and
 *  well-formed, and THROWS when present but malformed. `filename` / `source_url`
 *  are kept only as provenance metadata; they are never used to build a fetch
 *  URL (the loader resolves bundled assets by slug convention). `label` is the
 *  caller context for the error message (e.g. a slug or "manifest entry"). */
function parseSourcePdf(
  raw: unknown,
  label: string,
): MethodCatalogSourcePdf | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    throw new Error(`${label}: source_pdf is not an object`);
  }
  if (typeof raw.bundled !== "boolean") {
    throw new Error(`${label}: source_pdf.bundled must be a boolean`);
  }
  if (typeof raw.filename !== "string" || raw.filename.length === 0) {
    throw new Error(`${label}: source_pdf.filename must be a non-empty string`);
  }
  if (raw.source_url !== undefined && typeof raw.source_url !== "string") {
    throw new Error(`${label}: source_pdf.source_url must be a string when set`);
  }
  if (raw.sha256 !== undefined && typeof raw.sha256 !== "string") {
    throw new Error(`${label}: source_pdf.sha256 must be a string when set`);
  }
  return {
    bundled: raw.bundled,
    filename: raw.filename,
    ...(raw.source_url !== undefined ? { source_url: raw.source_url } : {}),
    ...(raw.sha256 !== undefined ? { sha256: raw.sha256 } : {}),
  };
}

/** Shape-check a COMPOUND template payload: a `components` array that is
 *  NON-EMPTY and whose every entry is `{ slug: string, ordering: number,
 *  label?: string }`. Throws on any malformed entry. `description` is optional
 *  (a string or null). `label` is the caller context for the error message. */
function parseCompoundPayload(
  raw: unknown,
  label: string,
): CompoundTemplatePayload {
  if (!isRecord(raw)) {
    throw new Error(`${label}: compound payload is not an object`);
  }
  if (!Array.isArray(raw.components) || raw.components.length === 0) {
    throw new Error(
      `${label}: compound payload.components must be a non-empty array`,
    );
  }
  const components: CompoundTemplateComponent[] = raw.components.map(
    (entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`${label}: component #${index} is not an object`);
      }
      if (typeof entry.slug !== "string" || entry.slug.length === 0) {
        throw new Error(
          `${label}: component #${index} is missing a string slug`,
        );
      }
      if (typeof entry.ordering !== "number") {
        throw new Error(
          `${label}: component #${index} is missing a numeric ordering`,
        );
      }
      if (entry.label !== undefined && typeof entry.label !== "string") {
        throw new Error(
          `${label}: component #${index} label must be a string when set`,
        );
      }
      return {
        slug: entry.slug,
        ordering: entry.ordering,
        ...(entry.label !== undefined ? { label: entry.label } : {}),
      };
    },
  );
  const description = raw.description;
  return {
    components,
    ...(description === undefined
      ? {}
      : {
          description:
            typeof description === "string" || description === null
              ? description
              : null,
        }),
  };
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
      const source_pdf = parseSourcePdf(
        entry.source_pdf,
        `manifest template "${slug}"`,
      );
      return {
        slug,
        title,
        description,
        category,
        method_type,
        tags: Array.isArray(tags)
          ? tags.filter((t): t is string => typeof t === "string")
          : undefined,
        ...(source_pdf ? { source_pdf } : {}),
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
  const source_pdf = parseSourcePdf(raw.source_pdf, `template "${slug}"`);
  // A compound combination template references its children by slug, so its
  // payload is validated structurally (a non-empty components array) before the
  // loader fans out the recursive instantiation. Every other per-type payload is
  // build-shipped data trusted beyond the presence check above (mirrors the
  // demo-data loader). Cast through `unknown` to land on the discriminated
  // union: method_type is already narrowed to a CatalogMethodType and payload is
  // confirmed an object.
  const checkedPayload =
    method_type === "compound"
      ? parseCompoundPayload(payload, `template "${slug}"`)
      : payload;
  return {
    slug,
    title,
    description,
    category,
    method_type,
    payload: checkedPayload,
    tags: Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === "string")
      : undefined,
    ...(source_pdf ? { source_pdf } : {}),
  } as unknown as MethodCatalogTemplate;
}

// ── Fetching ─────────────────────────────────────────────────────────────────

/** A swappable fetch impl so the loader is testable without a real network.
 *  `arrayBuffer` is optional: only the bundled-source-PDF copy uses it, and
 *  only when `source_pdf.bundled` is true. */
type FetchLike = (input: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
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

/** Encode an ArrayBuffer to base64 (the form `filesApi.uploadImage` expects),
 *  chunked to avoid blowing the call stack on a multi-hundred-KB PDF. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  if (typeof btoa === "function") return btoa(binary);
  // Node fallback (tests / SSR): Buffer is available where btoa is not.
  return Buffer.from(binary, "binary").toString("base64");
}

/**
 * Best-effort copy of a template's BUNDLED source PDF into the new method's
 * folder, reusing the existing pdf-method storage primitive
 * (`filesApi.uploadImage`, base64 -> blob, the same call CreateMethodModal makes
 * for an uploaded PDF). The fetch URL is resolved BY CONVENTION from the slug
 * (`sources/<templateSlug>.pdf`), NEVER from the template-supplied `filename` /
 * `source_url`, so a template cannot point the fetch at an arbitrary asset.
 *
 * Returns the written `source_pdf_path` on success, or `null` on ANY failure
 * (no bundle declared, fetch miss, decode error, write error). A null return is
 * intentionally swallowed by the caller: a PDF-copy failure must NEVER fail the
 * structured instantiation, which has already succeeded by the time this runs.
 */
async function copyBundledSourcePdf(
  template: MethodCatalogTemplate,
  methodSlug: string,
  doFetch: FetchLike,
  filesApiDep: Pick<typeof filesApi, "uploadImage">,
): Promise<string | null> {
  const sourcePdf = template.source_pdf;
  if (!sourcePdf?.bundled) return null;
  try {
    const assetUrl = `${METHOD_CATALOG_BASE}/sources/${template.slug}.pdf`;
    const res = await doFetch(assetUrl);
    if (!res.ok || typeof res.arrayBuffer !== "function") {
      console.warn(
        `[method-catalog] bundled source PDF for "${template.slug}" not available (status ${res.status}); skipping PDF copy`,
      );
      return null;
    }
    const base64 = arrayBufferToBase64(await res.arrayBuffer());
    // Sanitize the vendor filename for the on-disk attachment name; keep a
    // .pdf extension. Falls back to the slug if sanitization empties it.
    const safeName =
      sourcePdf.filename.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+/, "") ||
      `${template.slug}.pdf`;
    const withExt = safeName.toLowerCase().endsWith(".pdf")
      ? safeName
      : `${safeName}.pdf`;
    const targetPath = `methods/${methodSlug}/source-${withExt}`;
    await filesApiDep.uploadImage(
      targetPath,
      base64,
      `Bundle source PDF: ${template.title}`,
    );
    return targetPath;
  } catch (err) {
    console.warn(
      `[method-catalog] failed to copy bundled source PDF for "${template.slug}"; instantiation continues without it`,
      err,
    );
    return null;
  }
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
  // `create` builds every method row; `update` is used ONLY by the compound
  // partial-failure path to stamp the `incomplete-kit` marker on orphaned
  // children (see the compound branch).
  methodsApi: Pick<typeof methodsApi, "create" | "update">;
  pcrApi: Pick<typeof pcrApi, "create">;
  lcGradientApi: Pick<typeof lcGradientApi, "create">;
  plateApi: Pick<typeof plateApi, "create">;
  cellCultureApi: Pick<typeof cellCultureApi, "create">;
  massSpecApi: Pick<typeof massSpecApi, "create">;
  // `writeFile` backs the markdown source; `uploadImage` is the existing binary
  // (base64 -> blob) primitive reused to copy a bundled source PDF (Kit Phase 1).
  filesApi: Pick<typeof filesApi, "writeFile" | "uploadImage">;
  /** Fetch a child catalog template by slug. Threaded as a seam so the COMPOUND
   *  branch can fetch + recurse its children against in-memory fixtures in a
   *  unit test. Defaults to the module `fetchMethodCatalogTemplate`. */
  fetchTemplate?: (slug: string) => Promise<MethodCatalogTemplate>;
}

/** Resolve the real local-api singletons lazily, at call time, instead of in a
 *  module-level literal. Reading these bindings during module initialization
 *  couples every importer of this module (and its dependents, e.g.
 *  experiment-tools.ts) to the full `@/lib/local-api` surface. A test that
 *  factory-mocks `@/lib/local-api` with only a partial surface would otherwise
 *  trip vitest's "no <export> defined on the mock" guard the moment this file is
 *  imported, even when no template is ever instantiated. Deferring the read to
 *  call time keeps import-time side-effect-free. */
function defaultInstantiateDeps(): InstantiateTemplateDeps {
  return {
    methodsApi,
    pcrApi,
    lcGradientApi,
    plateApi,
    cellCultureApi,
    massSpecApi,
    filesApi,
  };
}

/** Marker tag stamped on an orphaned child when a COMPOUND combination fails
 *  partway: by Grant-locked decision the loader does NOT roll back the children
 *  already created, but tags them so a half-built kit is discoverable as
 *  incomplete (the modal also surfaces the thrown error). */
export const INCOMPLETE_KIT_TAG = "incomplete-kit";

/**
 * Create a new, user-owned method from a catalog template. Returns the created
 * `Method` row. The method lands in the current user's namespace (owner stamped
 * by `methodsApi.create`), in `folderPath`, and is fully editable + decoupled
 * from the catalog.
 */
export async function instantiateMethodFromTemplate(
  template: MethodCatalogTemplate,
  options: InstantiateTemplateOptions = {},
  deps: InstantiateTemplateDeps = defaultInstantiateDeps(),
  customFetch?: FetchLike,
): Promise<Method> {
  const name = (options.name ?? template.title).trim();
  const folderPath =
    options.folderPath && options.folderPath.trim().length > 0
      ? options.folderPath.trim()
      : null;
  const tags = options.tags ?? template.tags ?? [];

  // A stable per-method slug used both for the markdown source folder and the
  // bundled-PDF attachment folder (`methods/<methodSlug>/...`). Resolving fetch
  // is deferred so non-kit templates (no source_pdf) never touch fetch.
  const methodSlug = slugifyTitle(name) || "method";
  // Best-effort bundled-PDF copy, run AFTER the structured create in each branch
  // so a PDF failure can never take down the structured instantiation. Returns
  // `null` when the template declares no bundled PDF or any step fails.
  const copyPdf = (): Promise<string | null> =>
    template.source_pdf?.bundled
      ? copyBundledSourcePdf(
          template,
          methodSlug,
          resolveFetch(customFetch),
          deps.filesApi,
        )
      : Promise.resolve(null);

  switch (template.method_type) {
    case "markdown": {
      const slug = methodSlug;
      const sourcePath = `methods/${slug}/${slug}.md`;
      const stamp = createNewFileContent(name, folderPath || "Methods", "method");
      const body = template.payload.body
        ? `${stamp}\n${template.payload.body}`
        : stamp;
      await deps.filesApi.writeFile(sourcePath, body, `Create method: ${name}`);
      const sourcePdfPath = await copyPdf();
      return deps.methodsApi.create({
        name,
        source_path: sourcePath,
        ...(sourcePdfPath ? { source_pdf_path: sourcePdfPath } : {}),
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
      const sourcePdfPath = await copyPdf();
      return deps.methodsApi.create({
        name,
        source_path: `pcr://protocol/${protocol.id}`,
        ...(sourcePdfPath ? { source_pdf_path: sourcePdfPath } : {}),
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
      const sourcePdfPath = await copyPdf();
      return deps.methodsApi.create({
        name,
        source_path: `lc_gradient://protocol/${protocol.id}`,
        ...(sourcePdfPath ? { source_pdf_path: sourcePdfPath } : {}),
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
      const sourcePdfPath = await copyPdf();
      return deps.methodsApi.create({
        name,
        source_path: `plate://protocol/${protocol.id}`,
        ...(sourcePdfPath ? { source_pdf_path: sourcePdfPath } : {}),
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
      const sourcePdfPath = await copyPdf();
      return deps.methodsApi.create({
        name,
        source_path: `cell_culture://protocol/${schedule.id}`,
        ...(sourcePdfPath ? { source_pdf_path: sourcePdfPath } : {}),
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
      const sourcePdfPath = await copyPdf();
      return deps.methodsApi.create({
        name,
        source_path: `mass_spec://protocol/${protocol.id}`,
        ...(sourcePdfPath ? { source_pdf_path: sourcePdfPath } : {}),
        method_type: "mass_spec",
        folder_path: folderPath,
        tags,
        shared_with: [],
      });
    }
    case "compound": {
      // A COMPOUND combination is a parent method that bundles already-created
      // child methods. The compound branch never copies a bundled PDF: it has no
      // structured sidecar to hang one on (source_path is null), and each child
      // copies its OWN source_pdf through its per-type branch when it recurses.
      const fetchChild =
        deps.fetchTemplate ??
        ((slug: string) => fetchMethodCatalogTemplate(slug, customFetch));

      // Instantiate children in `ordering` order (sample-flow order, e.g.
      // LC -> MS) so the kit reads predictably. Copy before sorting so the
      // template payload is never mutated in place.
      const ordered = [...template.payload.components].sort(
        (a, b) => a.ordering - b.ordering,
      );

      const createdChildren: Array<{ method: Method; ordering: number; label?: string }> =
        [];
      for (const component of ordered) {
        try {
          const childTemplate = await fetchChild(component.slug);
          // Recurse: each child runs its own per-type branch (and copies its own
          // bundled PDF). Children land in the same folder as the kit parent.
          const childMethod = await instantiateMethodFromTemplate(
            childTemplate,
            { folderPath },
            deps,
            customFetch,
          );
          createdChildren.push({
            method: childMethod,
            ordering: component.ordering,
            ...(component.label ? { label: component.label } : {}),
          });
        } catch (err) {
          // PARTIAL FAILURE (Grant-locked): do NOT roll back the children created
          // before this point. Instead mark each orphan with the `incomplete-kit`
          // tag so the half-built kit is DISCOVERABLE (the user / a future sweep
          // can find and clean it up), then re-throw a descriptive error so the
          // modal surfaces the failure. Tagging is best-effort: an update failure
          // must not mask the original error.
          for (const orphan of createdChildren) {
            try {
              const existingTags = orphan.method.tags ?? [];
              if (!existingTags.includes(INCOMPLETE_KIT_TAG)) {
                await deps.methodsApi.update(orphan.method.id, {
                  tags: [...existingTags, INCOMPLETE_KIT_TAG],
                });
              }
            } catch {
              // Swallow: marking is a discoverability aid, not a correctness gate.
            }
          }
          const reason = err instanceof Error ? err.message : String(err);
          throw new Error(
            `compound kit "${template.slug}" failed on component "${component.slug}": ${reason}. ` +
              `${createdChildren.length} child method(s) were left in place and tagged "${INCOMPLETE_KIT_TAG}" for follow-up.`,
          );
        }
      }

      // All children created: build the compound parent. It has no structured
      // sidecar and no PDF (source_path: null); its components reference the
      // created child method ids. `owner: null` on each component means "same
      // user as the compound" (the child was just created in the current user's
      // namespace).
      return deps.methodsApi.create({
        name,
        source_path: null,
        method_type: "compound",
        folder_path: folderPath,
        tags,
        shared_with: [],
        components: createdChildren.map((c) => ({
          method_id: c.method.id,
          owner: null,
          ordering: c.ordering,
          ...(c.label ? { label: c.label } : {}),
        })),
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
