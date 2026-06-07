// sequence editor master. The COMMAND MODEL for the Cmd-K palette (sequences
// redesign phase 4). Pure types + matching / grouping / selection-biasing
// helpers, kept free of React and the DOM so the fuzzy match, the group order,
// and the suggestion rule are unit-tested without rendering. The palette
// component (CommandPalette.tsx) and the command SOURCE (the `commands` memo in
// SequenceEditView) both lean on these.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import type { IconName } from "@/components/icons";
import type { SelectionKind } from "@/lib/sequences/inspector-context";

/** The intent buckets a command falls into. "Suggested" is not authored on a
 *  command; it is synthesized at the top of the empty-query list from the live
 *  selection (see suggestionIdsForSelection). The rest mirror the rail's intent
 *  grouping so the palette and the rail tell the same story. */
export type CommandGroup =
  | "Design"
  | "Analyze"
  | "Edit"
  | "View"
  | "Export";

/** The order groups print in, so the list reads top to bottom the way the rail
 *  does (do at the bench, then learn about the sequence, then edit bases, then
 *  what is drawn, then save and share). "Suggested" is handled separately and
 *  always leads when present. */
export const COMMAND_GROUP_ORDER: CommandGroup[] = [
  "Design",
  "Analyze",
  "Edit",
  "View",
  "Export",
];

/** One palette command. `run` points at the SAME handler the rail / menu / view
 *  switcher already uses, so the palette never re-implements an operation, it
 *  just exposes it to the keyboard. `enabled` false greys the row and blocks
 *  running it; absent means enabled. `keywords` widen the fuzzy match beyond the
 *  label (synonyms the user might type). */
export interface EditorCommand {
  id: string;
  label: string;
  group: CommandGroup;
  iconName: IconName;
  /** Right-aligned shortcut hint, e.g. "Cmd K" or "Cmd F". Optional. */
  shortcut?: string;
  /** Extra words the fuzzy match should also see (synonyms, the off-rail name). */
  keywords?: string;
  run: () => void;
  /** Absent => enabled. false => greyed and not runnable. */
  enabled?: boolean;
}

/** Whether a command can be run right now (absent enabled defaults to true). */
export function isCommandEnabled(cmd: EditorCommand): boolean {
  return cmd.enabled !== false;
}

/** A fuzzy SUBSEQUENCE match with a small relevance score. The query characters
 *  must appear in order inside the haystack (case-insensitive), not necessarily
 *  adjacent. Score rewards a prefix hit, a word-boundary hit, and adjacency, so
 *  the most on-the-nose command floats up. Returns null when there is no match.
 *  No dependency, the matcher is deliberately small. */
export function fuzzyScore(query: string, haystack: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const h = haystack.toLowerCase();
  let qi = 0;
  let score = 0;
  let prevHit = -2;
  let firstHit = -1;
  for (let hi = 0; hi < h.length && qi < q.length; hi += 1) {
    if (h[hi] === q[qi]) {
      if (firstHit === -1) firstHit = hi;
      // Adjacent run bonus (contiguous matches read like a typed substring).
      if (hi === prevHit + 1) score += 6;
      else score += 1;
      // Word-boundary bonus (start of word or after a separator).
      if (hi === 0 || /[\s/(.,_-]/.test(h[hi - 1])) score += 4;
      prevHit = hi;
      qi += 1;
    }
  }
  if (qi < q.length) return null;
  // Prefix bonus, and a mild penalty for matches that start deep in the string.
  if (firstHit === 0) score += 8;
  else score -= Math.min(firstHit, 8);
  return score;
}

/** Score a command against a query across its label AND keywords, taking the
 *  best of the two. Returns null when neither matches. */
export function scoreCommand(query: string, cmd: EditorCommand): number | null {
  const labelScore = fuzzyScore(query, cmd.label);
  const kwScore = cmd.keywords ? fuzzyScore(query, cmd.keywords) : null;
  if (labelScore == null && kwScore == null) return null;
  // A keyword-only hit is worth a bit less than the same hit on the label.
  const best = Math.max(labelScore ?? -Infinity, (kwScore ?? -Infinity) - 2);
  return best;
}

/** The command ids the palette should lift into a "Suggested" group at the top
 *  of the EMPTY-query list, ordered most-relevant first. The rule reads the live
 *  selection kind plus whether an organism is attached, and names existing
 *  command ids (the same ids the `commands` source emits). Ids that are not in
 *  the live command list (disabled / read-only / not present) are simply skipped
 *  by the caller, so this rule can be generous. */
export function suggestionIdsForSelection(input: {
  selectionKind: SelectionKind;
  hasOrganism: boolean;
}): string[] {
  const ids: string[] = [];
  switch (input.selectionKind) {
    case "region":
      ids.push(
        "primer-design",
        "annotate-add",
        "copy",
        "protein-props",
        "export-fasta-sel",
      );
      break;
    case "feature-cds":
      ids.push("protein-props", "protein-domains", "protein-translate", "copy");
      break;
    case "feature-primer":
      ids.push("primer-list", "copy");
      break;
    case "feature-other":
      ids.push("copy");
      break;
    default:
      // Nothing selected, lean on the whole-sequence starting moves.
      ids.push("find", "primer-design", "annotate-detect", "align-open");
      break;
  }
  if (input.hasOrganism) ids.push("tree-explore");
  return ids;
}

/** A grouped block of results for the palette to render. */
export interface CommandGroupResult {
  /** The visible group heading (a CommandGroup, or the synthetic "Suggested"). */
  group: CommandGroup | "Suggested";
  commands: EditorCommand[];
}

/** Turn the flat command list into the ordered, grouped result the palette
 *  draws, given the current query and the selection context.
 *
 *  Empty query => a "Suggested" group (from suggestionIdsForSelection, in rule
 *  order, de-duplicated, only commands that actually exist), then every group in
 *  COMMAND_GROUP_ORDER with its commands in source order.
 *
 *  Non-empty query => no Suggested group; every command is fuzzy-scored, the
 *  matches are sorted best-first, and they are re-bucketed into their groups (a
 *  group with no surviving match is dropped). The single best match across all
 *  groups is the default highlight, so the caller can flatten and highlight
 *  index 0. */
export function buildResults(
  commands: EditorCommand[],
  query: string,
  context: { selectionKind: SelectionKind; hasOrganism: boolean },
): CommandGroupResult[] {
  const trimmed = query.trim();

  if (trimmed === "") {
    const results: CommandGroupResult[] = [];
    // Suggested, biased by the live selection.
    const byId = new Map(commands.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const suggested: EditorCommand[] = [];
    for (const id of suggestionIdsForSelection(context)) {
      if (seen.has(id)) continue;
      const cmd = byId.get(id);
      if (cmd) {
        suggested.push(cmd);
        seen.add(id);
      }
    }
    if (suggested.length > 0) {
      results.push({ group: "Suggested", commands: suggested });
    }
    // Then every intent group in order.
    for (const group of COMMAND_GROUP_ORDER) {
      const inGroup = commands.filter((c) => c.group === group);
      if (inGroup.length > 0) results.push({ group, commands: inGroup });
    }
    return results;
  }

  // Scored query. Rank everything, then re-bucket the survivors by group while
  // preserving the best-first order WITHIN each group.
  const scored: Array<{ cmd: EditorCommand; score: number }> = [];
  for (const cmd of commands) {
    const score = scoreCommand(trimmed, cmd);
    if (score != null) scored.push({ cmd, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const results: CommandGroupResult[] = [];
  for (const group of COMMAND_GROUP_ORDER) {
    const inGroup = scored.filter((s) => s.cmd.group === group).map((s) => s.cmd);
    if (inGroup.length > 0) results.push({ group, commands: inGroup });
  }
  // Reorder the GROUPS themselves so the group holding the single top hit leads,
  // keeping the highlight near the input.
  if (scored.length > 0) {
    const topGroup = scored[0].cmd.group;
    results.sort((a, b) => {
      if (a.group === topGroup) return -1;
      if (b.group === topGroup) return 1;
      return COMMAND_GROUP_ORDER.indexOf(a.group as CommandGroup) -
        COMMAND_GROUP_ORDER.indexOf(b.group as CommandGroup);
    });
  }
  return results;
}

/** Flatten grouped results to the visual order, so the caller can index a single
 *  highlight cursor across groups (Up / Down move through this flat list). */
export function flattenResults(groups: CommandGroupResult[]): EditorCommand[] {
  const flat: EditorCommand[] = [];
  for (const g of groups) flat.push(...g.commands);
  return flat;
}
