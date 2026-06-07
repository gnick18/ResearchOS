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
// BeakerSearch global object search, chunk 2. The cross-app NAVIGATE record the
// palette can highlight and jump to, fed by the app-shell global source. It is a
// new PaletteItem kind, not a new renderer path, so the existing row markup
// (icon + label + meta) covers it via paletteRowParts.
import type { GlobalIndexEntry } from "@/components/beaker-search/global-index";

/** The intent buckets a command falls into. "Suggested" is not authored on a
 *  command; it is synthesized at the top of the empty-query list from the live
 *  selection (see suggestionIdsForSelection). The rest mirror the rail's intent
 *  grouping so the palette and the rail tell the same story. */
export type CommandGroup =
  | "Design"
  | "Analyze"
  | "Edit"
  | "View"
  | "Export"
  // BeakerSearch step 2a, the always-present GLOBAL layer. Two groups appended
  // at the END so a page's own intent groups always lead and the global reach
  // trails below. "Go to" is cross-page navigation (one row per NAV_ITEMS
  // route); "App" is app-level safe commands (toggle theme, open settings).
  // These two are fed by the app-shell global source, not by the editor; the
  // sequences editor never emits them, so its own palette is unchanged in
  // ordering except that the global rows trail after Export.
  | "Go to"
  | "App";

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
  // The global layer trails the page's own groups (see CommandGroup above).
  "Go to",
  "App",
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
  /** A short contextual subtitle echoing the live selection, e.g. "from 612..632"
   *  or "21 nt". Display only, shown under the label in the Suggested rows so the
   *  command reads as "do this to my highlight". Absent on most commands. */
  detail?: string;
}

/** One OTHER sequence in the open collection, offered as a jump target so the
 *  palette navigates and not only runs tools. `label` is the sequence name,
 *  `detail` is its meta sub (type, length, organism), `organism` widens the
 *  fuzzy match so typing a species finds the sequence. `onRun` switches the
 *  editor to it (the page's setSelectedId). */
export interface SequenceNavItem {
  id: string;
  label: string;
  detail?: string;
  /** The source organism, folded into the fuzzy match (not just the name). */
  organism?: string;
  iconName: IconName;
  onRun: () => void;
}

/** One recent saved result (a Phase 5 artifact) for the open sequence, offered
 *  for reopening from the palette. `label` is the artifact title, `detail` is
 *  its summary plus a relative time, `onRun` reopens it (handleOpenArtifact). */
export interface ArtifactNavItem {
  id: string;
  label: string;
  detail?: string;
  iconName: IconName;
  onRun: () => void;
}

/** The heterogeneous things the palette can highlight and run. A discriminated
 *  union so the keyboard cursor, the renderer, and Enter all branch on `kind`.
 *  "command" runs the editor handler, "sequence" switches the open sequence,
 *  "artifact" reopens a saved result, "object" jumps to a cross-app record (the
 *  global object source, chunk 2) via its deep-link href. */
export type PaletteItem =
  | { kind: "command"; command: EditorCommand }
  | { kind: "sequence"; sequence: SequenceNavItem }
  | { kind: "artifact"; artifact: ArtifactNavItem }
  | { kind: "object"; entry: GlobalIndexEntry; onRun: () => void };

/** The visible heading a palette group prints under. The command intent groups,
 *  the synthetic "Suggested", the sequence-editor navigation groups, plus the
 *  four per-type headings the global object source (chunk 2) prints under. */
export type PaletteGroupTitle =
  | CommandGroup
  | "Suggested"
  | "Jump to a sequence"
  | "Recent results"
  // BeakerSearch global object search, chunk 2, one heading per object type.
  | "Tasks"
  | "Projects"
  | "Methods"
  | "Sequences";

/** A grouped block of heterogeneous palette items the component renders. `hint`
 *  is an optional muted clause after the heading (e.g. "for your selection" or
 *  "in Gateway demo (4)"). */
export interface PaletteGroup {
  title: PaletteGroupTitle;
  hint?: string;
  items: PaletteItem[];
}

/** Whether a palette item can be run / highlighted right now. Commands honor
 *  their `enabled` flag; navigation items are always runnable. */
export function isPaletteItemEnabled(item: PaletteItem): boolean {
  if (item.kind === "command") return isCommandEnabled(item.command);
  if (item.kind === "object") return item.entry.enabled;
  return true;
}

/** The stable id used for keys / aria-activedescendant, namespaced by kind so a
 *  command, a sequence, and a cross-app object can never collide. The object key
 *  folds in the type so a task and a sequence sharing a numeric id never clash. */
export function paletteItemKey(item: PaletteItem): string {
  if (item.kind === "command") return `command-${item.command.id}`;
  if (item.kind === "sequence") return `sequence-${item.sequence.id}`;
  if (item.kind === "object") return `object-${item.entry.type}-${item.entry.key}`;
  return `artifact-${item.artifact.id}`;
}

/** Run a palette item's action, branching on its kind. */
export function runPaletteItem(item: PaletteItem): void {
  if (item.kind === "command") {
    if (isCommandEnabled(item.command)) item.command.run();
    return;
  }
  if (item.kind === "sequence") {
    item.sequence.onRun();
    return;
  }
  if (item.kind === "object") {
    if (item.entry.enabled) item.onRun();
    return;
  }
  item.artifact.onRun();
}

/** Whether a command can be run right now (absent enabled defaults to true). */
export function isCommandEnabled(cmd: EditorCommand): boolean {
  return cmd.enabled !== false;
}

/** The live SELECTION the context card chips when a range is active. Coordinates
 *  are 1-based display (lo..hi), `len` is the length in nt, Tm / GC are attached
 *  only when meaningful (oligo-length range). */
export interface PaletteSelectionContext {
  lo: number;
  hi: number;
  len: number;
  /** Tm in C, present only for oligo-length ranges. */
  tm?: number;
  /** GC percent, present for any range. */
  gc?: number;
}

/** Everything the "On this sequence" context card draws from. Display only, the
 *  card is never a selectable / fuzzy row. Assembled in SequenceEditView from the
 *  open sequence fields plus the live readout. */
export interface PaletteContext {
  /** The open sequence's user-facing name. */
  name: string;
  /** Meta line, e.g. "DNA, Circular, 4,733 bp, 6 features". */
  meta: string;
  /** Whether the molecule is circular (drives the molecule icon). */
  circular: boolean;
  /** The source organism, shown with a color swatch when present. */
  organism?: string;
  /** A small swatch color (a stable hue derived from the organism / tax id). */
  organismSwatch?: string;
  /** The live range selection, chipped when present. */
  selection?: PaletteSelectionContext;
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

/** Score a SEQUENCE jump target against a query across its name AND organism,
 *  taking the best of the two (the organism hit is worth a touch less, the way a
 *  keyword hit is for a command). Returns null when neither matches. */
export function scoreSequenceNav(
  query: string,
  item: SequenceNavItem,
): number | null {
  const labelScore = fuzzyScore(query, item.label);
  const orgScore = item.organism ? fuzzyScore(query, item.organism) : null;
  if (labelScore == null && orgScore == null) return null;
  return Math.max(labelScore ?? -Infinity, (orgScore ?? -Infinity) - 2);
}

/** Score a recent-result jump target against a query across its title AND its
 *  detail (summary + time). Returns null when neither matches. */
export function scoreArtifactNav(
  query: string,
  item: ArtifactNavItem,
): number | null {
  const labelScore = fuzzyScore(query, item.label);
  const detailScore = item.detail ? fuzzyScore(query, item.detail) : null;
  if (labelScore == null && detailScore == null) return null;
  return Math.max(labelScore ?? -Infinity, (detailScore ?? -Infinity) - 2);
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
  // The COPY / FIND / GOTO commands surface in the live editor under the Edit
  // menu, where they carry an "edit-" id prefix (edit-copy, edit-find, edit-goto).
  // We list BOTH the bare and the prefixed id so the rule is robust whether the
  // caller emits one shape or the other; ids that are not in the live command
  // list are silently skipped, so naming both costs nothing.
  const ids: string[] = [];
  switch (input.selectionKind) {
    case "region":
      ids.push(
        "primer-design",
        "annotate-add",
        "copy",
        "edit-copy",
        "protein-props",
        "export-fasta-sel",
      );
      break;
    case "feature-cds":
      ids.push(
        "protein-props",
        "protein-domains",
        "protein-translate",
        "copy",
        "edit-copy",
      );
      break;
    case "feature-primer":
      ids.push("primer-list", "copy", "edit-copy");
      break;
    case "feature-other":
      ids.push("copy", "edit-copy");
      break;
    default:
      // Nothing selected, lean on the whole-sequence starting moves.
      ids.push("find", "edit-find", "primer-design", "annotate-detect", "align-open");
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

/** How many recent results the empty-query "Recent results" group shows. */
export const RECENT_RESULTS_CAP = 5;

/** The full input the palette assembles its heterogeneous view from. */
export interface PaletteInput {
  commands: EditorCommand[];
  /** OTHER sequences in the open collection, already excluding the open one. */
  sequences: SequenceNavItem[];
  /** The latest saved results for the open sequence, newest first. */
  artifacts: ArtifactNavItem[];
  /** The collection name, for the "Jump to a sequence" group hint. */
  collectionLabel?: string;
  selectionKind: SelectionKind;
  hasOrganism: boolean;
  /** BeakerSearch global object search, chunk 2. Pre-ranked per-type object
   *  groups (Tasks / Projects / Methods / Sequences), built by the app-shell
   *  global source from the pure rankGlobalEntries (already scored, capped, and
   *  de-duped against the active page). Empty on an empty query and on pages that
   *  do not feed the index. They splice in AFTER the page's own command / sequence
   *  / artifact groups and BEFORE the global "Go to" / "App" command groups, so
   *  the page's own context leads and the global reach lives below. Optional, an
   *  omitted value is the no-object-source case (e.g. the sequence editor's own
   *  unit tests). */
  objectGroups?: PaletteGroup[];
}

/** The two trailing command groups the always-present global layer contributes
 *  (cross-page nav + safe app commands). The object groups splice in just above
 *  these, so a page's own groups lead, then objects, then the global reach. */
const GLOBAL_COMMAND_GROUPS: ReadonlySet<CommandGroup> = new Set<CommandGroup>([
  "Go to",
  "App",
]);

/** Stable empty default so an omitted objectGroups prop does not churn the memo. */
const EMPTY_OBJECT_GROUPS: PaletteGroup[] = [];

/** Build the palette's heterogeneous, grouped view.
 *
 *  Empty query => the orienting glue, top to bottom: Suggested (selection-biased
 *  commands), Jump to a sequence (the collection siblings), Recent results (the
 *  newest artifacts, capped), then every command intent group in order. The
 *  context card is rendered by the component above all of this; it is not a
 *  group here.
 *
 *  Non-empty query => no Suggested / no whole-group blocks; commands, sequences,
 *  and artifacts are ALL fuzzy-scored together, sorted best-first, and re-bucketed
 *  into their kind's group (an empty group is dropped). The group holding the
 *  single top hit leads, so the default highlight sits near the input. Matches
 *  from any of the three kinds surface. */
export function buildPaletteResults(input: PaletteInput): PaletteGroup[] {
  return buildPaletteResultsForQuery(input, "");
}

/** The query-aware builder. `buildPaletteResults` is the empty-query shorthand. */
export function buildPaletteResultsForQuery(
  input: PaletteInput,
  query: string,
): PaletteGroup[] {
  const {
    commands,
    sequences,
    artifacts,
    collectionLabel,
    selectionKind,
    hasOrganism,
    objectGroups = EMPTY_OBJECT_GROUPS,
  } = input;
  const trimmed = query.trim();

  if (trimmed === "") {
    const groups: PaletteGroup[] = [];

    // 1. Suggested, biased by the live selection (reuse the command rule).
    const byId = new Map(commands.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const suggested: PaletteItem[] = [];
    for (const id of suggestionIdsForSelection({ selectionKind, hasOrganism })) {
      if (seen.has(id)) continue;
      const cmd = byId.get(id);
      if (cmd) {
        suggested.push({ kind: "command", command: cmd });
        seen.add(id);
      }
    }
    if (suggested.length > 0) {
      groups.push({
        title: "Suggested",
        hint: selectionKind === "none" ? undefined : "for your selection",
        items: suggested,
      });
    }

    // 2. Jump to a sequence (the other sequences in the collection).
    if (sequences.length > 0) {
      const where = collectionLabel ? `in ${collectionLabel} ` : "";
      groups.push({
        title: "Jump to a sequence",
        hint: `${where}(${sequences.length})`,
        items: sequences.map((s) => ({ kind: "sequence" as const, sequence: s })),
      });
    }

    // 3. Recent results (the newest artifacts, capped).
    if (artifacts.length > 0) {
      groups.push({
        title: "Recent results",
        items: artifacts
          .slice(0, RECENT_RESULTS_CAP)
          .map((a) => ({ kind: "artifact" as const, artifact: a })),
      });
    }

    // 4. Then every command intent group in source order.
    for (const group of COMMAND_GROUP_ORDER) {
      const inGroup = commands
        .filter((c) => c.group === group)
        .map((c) => ({ kind: "command" as const, command: c }));
      if (inGroup.length > 0) groups.push({ title: group, items: inGroup });
    }
    return groups;
  }

  // Scored query across ALL THREE kinds. Rank everything together, then re-bucket
  // by kind, keeping the best-first order within each bucket.
  type Scored = { item: PaletteItem; score: number };
  const scored: Scored[] = [];
  for (const cmd of commands) {
    const s = scoreCommand(trimmed, cmd);
    if (s != null) scored.push({ item: { kind: "command", command: cmd }, score: s });
  }
  for (const seqItem of sequences) {
    const s = scoreSequenceNav(trimmed, seqItem);
    if (s != null) {
      scored.push({ item: { kind: "sequence", sequence: seqItem }, score: s });
    }
  }
  for (const art of artifacts) {
    const s = scoreArtifactNav(trimmed, art);
    if (s != null) {
      scored.push({ item: { kind: "artifact", artifact: art }, score: s });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // Bucket the survivors. Sequences and artifacts each get their own heading;
  // the commands re-bucket into their intent groups (so the typed view still
  // reads in the rail's order under each label). The page's own groups are
  // assembled FIRST, then the global object groups splice in (between the page's
  // own context and the global "Go to" / "App" reach), so the page leads and the
  // global reach lives below (doc 5.4).
  const pageGroups: PaletteGroup[] = [];

  const seqItems = scored
    .filter((s) => s.item.kind === "sequence")
    .map((s) => s.item);
  if (seqItems.length > 0) {
    pageGroups.push({ title: "Jump to a sequence", items: seqItems });
  }

  const artItems = scored
    .filter((s) => s.item.kind === "artifact")
    .map((s) => s.item);
  if (artItems.length > 0) {
    pageGroups.push({ title: "Recent results", items: artItems });
  }

  // The page's own command intent groups (everything that is NOT the global
  // "Go to" / "App" layer), so the object groups can slot in just above those.
  const globalCommandGroups: PaletteGroup[] = [];
  for (const group of COMMAND_GROUP_ORDER) {
    const inGroup = scored
      .filter((s) => s.item.kind === "command" && s.item.command.group === group)
      .map((s) => s.item);
    if (inGroup.length === 0) continue;
    const built = { title: group, items: inGroup };
    if (GLOBAL_COMMAND_GROUPS.has(group)) globalCommandGroups.push(built);
    else pageGroups.push(built);
  }

  // The order before the top-hit lead, page's own groups, then the pre-ranked
  // global object groups (already scored, capped, de-duped by rankGlobalEntries),
  // then the global "Go to" / "App" command groups.
  const groups: PaletteGroup[] = [
    ...pageGroups,
    ...objectGroups,
    ...globalCommandGroups,
  ];

  // Lead with the group that holds the page source's single best hit, so the
  // default highlight sits right under the input (the existing rule). The page's
  // own scored list and the pre-ranked object groups are scored independently, so
  // we only promote the page's own top-hit group to front when the page produced
  // a match; otherwise the page's own context leads, then the object groups, then
  // the global reach, which is the intended composition (doc 5.4). The object
  // groups stay best-first among themselves (rankGlobalEntries already ordered
  // them), so a global-only match still surfaces in a stable, sensible order.
  if (scored.length > 0) {
    const topTitle = paletteGroupTitleOf(scored[0].item);
    groups.sort((a, b) => {
      if (a.title === topTitle) return -1;
      if (b.title === topTitle) return 1;
      return 0;
    });
  }
  return groups;
}

/** The per-type heading an object entry belongs under (Tasks / Projects /
 *  Methods / Sequences). Exported so the app-shell global source builds its
 *  PaletteGroup titles from the same map paletteGroupTitleOf uses, keeping one
 *  source of truth over the union. */
export function objectGroupTitle(type: GlobalIndexEntry["type"]): PaletteGroupTitle {
  switch (type) {
    case "task":
      return "Tasks";
    case "project":
      return "Projects";
    case "method":
      return "Methods";
    case "sequence":
      return "Sequences";
  }
}

/** The heading a single item belongs under in the typed view. */
function paletteGroupTitleOf(item: PaletteItem): PaletteGroupTitle {
  if (item.kind === "sequence") return "Jump to a sequence";
  if (item.kind === "artifact") return "Recent results";
  if (item.kind === "object") return objectGroupTitle(item.entry.type);
  return item.command.group;
}

/** Flatten grouped palette items to visual order, so the caller indexes one
 *  highlight cursor across the heterogeneous list (Up / Down walk this list). */
export function flattenPaletteItems(groups: PaletteGroup[]): PaletteItem[] {
  const flat: PaletteItem[] = [];
  for (const g of groups) flat.push(...g.items);
  return flat;
}
