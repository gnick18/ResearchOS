// BeakerBot transform-table tool (ai transform-tool bot, 2026-06-11).
//
// A gated coworker ACTION tool: `transform_table` maps the user's natural-language
// request onto one of the five existing Data Hub deterministic transforms, runs a
// REAL preview through the engine, shows the user an approval block card, and on
// Approve creates the new derived table and navigates to it.
//
// Division of labor.
//   - The LLM orchestrates. It calls list_datahub_tables to know the available
//     tables, then calls transform_table with a tableId, a TransformKind, and the
//     matching params. The model NEVER fabricates a cell or a computed value.
//   - The ENGINE computes. runTransform (transforms.ts) is the single pure entry
//     point. This file imports it and calls it. No cell arithmetic lives here.
//   - The APPROVAL BLOCK renders the step visually. The card mirrors the language
//     from TransformDialog (KIND_META labels + blurbs), so there is one visual
//     language across both front ends.
//
// The describeAction path is SYNCHRONOUS (the agent loop calls it sync). It reads
// from the content cache (populated by list_datahub_tables, same pattern as
// datahub-analysis.ts). execute always re-reads the LIVE source, so a stale cache
// never corrupts the persisted result.
//
// After create, the user is navigated to /datahub?doc=<newId> and the model embeds
// the new table as a datahub table embed.
//
// Injectable deps seam mirrors datahubAnalysisDeps so unit tests run with no folder.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { dataHubApi } from "@/lib/datahub/api";
import { runTransform } from "@/lib/datahub/transforms";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { openDataHubDoc } from "@/lib/loro/datahub-store";
import { getDataHubContent } from "@/lib/loro/datahub-doc";
import type {
  DataHubDocContent,
  DataHubDocument,
  TransformKind,
} from "@/lib/datahub/model/types";
import {
  cacheTableContent,
  getCachedTableContent,
} from "./datahub-analysis";
import type { AiTool } from "./types";
import type { TransformApprovalRequest, TransformStepBlock } from "./types";

// ---------------------------------------------------------------------------
// KIND_META: the same labels + blurbs the TransformDialog uses, so the two
// front ends share one visual language. Keep in sync with TransformDialog.tsx.
// ---------------------------------------------------------------------------

const KIND_META: Record<TransformKind, { label: string; blurb: string; suffix: string }> = {
  transform: {
    label: "Transform",
    blurb:
      "Apply a function to every Y value, like log, square root, or a linear Y times k plus b.",
    suffix: "transformed",
  },
  normalize: {
    label: "Normalize",
    blurb:
      "Rescale each column to a percent of its max, sum, first value, or its min-to-max range.",
    suffix: "normalized",
  },
  transpose: {
    label: "Transpose",
    blurb:
      "Swap rows and columns, so each row becomes a column. Pick a column to title the new columns.",
    suffix: "transposed",
  },
  removeBaseline: {
    label: "Remove baseline",
    blurb:
      "Subtract a baseline from every value, taken from a column, each column's first row, or a constant.",
    suffix: "baseline removed",
  },
  fractionOfTotal: {
    label: "Fraction of total",
    blurb:
      "Express each value as a fraction or percent of its column, row, or the grand total.",
    suffix: "fraction of total",
  },
};

// ---------------------------------------------------------------------------
// Param formatter: turn the raw params record into human label/value pairs for
// the approval card's pill row. Called purely from the describe path.
// ---------------------------------------------------------------------------

function formatParams(
  kind: TransformKind,
  params: Record<string, unknown>,
): { label: string; value: string }[] {
  switch (kind) {
    case "transform": {
      const fn = typeof params.func === "string" ? params.func : "log10";
      const fnLabel: Record<string, string> = {
        log10: "Log base 10",
        ln: "Natural log (ln)",
        log2: "Log base 2",
        sqrt: "Square root",
        square: "Square",
        reciprocal: "Reciprocal (1 / Y)",
        linear: "Linear",
      };
      const pills: { label: string; value: string }[] = [
        { label: "function", value: fnLabel[fn] ?? fn },
      ];
      if (fn === "linear") {
        const k = typeof params.k === "number" ? params.k : 1;
        const b = typeof params.b === "number" ? params.b : 0;
        pills.push({ label: "k", value: String(k) });
        pills.push({ label: "b", value: String(b) });
      }
      return pills;
    }
    case "normalize": {
      const modeLabel: Record<string, string> = {
        max: "Percent of max",
        sum: "Percent of sum",
        first: "Percent of first value",
        minMax: "Min 0% to max 100%",
      };
      const mode = typeof params.mode === "string" ? params.mode : "max";
      return [{ label: "baseline", value: modeLabel[mode] ?? mode }];
    }
    case "transpose": {
      const hcol = typeof params.headerColumnId === "string" ? params.headerColumnId : "";
      return hcol
        ? [{ label: "title column id", value: hcol }]
        : [{ label: "title", value: "numbered columns" }];
    }
    case "removeBaseline": {
      const mode = typeof params.mode === "string" ? params.mode : "firstRow";
      const modeLabel: Record<string, string> = {
        column: "Subtract a column",
        firstRow: "Subtract first row",
        value: "Subtract a constant",
      };
      const pills: { label: string; value: string }[] = [
        { label: "baseline", value: modeLabel[mode] ?? mode },
      ];
      if (mode === "column" && typeof params.baselineColumnId === "string") {
        pills.push({ label: "column id", value: params.baselineColumnId });
      }
      if (mode === "value" && typeof params.value === "number") {
        pills.push({ label: "constant", value: String(params.value) });
      }
      return pills;
    }
    case "fractionOfTotal": {
      const scope = typeof params.scope === "string" ? params.scope : "column";
      const scopeLabel: Record<string, string> = {
        column: "Column total",
        row: "Row total",
        grand: "Grand total",
      };
      const pills: { label: string; value: string }[] = [
        { label: "total", value: scopeLabel[scope] ?? scope },
      ];
      if (params.asPercent === true) {
        pills.push({ label: "output", value: "percent" });
      } else {
        pills.push({ label: "output", value: "fraction" });
      }
      return pills;
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Preview helper: first few cols x rows from a computed result.
// ---------------------------------------------------------------------------

function buildPreview(
  result: DataHubDocContent,
): TransformStepBlock["preview"] {
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
// Injectable deps seam (mirrors DataHubAnalysisDeps for testability).
// ---------------------------------------------------------------------------

export type TransformTableDeps = {
  /** Get a table's content by id. The describe path uses the cache; execute uses this. */
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

export const transformTableDeps: TransformTableDeps = {
  getContent: defaultGetContent,
  createTable: (data) => dataHubApi.create(data),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export type TransformTableArgs = {
  tableId: string;
  transform: TransformKind;
  params: Record<string, unknown>;
  resultName?: string;
};

export function parseTransformTableArgs(
  args: Record<string, unknown>,
): TransformTableArgs {
  const tableId = typeof args.tableId === "string" ? args.tableId : "";
  const transform = (typeof args.transform === "string"
    ? args.transform
    : "transform") as TransformKind;
  const params =
    args.params && typeof args.params === "object" && !Array.isArray(args.params)
      ? (args.params as Record<string, unknown>)
      : {};
  const resultName = typeof args.resultName === "string" ? args.resultName : undefined;
  return { tableId, transform, params, resultName };
}

// ---------------------------------------------------------------------------
// describeAction (synchronous): reads from the content cache, calls runTransform
// to compute a real preview, returns the transform ApprovalRequest payload.
// ---------------------------------------------------------------------------

export function describeTransformTable(
  args: Record<string, unknown>,
): {
  summary: string;
  transformPayload?: TransformApprovalRequest;
} {
  const parsed = parseTransformTableArgs(args);
  const meta = KIND_META[parsed.transform];

  // Fall back to a plain summary when the table is not cached yet.
  const content = getCachedTableContent(parsed.tableId);
  if (!content) {
    return {
      summary: `create a ${meta?.label ?? parsed.transform} derived table`,
    };
  }

  const sourceName = content.meta.name;
  const suffix = meta?.suffix ?? parsed.transform;
  const resultName = parsed.resultName ?? `${sourceName} (${suffix})`;

  // Run the real engine preview (pure, cheap, deterministic).
  let preview: TransformStepBlock["preview"] | undefined;
  try {
    const previewResult = runTransform(parsed.transform, content, parsed.params);
    preview = buildPreview(previewResult);
  } catch {
    // A bad-params preview is non-fatal, the user still sees the step block.
    preview = undefined;
  }

  const step: TransformStepBlock = {
    kind: parsed.transform,
    name: meta?.label ?? parsed.transform,
    blurb: meta?.blurb ?? "",
    params: formatParams(parsed.transform, parsed.params),
    preview,
  };

  const payload: TransformApprovalRequest = {
    kind: "transform",
    toolName: "transform_table",
    sourceName,
    resultName,
    steps: [step],
  };

  return {
    summary: `create a ${meta?.label ?? parsed.transform} derived table from "${sourceName}" named "${resultName}"`,
    transformPayload: payload,
  };
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

export type TransformTableResult =
  | { ok: true; tableId: string; name: string }
  | { ok: false; error: string };

export const transformTableTool: AiTool = {
  name: "transform_table",
  description:
    "Create a new derived Data Hub table by applying one of the five available transforms to an existing table. The engine computes every value, the model only maps the user's request to a kind and params. Call list_datahub_tables first to get the real table id, then call this with that id, a transform kind, and the matching params. The user sees a block card preview (step name, description, params, and a live preview of the first rows) and approves or rejects before anything is created. On Approve the new table is created and the user is taken to it. Do NOT also call propose_plan for this, the block card IS the consent.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the source Data Hub table, from list_datahub_tables.",
      },
      transform: {
        type: "string",
        description:
          'One of: "transform" (apply a function to every Y value: log10, ln, log2, sqrt, square, reciprocal, or linear Y*k+b), "normalize" (rescale each column as a percent of its max / sum / first / minMax), "transpose" (swap rows and columns), "removeBaseline" (subtract a baseline column, first-row, or constant), "fractionOfTotal" (express each value as a fraction or percent of its column / row / grand total).',
      },
      params: {
        type: "object",
        description:
          'The transform-specific params. For "transform": { func: "log10"|"ln"|"log2"|"sqrt"|"square"|"reciprocal"|"linear", k?: number, b?: number }. For "normalize": { mode?: "max"|"sum"|"first"|"minMax" }. For "transpose": { headerColumnId?: string }. For "removeBaseline": { mode?: "column"|"firstRow"|"value", baselineColumnId?: string, value?: number }. For "fractionOfTotal": { scope?: "column"|"row"|"grand", asPercent?: boolean }.',
        additionalProperties: true,
      },
      resultName: {
        type: "string",
        description:
          'Optional name for the new derived table. Defaults to "<source> (<suffix>)", for example "Growth data (normalized)".',
      },
    },
    required: ["tableId", "transform", "params"],
    additionalProperties: false,
  },
  action: true,
  describeAction(args) {
    const { summary, transformPayload } = describeTransformTable(args);
    if (transformPayload) {
      // Return the transform payload on the result so the agent loop can raise it.
      // The loop recognises a `transformPayload` field and raises a "transform"
      // approval request through the same bridge.
      return { summary, transformPayload };
    }
    return { summary };
  },
  isDestructive: () => false,
  execute: async (args) => {
    const parsed = parseTransformTableArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error:
          "No tableId given. Call list_datahub_tables first and pass the id of the source table.",
      } satisfies TransformTableResult;
    }

    // Always read the LIVE source so the derived snapshot is current.
    const content = await transformTableDeps.getContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error:
          "I could not open that table. It may have been deleted, or the id is wrong. List the tables again and try one of those.",
      } satisfies TransformTableResult;
    }
    // Refresh the cache for any later describe pass.
    cacheTableContent(parsed.tableId, content);

    // The engine does all the work. runTransform is pure and deterministic.
    let derived: DataHubDocContent;
    try {
      derived = runTransform(parsed.transform, content, parsed.params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transform failed.";
      return {
        ok: false,
        error: `The transform could not run: ${msg}`,
      } satisfies TransformTableResult;
    }

    const meta = KIND_META[parsed.transform];
    const suffix = meta?.suffix ?? parsed.transform;
    const name = parsed.resultName ?? `${content.meta.name} (${suffix})`;

    const newDoc = await transformTableDeps.createTable({
      name,
      table_type: content.meta.table_type,
      project_ids: content.meta.project_ids,
      folder_path: null,
      derivedFrom: {
        sourceTableId: parsed.tableId,
        transform: parsed.transform,
        params: parsed.params,
      },
      columns: derived.columns,
      rows: derived.rows,
    });

    // Take the user to the new derived table, like run_datahub_analysis does.
    transformTableDeps.navigate(`/datahub?doc=${newDoc.id}`);

    return { ok: true, tableId: newDoc.id, name: newDoc.name } satisfies TransformTableResult;
  },
};
