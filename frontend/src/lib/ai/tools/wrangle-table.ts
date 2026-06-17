// BeakerBot wrangle-table tool (BeakerAI manager, 2026-06-12).
//
// The full-pipeline sibling of transform_table. Where transform_table is the
// single-column-transform shortcut, wrangle_table builds a RELATIONAL,
// multi-step Data Hub recipe (join, groupby, filter, pivot, unpivot, union,
// derive, sort, dedupe, select, drop, rename, plus the five column transforms)
// over one or more existing tables, previews it through the REAL engine, shows
// the user the existing multi-step approval card (one step block per op), and on
// Approve creates the derived table and navigates to it.
//
// Division of labor (identical to transform_table).
//   - The LLM orchestrates. It calls list_datahub_tables to learn the available
//     tables and their column names, then calls wrangle_table with a primary
//     tableId and a recipe (an ordered TransformOp array). Join / union ops carry
//     the OTHER tables' ids in rightRef / otherRef. The model NEVER fabricates a
//     cell or a computed value.
//   - The ENGINE computes. executePipeline (datahub/transform) is the single pure
//     entry point. This file imports it, builds the sources Map, and calls it. No
//     relational math lives here.
//   - The APPROVAL BLOCK renders the steps visually. The card mirrors the same
//     TransformStepBlock language transform_table uses, one block per op, so there
//     is one visual language across both front ends and the card needs no change
//     (TransformStepBlock.kind is a plain string, so it renders any op kind).
//
// The describeAction path is SYNCHRONOUS (the agent loop calls it sync). It reads
// the primary and any referenced sources from the content cache (populated by
// list_datahub_tables, same pattern as datahub-analysis.ts). execute always
// re-reads the LIVE content via the deps, so a stale cache never corrupts the
// persisted result.
//
// After create, the user is navigated to /datahub?doc=<newId> and the model
// embeds the new table as a datahub table embed.
//
// Injectable deps seam mirrors transformTableDeps so unit tests run with no folder.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { dataHubApi } from "@/lib/datahub/api";
import { executePipeline } from "@/lib/datahub/transform";
import type { TransformOp } from "@/lib/datahub/transform";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { openDataHubDoc } from "@/lib/loro/datahub-store";
import { getDataHubContent } from "@/lib/loro/datahub-doc";
import type {
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import {
  cacheTableContent,
  getCachedTableContent,
} from "./datahub-analysis";
import type { AiTool } from "./types";
import type { TransformApprovalRequest, TransformStepBlock } from "./types";

// ---------------------------------------------------------------------------
// OP_META: the human label and one-line blurb for every op kind the recipe can
// hold. Keyed by the TransformOp discriminant. The five column transforms reuse
// the same wording transform_table's KIND_META uses, so the two front ends share
// one visual language.
// ---------------------------------------------------------------------------

const OP_META: Record<TransformOp["kind"], { label: string; blurb: string }> = {
  join: {
    label: "Join",
    blurb:
      "Match rows from a second table on shared key columns, like a database join.",
  },
  filter: {
    label: "Filter",
    blurb: "Keep only the rows that satisfy a condition.",
  },
  groupby: {
    label: "Group by",
    blurb:
      "Group rows by one or more columns and aggregate the rest (mean, sum, count, and more).",
  },
  select: {
    label: "Select columns",
    blurb: "Keep only the named columns, in the given order.",
  },
  drop: {
    label: "Drop columns",
    blurb: "Remove the named columns, keeping all the others.",
  },
  rename: {
    label: "Rename columns",
    blurb: "Rename the listed columns; the rest stay as they are.",
  },
  sort: {
    label: "Sort",
    blurb: "Order the rows by one or more columns, ascending or descending.",
  },
  dedupe: {
    label: "Remove duplicates",
    blurb: "Drop duplicate rows, keeping the first or last of each.",
  },
  union: {
    label: "Union",
    blurb: "Stack a second table underneath this one, aligning columns by name.",
  },
  derive: {
    label: "New column",
    blurb: "Compute a new column from a formula over the existing columns.",
  },
  pivot: {
    label: "Pivot (long to wide)",
    blurb: "Spread a key column's values into new columns.",
  },
  unpivot: {
    label: "Unpivot (wide to long)",
    blurb: "Gather columns into a single key column and a value column.",
  },
  "column-transform": {
    label: "Transform",
    blurb:
      "Apply a function to every Y value, like log, square root, or a linear Y times k plus b.",
  },
  normalize: {
    label: "Normalize",
    blurb:
      "Rescale each column to a percent of its max, sum, first value, or its min-to-max range.",
  },
  transpose: {
    label: "Transpose",
    blurb:
      "Swap rows and columns, so each row becomes a column. Pick a column to title the new columns.",
  },
  "remove-baseline": {
    label: "Remove baseline",
    blurb:
      "Subtract a baseline from every value, taken from a column, each column's first row, or a constant.",
  },
  "fraction-of-total": {
    label: "Fraction of total",
    blurb:
      "Express each value as a fraction or percent of its column, row, or the grand total.",
  },
  fillna: {
    label: "Fill empty cells",
    blurb:
      "Fill empty cells in a column with a value, the previous or next value, or the column mean or median.",
  },
  interpolate: {
    label: "Interpolate empty cells",
    blurb:
      "Linearly fill empty numeric cells from the nearest filled neighbours, equally spaced by row position.",
  },
  dropna: {
    label: "Drop empty rows",
    blurb: "Drop rows that are empty in any or all of the selected columns.",
  },
  "set-where": {
    label: "Set value where",
    blurb:
      "Set a column to a value or a formula on the rows that match a condition, leaving the rest unchanged.",
  },
  "str-op": {
    label: "Text operation",
    blurb:
      "Edit text in a column (slice, replace, extract, split, change case, trim, or concatenate columns).",
  },
  astype: {
    label: "Cast type",
    blurb: "Convert a column to a number, text, boolean, or date.",
  },
  "to-date": {
    label: "Parse date",
    blurb: "Parse a text column to a date using a format you give.",
  },
  "date-parts": {
    label: "Extract date parts",
    blurb: "Pull the year, month, day, weekday, or hour out of a date column into new columns.",
  },
  clip: {
    label: "Clip to range",
    blurb: "Clamp a numeric column so values stay within a low and high bound.",
  },
  round: {
    label: "Round",
    blurb: "Round a numeric column to a number of decimal places.",
  },
  bin: {
    label: "Bin into categories",
    blurb:
      "Cut a numeric column into labeled bins, by explicit ranges or by equal-frequency quantiles.",
  },
  map: {
    label: "Map via lookup",
    blurb: "Replace values in a column using a key to value lookup, with an optional fallback.",
  },
  rank: {
    label: "Rank",
    blurb: "Rank a numeric column ascending or descending into a new column.",
  },
  cumulative: {
    label: "Running total",
    blurb: "Running sum, product, max, or min of a numeric column into a new column.",
  },
  lag: {
    label: "Shift / diff / pct change",
    blurb: "Shift a column by rows, or take the row-to-row difference or percent change.",
  },
  rolling: {
    label: "Rolling window",
    blurb: "Rolling mean, sum, min, or max of a numeric column over a fixed window.",
  },
  isin: {
    label: "Keep rows in set",
    blurb: "Keep (or drop) rows whose column value is in a set of values.",
  },
  between: {
    label: "Keep rows between",
    blurb: "Keep rows whose numeric column value falls between a low and high bound.",
  },
  topn: {
    label: "Top N by column",
    blurb: "Keep the N rows with the largest or smallest value in a column.",
  },
  sample: {
    label: "Random sample",
    blurb: "Take a random sample of rows, by exact count or by fraction.",
  },
  value_counts: {
    label: "Value counts",
    blurb: "Count how many times each distinct value appears in a column.",
  },
  describe: {
    label: "Describe",
    blurb: "Summary statistics (count, mean, std, min, quartiles, max) for the numeric columns.",
  },
  crosstab: {
    label: "Cross-tabulate",
    blurb: "Count co-occurrences of two columns into a row-by-column table.",
  },
  pivot_table: {
    label: "Pivot table",
    blurb: "Group by an index, spread one column across new columns, and aggregate a value.",
  },
};

// The set of valid op kinds, derived from OP_META so the two never drift.
const VALID_KINDS = new Set<string>(Object.keys(OP_META));

// ---------------------------------------------------------------------------
// Source-id scan: collect every OTHER table id a recipe references. Only join
// (rightRef) and union (otherRef) reference a second table in pipeline.ts; every
// other op operates on the table threaded through the pipeline. We scan both
// field names so a future source-referencing op is picked up if it reuses them.
// ---------------------------------------------------------------------------

function referencedSourceIds(recipe: TransformOp[]): string[] {
  const ids: string[] = [];
  for (const op of recipe) {
    if (op.kind === "join" && typeof op.rightRef === "string") {
      ids.push(op.rightRef);
    } else if (op.kind === "union" && typeof op.otherRef === "string") {
      ids.push(op.otherRef);
    }
  }
  // De-duplicate while preserving first-seen order.
  return Array.from(new Set(ids));
}

// ---------------------------------------------------------------------------
// Param formatter: turn one op into human label/value pairs for the card's pill
// row. Pure, called only from the describe path. Unknown shapes fall back to a
// compact key list so the card is never empty for a recognised kind.
// ---------------------------------------------------------------------------

function num(v: unknown): string {
  return typeof v === "number"
    ? Number.isInteger(v)
      ? String(v)
      : v.toFixed(3).replace(/\.?0+$/, "")
    : String(v);
}

function formatOpParams(op: TransformOp): { label: string; value: string }[] {
  switch (op.kind) {
    case "join":
      return [
        { label: "right table id", value: op.rightRef },
        { label: "on", value: (op.on ?? []).join(", ") || "(none)" },
        { label: "how", value: op.how ?? "inner" },
      ];
    case "filter":
      return [{ label: "where", value: describeFilter(op.node) }];
    case "groupby":
      return [
        { label: "by", value: (op.by ?? []).join(", ") || "(none)" },
        {
          label: "aggregate",
          value:
            (op.aggregations ?? [])
              .map((a) => `${a.func}(${a.column})`)
              .join(", ") || "(none)",
        },
      ];
    case "select":
      return [{ label: "keep", value: (op.columns ?? []).join(", ") }];
    case "drop":
      return [{ label: "remove", value: (op.columns ?? []).join(", ") }];
    case "rename":
      return Object.entries(op.mapping ?? {}).map(([from, to]) => ({
        label: from,
        value: String(to),
      }));
    case "sort":
      return (op.by ?? []).map((k) => ({
        label: k.column,
        value: k.direction,
      }));
    case "dedupe":
      return [
        {
          label: "on",
          value: op.subset && op.subset.length ? op.subset.join(", ") : "all columns",
        },
        { label: "keep", value: op.keep ?? "first" },
      ];
    case "union":
      return [{ label: "other table id", value: op.otherRef }];
    case "derive":
      return [
        { label: "new column", value: op.outputName },
        { label: "formula", value: op.formula },
      ];
    case "pivot":
      return [
        { label: "index", value: (op.index ?? []).join(", ") },
        { label: "spread", value: op.columns },
        { label: "values", value: op.values },
      ];
    case "unpivot":
      return [
        { label: "keep", value: (op.idVars ?? []).join(", ") },
        {
          label: "gather",
          value: op.valueVars && op.valueVars.length ? op.valueVars.join(", ") : "all other columns",
        },
      ];
    case "column-transform": {
      const p = (op.params ?? {}) as unknown as Record<string, unknown>;
      const fn = typeof p.func === "string" ? p.func : "log10";
      const pills = [{ label: "function", value: fn }];
      if (fn === "linear") {
        pills.push({ label: "k", value: num(p.k ?? 1) });
        pills.push({ label: "b", value: num(p.b ?? 0) });
      }
      return pills;
    }
    case "normalize": {
      const p = (op.params ?? {}) as unknown as Record<string, unknown>;
      return [{ label: "baseline", value: typeof p.mode === "string" ? p.mode : "max" }];
    }
    case "transpose": {
      const p = (op.params ?? {}) as unknown as Record<string, unknown>;
      return typeof p.headerColumnId === "string" && p.headerColumnId
        ? [{ label: "title column id", value: p.headerColumnId }]
        : [{ label: "title", value: "numbered columns" }];
    }
    case "remove-baseline": {
      const p = (op.params ?? {}) as unknown as Record<string, unknown>;
      const mode = typeof p.mode === "string" ? p.mode : "firstRow";
      const pills = [{ label: "baseline", value: mode }];
      if (mode === "column" && typeof p.baselineColumnId === "string") {
        pills.push({ label: "column id", value: p.baselineColumnId });
      }
      if (mode === "value" && typeof p.value === "number") {
        pills.push({ label: "constant", value: num(p.value) });
      }
      return pills;
    }
    case "fraction-of-total": {
      const p = (op.params ?? {}) as unknown as Record<string, unknown>;
      return [
        { label: "total", value: typeof p.scope === "string" ? p.scope : "column" },
        { label: "output", value: p.asPercent === true ? "percent" : "fraction" },
      ];
    }
    default:
      return [];
  }
}

// A compact one-line rendering of a filter node tree for the pill row.
function describeFilter(node: unknown): string {
  if (!node || typeof node !== "object") return "(condition)";
  const n = node as Record<string, unknown>;
  if (n.type === "condition" && n.condition && typeof n.condition === "object") {
    const c = n.condition as Record<string, unknown>;
    const v =
      Array.isArray(c.value)
        ? `[${(c.value as unknown[]).join(", ")}]`
        : c.value === undefined
          ? ""
          : String(c.value);
    return `${String(c.column)} ${String(c.op)}${v ? " " + v : ""}`.trim();
  }
  if (n.type === "not") return `not (${describeFilter(n.child)})`;
  if (n.type === "and" && Array.isArray(n.children)) {
    return n.children.map(describeFilter).join(" and ");
  }
  if (n.type === "or" && Array.isArray(n.children)) {
    return n.children.map(describeFilter).join(" or ");
  }
  return "(condition)";
}

// ---------------------------------------------------------------------------
// Preview helper: first few cols x rows from a computed result.
// ---------------------------------------------------------------------------

function buildPreview(result: DataHubDocContent): TransformStepBlock["preview"] {
  const cols = result.columns.slice(0, 6).map((c) => c.name || "(unnamed)");
  const colIds = result.columns.slice(0, 6).map((c) => c.id);
  const rows = result.rows.slice(0, 4).map((row) =>
    colIds.map((id) => {
      const v = row.cells[id] ?? null;
      if (v === null) return "";
      if (typeof v === "number") {
        return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
      }
      return String(v);
    }),
  );
  return { columns: cols, rows };
}

// ---------------------------------------------------------------------------
// Recipe parsing + validation. Each op object the model produced is checked for
// a recognised kind and its required fields. A bad op returns an error STRING
// (never throws) so the tool can relay a helpful message instead of crashing.
// ---------------------------------------------------------------------------

type RecipeParse =
  | { ok: true; recipe: TransformOp[] }
  | { ok: false; error: string };

function validateOp(op: Record<string, unknown>, idx: number): string | null {
  const kind = typeof op.kind === "string" ? op.kind : "";
  if (!kind) return `op[${idx}] is missing a "kind" field.`;
  if (!VALID_KINDS.has(kind)) {
    return `op[${idx}] has an unknown kind "${kind}". Valid kinds are ${Array.from(
      VALID_KINDS,
    ).join(", ")}.`;
  }
  // Required-field checks for the ops whose shape the engine relies on. These
  // catch the common model mistakes early with a readable message; the engine
  // itself still re-validates everything.
  switch (kind) {
    case "join":
      if (typeof op.rightRef !== "string" || !op.rightRef) {
        return `op[${idx}] (join) needs a "rightRef" table id.`;
      }
      if (!Array.isArray(op.on) || op.on.length === 0) {
        return `op[${idx}] (join) needs an "on" array of key column names.`;
      }
      break;
    case "union":
      if (typeof op.otherRef !== "string" || !op.otherRef) {
        return `op[${idx}] (union) needs an "otherRef" table id.`;
      }
      break;
    case "groupby":
      if (!Array.isArray(op.by) || op.by.length === 0) {
        return `op[${idx}] (groupby) needs a "by" array of column names.`;
      }
      if (!Array.isArray(op.aggregations) || op.aggregations.length === 0) {
        return `op[${idx}] (groupby) needs an "aggregations" array.`;
      }
      break;
    case "filter":
      if (!op.node || typeof op.node !== "object") {
        return `op[${idx}] (filter) needs a "node" filter tree.`;
      }
      break;
    case "select":
    case "drop":
      if (!Array.isArray(op.columns) || op.columns.length === 0) {
        return `op[${idx}] (${kind}) needs a "columns" array.`;
      }
      break;
    case "rename":
      if (!op.mapping || typeof op.mapping !== "object") {
        return `op[${idx}] (rename) needs a "mapping" object of old to new names.`;
      }
      break;
    case "sort":
      if (!Array.isArray(op.by) || op.by.length === 0) {
        return `op[${idx}] (sort) needs a "by" array of sort keys.`;
      }
      break;
    case "derive":
      if (typeof op.outputName !== "string" || !op.outputName) {
        return `op[${idx}] (derive) needs an "outputName".`;
      }
      if (typeof op.formula !== "string" || !op.formula) {
        return `op[${idx}] (derive) needs a "formula".`;
      }
      break;
    case "pivot":
      if (!Array.isArray(op.index)) return `op[${idx}] (pivot) needs an "index" array.`;
      if (typeof op.columns !== "string") return `op[${idx}] (pivot) needs a "columns" key.`;
      if (typeof op.values !== "string") return `op[${idx}] (pivot) needs a "values" column.`;
      break;
    case "unpivot":
      if (!Array.isArray(op.idVars)) return `op[${idx}] (unpivot) needs an "idVars" array.`;
      break;
    case "column-transform":
    case "normalize":
    case "transpose":
    case "remove-baseline":
    case "fraction-of-total":
      if (op.params !== undefined && (typeof op.params !== "object" || op.params === null)) {
        return `op[${idx}] (${kind}) "params" must be an object.`;
      }
      break;
  }
  return null;
}

export function parseRecipe(raw: unknown): RecipeParse {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'The "recipe" must be an array of op objects.' };
  }
  if (raw.length === 0) {
    return { ok: false, error: "The recipe is empty. Add at least one op." };
  }
  const recipe: TransformOp[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `op[${i}] must be an object.` };
    }
    const op = entry as Record<string, unknown>;
    const err = validateOp(op, i);
    if (err) return { ok: false, error: err };
    // The folded column ops want a params object; default an absent one to {}
    // so the engine's delegated transforms.ts call sees a record, not undefined.
    if (
      (op.kind === "column-transform" ||
        op.kind === "normalize" ||
        op.kind === "transpose" ||
        op.kind === "remove-baseline" ||
        op.kind === "fraction-of-total") &&
      op.params === undefined
    ) {
      recipe.push({ ...op, params: {} } as unknown as TransformOp);
    } else {
      recipe.push(op as unknown as TransformOp);
    }
  }
  return { ok: true, recipe };
}

// ---------------------------------------------------------------------------
// Injectable deps seam (mirrors transformTableDeps for testability).
// ---------------------------------------------------------------------------

export type WrangleTableDeps = {
  /** Get a table's content by id. execute uses this; describe uses the cache. */
  getContent: (id: string) => Promise<DataHubDocContent | null>;
  /** Create a new derived table, returning the new document. */
  createTable: (data: Parameters<typeof dataHubApi.create>[0]) => Promise<DataHubDocument>;
  /** Navigate the user to a path after a successful create. */
  navigate: (path: string) => void;
};

async function defaultGetContent(id: string): Promise<DataHubDocContent | null> {
  try {
    const owner = await getCurrentUserCached();
    const handle = await openDataHubDoc(owner, id);
    return getDataHubContent(handle.doc, id);
  } catch {
    return null;
  }
}

export const wrangleTableDeps: WrangleTableDeps = {
  getContent: defaultGetContent,
  createTable: (data) => dataHubApi.create(data),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export type WrangleTableArgs = {
  tableId: string;
  recipe: unknown;
  resultName?: string;
};

export function parseWrangleTableArgs(
  args: Record<string, unknown>,
): WrangleTableArgs {
  const tableId = typeof args.tableId === "string" ? args.tableId : "";
  const resultName = typeof args.resultName === "string" ? args.resultName : undefined;
  return { tableId, recipe: args.recipe, resultName };
}

// ---------------------------------------------------------------------------
// Engine runner shared by describe (cache content) and execute (live content).
// Builds the sources Map (primary under its own id plus every referenced source)
// and calls executePipeline. Returns the computed content or an error string.
// ---------------------------------------------------------------------------

type SourceGetter = (id: string) => DataHubDocContent | null;

function runPipeline(
  primaryId: string,
  primary: DataHubDocContent,
  recipe: TransformOp[],
  getSource: SourceGetter,
): { content: DataHubDocContent } | { error: string } {
  const sources = new Map<string, DataHubDocContent>();
  sources.set(primaryId, primary);
  for (const id of referencedSourceIds(recipe)) {
    if (sources.has(id)) continue;
    const src = getSource(id);
    if (!src) {
      return {
        error: `The recipe references table "${id}", which I could not read. List the tables again and use a real id for the join or union.`,
      };
    }
    sources.set(id, src);
  }
  return executePipeline(primary, { ops: recipe }, sources);
}

// ---------------------------------------------------------------------------
// describeAction (synchronous): reads from the content cache, runs a real engine
// preview, returns the transform ApprovalRequest payload with one step per op.
// ---------------------------------------------------------------------------

export function describeWrangleTable(
  args: Record<string, unknown>,
): {
  summary: string;
  transformPayload?: TransformApprovalRequest;
} {
  const parsed = parseWrangleTableArgs(args);

  const parse = parseRecipe(parsed.recipe);
  if (!parse.ok) {
    // A bad recipe still surfaces a plain summary so the gate can show the user
    // something; the model gets the real error back from execute.
    return { summary: "build a wrangled derived table" };
  }
  const recipe = parse.recipe;

  // Fall back to a plain summary when the primary is not cached yet.
  const primary = getCachedTableContent(parsed.tableId);
  if (!primary) {
    return { summary: "build a wrangled derived table" };
  }

  const sourceName = primary.meta.name;
  const resultName = parsed.resultName ?? `${sourceName} (wrangled)`;

  // Run the real engine preview from the cached sources (pure, deterministic).
  const result = runPipeline(parsed.tableId, primary, recipe, getCachedTableContent);
  const finalPreview =
    "content" in result ? buildPreview(result.content) : undefined;

  // One step block per op. The final op carries the engine's real output preview;
  // intermediate ops show the op and its params (a true per-op preview would need
  // a partial-pipeline run per step, which the engine does not expose).
  const steps: TransformStepBlock[] = recipe.map((op, i) => {
    const meta = OP_META[op.kind];
    return {
      kind: op.kind,
      name: meta?.label ?? op.kind,
      blurb: meta?.blurb ?? "",
      params: formatOpParams(op),
      preview: i === recipe.length - 1 ? finalPreview : undefined,
    };
  });

  const payload: TransformApprovalRequest = {
    kind: "transform",
    toolName: "wrangle_table",
    sourceName,
    resultName,
    steps,
  };

  return {
    summary: `build a ${recipe.length}-step wrangled table from "${sourceName}" named "${resultName}"`,
    transformPayload: payload,
  };
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

export type WrangleTableResult =
  | { ok: true; tableId: string; name: string }
  | { ok: false; error: string };

export const wrangleTableTool: AiTool = {
  name: "wrangle_table",
  description:
    "Build a new derived Data Hub table by running a multi-step RELATIONAL recipe over one or more existing tables. Use this for joins, group-by aggregation, filters, pivot / unpivot, union, derived columns, sort, dedupe, select / drop / rename, and the five column transforms, alone or chained. transform_table stays the single-column-transform shortcut; reach for wrangle_table whenever the user wants a join, a group-by, a pivot, or any chain of steps. The engine computes every value, the model only maps the request to ops and real table ids. Call list_datahub_tables FIRST to get the real table ids and column names, then pass the primary tableId and a recipe (an ordered array of op objects). Join / union ops reference the OTHER tables by their id in rightRef / otherRef. The user sees a block card with one step per op (its name, description, param pills, and a live preview of the result) and approves or rejects before anything is created. On Approve the new table is created and the user is taken to it. Do NOT also call propose_plan for this, the block card IS the consent.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description:
          "The id of the PRIMARY source table (the recipe runs over this one), from list_datahub_tables.",
      },
      recipe: {
        type: "array",
        description:
          'An ordered array of op objects, applied top to bottom. Each op is { "kind": <op kind>, ...fields }. Op kinds and their fields: ' +
          'join { kind:"join", rightRef:<other table id>, on:[col,...], how:"inner"|"left"|"right"|"outer", suffixLeft?, suffixRight? }; ' +
          'filter { kind:"filter", node:<filter tree> } where a leaf node is { type:"condition", condition:{ column, op:"eq"|"ne"|"lt"|"le"|"gt"|"ge"|"contains"|"regex"|"in"|"is_empty", value? } } and you can combine with { type:"and"|"or", children:[...] } or { type:"not", child:{...} }; ' +
          'groupby { kind:"groupby", by:[col,...], aggregations:[{ column, func:"mean"|"sum"|"count"|"min"|"max"|"median"|"sd"|"first"|"nunique"|"concat", separator?, outputName? }] }; ' +
          'select { kind:"select", columns:[col,...] }; drop { kind:"drop", columns:[col,...] }; rename { kind:"rename", mapping:{ oldName:newName } }; ' +
          'sort { kind:"sort", by:[{ column, direction:"asc"|"desc", nulls? }], resetIndex? }; dedupe { kind:"dedupe", subset?:[col,...], keep?:"first"|"last" }; ' +
          'union { kind:"union", otherRef:<other table id>, resetIndex? }; derive { kind:"derive", outputName, formula } (formula is an expression over column names, like "a + b" or "mass / volume"); ' +
          'pivot { kind:"pivot", index:[col,...], columns:<key col>, values:<value col> }; unpivot { kind:"unpivot", idVars:[col,...], valueVars?:[col,...], varName?, valueName? }; ' +
          'and the five column transforms, each as { kind:"column-transform"|"normalize"|"transpose"|"remove-baseline"|"fraction-of-total", params:{...} } with the same params transform_table uses. Use the real column names and table ids from list_datahub_tables.',
        items: { type: "object", additionalProperties: true },
      },
      resultName: {
        type: "string",
        description:
          'Optional name for the new derived table. Defaults to "<primary source> (wrangled)".',
      },
    },
    required: ["tableId", "recipe"],
    additionalProperties: false,
  },
  action: true,
  describeAction(args) {
    const { summary, transformPayload } = describeWrangleTable(args);
    if (transformPayload) {
      return { summary, transformPayload };
    }
    return { summary };
  },
  isDestructive: () => false,
  execute: async (args) => {
    const parsed = parseWrangleTableArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error:
          "No tableId given. Call list_datahub_tables first and pass the id of the primary source table.",
      } satisfies WrangleTableResult;
    }

    const parse = parseRecipe(parsed.recipe);
    if (!parse.ok) {
      return { ok: false, error: parse.error } satisfies WrangleTableResult;
    }
    const recipe = parse.recipe;

    // Always read the LIVE primary so the derived snapshot is current.
    const primary = await wrangleTableDeps.getContent(parsed.tableId);
    if (!primary) {
      return {
        ok: false,
        error:
          "I could not open the primary table. It may have been deleted, or the id is wrong. List the tables again and try one of those.",
      } satisfies WrangleTableResult;
    }
    cacheTableContent(parsed.tableId, primary);

    // Read every referenced source (join / union targets) live too, building the
    // sources map. The ORDERED sources list stored on the derived link is the
    // primary first, then the referenced ids in first-seen order.
    const sources = new Map<string, DataHubDocContent>();
    sources.set(parsed.tableId, primary);
    const refIds = referencedSourceIds(recipe);
    for (const id of refIds) {
      if (sources.has(id)) continue;
      const src = await wrangleTableDeps.getContent(id);
      if (!src) {
        return {
          ok: false,
          error: `The recipe references table "${id}" for a join or union, which I could not read. List the tables again and use a real id.`,
        } satisfies WrangleTableResult;
      }
      cacheTableContent(id, src);
      sources.set(id, src);
    }

    // The engine does all the work. executePipeline is pure and deterministic.
    const result = executePipeline(primary, { ops: recipe }, sources);
    if ("error" in result) {
      return {
        ok: false,
        error: `The recipe could not run: ${result.error}`,
      } satisfies WrangleTableResult;
    }
    const derived = result.content;

    const name = parsed.resultName ?? `${primary.meta.name} (wrangled)`;
    // Ordered sources: primary first, then the referenced ids (de-duplicated).
    const orderedSources = [parsed.tableId, ...refIds.filter((id) => id !== parsed.tableId)];

    const newDoc = await wrangleTableDeps.createTable({
      name,
      table_type: derived.meta.table_type,
      project_ids: primary.meta.project_ids,
      folder_path: null,
      derivedFrom: {
        // The phase-2 recipe shape. sources[0] is the primary; join / union ops
        // reference the rest by id. No legacy single-op fields are written.
        sources: orderedSources,
        recipe,
      },
      columns: derived.columns,
      rows: derived.rows,
    });

    wrangleTableDeps.navigate(`/datahub?doc=${newDoc.id}`);

    return { ok: true, tableId: newDoc.id, name: newDoc.name } satisfies WrangleTableResult;
  },
};
