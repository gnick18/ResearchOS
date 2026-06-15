// Prompt + output cleanup for the method phone-projection reformatter
// (method phone projection reformatter, Phase 2, 2026-06-14).
//
// The model's ONLY job is to re-structure a researcher's own free-form protocol
// markdown into clean, bench-readable markdown that the phone's deterministic
// parser (mobile/lib/method-read.ts parseBodyToSteps) already renders as proper
// steps: numbered steps, phase headings, reagent lists. It must change no value.
// The verbatim guardrail is enforced in code afterwards (reformat-validate.ts);
// this prompt makes a faithful result the model's default, so the validator
// rarely has to reject.
//
// We deliberately do NOT ask the model for a bespoke JSON step schema. Emitting
// tidied MARKDOWN means the existing phone parser is unchanged and the validator
// can compare plain text. Markdown in, tidier markdown out, same facts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export const REFORMAT_SYSTEM_PROMPT = `You restructure a researcher's own lab protocol into clean, bench-friendly markdown. You are a formatter, not an author or an editor.

ABSOLUTE RULES (a protocol is safety-critical, a wrong value ruins an experiment):
- Preserve every number, unit, temperature, time, volume, concentration, reagent name, and catalog number EXACTLY as written, character for character.
- Do not add, remove, merge, split, reorder, or paraphrase any value or instruction.
- Use ONLY words that already appear in the source text. Do not introduce new vocabulary, do not rename a reagent, do not add commentary, warnings, tips, or interpretation.
- Do not summarize and do not expand. Every instruction in the source must appear once in the output, unchanged.

WHAT YOU MAY DO (structure only):
- Number sequential actions as an ordered markdown list (1., 2., 3.).
- Promote a phase or section name that is ALREADY in the source to a "## Heading". Build a heading only from words present in the source.
- Turn a list of reagents or materials into a markdown bullet list, one item per line, keeping each amount with its reagent.
- Keep figure references (for example ![alt](path)) where they appear.
- The single structural labels "Materials" and "Step" may be used as section labels even if absent from the source.

OUTPUT: only the reformatted markdown. No preamble, no explanation, no code fences.`;

/** Build the user message: just the raw method body, framed minimally so the
 *  model treats the whole thing as the source to restructure. */
export function buildReformatUserMessage(body: string): string {
  return `Restructure this protocol into clean bench-friendly markdown, following every rule. Output only the markdown.\n\n---\n${body}`;
}

/** Strip a wrapping markdown code fence the model sometimes adds despite the
 *  instruction, and trim surrounding whitespace. Only removes a fence that wraps
 *  the WHOLE output, never an inner one. */
export function cleanReformatOutput(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fence) s = fence[1].trim();
  return s;
}
