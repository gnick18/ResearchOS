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
 * Wrap each selection range with `before` / `after`. For a non-empty range the
 * selected text is wrapped and stays selected (offset by the inserted prefix);
 * for a bare caret the empty pair is inserted and the caret lands BETWEEN the
 * delimiters so the user can type immediately. Insert-wrap (no toggle): this is
 * the hybrid-editor parity contract.
 */
function wrapCommand(before: string, after: string): StateCommand {
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
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

/**
 * The raw key bindings (key + run), exported so a test can assert the registered
 * key families without simulating a keydown.
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
