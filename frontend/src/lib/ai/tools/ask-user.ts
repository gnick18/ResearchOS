// BeakerBot ask_user tool (ai ask-user bot, 2026-06-11).
//
// The structured-choice primitive. When BeakerBot needs the user to pick from a
// KNOWN, SMALL, ENUMERABLE set (which two groups to compare, which table, which
// of a few tests, yes or no), it should NOT ask them to type the answer back in
// prose. It calls ask_user with the question and the options, and the panel
// renders a button per option. The user TAPS instead of typing, so the model
// gets a structured choice (the exact option string, never a fuzzy free-text
// reply it has to re-parse).
//
// Why a coordination tool, not an action tool. ask_user changes nothing in the
// user's data and never clicks anything. It IS its own user-input pause, the same
// way propose_plan IS the plan gate. So it carries no `action` flag and the loop
// special-cases it by name through ASK_USER_TOOL_NAME, raising a "choice" request
// on the SAME pause/resume bridge propose_plan and the action confirm use. It must
// not flow through the per-action approval gate (there is nothing to approve, the
// user is choosing, not allowing).
//
// Single vs multiple. `select` defaults to "one", a single click resolves
// immediately with that one option. "multiple" lets the user toggle chips and
// press Confirm, and an optional `count` pins the EXACT number to pick (for
// example exactly 2 for a two-group t-test), so the panel only enables Confirm at
// that count. A dismiss resolves with a graceful "the user did not choose" result
// the model can handle without fabricating an answer.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { AiTool, ChoiceSelect } from "./types";

// The one name the loop recognizes as the ask-user tool, so the special handling
// and the registry never drift apart on a literal string.
export const ASK_USER_TOOL_NAME = "ask_user";

/** The typed, validated view of the model's ask_user arguments. */
export type AskUserArgs = {
  question: string;
  options: string[];
  select: ChoiceSelect;
  /** The exact number to pick, for "multiple" only. Undefined means any count
   *  from 1 up. */
  count?: number;
};

/** Pull the question, returning an empty string when missing or blank so the
 *  caller can decline gracefully. Pure. */
export function readQuestion(args: Record<string, unknown>): string {
  return typeof args.question === "string" ? args.question.trim() : "";
}

/** Pull the options, keeping only non-empty trimmed strings and dropping exact
 *  duplicates, so a malformed or empty option never reaches the UI. Pure. */
export function readOptions(args: Record<string, unknown>): string[] {
  const raw = args.options;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const o of raw) {
    if (typeof o !== "string") continue;
    const trimmed = o.trim();
    if (trimmed.length === 0) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** Read the select mode, defaulting to "one" for any value that is not the
 *  literal "multiple". Pure. */
export function readSelect(args: Record<string, unknown>): ChoiceSelect {
  return args.select === "multiple" ? "multiple" : "one";
}

/** Read the optional exact count, returning undefined unless it is a positive
 *  integer. Pure. Only meaningful for "multiple". */
export function readCount(args: Record<string, unknown>): number | undefined {
  const raw = args.count;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return undefined;
  }
  return raw;
}

/** Parse the loose tool args into a typed, validated AskUserArgs. A "one"
 *  selection never carries a count (it is always exactly one). */
export function parseAskUserArgs(args: Record<string, unknown>): AskUserArgs {
  const select = readSelect(args);
  return {
    question: readQuestion(args),
    options: readOptions(args),
    select,
    ...(select === "multiple" ? { count: readCount(args) } : {}),
  };
}

export const askUserTool: AiTool = {
  name: ASK_USER_TOOL_NAME,
  description:
    "Ask the user to choose from a known, small, enumerable set of options, so they TAP a button instead of typing the answer back. Use this whenever the answer is one of a few specific known values, for example which two groups to compare, which table to use, which of a few tests to run, or a yes or no. Pass the question and the list of options. Set select to \"one\" (the default) when the user picks a single option, or \"multiple\" when they pick several, and set count to the exact number to pick when you need a precise subset (for example count 2 to compare exactly two groups). This returns the option or options the user chose, so continue with their real choice. If the user dismisses without choosing, this returns chosen false, so ask again or stop, do not invent a choice. Do not use this for genuinely free-form input that is not a small known set, plain prose is fine there.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The question to show above the choices, a short plain sentence, for example \"Which two groups would you like to compare?\".",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description:
          "The choices to show as buttons, each a short human label, for example [\"Control\", \"Drug A\", \"Drug B\"]. Keep this to a small known set.",
      },
      select: {
        type: "string",
        enum: ["one", "multiple"],
        description:
          "\"one\" (the default) when the user picks a single option, a tap resolves immediately. \"multiple\" when the user picks several, they toggle chips and confirm.",
      },
      count: {
        type: "number",
        description:
          "For select \"multiple\", the exact number of options to pick, for example 2 to compare exactly two groups. Omit to allow any number from one up.",
      },
    },
    required: ["question", "options"],
    additionalProperties: false,
  },
  // No `action` flag and no real side effect. The loop owns this tool's behavior
  // (raising the choice request on the shared bridge and returning the selection)
  // by name through ASK_USER_TOOL_NAME, so execute is never actually called for
  // it. It is defined as a fail-safe, if the loop ever dispatched it directly it
  // would report that no choice path was reached, never silently invent a pick.
  execute: async (args) => {
    const parsed = parseAskUserArgs(args);
    return {
      chosen: false,
      options: parsed.options,
      message:
        "The choice was not presented to the user. Do not pick on their behalf, ask the user directly how they would like to proceed.",
    };
  },
};
