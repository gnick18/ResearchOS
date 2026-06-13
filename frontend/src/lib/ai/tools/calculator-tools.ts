// BeakerBot custom-calculator tools (BeakerAI lane, 2026-06-13).
//
// Two deterministic read tools that let BeakerBot run the user's custom lab
// calculators without ever computing a number itself.
//
//   list_calculators   - returns every available calculator (own + shared) with
//                        its name, one-line description, and required input fields.
//                        The model uses this to learn what exists and what inputs
//                        each needs before calling run_calculator.
//
//   run_calculator     - given a calculator id or name and a map of input values,
//                        validates the inputs against the calculator's input defs,
//                        calls evaluateCustomCalculator, and returns the computed
//                        outputs with their labels, units, and pre-formatted display
//                        strings. The model copies those display strings verbatim.
//
// HARD RULE: the engine (evaluateCustomCalculator) owns every number. The model
// NEVER computes, re-derives, rounds, or guesses an output value. It only narrates
// what this tool returns. If a required input is missing, the tool says which ones
// are missing instead of substituting a default or guessing.
//
// Injectable deps seam: both tools resolve calculators and call evaluate through
// the deps object, so tests run with fixture calculators + a stubbed evaluate
// without touching the real FSA store.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { CustomCalculator } from "@/lib/types";
import {
  evaluateCustomCalculator,
  type CustomCalcInputValues,
  type CustomCalcResult,
} from "@/lib/calculators/custom";
import { fetchAllCalculatorsIncludingShared } from "@/lib/local-api";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam
// ---------------------------------------------------------------------------

export type CalculatorToolsDeps = {
  /** List all calculators the current user may see (own + shared-in). */
  listCalculators: () => Promise<CustomCalculator[]>;
  /** Evaluate a calculator against input values. Pure in production; stubbable
   *  in tests so the suite never needs a real parser or FSA folder. */
  evaluate: (calc: CustomCalculator, values: CustomCalcInputValues) => CustomCalcResult;
};

export const calculatorToolsDeps: CalculatorToolsDeps = {
  listCalculators: () => fetchAllCalculatorsIncludingShared(),
  evaluate: (calc, values) => evaluateCustomCalculator(calc, values),
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** One input field description returned to the model, so it can ask the user
 *  for exactly the right value before calling run_calculator. */
type InputFieldDesc = {
  key: string;
  label: string;
  type: "number" | "replicate" | "dropdown" | "table";
  unit?: string;
  /** For dropdown inputs, the available choices. */
  options?: Array<{ label: string; value: string | number }>;
  /** A non-blank default the user may keep; absent when there is no safe default
   *  (the model must prompt the user for the value). */
  defaultValue?: number | number[] | string;
};

/** Summary card for list_calculators. */
type CalculatorBrief = {
  id: number;
  name: string;
  description: string;
  field?: string;
  /** True when this calculator belongs to another lab member. */
  isShared: boolean;
  owner?: string;
  inputs: InputFieldDesc[];
};

/** One computed output row returned by run_calculator. */
type OutputResult = {
  label: string;
  /** The numeric value. NaN serialises to null in JSON, which the model must
   *  treat as a failed / incomplete computation. */
  value: number | null;
  /** Pre-formatted display string (the engine's formatCalcValueAs result).
   *  "—" signals a failed expression. The model copies this verbatim. */
  display: string;
  unit?: string;
};

function toInputFieldDesc(input: CustomCalculator["inputs"][number]): InputFieldDesc {
  const desc: InputFieldDesc = {
    key: input.key,
    label: input.label,
    type: input.type,
  };
  if (input.unit) desc.unit = input.unit;
  if (input.type === "dropdown" && input.options && input.options.length > 0) {
    desc.options = input.options.map((o) => ({ label: o.label, value: o.value }));
  }
  // Surface a default only for number + replicate types (dropdown defaults to its
  // first option implicitly and is already described via options above; table
  // inputs have seed rows that are too verbose to surface in a brief).
  if (input.type === "number" && typeof input.default === "number") {
    desc.defaultValue = input.default;
  }
  if (input.type === "replicate" && Array.isArray(input.default)) {
    desc.defaultValue = input.default as number[];
  }
  return desc;
}

function toBrief(calc: CustomCalculator): CalculatorBrief {
  return {
    id: calc.id,
    name: calc.name,
    description: calc.description || "",
    ...(calc.field ? { field: calc.field } : {}),
    isShared: calc.is_shared_with_me === true,
    ...(calc.owner ? { owner: calc.owner } : {}),
    inputs: calc.inputs.map(toInputFieldDesc),
  };
}

/** Resolve a calculator by id (number) or by name (case-insensitive prefix
 *  match) from a list. Returns the matched calculator or null. */
function resolveCalculator(
  calcs: CustomCalculator[],
  idOrName: unknown,
): CustomCalculator | null {
  if (typeof idOrName === "number") {
    return calcs.find((c) => c.id === idOrName) ?? null;
  }
  if (typeof idOrName === "string") {
    const needle = idOrName.trim().toLowerCase();
    // Exact match first.
    const exact = calcs.find((c) => c.name.toLowerCase() === needle);
    if (exact) return exact;
    // Prefix match as fallback (lets the user type the start of a long name).
    return calcs.find((c) => c.name.toLowerCase().startsWith(needle)) ?? null;
  }
  return null;
}

/** Validate supplied input values against the calculator's input defs.
 *  Returns a list of missing required input labels (those that have no supplied
 *  value AND no usable default the engine would fall back to). Dropdown and table
 *  inputs always have a fallback (first option / empty rows), so they are never
 *  flagged missing here. Number inputs with no default are required. Replicate
 *  inputs accept an empty list as a valid (if degenerate) value. */
function findMissingInputs(
  calc: CustomCalculator,
  values: CustomCalcInputValues,
): string[] {
  const missing: string[] = [];
  for (const input of calc.inputs) {
    if (input.type === "dropdown" || input.type === "table" || input.type === "replicate") {
      // These always have a usable fallback in the engine.
      continue;
    }
    // number input: required when the caller supplied nothing AND there is no
    // default to fall back on.
    const supplied = values[input.key];
    const hasSupplied =
      supplied !== undefined && supplied !== null && supplied !== "";
    const hasDefault = typeof input.default === "number";
    if (!hasSupplied && !hasDefault) {
      missing.push(input.label || input.key);
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Tool 1: list_calculators
// ---------------------------------------------------------------------------

export const listCalculatorsTool: AiTool = {
  name: "list_calculators",
  description:
    "List the user's available custom lab calculators (their own calculators plus any shared by lab members). " +
    "Returns each calculator's id, name, one-line description, optional field/category, and the full list of input fields " +
    "(key, label, type, unit, and dropdown options if applicable) so you know what exists and exactly what inputs to ask for " +
    "before calling run_calculator. " +
    "Call this first when the user asks to calculate something with one of their custom calculators, or when they ask " +
    "\"what calculators do I have?\" or \"can you run my dilution calculator?\". " +
    "Read-only, runs straight away, no approval step. " +
    "The tool only relays what is stored; it never invents a calculator or a field.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async () => {
    try {
      const calcs = await calculatorToolsDeps.listCalculators();
      const briefs = calcs.map(toBrief);
      return {
        ok: true as const,
        count: briefs.length,
        calculators: briefs,
      };
    } catch {
      return {
        ok: false as const,
        error: "Could not read the custom calculators. A folder may not be connected.",
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 2: run_calculator
// ---------------------------------------------------------------------------

export const runCalculatorTool: AiTool = {
  name: "run_calculator",
  description:
    "Run one of the user's custom lab calculators with a set of input values and return the computed outputs. " +
    "Call list_calculators first to learn the available calculators and their required inputs before calling this. " +
    "Pass the calculator id (preferred, unambiguous) or a name string. " +
    "Pass inputValues as a JSON object keyed by each input's key (from the input's `key` field, NOT its `label`). " +
    "For a number input the value is a number. For a replicate input the value is an array of numbers. " +
    "For a dropdown input the value is the option's value (a number or string). " +
    "For a table input the value is an array of row objects, each keyed by the column's key. " +
    "If a required input is missing, the tool tells you which inputs are still needed rather than guessing a value. " +
    "THE ENGINE OWNS EVERY NUMBER. You NEVER compute, round, re-derive, or guess an output value. " +
    "You copy the display string from each output row verbatim (it is already formatted by the engine). " +
    "A display of \"\\u2014\" means the expression failed (bad formula or missing variable), say so plainly. " +
    "Read-only (computes in memory, writes nothing to disk), runs straight away, no approval step.",
  parameters: {
    type: "object",
    properties: {
      calculatorId: {
        description:
          "The numeric id of the calculator to run (from list_calculators). " +
          "Preferred over calculatorName when you have the id, because names may not be unique.",
        type: "number",
      },
      calculatorName: {
        description:
          "The name of the calculator to run (case-insensitive, prefix match). " +
          "Use calculatorId when you have it.",
        type: "string",
      },
      inputValues: {
        description:
          "A JSON object mapping each input key (from list_calculators) to its value. " +
          "A number input: a number. A replicate input: an array of numbers. " +
          "A dropdown input: the option value (number or string). " +
          "A table input: an array of row objects keyed by column key. " +
          "Omit a key to use that input's default (if it has one). " +
          "Required number inputs with no default will be reported as missing.",
        type: "object",
        additionalProperties: true,
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const rawId = args.calculatorId;
    const rawName = args.calculatorName;
    const rawValues = args.inputValues;

    // At least one identifier must be provided.
    if (rawId === undefined && rawName === undefined) {
      return {
        ok: false as const,
        error: "Pass calculatorId (number) or calculatorName (string) to identify which calculator to run.",
      };
    }

    let calcs: CustomCalculator[];
    try {
      calcs = await calculatorToolsDeps.listCalculators();
    } catch {
      return {
        ok: false as const,
        error: "Could not read the custom calculators. A folder may not be connected.",
      };
    }

    const idOrName = rawId !== undefined ? (rawId as unknown) : (rawName as unknown);
    const calc = resolveCalculator(calcs, idOrName);
    if (!calc) {
      const tried = rawId !== undefined ? `id ${rawId}` : `name "${rawName}"`;
      const available = calcs.map((c) => `"${c.name}" (id ${c.id})`).join(", ") || "none";
      return {
        ok: false as const,
        error: `No calculator found for ${tried}. Available: ${available}.`,
      };
    }

    // Build the input values map, accepting whatever the caller supplied as a
    // plain object keyed by input key.
    const values: CustomCalcInputValues =
      rawValues && typeof rawValues === "object" && !Array.isArray(rawValues)
        ? (rawValues as CustomCalcInputValues)
        : {};

    // Validate: report missing required inputs rather than letting the engine
    // silently substitute NaN for a number the user forgot to pass.
    const missing = findMissingInputs(calc, values);
    if (missing.length > 0) {
      return {
        ok: false as const,
        missingInputs: missing,
        error:
          `The following inputs are required but were not supplied: ${missing.join(", ")}. ` +
          "Ask the user for those values then call run_calculator again.",
      };
    }

    // Delegate entirely to the engine.
    let result: CustomCalcResult;
    try {
      result = calculatorToolsDeps.evaluate(calc, values);
    } catch {
      return {
        ok: false as const,
        error: "The calculator engine encountered an unexpected error while evaluating.",
      };
    }

    const outputs: OutputResult[] = result.outputs.map((o) => ({
      label: o.label,
      // NaN cannot round-trip through JSON (serialises to null), so surface null
      // explicitly so the model knows the value is indeterminate.
      value: Number.isNaN(o.value) ? null : o.value,
      display: o.display,
      ...(o.unit ? { unit: o.unit } : {}),
    }));

    return {
      ok: true as const,
      calculatorId: calc.id,
      calculatorName: calc.name,
      outputs,
      /** Any non-empty guidance strings from the calculator's conditional rules
       *  (e.g. "Viability below 80%, check handling"). Relay these to the user
       *  verbatim alongside the outputs. */
      messages: result.messages,
    };
  },
};
