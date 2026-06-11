/**
 * Static template catalog for the Custom Calculator Builder (Phase 1).
 *
 * A STATIC, data-only library of prebuilt calculators that ships in the app
 * build under `frontend/public/calculator-templates/`. A template is the same
 * `CustomCalculator` spec the builder authors, with a string `slug` instead of
 * a numeric record `id` (the static file has no per-user id namespace). The
 * user browses the gallery and, on "Use this", the template is loaded into the
 * builder; saving it through `calculatorsApi` mints a real owned record.
 *
 * Fetched client-side exactly like the method catalog
 * (`frontend/src/lib/methods/method-catalog.ts`): a plain `fetch` of static
 * JSON from the Vercel deploy, no server, no proxy. A manifest lists the
 * curated order; each template lives in its own file so the manifest stays
 * light. Templates are DATA, not code, so none of the runtime-code constraints
 * apply (the engine in `custom.ts` evaluates the same trusted expression DSL).
 */
import type {
  CustomCalculatorInput,
  CustomCalculatorStep,
  CustomCalculatorConditional,
  CustomCalculatorOutput,
  SharedUser,
} from "@/lib/types";

// ── Where the catalog lives ──────────────────────────────────────────────────

/** Public path the static catalog is served from (Vercel deploy + dev). */
export const CALC_TEMPLATE_BASE = "/calculator-templates";
export const CALC_TEMPLATE_MANIFEST = `${CALC_TEMPLATE_BASE}/manifest.json`;

// ── The template + manifest schema ───────────────────────────────────────────

/** A library template: the `CustomCalculator` spec keyed by a string `slug`
 *  (no numeric record id), with the grouping `field` always present so the
 *  gallery can group by it. */
export interface CalculatorTemplate {
  /** Stable, URL-safe identifier. The file is `templates/<slug>.json`. */
  slug: string;
  name: string;
  description: string;
  /** Grouping label for the gallery (e.g. "Microbiology"). */
  field: string;
  inputs: CustomCalculatorInput[];
  steps: CustomCalculatorStep[];
  conditionals: CustomCalculatorConditional[];
  outputs: CustomCalculatorOutput[];
}

/** Lightweight per-entry metadata in `manifest.json` (the browse list). */
export interface CalculatorTemplateManifestEntry {
  slug: string;
  name: string;
  description: string;
  field: string;
}

export interface CalculatorTemplateManifest {
  /** Catalog format version; bump on a breaking schema change. */
  version: number;
  /** ISO timestamp the catalog was authored. Informational. */
  generatedAt: string;
  /** Curated order. */
  templates: CalculatorTemplateManifestEntry[];
}

// ── Parsing / validation ─────────────────────────────────────────────────────
//
// The catalog ships in the build, so parsing is a light shape guard that
// catches an author typo (a missing field, a malformed input/output) before it
// reaches the gallery, not a hostile-input defense.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseInputs(raw: unknown, label: string): CustomCalculatorInput[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${label}: inputs must be an array`);
  }
  return raw.map((entry, i) => {
    if (!isRecord(entry)) throw new Error(`${label}: input #${i} is not an object`);
    const key = asString(entry.key, `${label}: input #${i} key`);
    const label2 = asString(entry.label, `${label}: input #${i} label`);
    const type = entry.type;
    if (type !== "number" && type !== "replicate" && type !== "dropdown") {
      throw new Error(`${label}: input "${key}" has an invalid type`);
    }
    const out: CustomCalculatorInput = { key, type, label: label2 };
    if (entry.unit !== undefined) {
      out.unit = asString(entry.unit, `${label}: input "${key}" unit`);
    }
    if (entry.default !== undefined) {
      out.default = entry.default as number | number[] | string;
    }
    if (type === "dropdown") {
      if (!Array.isArray(entry.options) || entry.options.length === 0) {
        throw new Error(`${label}: dropdown "${key}" needs a non-empty options array`);
      }
      out.options = entry.options.map((opt, j) => {
        if (!isRecord(opt)) {
          throw new Error(`${label}: dropdown "${key}" option #${j} is not an object`);
        }
        const optLabel = asString(opt.label, `${label}: "${key}" option #${j} label`);
        if (typeof opt.value !== "number" && typeof opt.value !== "string") {
          throw new Error(
            `${label}: dropdown "${key}" option #${j} value must be a number or string`,
          );
        }
        return { label: optLabel, value: opt.value };
      });
    }
    return out;
  });
}

function parseExprList(
  raw: unknown,
  label: string,
  withKey: boolean,
): Array<{ key?: string; expr: string }> {
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array`);
  return raw.map((entry, i) => {
    if (!isRecord(entry)) throw new Error(`${label} #${i} is not an object`);
    const expr = asString(entry.expr, `${label} #${i} expr`);
    if (withKey) {
      return { key: asString(entry.key, `${label} #${i} key`), expr };
    }
    return { expr };
  });
}

function parseOutputs(raw: unknown, label: string): CustomCalculatorOutput[] {
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array`);
  return raw.map((entry, i) => {
    if (!isRecord(entry)) throw new Error(`${label} #${i} is not an object`);
    const out: CustomCalculatorOutput = {
      label: asString(entry.label, `${label} #${i} label`),
      expr: asString(entry.expr, `${label} #${i} expr`),
    };
    if (entry.unit !== undefined) {
      out.unit = asString(entry.unit, `${label} #${i} unit`);
    }
    return out;
  });
}

/** Parse + validate one template payload file. Throws on a malformed file. */
export function parseCalculatorTemplate(raw: unknown): CalculatorTemplate {
  if (!isRecord(raw)) throw new Error("calculator template is not an object");
  const slug = asString(raw.slug, "template slug");
  const name = asString(raw.name, `template "${slug}" name`);
  const description =
    typeof raw.description === "string" ? raw.description : "";
  const field = asString(raw.field, `template "${slug}" field`);
  return {
    slug,
    name,
    description,
    field,
    inputs: parseInputs(raw.inputs, `template "${slug}"`),
    steps: parseExprList(raw.steps, `template "${slug}" steps`, true) as CustomCalculatorStep[],
    conditionals: parseExprList(
      raw.conditionals,
      `template "${slug}" conditionals`,
      false,
    ) as CustomCalculatorConditional[],
    outputs: parseOutputs(raw.outputs, `template "${slug}" outputs`),
  };
}

/** Parse + validate the manifest JSON. Throws on a malformed manifest. */
export function parseCalculatorTemplateManifest(
  raw: unknown,
): CalculatorTemplateManifest {
  if (!isRecord(raw)) throw new Error("calculator-template manifest is not an object");
  if (typeof raw.version !== "number") {
    throw new Error("calculator-template manifest is missing a numeric `version`");
  }
  if (!Array.isArray(raw.templates)) {
    throw new Error("calculator-template manifest is missing a `templates` array");
  }
  const templates: CalculatorTemplateManifestEntry[] = raw.templates.map(
    (entry, i) => {
      if (!isRecord(entry)) throw new Error(`manifest template #${i} is not an object`);
      const slug = asString(entry.slug, `manifest template #${i} slug`);
      return {
        slug,
        name: asString(entry.name, `manifest template "${slug}" name`),
        description:
          typeof entry.description === "string" ? entry.description : "",
        field: asString(entry.field, `manifest template "${slug}" field`),
      };
    },
  );
  return {
    version: raw.version,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    templates,
  };
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
  throw new Error("no fetch implementation available for the calculator catalog");
}

/** Fetch + parse the catalog manifest. Rejects on a network error or a
 *  malformed manifest; the gallery can show an offline state. */
export async function fetchCalculatorTemplateManifest(
  customFetch?: FetchLike,
): Promise<CalculatorTemplateManifest> {
  const doFetch = resolveFetch(customFetch);
  const res = await doFetch(CALC_TEMPLATE_MANIFEST);
  if (!res.ok) {
    throw new Error(
      `calculator-template manifest fetch failed (status ${res.status})`,
    );
  }
  return parseCalculatorTemplateManifest(await res.json());
}

/** Fetch + parse one template payload by slug. */
export async function fetchCalculatorTemplate(
  slug: string,
  customFetch?: FetchLike,
): Promise<CalculatorTemplate> {
  const doFetch = resolveFetch(customFetch);
  const res = await doFetch(`${CALC_TEMPLATE_BASE}/templates/${slug}.json`);
  if (!res.ok) {
    throw new Error(
      `calculator-template "${slug}" fetch failed (status ${res.status})`,
    );
  }
  return parseCalculatorTemplate(await res.json());
}

/** Convenience: fetch the manifest then every template payload, in manifest
 *  order. Used by the gallery to render all cards grouped by `field`. */
export async function fetchAllCalculatorTemplates(
  customFetch?: FetchLike,
): Promise<CalculatorTemplate[]> {
  const manifest = await fetchCalculatorTemplateManifest(customFetch);
  return Promise.all(
    manifest.templates.map((entry) =>
      fetchCalculatorTemplate(entry.slug, customFetch),
    ),
  );
}

/** Build a fresh `CustomCalculatorCreate`-shaped object from a template (drops
 *  the `slug`, keeps the spec). The builder loads this on "Use this"; saving it
 *  mints an owned record. `shared_with` defaults to [] (Just me). */
export function templateToDraft(template: CalculatorTemplate): {
  name: string;
  description: string;
  field: string;
  inputs: CustomCalculatorInput[];
  steps: CustomCalculatorStep[];
  conditionals: CustomCalculatorConditional[];
  outputs: CustomCalculatorOutput[];
  shared_with: SharedUser[];
} {
  return {
    name: template.name,
    description: template.description,
    field: template.field,
    inputs: template.inputs,
    steps: template.steps,
    conditionals: template.conditionals,
    outputs: template.outputs,
    shared_with: [],
  };
}
