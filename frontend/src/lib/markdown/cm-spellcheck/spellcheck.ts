// CodeMirror 6 spell-check extension. Built on @codemirror/lint, which gives
// the underline + hover tooltip + click-to-fix UI for free, and on the lazy
// nspell checker in lib/spellcheck. This module is itself only ever imported
// dynamically by InlineMarkdownEditor, so @codemirror/lint + nspell stay out of
// the main bundle and only load with the editor chunk.
//
// Design constraints (launch-safe):
//   - Never throws into the editor: the lint callback is wrapped so any failure
//     yields zero diagnostics instead of breaking typing.
//   - Never touches code: fenced blocks, inline code, HTML tags/comments, and
//     link destinations are skipped, so protocols and pasted commands are quiet.
//   - Bounded work: at most MAX_FLAGGED words get the (slower) suggest() call
//     per lint pass, so a note full of jargon can't stall the editor.

import { linter, forceLinting, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import {
  getSpellChecker,
  shouldCheckToken,
  addUserWord,
} from "@/lib/spellcheck/spellchecker";

const MAX_FLAGGED = 200;
const MAX_SUGGESTIONS = 5;

// Regions whose text we never spell-check. Order does not matter; ranges are
// merged. Each regex is scanned over the whole document once per lint pass.
const SKIP_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/g, // fenced code blocks
  /`[^`\n]+`/g, // inline code
  /<!--[\s\S]*?-->/g, // HTML comments (our <!-- stamp --> markers)
  /<[^>\n]+>/g, // HTML tags (raw <img>, <u>, attributes)
  /\]\([^)\n]*\)/g, // markdown link / image destinations: ](...)
];

interface Range {
  from: number;
  to: number;
}

/** Build the merged, sorted set of character ranges to skip. */
function computeSkipRanges(text: string): Range[] {
  const raw: Range[] = [];
  for (const re of SKIP_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      raw.push({ from: m.index, to: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++; // guard against zero-width loops
    }
  }
  if (raw.length === 0) return raw;
  raw.sort((a, b) => a.from - b.from);
  const merged: Range[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    if (raw[i].from <= last.to) {
      last.to = Math.max(last.to, raw[i].to);
    } else {
      merged.push(raw[i]);
    }
  }
  return merged;
}

// Word tokens: a letter-run, allowing internal apostrophes (don't, 5'). Digits
// and symbols break the run, so "72C" / "pH7" never tokenize as a word.
const WORD_RE = /[A-Za-z][A-Za-z'’]*/g;

/**
 * The async lint source. Walks word tokens outside skip ranges, asks the
 * checker, and emits a warning diagnostic with click-to-fix actions for each
 * misspelling. Wrapped so it can never throw into the editor.
 */
async function spellLintSource(
  view: import("@codemirror/view").EditorView,
): Promise<Diagnostic[]> {
  try {
    const checker = await getSpellChecker();
    if (!checker) return [];
    const text = view.state.doc.toString();
    const skip = computeSkipRanges(text);
    const diagnostics: Diagnostic[] = [];
    let skipIdx = 0;
    let flagged = 0;

    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text))) {
      if (flagged >= MAX_FLAGGED) break;
      const word = m[0];
      const from = m.index;
      const to = from + word.length;

      // Advance the skip pointer past ranges that end before this word.
      while (skipIdx < skip.length && skip[skipIdx].to <= from) skipIdx++;
      if (skipIdx < skip.length && skip[skipIdx].from < to) continue; // inside a skip range

      if (!shouldCheckToken(word)) continue;
      if (checker.correct(word)) continue;

      flagged++;
      const suggestions = checker.suggest(word).slice(0, MAX_SUGGESTIONS);
      diagnostics.push({
        from,
        to,
        severity: "warning",
        source: "spellcheck",
        markClass: "cm-spell-error",
        message: suggestions.length
          ? "Possible misspelling"
          : "Possible misspelling (no suggestions)",
        actions: [
          ...suggestions.map((s) => ({
            name: s,
            apply(v: import("@codemirror/view").EditorView, a: number, b: number) {
              v.dispatch({ changes: { from: a, to: b, insert: s } });
            },
          })),
          {
            name: "Add to dictionary",
            apply(v: import("@codemirror/view").EditorView) {
              addUserWord(word);
              // The doc did not change, so force a re-lint to clear every
              // instance of the now-known word immediately.
              forceLinting(v);
            },
          },
        ],
      });
    }
    return diagnostics;
  } catch {
    return [];
  }
}

/**
 * The spell-check extension to spread into the editor. Caller decides whether
 * to include it (gated on the user's pref). `delay` debounces re-linting so we
 * are not tokenizing on every keystroke.
 */
export function spellcheckExtension(): Extension {
  return linter(spellLintSource, { delay: 600 });
}
