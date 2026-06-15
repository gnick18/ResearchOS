// BeakerBot create_datahub_table tool (BeakerAI lane, 2026-06-14).
//
// "BeakerBot, make a table from this data" in ONE deterministic call. Reuses the
// existing Data Hub import primitives (importTextToTable parses CSV/TSV with auto
// header + delimiter + type detection; dataHubApi.create writes a "column" table),
// so there is no new infrastructure and no UI click-storm. The model only maps the
// user's pasted data to the call; the parser computes the columns/rows and the
// engine writes them. GATED: describeAction previews the detected columns + row
// count before anything is written (a new library record), isDestructive false
// (reversible via trash). It fills the CRUD gap (BeakerBot could create methods /
// notes / molecules / sequences / purchases / projects but not Data Hub tables)
// and closes the Phase 4 loop (create a table, then suggest_tree_overlays it onto
// a tree, all in chat).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { importTextToTable } from "@/lib/datahub/import-table";
import { dataHubApi } from "@/lib/datahub/api";
import type { DataHubCreate, DataHubDocument } from "@/lib/datahub/model/types";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { getBeakerContext, type BeakerContext } from "@/components/ai/context-bridge";
import type { AiTool } from "./types";

// Injectable seam so the tool is unit-testable without a real folder.
export type CreateDatahubTableDeps = {
  createTable: (data: DataHubCreate) => Promise<DataHubDocument>;
  navigate: (path: string) => void;
  // Read the on-screen selection so an open tree's project can default the new
  // table's collection (the phylo lane publishes selection.projectIds). Seamed
  // for testability.
  getContext: () => BeakerContext | null;
};

export const createDatahubTableDeps: CreateDatahubTableDeps = {
  createTable: (data) => dataHubApi.create(data),
  navigate: requestNavigation,
  getContext: getBeakerContext,
};

/** Pull the raw data text + name + project from loose tool args. */
function readArgs(args: Record<string, unknown>): {
  text: string;
  name: string;
  projectId: string | null;
} {
  const text = typeof args.data === "string" ? args.data : "";
  const rawName = typeof args.name === "string" ? args.name.trim() : "";
  const projectId =
    typeof args.projectId === "string" && args.projectId.trim()
      ? args.projectId.trim()
      : null;
  return { text, name: rawName || "Imported table", projectId };
}

/** Parse the data text to columns + rows (pure, the same path the import dialog
 *  uses). Returns null counts when nothing parses. */
function parse(text: string) {
  const { columns, rows } = importTextToTable(text);
  return { columns, rows };
}

export const createDatahubTableTool: AiTool = {
  name: "create_datahub_table",
  description:
    "Create a Data Hub table from raw tabular data the user gives you (pasted CSV or TSV, or a grid copied from a spreadsheet). Use this when the user wants their data turned into a Data Hub table (for example \"make a table from this\", \"import this CSV into Data Hub\", \"save this data as a table\"). Pass `data` as the raw text (rows on separate lines, columns separated by commas or tabs); the importer auto-detects the delimiter, the header row, and column types, so do NOT reformat or retype the user's values, paste them through verbatim. Optionally pass `name` (the table name) and `projectId` (a collection to file it under). This is a GATED write, the user sees the detected columns and row count and approves before anything is created. You never invent, drop, or alter a value, the parser handles the data exactly as given. After it is created, end your reply with the table embed [<name>](/datahub?doc=<id>#ros=table) using the id the tool returns, so the new table renders as a card.",
  parameters: {
    type: "object",
    properties: {
      data: {
        type: "string",
        description:
          "The raw table data as text, CSV or TSV. Rows on separate lines, the first row usually the header. Pasted verbatim from the user, never reformatted.",
      },
      name: {
        type: "string",
        description: "Optional name for the new table. Defaults to a generic name.",
      },
      projectId: {
        type: "string",
        description: "Optional collection (project) id to file the table under.",
      },
    },
    required: ["data"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const { text, name } = readArgs(args);
    const { columns, rows } = parse(text);
    const colList = columns.map((c) => c.name).join(", ");
    const summary =
      columns.length === 0
        ? `create a Data Hub table "${name}" (no columns could be detected from the data)`
        : `create a Data Hub table "${name}" with ${columns.length} column${columns.length === 1 ? "" : "s"} (${colList}) and ${rows.length} row${rows.length === 1 ? "" : "s"}`;
    return { summary };
  },
  execute: async (args) => {
    const { text, name, projectId } = readArgs(args);
    if (!text.trim()) {
      return { ok: false as const, error: "There was no data to make a table from." };
    }
    const { columns, rows } = parse(text);
    if (columns.length === 0 || rows.length === 0) {
      return {
        ok: false as const,
        error:
          "I could not detect any columns or rows in that data. Check it is rows of comma- or tab-separated values.",
      };
    }
    // Default the table's collection to the open tree's project when the model
    // gave no explicit projectId, so "make a table from this and put it on my
    // tree" files it alongside the tree (phylo publishes selection.projectIds).
    // An explicit projectId from the model always wins.
    const resolvedProjectId =
      projectId ??
      createDatahubTableDeps.getContext()?.selection?.projectIds?.[0] ??
      null;
    let created: DataHubDocument;
    try {
      created = await createDatahubTableDeps.createTable({
        name,
        table_type: "column",
        project_ids: resolvedProjectId ? [resolvedProjectId] : [],
        columns,
        rows,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, error: `I could not create the table: ${msg}` };
    }
    createDatahubTableDeps.navigate(`/datahub?doc=${created.id}`);
    return {
      ok: true as const,
      id: created.id,
      name: created.name,
      columns: columns.map((c) => c.name),
      rowCount: rows.length,
      embed: `[${created.name}](/datahub?doc=${created.id}#ros=table)`,
    };
  },
};
