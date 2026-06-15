// Inline overlay-wizard widget seam for BeakerBot (BeakerAI lane, 2026-06-14).
//
// suggest_tree_overlays surfaces the SAME Smart Data Binding wizard the /phylo
// GUI mounts, inline in chat (Grant: ONE engine, TWO front doors). It mirrors the
// record-set widget seam exactly: the tool rides the wizard payload UI-only under
// the shared `_ui` key, the agent loop strips `_ui` before the model sees the
// result (stripRecordSetUi deletes the key generically, no change needed), and the
// conversation store lifts the payload onto the in-flight assistant message so
// BeakerBotConversation can mount <SmartDataWizard> below the reply.
//
// The payload is discriminated by `widget: "overlayWizard"` and carries no `items`
// array, so recordSetFromResult ignores it (it requires items) and this module's
// overlayWizardFromResult claims it. One tool result has exactly one `_ui`, and a
// tool is either record-listing OR the overlay tool, so the two never collide.
//
// The engine (rankJoinCandidates etc.) is deterministic and owned by the phylo
// lane; the model only narrates the ranked facts and never recomputes a join rate.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { JoinCandidate } from "@/lib/phylo/smart-binding";

/** The shared out-of-band UI key (same key the record-set widget uses). */
const UI_KEY = "_ui";

/** The wizard payload carried UI-only on a suggest_tree_overlays result. The
 *  commit re-loads table content by id, so the payload stays lean (no row data). */
export type OverlayWizardPayload = {
  widget: "overlayWizard";
  /** The tree the overlays apply to (the host commit writes to this id). */
  treeId: string;
  treeName: string;
  /** The ranked join candidates the wizard renders, from rankJoinCandidates. */
  candidates: JoinCandidate[];
};

/** Attach an overlay-wizard payload to a tool result under the shared `_ui` key,
 *  leaving the model-facing shape otherwise untouched. */
export function withOverlayWizardUi<T extends object>(
  result: T,
  payload: OverlayWizardPayload,
): T & { _ui: OverlayWizardPayload } {
  return { ...result, [UI_KEY]: payload } as T & { _ui: OverlayWizardPayload };
}

/** Read an overlay-wizard payload off a (possibly unstripped) tool result, or
 *  null when absent. Defensive against non-objects and a malformed `_ui`. */
export function overlayWizardFromResult(result: unknown): OverlayWizardPayload | null {
  if (result === null || typeof result !== "object") return null;
  const value = (result as Record<string, unknown>)[UI_KEY];
  if (value === null || typeof value !== "object") return null;
  const p = value as Partial<OverlayWizardPayload>;
  if (p.widget !== "overlayWizard") return null;
  if (typeof p.treeId !== "string" || !Array.isArray(p.candidates)) return null;
  return value as OverlayWizardPayload;
}

/** A compact, model-facing fact view of one candidate. The model narrates these
 *  verbatim (deterministic engine numbers), never recomputing a join rate. */
export type CandidateFact = {
  tableName: string;
  joinPercent: number;
  matchedTips: number;
  totalTips: number;
  columns: { name: string; kind: string; geoms: string[] }[];
};

/** Build the lean fact list the model relays from the engine's candidates. */
export function candidatesToFacts(candidates: JoinCandidate[]): CandidateFact[] {
  return candidates.map((c) => ({
    tableName: c.tableName,
    joinPercent: Math.round(c.joinRate * 100),
    matchedTips: c.matchedTips,
    totalTips: c.totalTips,
    columns: c.overlays.map((o) => ({
      name: o.columnName,
      kind: o.columnKind,
      geoms: o.geoms,
    })),
  }));
}
