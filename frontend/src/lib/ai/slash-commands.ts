// BeakerBot slash-command registry (ai at-mentions bot, 2026-06-13).
//
// A data-driven registry of the curated "/" commands the composer offers. Each
// command is an input affordance only, it pre-fills the textarea with an intent
// phrase that maps to a real BeakerBot tool that already exists. There is no new
// backend here, the model reads the pre-filled intent (plus any @ attached refs)
// and calls the matching deterministic tool. The list is kept as a typed array
// so a new command is one entry, not a new branch of JSX.
//
// Locked decision (mockup section 3 + Q1): keep the list curated and tight (the
// six commands below map 1:1 to real tools). The shape is extensible so a future
// pass can grow the list or let PIs register lab macros without a rewrite.
//
// Pre-fill phrasing matches the mockup intent per command. Selecting a command
// pre-fills the input and leaves the cursor ready for an @object mention, so the
// composer never sends the raw slash token to the model.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

/** One curated composer command. */
export interface SlashCommand {
  /** The token typed after "/", lowercase, no leading slash (e.g. "summarize"). */
  name: string;
  /** One-line description shown in the command menu row. */
  description: string;
  /** The text written into the composer when the command is chosen. Ends with a
   *  trailing space so the caret sits ready for an @object mention. */
  prefill: string;
}

/** The curated command set. Order here is the order shown in the menu. */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "summarize",
    description:
      "Summarize an object or date range. BeakerBot counts, the model narrates.",
    prefill: "Summarize ",
  },
  {
    name: "plot",
    description: "Make a chart from a table or result set in the Data Hub.",
    prefill: "Make a chart from ",
  },
  {
    name: "cite",
    description: "Generate a formatted citation for a method, note, or sequence.",
    prefill: "Generate a citation for ",
  },
  {
    name: "digest",
    description:
      "Cross-type lab digest, experiments plus purchases plus notes for a period.",
    prefill: "Give me a lab digest for ",
  },
  {
    name: "setup",
    description:
      "Create an experiment from a method, schedule tasks, link a note, one step.",
    prefill: "Set up an experiment from ",
  },
  {
    name: "draft",
    description: "Draft a note or summary to review before BeakerBot writes it.",
    prefill: "Draft a note about ",
  },
];

/**
 * Detect a leading "/" command query in the composer text.
 *
 * Returns the lowercased query (the text after "/", which may be empty) when the
 * input is a single "/" token at the start with no whitespace yet, so the menu
 * stays open only while the user is still typing the command name. Returns null
 * once a space is typed (the command has been committed to prose) or when the
 * input does not start with "/".
 *
 * Examples:
 *   "/"        -> ""        (menu open, all commands)
 *   "/sum"     -> "sum"     (menu open, filtered)
 *   "/summarize " -> null   (space typed, menu closes)
 *   "hi /plot" -> null      (not at the start)
 */
export function parseSlashQuery(text: string): string | null {
  if (!text.startsWith("/")) return null;
  const rest = text.slice(1);
  // A space (or newline) means the command name is finished, stop matching.
  if (/\s/.test(rest)) return null;
  return rest.toLowerCase();
}

/** Filter the registry by a query (prefix-first, then substring). Empty query
 *  returns the full list in registry order. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  const prefix = SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
  const substring = SLASH_COMMANDS.filter(
    (c) => !c.name.startsWith(q) && c.name.includes(q),
  );
  return [...prefix, ...substring];
}
