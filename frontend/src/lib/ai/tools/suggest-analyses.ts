// suggest_analyses (the chat front door for the analysis/graph picker)
// ---------------------------------------------------------------------------
//
// ONE engine, TWO front doors (Grant): this calls the SAME deterministic engine
// (tableCapabilities) the Data Hub "Analyze" UI uses, then rides the result
// UI-only so BeakerBotConversation mounts the analysis picker inline. The model
// only narrates the engine's VALID analyses + graphs and NEVER invents one or
// offers one that cannot run on the table, which is the fix for Beaker
// suggesting an analysis and then refusing it. The actual run is the user
// clicking an option in the picker (host commit), so this tool is read-only and
// non-gated.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { datahubAnalysisDeps } from "./datahub-analysis";
import { tableCapabilities } from "@/lib/datahub/table-capabilities";
import {
  capabilitiesToFacts,
  withAnalysisPickerUi,
} from "@/lib/ai/analysis-picker";
import { getBeakerContext } from "@/components/ai/context-bridge";
import type { AiTool } from "./types";

/** An empty or "this table" style ref means the open table, not a named lookup. */
function isDeicticTableRef(ref: string): boolean {
  const r = ref.trim().toLowerCase();
  if (r === "") return true;
  return (
    r === "this" ||
    r === "it" ||
    r === "this table" ||
    r === "the table" ||
    r === "this one" ||
    r === "current table"
  );
}

export const suggestAnalysesTool: AiTool = {
  name: "suggest_analyses",
  description:
    "Show the statistical analyses AND graphs that can actually run on a Data Hub table, and open the analysis picker inline so the user can pick one to run or plot. Use this whenever the user asks what they can do with a table (for example \"what analysis can I run on this table\", \"what tests or figures can I make from my qPCR data\", \"how should I analyze the Control vs Drug table\"). By default it acts on the table the user has OPEN in the Data Hub; pass `table` (a table name or id) to target a specific one. It is READ-ONLY and deterministic, the engine computes which analyses and graphs are valid for the table's design, so ONLY offer the analyses and graphs it returns. Relay them as FACTS (each label and what it does), and NEVER suggest a test or figure the engine did not return, because it cannot run on that table. The picker appears below your reply for the user to choose; do NOT call any other tool to run it, the user drives the picker. If the table has no runnable analysis or graph, say so plainly and do not open the picker.",
  parameters: {
    type: "object",
    properties: {
      table: {
        type: "string",
        description:
          "Optional table to act on, by name or id. Omit to use the table the user currently has open in the Data Hub.",
      },
    },
    additionalProperties: false,
  },
  // Read-only: the run is the user's pick in the inline picker (host commit).
  execute: async (args) => {
    const ref = typeof args.table === "string" ? args.table.trim() : "";

    let docs;
    try {
      docs = await datahubAnalysisDeps.listDocuments();
    } catch {
      return {
        ok: false as const,
        error:
          "I could not read your Data Hub tables. A folder may not be connected.",
      };
    }

    // Resolve the target table. A real name/id is looked up; a deictic or empty
    // ref falls back to the OPEN table from the context bridge.
    const named = ref !== "" && !isDeicticTableRef(ref);
    let meta = named
      ? docs.find(
          (d) =>
            d.id === ref || d.name.trim().toLowerCase() === ref.toLowerCase(),
        ) ?? null
      : null;
    if (!meta && !named) {
      const ctx = getBeakerContext();
      if (ctx?.selection?.type === "datahub-table") {
        meta = docs.find((d) => d.id === ctx.selection!.id) ?? null;
      }
    }
    if (!meta) {
      if (named) {
        const names = docs.map((d) => `"${d.name}"`).join(", ");
        return {
          ok: false as const,
          error: `I could not find a table called "${ref}". Your tables are: ${names || "(none yet)"}.`,
        };
      }
      return {
        ok: false as const,
        error:
          "I am not sure which table you mean. Open a table in the Data Hub, or name one. I will not guess.",
      };
    }

    let content;
    try {
      content = await datahubAnalysisDeps.resolveContent(meta.id);
    } catch {
      content = null;
    }
    if (!content) {
      return {
        ok: false as const,
        error: "I could not read that table's data.",
      };
    }

    const tableName = meta.name || "table";
    const caps = tableCapabilities(content);

    if (caps.analyses.length === 0 && caps.graphs.length === 0) {
      return {
        ok: true as const,
        tableName,
        tableType: meta.table_type,
        analysisCount: 0,
        graphCount: 0,
        message: `${tableName} is a ${meta.table_type} table that has no analysis or graph it can run yet. Add the data its design needs, or pick a different table.`,
      };
    }

    const facts = capabilitiesToFacts(caps);
    const result = {
      ok: true as const,
      tableName,
      tableId: meta.id,
      tableType: meta.table_type,
      analysisCount: caps.analyses.length,
      graphCount: caps.graphs.length,
      analyses: facts.analyses,
      graphs: facts.graphs,
    };
    // Ride the full capabilities UI-only so the picker mounts inline; stripped
    // before the model so its context stays the lean facts above.
    return withAnalysisPickerUi(result, {
      widget: "analysisPicker",
      tableId: meta.id,
      tableName,
      capabilities: caps,
    });
  },
};
