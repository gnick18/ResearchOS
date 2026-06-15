// Inline analysis-picker widget seam for BeakerBot (BeakerAI lane, 2026-06-15).
//
// suggest_analyses surfaces the constraint-aware analysis/graph picker inline in
// chat (Grant: ONE engine, TWO front doors, same shape as Smart Data Binding).
// It mirrors the overlay-wizard seam exactly: the tool rides the capabilities
// payload UI-only under the shared `_ui` key, the agent loop strips `_ui` before
// the model sees the result, and the conversation store lifts the payload onto
// the in-flight assistant message so BeakerBotConversation can mount the picker
// below the reply.
//
// The payload is discriminated by `widget: "analysisPicker"` and carries no
// `items` array, so recordSetFromResult ignores it and analysisPickerFromResult
// claims it. One tool result has exactly one `_ui`.
//
// The engine (tableCapabilities) is deterministic. The model only narrates the
// valid analyses + graphs it returns and NEVER invents one or offers one that
// cannot run on the table. House style: no em-dashes, no emojis, no mid-sentence
// colons.

import type {
  TableCapabilities,
  Capability,
} from "@/lib/datahub/table-capabilities";

/** The shared out-of-band UI key (same key the record-set + overlay wizards use). */
const UI_KEY = "_ui";

/** The picker payload carried UI-only on a suggest_analyses result. The run/plot
 *  re-loads the table by id, so the payload stays lean (no row data). */
export type AnalysisPickerPayload = {
  widget: "analysisPicker";
  /** The table the analyses + graphs apply to. */
  tableId: string;
  tableName: string;
  /** The constraint-aware valid analyses + graphs, from tableCapabilities. */
  capabilities: TableCapabilities;
};

/** Attach an analysis-picker payload to a tool result under the shared `_ui`
 *  key, leaving the model-facing shape otherwise untouched. */
export function withAnalysisPickerUi<T extends object>(
  result: T,
  payload: AnalysisPickerPayload,
): T & { _ui: AnalysisPickerPayload } {
  return { ...result, [UI_KEY]: payload } as T & { _ui: AnalysisPickerPayload };
}

/** Read an analysis-picker payload off a (possibly unstripped) tool result, or
 *  null when absent. Defensive against non-objects and a malformed `_ui`. */
export function analysisPickerFromResult(
  result: unknown,
): AnalysisPickerPayload | null {
  if (result === null || typeof result !== "object") return null;
  const value = (result as Record<string, unknown>)[UI_KEY];
  if (value === null || typeof value !== "object") return null;
  const p = value as Partial<AnalysisPickerPayload>;
  if (p.widget !== "analysisPicker") return null;
  if (typeof p.tableId !== "string" || p.capabilities == null) return null;
  return value as AnalysisPickerPayload;
}

/** A compact, model-facing fact view. The model narrates these verbatim (the
 *  engine's labels), never inventing an analysis or graph. */
export type CapabilityFact = {
  id: string;
  kind: "analysis" | "graph";
  label: string;
  hint: string;
};

function toFact(c: Capability): CapabilityFact {
  return { id: c.id, kind: c.kind, label: c.label, hint: c.hint };
}

/** Build the lean fact lists the model relays from the engine's capabilities. */
export function capabilitiesToFacts(caps: TableCapabilities): {
  analyses: CapabilityFact[];
  graphs: CapabilityFact[];
} {
  return {
    analyses: caps.analyses.map(toFact),
    graphs: caps.graphs.map(toFact),
  };
}
