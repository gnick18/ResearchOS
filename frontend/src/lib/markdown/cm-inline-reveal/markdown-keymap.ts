/**
 * markdown-keymap.ts: the hybrid-parity markdown shortcut keymap for the CM6
 * inline editor (Typora editor chip 2b).
 *
 * This is the ONLY part of the inline-reveal arc that dispatches a doc-changing
 * transaction: every command here is user-initiated (a deliberate keypress).
 * The reveal / widget layers stay strictly view-only. Each command uses
 * EditorState.changeByRange so it works for every cursor in a multi-cursor
 * selection and lets CM6 map the resulting selection.
 *
 * The 8 hybrid shortcut families, matching the hybrid editor contract:
 *   - Mod-b        wrap with **..**        (bold)
 *   - Mod-i        wrap with *..*          (italic)
 *   - Mod-u        wrap with <u>..</u>     (underline, LITERAL tag, not _ , to
 *                                           preserve the two-form underline
 *                                           contract: _ stays the underscore
 *                                           form, the shortcut emits the literal)
 *   - Mod-Shift-x  wrap with ~~..~~        (strikethrough)
 *   - Mod-k        [sel](url) with the caret parked in the empty url slot
 *   - Mod-Shift-c  wrap with a fenced ```  code block (the code-fence combo)
 *   - Mod-1..6     toggle the heading marker (#..######) on the caret line
 *   - Ctrl-q       toggle the > blockquote marker on the caret line
 *
 * Insert-wrap parity is the contract (the hybrid editor is insert-wrap); a
 * type-over selection is wrapped, a bare caret inserts the empty pair with the
 * caret between the delimiters. The keymap is registered at Prec.high so it wins
 * over the markdown language + default keymaps.
 *
 * House style: no em-dashes, no emojis.
 */

import { EditorSelection, Prec } from "@codemirror/state";
import type { ChangeSpec, StateCommand } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { KeyBinding } from "@codemirror/view";

/**
 * Toggle each selection range with the `before` / `after` markers (Word-style):
 * wrap when not already wrapped, UNWRAP when it is. For EACH range, in priority
 * order:
 *
 *   1. UNWRAP-FROM-OUTSIDE: if the text immediately BEFORE the selection equals
 *      `before` AND immediately AFTER equals `after`, delete those outer markers
 *      and keep the inner text selected (an empty caret stays a caret where the
 *      content was). This is the key bug-fix case: an empty bold caret `**|**`
 *      toggles OFF to nothing instead of growing a second `**` pair.
 *   2. UNWRAP-FROM-WITHIN: else if the SELECTED text itself starts with `before`
 *      and ends with `after` (and is long enough to hold both), strip them,
 *      keeping the inner text selected.
 *   3. WRAP: else wrap with `before`/`after`. A non-empty selection stays
 *      selected (offset by the prefix); a bare caret lands BETWEEN the
 *      delimiters. This branch is byte-identical to the original insert-wrap.
 *
 * `*` vs `**` disambiguation: a single `*` (italic) marker must only count as
 * "wrapped from outside" when it is a LONE `*`, not the inner star of a `**`
 * (bold) pair. So for the outside check we require, when a marker is a single
 * "*", that the character just beyond the candidate marker is not also "*". That
 * keeps Cmd+I on the `bold` inside `**bold**` from stripping a bold star (it
 * would wrongly yield `*bold*`); instead italic there falls through to WRAP. The
 * `**` family needs no such rejection: unwrapping bold inside `***...***`
 * correctly leaves `*...*`, which is the desired toggle.
 */
function wrapCommand(before: string, after: string): StateCommand {
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);

      // --- 1. UNWRAP-FROM-OUTSIDE -------------------------------------------
      const outerFrom = range.from - before.length;
      const outerTo = range.to + after.length;
      if (
        outerFrom >= 0 &&
        outerTo <= state.doc.length &&
        state.sliceDoc(outerFrom, range.from) === before &&
        state.sliceDoc(range.to, outerTo) === after &&
        !isLoneStarViolation(state, before, after, outerFrom, outerTo)
      ) {
        // Remove the outer markers; keep the inner content selected (an empty
        // selection collapses to a caret sitting where the content was).
        return {
          changes: [
            { from: outerFrom, to: range.from, insert: "" },
            { from: range.to, to: outerTo, insert: "" },
          ],
          range: EditorSelection.range(outerFrom, outerFrom + text.length),
        };
      }

      // --- 2. UNWRAP-FROM-WITHIN ---------------------------------------------
      if (
        text.length >= before.length + after.length &&
        text.startsWith(before) &&
        text.endsWith(after)
      ) {
        const inner = text.slice(before.length, text.length - after.length);
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        };
      }

      // --- 3. WRAP (original insert-wrap behavior, unchanged) ---------------
      const insert = before + text + after;
      // Keep the original content selected; for an empty range this collapses
      // to a bare caret sitting between the delimiters.
      const start = range.from + before.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(start, start + text.length),
      };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.wrap" }));
    return true;
  };
}

/**
 * Guard for the UNWRAP-FROM-OUTSIDE check: a LONE-`*` marker (italic) must not
 * be matched when it is really the inner star of a `**` (bold) pair. When
 * `before`/`after` is the single character "*", require that the character just
 * BEYOND each candidate marker is not also "*"; otherwise the candidate `*` is
 * part of a `**` and italic must not strip it. Returns true when the match
 * should be REJECTED. Non-single-star markers (`**`, `~~`, `<u>`, ...) never
 * trigger the guard: unwrapping bold inside `***...***` correctly yields `*...*`.
 */
function isLoneStarViolation(
  state: EditorStateLike,
  before: string,
  after: string,
  outerFrom: number,
  outerTo: number,
): boolean {
  if (before === "*") {
    // Char just before the leading `*` (i.e. an outer `*` making it `**`).
    if (outerFrom - 1 >= 0 && state.sliceDoc(outerFrom - 1, outerFrom) === "*") {
      return true;
    }
  }
  if (after === "*") {
    // Char just after the trailing `*`.
    if (outerTo + 1 <= state.doc.length && state.sliceDoc(outerTo, outerTo + 1) === "*") {
      return true;
    }
  }
  return false;
}

/** The minimal slice of EditorState the lone-star guard needs. */
type EditorStateLike = {
  doc: { length: number };
  sliceDoc(from: number, to: number): string;
};

/**
 * The link command: wrap the selection as the link TEXT and append an empty
 * `(url)`, parking the caret inside the parentheses so the user types the URL
 * next. [selected]() with the caret between ( and ).
 */
const linkCommand: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}]()`;
    // Caret lands inside the empty parens: after `[text](`.
    const caret = range.from + 1 + text.length + 2;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(caret),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.wrap" }));
  return true;
};

/**
 * The fenced-code command: wrap the selection in a ```\n ... \n``` block. For a
 * bare caret it inserts an empty fence with the caret on the body line.
 */
const fencedCodeCommand: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = "```\n" + text + "\n```";
    // Caret after the opening fence + newline, i.e. start of the body line.
    const caret = range.from + 4 + text.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range:
        range.from === range.to
          ? EditorSelection.cursor(range.from + 4)
          : EditorSelection.range(range.from + 4, caret),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.wrap" }));
  return true;
};

/**
 * A line-prefix toggle command (headings, blockquote). For each selection range
 * it toggles `marker` (e.g. "## " or "> ") at the START of the caret line: if
 * the line already begins with EXACTLY that marker it is removed, otherwise any
 * existing same-family prefix is replaced and the marker is added. Family-aware
 * so Mod-2 on an existing `# ` line becomes `## ` rather than `## # `.
 */
function linePrefixCommand(marker: string, familyPrefix: RegExp): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = [];
    const seenLines = new Set<number>();
    for (const range of state.selection.ranges) {
      const line = state.doc.lineAt(range.head);
      if (seenLines.has(line.from)) continue;
      seenLines.add(line.from);
      const existing = line.text.match(familyPrefix);
      const existingLen = existing ? existing[0].length : 0;
      if (existing && existing[0] === marker) {
        // Exact same marker present: toggle it off.
        changes.push({ from: line.from, to: line.from + existingLen, insert: "" });
      } else {
        // Replace any same-family prefix (or none) with the new marker.
        changes.push({ from: line.from, to: line.from + existingLen, insert: marker });
      }
    }
    if (changes.length === 0) return false;
    dispatch(
      state.update({ changes, scrollIntoView: true, userEvent: "input.prefix" }),
    );
    return true;
  };
}

// Heading family: a leading run of 1..6 # followed by a space.
const HEADING_FAMILY = /^#{1,6} /;
// Blockquote family: a leading > optionally followed by a space.
const QUOTE_FAMILY = /^> ?/;

function headingCommand(level: number): StateCommand {
  return linePrefixCommand("#".repeat(level) + " ", HEADING_FAMILY);
}

/**
 * Step the heading level of every caret line up or down by one, mirroring the
 * hybrid editor's adjustHeadingLevelInBlock semantics so the rail's
 * "Heading Up" (Cmd/Ctrl+Alt++) and "Heading Down" (Cmd/Ctrl+Alt+-) shortcuts
 * behave identically in the inline editor:
 *
 *   - "up" (fewer hashes, larger heading): `### ` -> `## ` -> `# ` -> no heading.
 *     A non-heading line gains `# `.
 *   - "down" (more hashes, smaller heading): `# ` -> `## ` -> ... up to `###### `,
 *     which is the floor (level 6 stays). A non-heading line gains `## `.
 *
 * Family-aware (replaces any existing `#{1,6} ` prefix) so it never stacks
 * markers. One change per distinct caret line (multi-cursor safe).
 */
function headingStepCommand(up: boolean): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = [];
    const seenLines = new Set<number>();
    for (const range of state.selection.ranges) {
      const line = state.doc.lineAt(range.head);
      if (seenLines.has(line.from)) continue;
      seenLines.add(line.from);
      const existing = line.text.match(HEADING_FAMILY);
      const existingLen = existing ? existing[0].length : 0;
      const currentLevel = existing ? existing[0].trimEnd().length : 0;

      let nextMarker: string;
      if (up) {
        // Fewer hashes; at level 1 (or no heading) clear to plain text.
        nextMarker = currentLevel <= 1 ? "" : "#".repeat(currentLevel - 1) + " ";
        if (currentLevel === 0) nextMarker = "# ";
      } else {
        // More hashes; non-heading line becomes level 2 (hybrid parity), and
        // level 6 is the floor.
        if (currentLevel === 0) nextMarker = "## ";
        else if (currentLevel >= 6) nextMarker = "###### ";
        else nextMarker = "#".repeat(currentLevel + 1) + " ";
      }
      if (nextMarker === existing?.[0]) continue; // no-op (e.g. level-6 down)
      changes.push({ from: line.from, to: line.from + existingLen, insert: nextMarker });
    }
    if (changes.length === 0) return false;
    dispatch(
      state.update({ changes, scrollIntoView: true, userEvent: "input.prefix" }),
    );
    return true;
  };
}

/**
 * The named StateCommands behind the keymap, exported so they can be unit-tested
 * directly (invoking { state, dispatch }) without simulating a keydown, which is
 * brittle under jsdom. The keymap binds these at Prec.high.
 */
export const boldCommand: StateCommand = wrapCommand("**", "**");
export const italicCommand: StateCommand = wrapCommand("*", "*");
// LITERAL <u>..</u>, NOT the _ underscore form: the two-form underline contract
// keeps _ for the markdown form and the shortcut for the literal tag.
export const underlineCommand: StateCommand = wrapCommand("<u>", "</u>");
export const strikethroughCommand: StateCommand = wrapCommand("~~", "~~");
export { linkCommand, fencedCodeCommand };
export function headingCommandFor(level: number): StateCommand {
  return headingCommand(level);
}
export const blockquoteCommand: StateCommand = linePrefixCommand("> ", QUOTE_FAMILY);
// Heading-step commands behind the rail's "Heading Up" / "Heading Down" rows.
export const headingUpCommand: StateCommand = headingStepCommand(true);
export const headingDownCommand: StateCommand = headingStepCommand(false);

/**
 * The raw key bindings (key + run), exported so a test can assert the registered
 * key families without simulating a keydown.
 *
 * Heading Up / Down use the Cmd/Ctrl+Alt+ +/- combo the hybrid editor advertises.
 * CM6 normalizes the keypad / shifted forms, so we bind every glyph the platform
 * may report for "+" (Shift+=) and "-" so the shortcut fires regardless of layout:
 *   - Up:   Mod-Alt-=, Mod-Alt-Shift-=, Mod-Alt-+
 *   - Down: Mod-Alt--
 */
export const markdownKeyBindings: KeyBinding[] = [
  { key: "Mod-b", run: viewBinding(boldCommand) },
  { key: "Mod-i", run: viewBinding(italicCommand) },
  { key: "Mod-u", run: viewBinding(underlineCommand) },
  { key: "Mod-Shift-x", run: viewBinding(strikethroughCommand) },
  { key: "Mod-k", run: viewBinding(linkCommand) },
  { key: "Mod-Shift-c", run: viewBinding(fencedCodeCommand) },
  { key: "Mod-1", run: viewBinding(headingCommand(1)) },
  { key: "Mod-2", run: viewBinding(headingCommand(2)) },
  { key: "Mod-3", run: viewBinding(headingCommand(3)) },
  { key: "Mod-4", run: viewBinding(headingCommand(4)) },
  { key: "Mod-5", run: viewBinding(headingCommand(5)) },
  { key: "Mod-6", run: viewBinding(headingCommand(6)) },
  { key: "Ctrl-q", run: viewBinding(blockquoteCommand) },
  { key: "Mod-Alt-=", run: viewBinding(headingUpCommand) },
  { key: "Mod-Alt-+", run: viewBinding(headingUpCommand) },
  { key: "Mod-Alt-Shift-=", run: viewBinding(headingUpCommand) },
  { key: "Mod-Alt--", run: viewBinding(headingDownCommand) },
];

/**
 * The hybrid-parity markdown keymap, registered at Prec.high so it wins over the
 * markdown language indentation + the default keymap. Spread into the editor
 * AFTER the markdown language extension.
 */
export const markdownKeymap = Prec.high(keymap.of(markdownKeyBindings));

/**
 * Adapt a StateCommand to the (view) => boolean shape a KeyBinding.run expects.
 * StateCommand takes { state, dispatch }; the EditorView satisfies that shape,
 * so we forward state + the view dispatch.
 */
function viewBinding(cmd: StateCommand): (view: EditorView) => boolean {
  return (view: EditorView) =>
    cmd({ state: view.state, dispatch: (tr) => view.dispatch(tr) });
}
