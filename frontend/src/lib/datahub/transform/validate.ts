/**
 * datahub/transform/validate.ts
 *
 * Two small, pure helpers that keep raw engine internals away from researchers.
 *
 * recipeIssues runs BEFORE a recipe is compiled to SQL and surfaces the
 * predictable "you have not finished typing this rule yet" problems as short,
 * friendly hints (for example a numeric comparison with an empty operand). This
 * lets the builder skip a query it knows would fail rather than round-trip a raw
 * DuckDB conversion error to the screen.
 *
 * humanizeEngineError is the backstop for anything that still reaches the
 * preview. A DuckDB message arrives with a trailing SQL pointer ("LINE 1: ... ^")
 * and references to the engine's synthetic step aliases (__step1, __step2). Both
 * are meaningless to a researcher and leak query internals, so we strip them and
 * keep only the human-readable cause.
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import type { FilterCondition, FilterNode, TransformOp } from "./pipeline";

/**
 * The comparison operators that compare a column to the operand AS A NUMBER
 * (the SQL codegen wraps the column in TRY_CAST(... AS DOUBLE) for these). When
 * the operand is left empty or is not a number, the compiled query asks DuckDB
 * to convert that text to DOUBLE and it throws a Conversion Error. These are the
 * ops we validate up front.
 */
const NUMERIC_COMPARATORS: ReadonlySet<FilterCondition["op"]> = new Set([
  "lt",
  "le",
  "gt",
  "ge",
]);

/** A friendly hint for one leaf condition, or null when the condition is fine. */
function conditionIssue(cond: FilterCondition): string | null {
  if (NUMERIC_COMPARATORS.has(cond.op)) {
    if (typeof cond.value !== "number" || !Number.isFinite(cond.value)) {
      return "Enter a number to filter by, so the comparison has a value to test against.";
    }
  }
  return null;
}

/** Walk a filter tree and return the first leaf-condition issue, or null. */
function nodeIssue(node: FilterNode): string | null {
  switch (node.type) {
    case "condition":
      return conditionIssue(node.condition);
    case "not":
      return nodeIssue(node.child);
    case "and":
    case "or": {
      for (const child of node.children) {
        const issue = nodeIssue(child);
        if (issue) return issue;
      }
      return null;
    }
    default:
      return null;
  }
}

/** A friendly hint for one op, or null when the op has nothing to flag. */
function opIssue(op: TransformOp): string | null {
  if (op.kind === "filter") return nodeIssue(op.node);
  if (op.kind === "set-where") return nodeIssue(op.where);
  return null;
}

/**
 * Map each step index that has a blocking, friendly-to-explain problem to its
 * hint. An empty map means the recipe is safe to compile and run. The builder
 * uses this to short-circuit the preview query and to annotate the offending
 * step inline.
 */
export function recipeIssues(pipe: TransformOp[]): Map<number, string> {
  const issues = new Map<number, string>();
  pipe.forEach((op, i) => {
    const issue = opIssue(op);
    if (issue) issues.set(i, issue);
  });
  return issues;
}

/**
 * Turn a raw engine error string into something a researcher can read. Strips
 * the trailing "LINE n: ... ^" SQL pointer DuckDB appends and rewrites the
 * internal step aliases (__step1, __step2, ...) so no query internals leak.
 */
export function humanizeEngineError(raw: string): string {
  let msg = (raw ?? "").trim();
  // Drop everything from the SQL source pointer onward ("LINE 1: <sql> ^").
  const lineIdx = msg.search(/\bLINE\s+\d+\s*:/i);
  if (lineIdx !== -1) msg = msg.slice(0, lineIdx).trim();
  // Rewrite any internal step aliases that survived (no LINE pointer present).
  msg = msg.replace(/__step\d+/g, "the working table");
  // Remove a dangling caret and trailing punctuation noise.
  msg = msg.replace(/\s*\^\s*$/, "").trim();
  return msg.length ? msg : "The engine could not run this recipe.";
}
