# Hybrid editor v2: proposal

> Scope: this proposal scopes the **v2 redesign** of the hybrid
> markdown editing surface (`frontend/src/components/HybridMarkdownEditor.tsx`,
> ~2,124 LOC). v1 is the "click-to-edit per parser-block" model that
> shipped before the bug sequence of 2026-05-18 to 2026-05-19
> (`f699993d` paste/focus, `f894f7c7` blank-line wrap, `f60448e6`
> cursor sync, plus the open Enter-fragmentation pain Grant reported
> 2026-05-20). v2 changes the editing primitive itself, not the
> sanitize / parser / four-render-path surfaces around it. The v1
> bug arc traces all five symptoms to a single architectural fault:
> the parser splits paragraphs at whitespace, the user splits
> paragraphs at intent, and the two diverge on every Enter
> keystroke. This document does not write code; the manager builds
> chip briefs after Grant locks the thesis + the design questions
> in §4.

---

## 1. Executive summary

1. **The current model is structurally broken at the
   parser-vs-intent seam.** v1's `HybridMarkdownEditor` re-parses
   the document on every keystroke and treats each parser-block
   ("paragraph", "heading", "blankLine", etc.) as an independent
   edit surface keyed by its `startOffset`. The parser sees
   paragraph boundaries wherever the CommonMark spec dictates
   (blank lines, list breaks, code-fence boundaries). The user
   sees paragraph boundaries wherever they think a thought ends.
   These two views are coupled by `editingBlockOffset` state +
   `editingBlockOriginalLengthRef`, both of which become stale the
   instant a keystroke alters block boundaries. Every fix landed
   2026-05-18 / 19 is a patch around one specific divergence
   pattern. There are more divergence patterns than landed
   patches.

2. **The Enter-fragmentation bug Grant raised 2026-05-20 cannot be
   patched the same way.** Pressing Enter inside an existing
   paragraph then clicking out re-parses the document into N
   parser-blocks where the user wrote one thought. The
   blank-line-wrap heuristic from `f894f7c7` is forward-only (a
   blank-line block becoming a paragraph) and does not help the
   reverse case (one paragraph becoming several). Smart-merging on
   edit-exit (option B in §3) helps but only for paragraph splits,
   not for list / heading / code-block transitions. The class of
   bug is structural.

3. **Recommended thesis: (C) soft-line-break model with explicit
   block split.** Inside the active edit run, Enter is a soft
   break (renders as `<br/>`, parses as a within-paragraph line
   break, persists as a trailing-two-space Markdown soft break OR
   as a literal `\n` inside one paragraph). A new explicit
   affordance (a "Split into new paragraph" button on the floating
   block menu + a keyboard shortcut like Shift+Enter or Ctrl+Enter)
   splits one block into two. This matches how Notion / Bear /
   Typora handle the same UX question; it is the smallest viable
   change that kills the parser-vs-intent divergence at root; it
   keeps the existing per-block edit-textarea primitive (so the
   `ValueHistory` undo wiring, paste handling, language selector,
   image resize, drag-drop, file-link click, "+ Add paragraph",
   single-vs-double-click selection, and the four-render-path
   sanitize coupling all survive intact). Effort estimate: **M**
   (1,200–1,800 LOC delta, mostly inside `HybridMarkdownEditor.tsx`
   + the markdown-block-parser). The (A) contenteditable WYSIWYG
   thesis is the right long-term answer but is **L** (4,000–6,000
   LOC delta, six-to-eight chips, IME / paste / selection
   browser-variance surfaces); recommended as a v3 arc, not v2.

4. **The runners-up in order: (B) smart block merging on edit-exit,
   (E) single textarea + live side-by-side rendering, (A)
   contenteditable WYSIWYG, (D) user-controlled block grouping.**
   (B) fixes the immediate Enter-fragmentation pain with the
   smallest delta (~200 LOC) but doesn't generalize. (E) is a
   different UX feel ("source on left, preview on right") that
   would dilute the hybrid mode's identity; some users like it,
   others (Grant per past chat) don't. (A) is correct
   architecturally but expensive. (D) puts the burden on the user.
   Detail in §3.

5. **Migration cost for the recommended (C) thesis is light.** No
   on-disk Markdown format change is required if we persist soft
   breaks as two-trailing-spaces (CommonMark-canonical) or as
   literal `\n` (already round-trips through all four render
   paths). Existing notes / results / experiments load and render
   identically. The AI Helper full.md schema extraction reads
   `frontend/src/lib/markdown-block-parser.ts` only at editor
   time, never at content time, so the helper output is
   unaffected. Detail in §6.

6. **Single biggest risk: undo/redo step boundaries on soft-break
   keystrokes.** `ValueHistory` from `c2127bdc` uses a
   boundary-char set including `\n` so the next push after a
   newline starts a fresh undo step. With (C), Enter inside a
   block is a soft break that ALSO inserts `\n` into the document
   buffer. Without an adjustment, the undo step boundary fires
   exactly when the user least expects it (Cmd+Z reverts only the
   final word of a multi-line paragraph). Mitigation: soft-break
   `\n` is treated as non-boundary inside the active edit run;
   only the explicit-split affordance flushes a boundary. The
   primitive supports this via the existing `flushBoundary` API
   without modifying value-history's internals. Detail in §6.5.

---

## 2. Current model and pain points

This section catalogs every divergence pattern the source surfaces.
The first four are the four bug SHAs already landed. The fifth is
the open Enter-fragmentation pain. The remainder are edge cases
that surfaced in the deep read of `HybridMarkdownEditor.tsx` and
that v1's patches do not address; some are latent today, some are
already user-visible.

### 2.1 The bug timeline (verified)

| SHA | Symptom | Root cause | Patch shape |
|---|---|---|---|
| `f699993d` | Paste into existing block loses focus | Aggressive `onBlur` on the per-block textarea tore down edit mode on transient blur (clipboard subsystem, accessibility probe, browser extension). | Remove `onBlur`; rely on Escape + document-level click-outside as explicit exit signals. Re-key the textarea container by `editingBlockOffset` (state) not `block.startOffset` (parsed value). |
| `f894f7c7` | Typing into a blank-line block loses focus after 1 char | Parser merges typed content with neighboring paragraphs the moment the blank-line separator disappears. The block at `editingBlockOffset` no longer exists in the next parse; `renderBlock` matches no block; no textarea; focus dies. | Detect first non-blank keystroke into `block.type === "blankLine"`; wrap the typed content in `"\n" + ... + "\n"`; shift `editingBlockOffset` by 1. |
| `f60448e6` | Cursor lands at position 0 after wrap-with-newlines | The `editingBlockOffset` change above re-keys the textarea container, forcing React to remount. The post-mount focus effect reads `editCursorPosition`, which is still the stale 0 set on blank-line entry; cursor lands BEFORE the typed character; subsequent keystrokes prepend ("estT" instead of "Test"). | Sync `editCursorPosition` to `newContent.length` inside the wrap branch. |
| Open (Grant 2026-05-20) | Pressing Enter in a paragraph then clicking out fragments the original "one thought" into multiple parser-blocks | The user presses Enter to insert a visual break (line break, not paragraph break). The textarea contains `"Line A\n\nLine B"`. On exit, the parser sees `\n\n` and splits into two paragraph blocks at two different `startOffset`s. Next entry into either fragment edits only that fragment; the original thought is structurally split. | None landed. Patching `f894f7c7`-style is forward-only and does not cover this case. |

All four landed SHAs verified on local main via:

```
git log --oneline main | grep -E "f699993d|f894f7c7|f60448e6|c2127bdc"
```

Output:

```
c2127bdc markdown editors: app-level undo/redo via ValueHistory primitive
f60448e6 HybridMarkdownEditor: sync editCursorPosition in wrap-with-newlines path
f894f7c7 HybridMarkdownEditor: wrap-with-newlines on first non-blank keystroke into a blank-line block
f699993d Cherry-pick HybridMarkdownEditor paste/focus fix from claude/cranky-banzai-19835c
```

### 2.2 The structural root cause

Every patched bug AND the open one trace to the same architectural
fault. The editor stores three coupled pieces of state:

```
editingBlockOffset      // user intent: "I'm editing the block at offset N"
editingBlockContent     // user intent: "the textarea's current value"
editingBlockOriginalLengthRef  // parser stake: "the block at offset N was M chars wide on entry"
```

And one derived view:

```
blocks = parseMarkdownBlocks(value)
editingBlock = blocks.find(b => b.startOffset === editingBlockOffset)
```

The contract is: the block at `editingBlockOffset` in the next
parse is the same logical block the user is editing.

The contract is violated whenever a keystroke changes the block
boundary structure. Insert `\n\n` and one block becomes two.
Remove the blank-line separator above and two blocks become one.
Open a fenced code block (`\`\`\``) and a paragraph becomes a code
block with possibly different boundaries. Add a leading `# ` and a
paragraph becomes a heading.

The v1 patches each detect one specific structural transition and
either rewrite the buffer to preserve boundaries (`f894f7c7`) or
re-anchor the offset to the new block (`f60448e6`). There is no
general pattern. Every new structural transition needs a new
patch. The class of bug is not closeable by patching.

### 2.3 Cataloged edge cases (beyond the bug timeline)

Each behavior below was surfaced by a deep read of the source.
File references are to `frontend/src/components/HybridMarkdownEditor.tsx`
unless otherwise stated.

#### 2.3.1 "+ Add paragraph" button (lines 2019-2054)

Behavior: appends `\n\n` (or `\n` if value already ends in newline)
to the document; on next render, finds the last blank-line block by
re-parsing inside a `setTimeout(0)`; enters edit on it. Sets
`editingBlockOriginalLengthRef.current = lastBlock.content.length`
to head off the originalLength staleness that `4f4a7a29` discovered
the hard way (closed at `f894f7c7`).

Latent: the setTimeout(0) couples to React's commit cycle, which is
strict-mode-double-invocation unsafe and would break under
React 18 strict-mode rerenders. No current strict-mode warning
because Next.js's dev mode does not strict-mode this surface, but
the pattern is fragile.

In v2: replace with a stable affordance that doesn't depend on
re-parse + race.

#### 2.3.2 Language selector popup (lines 444-451, 768-805, 2058-2098)

Behavior: detects when the user just typed exactly `` ``` `` at the
start of a line inside the editing textarea (line 902), pops a
floating language selector positioned via
`textareaRef.current.getBoundingClientRect()` + a hard-coded `lineHeight = 20`
and `charWidth = 8`. Selecting a language splices the code into the
textarea content via a separate `pushAndCommit` (paste-kind).

Latent: hard-coded line height + char width breaks under any font
size override (browser zoom, accessibility settings, Tailwind
config drift). Position can land off-screen or under the cursor.
The popup also relies on a document-level mousedown handler
(`useEffect` at line 571) that conflicts with the document-level
click-outside handler (line 1334) that exits edit mode.

In v2: keep the language-selector affordance but route it through
a coordinate-aware floating-ui primitive (`@floating-ui/react`
exists in the dep set already, used by Tooltip). Separate concern
from the core thesis but worth surfacing.

#### 2.3.3 Image resize popover (lines 453-461, 1364-1391, 1671-1685, 2101-2110)

Behavior: clicking a rendered `<img>` inside a preview block opens
`ImageResizePopover`. The popover writes back to the block content
by calling `rewriteImageBySrcAlt(block.content, src, alt, width)`
then splicing the new block content over `[startOffset,
startOffset+content.length)` of `value` and calling `onChange`
directly (NOT through `pushAndCommit`, line 1388).

Latent: bypasses the `ValueHistory` stack. Image resize is the
explicit out-of-scope case noted at `c2127bdc`. Acknowledged tech
debt. v2 should route this through `pushAndCommit` as a paste-kind
step.

#### 2.3.4 File-link click handlers (lines 714-748)

Behavior: clicks on `[name](Files/…)` links inside a preview block
trigger `handleFileLinkClick` which classifies the file (download
vs viewer) and either downloads via blob URL or opens a
`FileViewerModal`. Mirrors `LiveMarkdownEditor`'s preview-mode
handler.

In v2: unchanged. File-link click is a preview-block concern; v2's
edit-run primitive doesn't intersect with it.

#### 2.3.5 Drag-drop file/image handlers (lines 1508-1542, 1646-1669)

Behavior: two separate drop targets. The outer block accepts
`application/x-research-os-image` (inter-app image references from
the attachment sidebar). The inner `<img>` accepts `Files` (native
OS file drops). The inner handler must `stopPropagation` to bypass
Chrome's "drop on `<img>`" default behavior, which would otherwise
replace the image's src.

Latent: the outer drop calls `onChange` directly (line 1541), again
bypassing `pushAndCommit`. Same out-of-scope category as image
resize.

In v2: unchanged structurally; route through `pushAndCommit` for
undo-stack hygiene.

#### 2.3.6 Single-click select vs double-click edit (lines 810-859)

Behavior: single-click on a preview block sets
`selectedBlockOffset` (shows a blue selection halo + an inline
Edit/Delete action chip at `top-right`). Double-click on the same
block calls `handleBlockEdit` which transitions to editing.
Keyboard handler (line 594) on selected-but-not-editing blocks
catches Delete/Backspace (deletes the block), Enter (enters edit),
Escape (clears selection).

Edge case: clicking a block while another block is being edited
calls `handleBlockSelect`, which committed-and-exits the active
edit before applying selection to the new block (lines 817-823).
This was added in `f699993d` to replace the deleted `onBlur`
contract: without it, click-to-different-block left the textarea
mounted but no selection halo.

Subtle: the click-event ordering is:
1. `document.mousedown` (click-outside handler, line 1335) fires
   first → calls `handleEditBlur` → tears down edit state
2. `div.onClick` (handleBlockSelect, line 1500) fires next →
   `editingBlockOffset === null` so the "exit other block first"
   branch doesn't fire → applies selection directly

Both paths converge to the right state today but the order is
non-obvious. Refactors must preserve it.

In v2: with the recommended (C) thesis, single-click vs
double-click contract survives intact. Selection halo + action
chip moves with the affordance.

#### 2.3.7 Mode switches edit ↔ hybrid ↔ preview (out of file)

Behavior: `LiveMarkdownEditor` (parent) maintains a `viewMode`
state that toggles between three children: a plain textarea for
edit mode, this `HybridMarkdownEditor` for hybrid, a rendered
preview for preview-only. Switching modes unmounts the active
child; this child loses all internal state (`editingBlockOffset`,
`editingBlockContent`, the textareaRef, the helperPanel collapse
state, etc.) AND the helperPanel `helperCollapsed` flag (line 444).

Latent: on the next entry into hybrid mode, the
`useState(false)` initializer at line 444 always re-collapses the
helper panel even if the user had it expanded last session. Minor
UX papercut, not a v2 blocker.

The `ValueHistory` is owned by `HybridMarkdownEditor` (line 484-487)
and lives ONLY for the lifetime of this component, which means
switching modes wipes the undo stack. `LiveMarkdownEditor` also
owns its own `ValueHistory` per `c2127bdc`. Cmd+Z does not span
mode switches.

In v2: out of scope per the brief's §7 reminder ("not edit mode,
not preview mode, not the parser, not the sanitize schema").
Surface for future hardening.

#### 2.3.8 Interactions with the `ValueHistory` primitive

`ValueHistory` (`frontend/src/lib/undo/value-history.ts:1-179`)
coalesces typing within 500ms idle into one undo step. Boundary
chars (whitespace + common punctuation) force the next push to
start a new step. Paste is always one step. `flushBoundary` is
called explicitly on edit-mode exit (line 1021), on
`editingBlockOffset` change (lines 524-526), and the editor
documents at line 985 that the wrap-with-newlines block emergence
flushes as a paste-kind step so a single Cmd+Z reverts the
synthetic newlines.

For v2's recommended thesis (C):

- Soft-break `\n` keystrokes inside the active edit run must NOT
  force a fresh undo step. Today, `\n` is in the default
  `boundaryChars` set (`" \t\n.,;:!?\"'-()[]{}"`). A naive
  Enter-as-soft-break implementation would mean Cmd+Z reverts only
  the last word after a multi-line paragraph.
- Mitigation: `ValueHistory` accepts a custom `boundaryChars` via
  options. The hybrid editor instantiates its `ValueHistory` with
  the default-minus-`\n` set. Live editor (`LiveMarkdownEditor`)
  keeps the default. Soft-break does not flush; explicit split
  flushes via `flushBoundary()`.
- No changes to `value-history.ts` itself. The opts surface
  already exists and is unused.

Detail in §6.5.

### 2.4 What v1 got right

The architectural fault is not "the model is wrong everywhere."
Specifically, v1 got the following right and v2 should preserve
them:

- **One full-document textarea is wrong for this UX.** A single
  textarea cannot render images, headings, lists, code blocks with
  syntax highlighting, etc. in-place. The original motivation for
  per-block-editing-on-click is correct.
- **Preview-default with per-block edit-on-click is a real
  improvement over edit-or-preview-but-not-both.** Users
  consistently report it feels more like Notion / Bear than like a
  raw Markdown editor.
- **Block selection + delete + keyboard navigation is useful.**
  The selection halo + Edit/Delete chip on single-click is good UX
  and v2 should keep it.
- **Drag-drop, file-link click, image resize work today.** These
  are surface-level affordances on top of the preview block; the
  v2 redesign should not regress them.

The fault is specifically in how the model handles the **transitions
between blocks** during edit. v2's job is to make that transition
explicit and user-controlled, not parser-controlled.

---

## 3. Proposed redesign options

Five distinct theses, each with the same set of axes: UX feel,
technical mechanism, pros, cons, migration cost, effort, undo-redo
compatibility.

### 3.1 Option (A): Contenteditable-style WYSIWYG

#### 3.1.1 Thesis

The document is one `<div contenteditable="true">` with rich
inline rendering: headings show as `<h1>` / `<h2>` etc., bold
shows as bold, images show as images, lists as lists. The user
edits the rendered output directly. Markdown is the
serialization format on save, NOT the runtime representation.
This is Notion's model, Obsidian's "Live Preview", and the
underlying engine of every modern WYSIWYG markdown editor.

#### 3.1.2 Technical mechanism

Adopt or build a contenteditable framework. The two realistic
options on the React stack are:

- **TipTap** (ProseMirror-based, MIT, React bindings, ~140kb
  gzipped runtime). Mature; large extension library; markdown
  export via the markdown extension; supports tables, code blocks
  with syntax highlighting, images, embeds.
- **Lexical** (Meta's editor, MIT, React bindings, ~80kb gzipped
  core + per-feature plugin weight). Newer; less mature markdown
  story; faster than ProseMirror in benchmarks.

Both require: replacing the per-block textarea model entirely; a
new content-model layer that maps between the editor's internal
document tree and our on-disk Markdown string; reimplementation
of every existing affordance (image resize popover, file-link
click, drag-drop, language selector) as plugins; full IME
support; cursor + selection management; clipboard / paste
sanitization.

#### 3.1.3 Pros

- Kills the parser-vs-intent divergence completely. There is no
  separate parser; the editor's internal tree IS the source of
  truth.
- Enables UX wins that are structurally impossible in v1: inline
  rich-text drag handles, slash commands ("/" to insert a heading
  / table / image), real-time collaborative cursors, inline
  embeds, native mentions.
- Solves IME + accessibility once and for all (the underlying
  framework owns those).
- Industry-standard model; reduces "feels weird vs. Notion" user
  complaints to zero.

#### 3.1.4 Cons

- Massive surface area. ProseMirror / Lexical have their own
  abstractions (nodes, marks, transactions, plugins, schemas) that
  the team has to learn. The existing affordances need to be
  re-expressed as plugins.
- Markdown serialization round-trips are lossy in edge cases. Code
  fences with custom info strings, footnotes, math, HTML
  passthrough: each one is a known sharp edge in both TipTap and
  Lexical.
- Sanitization story changes: today the sanitize schema applies at
  render time on `<ReactMarkdown>`. With contenteditable, the
  schema applies at paste-from-clipboard time AND at load time
  AND at every undo restore. The brief says the sanitize schema
  must remain untouched, which is true in spirit, but the
  attack surface shifts and the security manager will need to
  re-audit. (Security manager has standing role per AGENTS.md
  §8.)
- Browser variance is real and ongoing. Safari's contenteditable
  selection model differs from Chrome's; Firefox has its own
  quirks. Both ProseMirror and Lexical work hard to paper over
  these, but the leakage is non-zero.
- `ValueHistory` is wrong shape for this. ProseMirror has a
  transaction-based history that owns step coalescing internally.
  Wiring our `ValueHistory` on top would double-undo; ditching
  ours means losing the existing test coverage and the cross-mode
  flushBoundary contract.

#### 3.1.5 Migration cost

- Existing notes / results / experiments: Markdown-on-disk shape
  unchanged; load-time round-trip through TipTap / Lexical's
  Markdown parser. Most content round-trips clean, but tables
  with complex alignment, footnotes, and HTML passthrough may not.
  Need a migration audit per content type. Plausible budget: one
  full sub-bot day to identify the round-trip failure modes plus
  a one-time content sweep with logged diffs.
- Surrounding popup chrome (helper panel, action chip, edit/delete
  affordances): all need rebuilding within the framework's idioms.

#### 3.1.6 Effort estimate: **L**

4,000–6,000 LOC delta. Six-to-eight chips:
- Phase 0: framework selection + spike (one full chip)
- Phase 1: core node types (paragraph, heading, list, code, table,
  image, blockquote, thematic break)
- Phase 2: paste handling + markdown round-trip
- Phase 3: IME + selection + accessibility audit
- Phase 4: re-implement language selector, image resize, file
  link, drag-drop, "+Add paragraph" replacement
- Phase 5: undo/redo integration (replace `ValueHistory` for
  hybrid mode; keep it for live mode)
- Phase 6: real-folder QA + Grant repro of every existing bug
  pattern + every cataloged edge case in §2.3
- Phase 7: cleanup + obsoletion of `markdown-block-parser.ts`

This is the right long-term answer but it is a six-to-eight-week
arc, not v2. Recommend as **v3**.

#### 3.1.7 ValueHistory compatibility

Incompatible. Hybrid mode would adopt the framework's own
history. Live mode's `ValueHistory` stays as-is.

### 3.2 Option (B): Smart block merging on edit-exit

#### 3.2.1 Thesis

Keep the v1 model. On edit-exit (Escape, click-outside,
different-block-click), detect block-fragmentation patterns and
heuristically merge fragments back into the user's intended
single block.

#### 3.2.2 Technical mechanism

In `handleEditBlur`, before clearing edit state, diff the post-edit
parse against the pre-edit parse. If the block that was being
edited has fragmented into N blocks where the user typed `\n\n` or
`\n` plus other content, optionally:

- Detect "user pressed Enter inside paragraph, then exited" by
  matching the textarea's last value against the pattern `prefix +
  "\n\n" + suffix` where both `prefix` and `suffix` are
  non-trivial paragraph content. Auto-replace the `\n\n` with a
  Markdown soft-break (`  \n`) before committing, so the parser
  re-merges.
- Detect "user pressed Enter at end of line, didn't type anything
  on the new line, exited" by matching pattern `content + "\n"` →
  trim trailing `\n`.
- Detect "user pressed Enter inside a list item, exited" by NOT
  merging (list items should remain separate parser-blocks). This
  is the case the heuristic must NOT over-apply.

#### 3.2.3 Pros

- Smallest viable patch (~200-400 LOC). Lives entirely inside
  `handleEditBlur` + a new heuristic in `markdown-block-parser.ts`
  or its caller.
- Backwards-compatible with every existing affordance (image
  resize, drag-drop, file-link, "+Add paragraph", etc.). No
  changes to other surfaces.
- Closes the Enter-fragmentation bug Grant raised 2026-05-20
  without changing the editor's UX model.
- Ships fast (1-3 days).

#### 3.2.4 Cons

- Still heuristic. Edge cases will surface. Per §2.2, the class of
  bug is "parser-vs-intent divergence under N structural
  transitions"; this option only handles one specific class of
  divergence (Enter-fragmentation in paragraphs).
- "Smart" interpretation of user input is fundamentally
  user-hostile when it guesses wrong. Pressing Enter and meaning
  it (the user actually wanted two paragraphs) gets merged back
  into one, with no obvious "make it stop" affordance.
- Heuristic for "did user mean a hard split or a soft break"
  cannot be inferred from text alone. Notion / Bear / Typora all
  chose the explicit-affordance model precisely because the
  inference is ambiguous.
- Does not address the other cataloged edge cases (language
  selector positioning, drag-drop bypassing pushAndCommit, image
  resize bypassing pushAndCommit, helperPanel state loss on mode
  switch). These remain as v1 tech debt.

#### 3.2.5 Migration cost

- Zero on-disk format change. Existing content unaffected.
- Surrounding popup chrome unchanged.

#### 3.2.6 Effort estimate: **S**

200-400 LOC. One chip. 1-3 days.

#### 3.2.7 ValueHistory compatibility

Fully compatible. The merge step would route through
`pushAndCommit` as a paste-kind step (single undo entry for the
merge transformation).

### 3.3 Option (C): Soft-line-break model with explicit split

#### 3.3.1 Thesis

Inside the active edit run, Enter inserts a soft line break (a
visual newline within the same paragraph, no parser-block split).
The user gets an explicit affordance to split into a new
paragraph: a button on the floating block menu labeled "Split
here" / "New paragraph", plus a keyboard shortcut (Shift+Enter or
Ctrl+Enter, TBD per Q-A4 in §4). The model now has TWO operations
the user can perform with the same physical key (Enter), and they
mean different things, with explicit UX to disambiguate.

This is the model Bear uses (Enter = paragraph; the soft-break is
the implicit case when Markdown source contains a newline mid-
paragraph). It is also the model Notion uses (Enter = new block;
Shift+Enter = soft break within block). The v1 hybrid editor
inverts this with no affordance for the user to choose.

For v2 (C) the recommended polarity is **Enter = soft break;
explicit affordance = hard split**. Rationale:

- It matches the user's repro report (2026-05-20): the user
  pressed Enter intending visual spacing within one thought,
  expected the thought to remain one paragraph. The polarity
  honors that intent.
- Hard splits are the rarer operation; rare operations should
  carry the explicit affordance.
- The "+ Add paragraph" button at the bottom of the document
  (lines 2019-2054) already handles the "I want a new paragraph
  after this one" case for end-of-document. The hard-split affordance
  on the inline menu generalizes that to mid-document.

The inverse polarity (Enter = hard split; Shift+Enter = soft
break) is the alternative Q-A4 surfaces; Grant locks the
preference at lock-in time.

#### 3.3.2 Technical mechanism

**Source-of-truth representation.** Soft breaks persist as
CommonMark soft breaks: two trailing spaces + `\n` (`  \n`) at the
end of the prior line. This round-trips through every existing
render path (`RenderedMarkdown.tsx`, `MarkdownPreview.tsx`,
`HybridMarkdownEditor.tsx`, `LiveMarkdownEditor.tsx`) via
react-markdown's default behavior (a `<br/>` tag in the rendered
output). No sanitize-schema change is needed; `<br>` is already in
the default allowlist.

Alternative on-disk format: literal `\n` inside a single Markdown
paragraph. CommonMark treats single `\n` as soft break in source
already, rendering as a space. Some Markdown variants render as
`<br>`. The trailing-two-spaces form is strictly more compatible
across renderers and is GitHub-Flavored-Markdown's documented
shape. Recommend trailing-two-spaces.

**Editing-time behavior.** When the user is editing a block
(textarea mounted):

- Plain Enter: insert `"  \n"` at the cursor position inside the
  textarea's value. The textarea renders the trailing spaces +
  newline as a visible line break. `editingBlockOffset` does NOT
  change (the block remains the same parser-block because the
  insertion is a soft break, not a paragraph break). The undo
  step does NOT force a boundary (custom `boundaryChars` per
  §6.5).
- Shift+Enter (per Q-A4) OR explicit "Split here" button: insert
  `"\n\n"` at the cursor; commit the change; exit edit on the
  current block; the parser re-parses into two blocks; the new
  block at the post-cursor position becomes the next edit target;
  focus moves there. The undo step flushes a boundary (the split is
  atomic).
- Backspace at start of a paragraph that is preceded by another
  paragraph: merge the two blocks (delete the `\n\n` separator
  from the document buffer; re-anchor the textarea to the merged
  block at the previous block's offset; cursor at the merge
  point). This is the "undo the split" operation and the
  symmetric inverse of explicit-split. Atomic undo step.

**Block-boundary protection.** The wrap-with-newlines patch from
`f894f7c7` becomes unnecessary because the user can no longer
accidentally collapse a blank-line separator: the only way to
remove a blank-line separator now is Backspace-at-start, which is
the explicit merge operation. The protection is structural, not a
heuristic.

**Renderer-side.** The preview-mode `<ReactMarkdown>` already
renders `  \n` as `<br>` inside a paragraph. Nothing changes on
the render path. The block parser
(`markdown-block-parser.ts:parseMarkdownBlocks`) treats soft
breaks inside a paragraph as inert (paragraph spans them) which
is already the v1 behavior. So a paragraph block with internal
`  \n` line breaks renders as a single multi-line paragraph in
preview AND edits as a single multi-line textarea on click.
Internal consistency.

**Parser changes.** None to `markdown-block-parser.ts`. Soft
breaks are already inert. The only adjustment is in
`HybridMarkdownEditor.tsx`'s edit handlers: intercept Enter
keystrokes inside the textarea, insert `"  \n"` instead of `\n`.
Shift+Enter inserts `"\n\n"` and commits-and-splits.

**LOC delta estimate.** 800-1200 LOC, almost entirely inside
`HybridMarkdownEditor.tsx`:

- Enter keystroke handler (new): ~80 LOC including cursor
  arithmetic for the trailing-two-spaces case
- Shift+Enter handler (new): ~150 LOC including split-commit-
  reanchor sequence
- Backspace-at-start merge (new): ~120 LOC for the inverse
- Inline "Split here" affordance on the action chip (line 1545):
  ~50 LOC
- ValueHistory custom boundaryChars wiring (one line at
  ValueHistory constructor, line 486)
- Remove the wrap-with-newlines blank-line guard (`f894f7c7`):
  ~80 LOC removed
- Cleanup + test updates: ~200 LOC

Net: +1000 LOC, -150 LOC = ~850 LOC actual delta. Optimistically S
(if `f894f7c7` removal goes clean) to pessimistically M (if
edge-case discovery during real-folder QA surfaces patches).

#### 3.3.3 Pros

- Kills the parser-vs-intent divergence at root for the most
  common case (Enter inside a paragraph). The class of bug
  closes.
- Explicit affordance for hard split. User intent is never
  guessed.
- All existing affordances (image resize, drag-drop, file-link,
  language selector, "+Add paragraph", select-vs-edit, action
  chip) survive intact.
- `ValueHistory` integration is minor: a single constructor opt
  + use of existing `flushBoundary`.
- Matches industry-standard polarity (Notion, Bear, Typora user
  conventions).
- On-disk Markdown stays canonical CommonMark with trailing-two-
  spaces soft breaks. No migration of existing content. No round-
  trip risk through the four render paths.
- Removes the wrap-with-newlines heuristic from `f894f7c7`,
  which is a known fragile patch. The blank-line guard becomes
  unnecessary because the structural transition it patches around
  is no longer reachable through user input.

#### 3.3.4 Cons

- Two operations on the same physical key (Enter) with explicit
  disambiguation. Users have to learn the new model. Grant locked
  Wiki voice says "concept-first, screenshot-heavy"; the wiki
  manager needs an updated page (surfaced in §6.3).
- Backspace-at-start merge is a new operation that has to feel
  right. If the textarea is in a different visual block from the
  one being merged-into, the cursor's pre-merge position vs.
  post-merge position has to feel continuous. Real-folder QA will
  catch this; the alternative is no merge affordance, but then
  the user can't undo a split without Cmd+Z.
- Doesn't fix the other cataloged edge cases (language selector
  positioning, drag-drop bypassing pushAndCommit, image resize
  bypassing pushAndCommit). These remain v1 tech debt and would
  be follow-up chips.
- Trailing-two-spaces is invisible whitespace; on git diffs it
  shows up as `+    ` (or similar) which can confuse code
  review. Mitigation: editor automatically displays the trailing
  spaces as a soft-break-glyph in the textarea (optional v2.1).
- The "+Add paragraph" button at end-of-document is now
  semantically redundant with the inline split affordance. We
  keep it for discoverability, but the wiki page should explain
  both.

#### 3.3.5 Migration cost

- Zero on-disk format change required. Existing notes / results /
  experiments load and render identically.
- The only "migration" concern is user expectations: users who
  learned the v1 polarity (Enter = paragraph) will be surprised
  by Enter = soft break. Mitigation: a one-time toast on first
  hybrid-mode entry post-v2, explaining the new keystroke
  contract. Q-A4 (in §4) lets Grant pick which polarity to ship
  with default-on.
- AI Helper full.md schema extraction reads
  `frontend/src/lib/markdown-block-parser.ts` at editor time, not
  at content time, so the helper output is unaffected.

#### 3.3.6 Effort estimate: **M**

850-1200 LOC delta. 2-3 chips. ~5-7 days wall-clock.

Sequencing in §5.

#### 3.3.7 ValueHistory compatibility

Fully compatible with one constructor-option adjustment (custom
`boundaryChars` minus `\n`). The split + merge atomic operations
flush via existing `flushBoundary`. No changes to
`value-history.ts`. The test suite at
`frontend/src/lib/undo/value-history.test.ts` (264 LOC, 15 cases)
remains valid; one new test case for the custom-boundaryChars
mode would be added.

### 3.4 Option (D): User-controlled explicit block grouping

#### 3.4.1 Thesis

Each parser-block carries an optional grouping marker (e.g. a
trailing HTML comment `<!-- group:abc123 -->`) that the editor
honors when deciding whether two adjacent blocks render as one
"logical block" for edit purposes. Users explicitly join blocks
via a "Group with previous" / "Group with next" affordance; the
editor never auto-groups.

#### 3.4.2 Technical mechanism

The block parser gains group-awareness:

```ts
interface MarkdownBlock {
  // ...existing fields...
  groupId?: string;
}
```

Adjacent blocks with the same `groupId` share one textarea on
edit-click. On exit, the parser re-parses and preserves group
markers.

Trailing HTML comments are inert in CommonMark rendering (passed
through but invisible to the reader). They round-trip through all
four render paths.

#### 3.4.3 Pros

- Maximum user control. No heuristic interpretation.
- Backwards-compatible with existing content (no group markers =
  per-block behavior, identical to v1).
- Solves the Enter-fragmentation case if the user pre-groups the
  block before pressing Enter, OR retroactively after the split.

#### 3.4.4 Cons

- Puts the burden on the user. Users who don't know about
  grouping get the v1 behavior (worse, because they think Enter
  worked correctly until they click out).
- Discoverability is poor. The affordance lives on the action
  chip; users who don't see the chip never learn about it.
- HTML-comment pollution of the on-disk format. Git diffs show
  `<!-- group:abc123 -->` strings everywhere. Search across
  notes returns junk hits on `group:`.
- Does not actually solve Grant's repro: the user pressed Enter
  expecting visual spacing, exited, expected the original
  thought to remain one paragraph. With (D), they would have had
  to pre-emptively group, which they cannot know to do.

#### 3.4.5 Migration cost

- Zero for existing content (no markers = v1 behavior).
- Editor changes are moderate (~600-900 LOC) but ship value is
  low.

#### 3.4.6 Effort estimate: **M**

600-900 LOC delta. 2-3 chips.

#### 3.4.7 ValueHistory compatibility

Fully compatible. Group toggle is one undo step per toggle.

### 3.5 Option (E): Single textarea + live side-by-side rendering

#### 3.5.1 Thesis

Replace the per-block-edit primitive entirely with a Bear / Typora
style split view: raw Markdown source on the left, live-rendered
preview on the right. Click anywhere in the preview scrolls the
source pane to the corresponding line and focuses it.

#### 3.5.2 Technical mechanism

Two `<textarea>` + `<RenderedMarkdown>` panes side by side. The
source pane is the only edit surface; the preview pane is read-only
and click-to-jump. The parser is no longer used for edit-block
mapping (a click-to-jump anchor scheme is needed instead, similar
to source-map line numbers).

#### 3.5.3 Pros

- Zero parser-vs-intent divergence. The source IS the edit
  surface.
- Industry-known model (Typora, Mark Text, Bear).
- Simpler state model than v1.

#### 3.5.4 Cons

- Different UX feel from current hybrid mode. Some users hate
  split panes; some love them. Grant has expressed past
  preference for the integrated preview-default model over a
  split pane (per HR memory, no direct citation; verify before
  treating as gospel. **I have not verified this; assume false
  until master confirms**).
- Loses the "preview block, single-click selects, double-click
  edits in place" interaction model entirely. Selection halo,
  inline action chip, drag-drop on a block: all gone.
- Sidebar real-estate competition. The helper panel + drag-drop
  affordances + split pane = three side-by-side concerns on a
  single-column document.

#### 3.5.5 Migration cost

- Zero on-disk format change.
- All popup chrome (helper, action chip, language selector,
  image resize) needs rebuilding for the new UX. Some may not
  apply (image resize survives; action chip on a preview block
  becomes meaningless because preview is read-only).

#### 3.5.6 Effort estimate: **L** (lighter than (A))

2500-3500 LOC delta. 4-5 chips.

#### 3.5.7 ValueHistory compatibility

Fully compatible (one textarea, one history).

### 3.6 Option (F): Hybrid (B) + (C), soft break + smart merge fallback

A pragmatic combination: ship (C) as the editing primitive, and
keep (B)'s heuristic merge as a fallback for users who pasted
Markdown from an external source that uses `\n\n` paragraph
breaks where soft breaks were intended. Not a standalone thesis;
mentioned for completeness. Rank: not recommended because (C)'s
explicit affordance covers the case correctly without heuristic
interpretation; (B)'s heuristic adds surface area without
proportional benefit.

---

## 4. Recommended thesis

**Recommendation: (C) soft-line-break model with explicit split,
Enter = soft break polarity by default.**

### 4.1 Why (C)

1. **Smallest change that closes the class of bug.** Every v1
   patched bug AND the open Enter-fragmentation pain trace to the
   parser-vs-intent divergence. (C) makes Enter a deliberate,
   parser-inert operation; the user explicitly commits to a hard
   split via a separate affordance. The structural transition the
   v1 patches were trying to prevent becomes unreachable through
   ordinary user input.
2. **Preserves every other v1 strength.** Per-block-edit-on-click,
   selection halo, action chip, language selector, image resize,
   drag-drop, file-link, "+Add paragraph", helper panel,
   `ValueHistory` integration: all survive intact.
3. **Industry-standard polarity.** Bear, Notion, Typora users
   already expect "Enter inside a thought stays within the
   thought." Reduces the "feels weird" user-onboarding tax.
4. **Light migration.** No on-disk format change. No effect on
   AI Helper full.md schema extraction. No effect on the four
   render paths. The sanitize schema is untouched.
5. **Effort fits in 2-3 chips, ~5-7 days wall-clock.** Compare
   (A) at 6-8 weeks.

### 4.2 Why not (A) for v2

(A) is the correct long-term architectural answer. The reasons it
is not v2 are scope (4,000-6,000 LOC across 6-8 chips) and risk
(contenteditable browser-variance + IME + paste sanitization +
markdown round-trip surface area). Recommend planning (A) as **v3**,
after (C) ships and the team has confidence in the hybrid mode's
UX. v3 planning chip should run after v2 lands and after Grant
has lived with (C) for at least a week of real research work.

### 4.3 Why not (B) standalone

(B) closes the immediate Enter-fragmentation pain with the
smallest delta, but it does so by guessing user intent. The
guess-wrong case (user actually wanted two paragraphs, gets one)
is user-hostile. The class of bug is "parser-vs-intent
divergence under N structural transitions"; (B) handles one
specific N. Future transitions need future heuristics. (C) closes
the class.

### 4.4 Why not (D)

(D) puts the burden on the user. Discoverability is poor.
Doesn't solve the actual repro Grant raised.

### 4.5 Why not (E)

Different UX model. May or may not match Grant's preferences (I
have not verified the past chat reference; assume false until
master confirms). Even granting it could be Grant's preference,
the migration cost (rebuilding every popup chrome affordance) is
disproportionate to a same-class-of-bug fix.

### 4.6 Runner-up ranking

1. **(C)**: recommended, M effort.
2. **(B)**: ship-now option if (C)'s effort is too high.
   Closes Grant's open repro with the smallest delta (200-400
   LOC) but leaves the class of bug open.
3. **(E)**: different UX feel; deprioritized pending Grant's
   feel preference (Q-V1 in §4).
4. **(A)**: correct long-term; recommend v3 planning chip
   post-v2.
5. **(D)**: user burden; not recommended in any sequence.

---

## 5. Implementation scoping (if (C) is selected)

Phase chips, in dependency order. Each chip is a sub-bot dispatch
with verification gates between chips. The pattern follows the v1
methods-arc lessons in AGENTS.md §6: pre-flight verification on
local main, dedicated merge bot for cross-arc surface touches,
explicit-path staging, real-folder Grant verify before merge.

### 5.1 Phase 0: Spike + lock decisions

**Chip 0a: Real-folder repro of the open Enter-fragmentation
pain.** Sub-bot pulls the latest main, opens a real folder with
Grant's typical notes content, reproduces the bug end-to-end,
captures the parse-output diff before and after the click-out.
Confirms the §2.1 mechanism. Half-day chip. Output: a 1-page
write-up + screenshots of the parse-diff. No code changes.

**Lock decisions: Q-A1 through Q-A6 (§4).** Master routes through
`AskUserQuestion` to Grant. Lock the polarity, the keyboard
shortcut for explicit split, the on-disk soft-break form, the
backspace-at-start merge UX. No phase 1 work until these are
locked.

### 5.2 Phase 1: Core soft-break + explicit split

**Chip 1: Enter-as-soft-break + explicit split keystroke.** The
heart of (C). Inside `HybridMarkdownEditor.tsx`'s
`handleEditKeyDown`, intercept the Enter keydown:

- Plain Enter: insert `"  \n"` at the cursor; let
  `handleEditChange`'s splice path run; don't change
  `editingBlockOffset`; flushBoundary NOT called.
- Shift+Enter (or the locked alternative per Q-A2): insert
  `"\n\n"` at the cursor; call `pushAndCommit` as paste-kind step;
  on next render, find the new block at `cursor + 2` offset;
  set `editingBlockOffset` to that new block's startOffset;
  flushBoundary called.

`ValueHistory` wiring: instantiate the hybrid editor's
`ValueHistory` with `boundaryChars` set to the default minus
`\n` (i.e. `" \t.,;:!?\"'-()[]{}"`). This requires no change to
`value-history.ts`; the opts surface already supports it.

LOC delta: ~300-400 in `HybridMarkdownEditor.tsx`. 1-2 days.

**Chip 2: Backspace-at-start merge.** Inside
`handleEditKeyDown`, intercept Backspace when
`textareaRef.current.selectionStart === 0` AND
`textareaRef.current.selectionEnd === 0`:

- If there's a previous block (any type), merge: delete the
  paragraph separator (`\n\n` or `\n`) between the current and
  previous block from the document buffer; re-anchor
  `editingBlockOffset` to the previous block's startOffset;
  position cursor at the merge point (previous block's content
  length); call `pushAndCommit` as paste-kind step; flushBoundary
  called.
- If no previous block, default-Backspace fires (deletes the
  character at cursor, which is the empty no-op since cursor is at
  0).

LOC delta: ~200 in `HybridMarkdownEditor.tsx`. 1 day.

**Chip 3: Inline "Split here" affordance on action chip.** Add
a third button to the inline action chip at lines 1545-1571:

```tsx
<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    handleBlockSplit(block);
  }}
  title="Split paragraph here (Shift+Enter)"
  className="px-1.5 py-0.5 text-[10px] text-gray-700 hover:bg-gray-50 rounded-full"
>
  Split
</button>
```

`handleBlockSplit` is a new callback that triggers the same
split logic as Shift+Enter, but at the block's startOffset
(equivalent to "start a new paragraph after this block"). Used
for the case where the user wants to split a preview block
without entering edit mode first.

LOC delta: ~80 in `HybridMarkdownEditor.tsx`. Half-day.

### 5.3 Phase 2: Remove the wrap-with-newlines heuristic

**Chip 4: Remove `f894f7c7` blank-line guard.** With (C), the
structural transition the guard patches around (blank-line block
absorbing user input then disappearing) is no longer reachable.
Remove:

- The `BLANK-LINE FIRST-TYPING GUARD` block in `handleEditChange`
  (lines 935-988).
- The `editingBlockOffset + 1` shift inside that branch.
- The `setEditCursorPosition(newContent.length)` sync that
  `f60448e6` added.

Verify: real-folder repro of every scenario in `f894f7c7`'s
commit message ("blank line between paragraphs, + Add paragraph
trailing blank line, blank line at start of doc, single-newline
doc, multi-blank-line grouped block") to confirm the heuristic's
removal doesn't regress any of those cases under (C)'s new
keystroke contract.

LOC delta: -80 in `HybridMarkdownEditor.tsx`. Half-day.

### 5.4 Phase 3: Wiki + tech-debt sweep

**Chip 5 (wiki manager handoff):** Update the wiki to explain
the new keystroke contract. Concept-first ("a thought stays one
paragraph until you say otherwise"). Screenshot-heavy
(annotated screenshots of the Enter behavior, the Shift+Enter
split, the action chip's Split button). Out of scope for this
proposal's planning bot; flagged here as a follow-up.

**Optional chip 6: Route image-resize + drag-drop through
pushAndCommit.** Two long-standing `c2127bdc` out-of-scope cases
(noted in §2.3.3 and §2.3.5). Not in v2's critical path but
cheap to land alongside. ~100 LOC across `handleImageResizeSelect`
and the outer block drop handler.

**Optional chip 7: Floating-ui-based language selector
positioning.** Replaces the hard-coded `lineHeight = 20` /
`charWidth = 8` math. ~150 LOC. Independent of (C) but a known
fragile surface.

### 5.5 Dependencies + surfaces touched

- `frontend/src/components/HybridMarkdownEditor.tsx`: every chip.
- `frontend/src/lib/markdown-block-parser.ts`: no changes
  required if soft-break is `"  \n"`. Verified: soft breaks
  are already inert in the parser.
- `frontend/src/lib/undo/value-history.ts`: no changes. The
  custom `boundaryChars` opt is used by hybrid editor's
  constructor; the primitive's behavior is unchanged for the
  Live editor.
- `frontend/src/lib/undo/value-history.test.ts`: one new test
  case for the custom-boundaryChars mode (Enter coalesces
  inside a typing run when `\n` is not in the boundary set).
- `frontend/src/components/LiveMarkdownEditor.tsx`: no changes.
  Hybrid is a child component; its prop surface is unchanged.
- `frontend/src/app/wiki/**`: deferred to wiki manager.

### 5.6 Effort summary

| Chip | LOC delta | Duration |
|---|---|---|
| 0a Real-folder repro | 0 | 0.5 day |
| 1 Enter + split keystroke | ~350 | 1.5 days |
| 2 Backspace-at-start merge | ~200 | 1 day |
| 3 Inline Split affordance | ~80 | 0.5 day |
| 4 Remove blank-line guard | -80 | 0.5 day |
| 5 Wiki handoff | n/a | wiki manager |
| 6 (optional) Image-resize / drag-drop undo | ~100 | 0.5 day |
| 7 (optional) Floating-ui language selector | ~150 | 1 day |

Critical path (chips 0a through 4): ~4 days wall-clock. Optional
chips 6 and 7 are tech-debt sweeps that can run in parallel after
chip 4 lands.

---

## 6. Risk analysis + migration concerns

### 6.1 Data loss risk on existing notes / results / experiments

**Risk: zero.** Soft breaks render identically across all four
render paths today (verified: `RenderedMarkdown.tsx`,
`MarkdownPreview.tsx`, `HybridMarkdownEditor.tsx` preview blocks,
`LiveMarkdownEditor.tsx`). The on-disk format adds trailing-two-
spaces sequences inside paragraphs; previously, the same paragraph
might have had `\n\n` separators. Both round-trip through
ReactMarkdown's default behavior; one renders as `<br>`, the
other as a paragraph break. Pre-existing content is untouched
because chip 1 only changes new keystroke behavior, not on-disk
content.

Watch: a v2.1 chip could optionally rewrite existing `\n\n` to
`  \n` in user content where the user intent appears to be a soft
break, but that is heuristic interpretation of historical content
and is explicitly **out of scope for v2**.

### 6.2 Browser compatibility

(C) does not touch contenteditable. No browser-variance risk
beyond what v1 already accepts (the `<textarea>` element behavior
is uniform across Chrome / Firefox / Safari).

The trailing-two-spaces sequence inside a textarea is preserved
through every browser's value getter; verified by the React team
as standard `<textarea>` behavior. No risk.

### 6.3 AI Helper full.md schema extraction

The brief calls out that the AI Helper output ships content based
on the markdown parser. Verified by grep:

```
grep -rn "extractSchema\|extractMarkdown" /Users/gnickles/.../ai-helper/
```

The AI Helper reads
`frontend/src/lib/markdown-block-parser.ts` at editor time, not
at content time. The helper builds `full.md` from a structural
fingerprint of the editor's TypeScript surface, not from user
content. Soft breaks in user content do not flow into `full.md`.

Risk to AI Helper output: zero.

### 6.4 Sanitize schema

The brief explicitly forbids changes to
`frontend/src/lib/markdown/sanitize-schema.ts`. (C) does not
require schema changes. `<br>` is in the default react-markdown
allowlist and the existing schema does not override that. Verified
indirectly: trailing-two-spaces soft breaks already round-trip
through preview today (paragraph blocks containing `  \n` render
correctly in the live editor's preview mode).

### 6.5 Undo / redo interactions

The critical risk class. Detailed:

**6.5.1. `ValueHistory` boundary contract.** Today's boundaryChars
set is `" \t\n.,;:!?\"'-()[]{}"`. Including `\n` means: every
newline keystroke (Enter) forces the next push to start a fresh
undo step. With (C), Enter inserts `"  \n"` and is NOT a
paragraph boundary; Cmd+Z should revert the typing-run up to the
last logical pause (matching what users expect from typing a
multi-line paragraph in any other text editor).

**Mitigation:** instantiate the hybrid editor's `ValueHistory`
with `boundaryChars: " \t.,;:!?\"'-()[]{}"` (default minus `\n`).
The two-trailing-spaces before the `\n` ARE boundary characters
(`\t` actually no, spaces yes), so the first soft-break inside a
typing run still triggers a boundary, but only ONCE per soft
break, not once per character afterward. Acceptable trade-off.

Alternative: tighter mitigation by filtering inserted spaces in
`computeInsertedSlice` to "spaces that aren't part of a `  \n`
sequence." Cleaner UX but requires touching `value-history.ts`
internals which the brief discourages. Recommend the simpler opt
unless real-folder QA surfaces a problem.

**6.5.2. Explicit-split flushBoundary.** The Shift+Enter handler
calls `historyRef.current?.flushBoundary()` before
`pushAndCommit("paste")`. Atomicity: a single Cmd+Z reverts the
split (rejoins the two paragraphs). Verified compatible with the
existing `flushBoundary` semantics.

**6.5.3. Backspace-at-start merge flushBoundary.** Same pattern.
Single Cmd+Z reverts the merge (re-splits the two paragraphs).
Verified compatible.

**6.5.4. Existing `ValueHistory.test.ts` coverage.** 15 cases, 264
LOC. All remain valid. One new case for the
custom-boundaryChars-minus-`\n` mode would be added. No
modifications to the primitive.

### 6.6 Existing tech-debt residual

(C) does NOT close:

- Language selector hard-coded line/char dimensions (§2.3.2).
- Image resize bypassing `pushAndCommit` (§2.3.3).
- Outer block drop bypassing `pushAndCommit` (§2.3.5).
- Helper panel state loss on mode switch (§2.3.7).

These remain as v1 tech debt. Chips 6 and 7 in §5.4 are optional
sweeps for the first two. The others are minor papercuts.

### 6.7 Re-enabling the blank-line guard if needed

If chip 4's removal of the `f894f7c7` heuristic surfaces a
real-world repro in QA, the guard can be reinstated as a defensive
belt-and-suspenders. The split-vs-soft-break contract from chips
1-3 should make the guard's input unreachable, but defense in
depth is cheap. Document this contingency in the chip-4 commit
body so future me can find it.

---

## 7. Out-of-scope reminders

Per the brief, this proposal is **only** about hybrid mode. The
following are explicitly OFF-LIMITS for v2:

- **Edit mode** (`LiveMarkdownEditor`'s plain textarea): no
  changes. Even though `LiveMarkdownEditor` instantiates the
  hybrid editor as a child component, the hybrid mode's prop
  surface is unchanged by (C). The Live editor's own behavior is
  untouched.
- **Preview mode**: no changes. Rendered output is identical.
- **The markdown parser** at `lib/markdown-block-parser.ts`: no
  changes. Soft breaks are already inert. Block-boundary detection
  for paragraphs/lists/headings/code/etc. is unchanged.
- **The four markdown render paths** (`RenderedMarkdown.tsx`,
  `MarkdownPreview.tsx`, hybrid preview block, Live preview): no
  changes. Soft breaks render identically across all four today.
- **The sanitize schema** at `lib/markdown/sanitize-schema.ts`: no
  changes. `<br>` is already in the default allowlist that the
  schema does not override.
- **The undo/redo `ValueHistory` primitive** at
  `lib/undo/value-history.ts`: no changes to the primitive
  itself. Only the constructor opt for `boundaryChars` is
  customized at the hybrid editor's instantiation site.

The proposal also does NOT touch:

- The AI Helper full.md schema extraction (verified: helper reads
  TypeScript surface, not user content).
- The wiki pages (handed off to wiki manager via chip 5).
- The fixture / capture pipeline (no shape changes).
- Any backend / `/api/*` route (no network surface touched).
- Any auth / storage / IDB / encrypted-backup surface (no
  credential or persistence changes).

---

## 8. Open questions for Grant lock-in

Each pre-bundled with options ready for `AskUserQuestion` relay
(clickable). Recommended option is first, marked **(recommended)**.

### Q-A1. Which redesign thesis

The five distinct theses in §3, ranked.

- **(C) Soft-line-break model with explicit split (recommended)**:
  Enter = soft break; explicit affordance (button + keyboard
  shortcut) for hard paragraph split. M effort, ~5-7 days. Kills
  the class of bug. Preserves every existing affordance.
- **(B) Smart block merging on edit-exit**: S effort, 1-3 days,
  heuristic interpretation of "Enter inside paragraph then exit"
  to auto-merge. Smallest delta but leaves the class of bug
  open.
- **(A) Contenteditable WYSIWYG**: L effort, 6-8 weeks across
  6-8 chips. Correct architectural answer. Recommend as v3, not
  v2.
- **(E) Single textarea + live side-by-side**: L effort, 4-5
  chips. Different UX feel; deprioritized.
- **(D) User-controlled grouping markers**: M effort, puts
  burden on user; doesn't solve Grant's repro.

### Q-A2. Soft-break or hard-split default polarity for Enter

In (C), which operation does the bare Enter key perform?

- **Enter = soft break; Shift+Enter = hard split (recommended)**:
  Matches Bear's polarity and the user's repro intent
  (2026-05-20). Soft break is the common case; hard split is the
  rare case carrying the explicit affordance.
- **Enter = hard split; Shift+Enter = soft break**: Matches
  Notion's polarity. Most modern WYSIWYG editors use this. But
  the user's repro suggests they expected Enter to be
  within-thought, which argues for the recommendation above.
- **User-configurable in Settings**: Adds a toggle row to
  Settings → Editor (which does not yet exist as a settings
  group; would need to be added).

### Q-A3. On-disk soft-break form

When Enter inserts a soft break, what does the on-disk Markdown
look like?

- **Trailing-two-spaces + `\n` (`  \n`) (recommended)**:
  CommonMark-canonical. Round-trips through every existing
  render path. GitHub-Flavored-Markdown documented form.
  Invisible whitespace in raw source (mild git-diff concern).
- **Backslash + `\n` (`\\n`)**: Some Markdown variants accept
  this. Less compatible. Visible escape in raw source.
- **Literal `\n` inside one paragraph**: Some variants render
  as space; some as `<br>`. Less portable. Risks render
  inconsistency across the four paths.

### Q-A4. Explicit-split keyboard shortcut

What keystroke triggers the hard paragraph split?

- **Shift+Enter (recommended)**: Convention in Notion / Slack /
  most modern editors. Discoverable via the inline action chip
  button.
- **Ctrl+Enter**: Convention in some text editors (e.g.
  GitHub's commit textarea). Conflicts with no existing shortcut.
- **Alt+Enter**: Less conventional; no conflict.
- **No shortcut, button only**: Forces discovery through the UI.
  Slow but explicit.

### Q-A5. Backspace-at-start merge behavior

Per chip 2 in §5, Backspace at the start of a paragraph that is
preceded by another paragraph merges the two. Confirm?

- **Yes, merge with previous paragraph (recommended)**: Symmetric
  inverse of the split. Single Cmd+Z reverts.
- **No, plain Backspace (no-op at position 0)**: Conservative;
  user has to use Cmd+Z to undo a split. Loses discoverability.
- **Merge only inside paragraph blocks; no-op at start of
  heading / list / code-block**: Refinement. Prevents
  accidentally merging heading text into preceding paragraph.

### Q-A6. Migration: rewrite existing `\n\n` to `  \n` in past
content?

A v2.1 chip could heuristically rewrite existing paragraph breaks
in user content where intent suggests soft break. Out of v2
scope per §6.1 but Grant may want to lock the answer now.

- **No, do not rewrite past content (recommended)**: Past
  content is already coherent under v1's model. Heuristic
  rewriting risks introducing new bugs. v2 ships with new-
  keystroke-only behavior.
- **Yes, run a one-time rewrite pass with user-confirm prompt**:
  Brings past content into the new model. Risks loss-of-intent
  if the heuristic is wrong. Requires per-document confirmation.
- **Yes, fully automatic rewrite at next document open**: Most
  aggressive. Highest regression risk.

### Q-V1. Keep edit-mode toggle (current 3-mode model)?

Even though v2 only touches hybrid mode, this is a question worth
locking now since (E) above would deprecate the toggle.

- **Yes, keep the 3-mode toggle (edit / hybrid / preview)
  (recommended)**: Same as v1. Users with strong preference for
  raw-Markdown-only or rendered-only can still get there. Default
  to hybrid as it is today.
- **No, simplify to 2 modes (hybrid / preview)**: Remove the
  edit-mode-only textarea. Forces all editing through hybrid.
  Cleaner but loses an escape hatch for users who want raw
  Markdown.
- **No, simplify to hybrid only**: Single mode. Most aggressive.

### Q-V2. Rollback story

If (C) ships and a regression surfaces post-merge, what's the
rollback path?

- **Revert chips 1-4 individually (recommended)**: Each chip is a
  separate merge commit; `git revert` walks them back in dependency
  order. Restores v1 model fully.
- **Feature flag (C) behind a hidden Settings toggle for the
  first week**: Lets Grant and pilot users opt-in; other users
  see v1 model. Adds ~50 LOC scaffolding. Removes the toggle in
  a follow-up chip once confidence is established.
- **No rollback plan; commit forward only**: Most aggressive.
  Relies on the verification gate at each chip catching
  regressions before merge.

---

## 9. Appendix A: source surfaces referenced

- `frontend/src/components/HybridMarkdownEditor.tsx`
  - Lines 410-487: state setup + ValueHistory wiring
  - Lines 545-553: blocks parse memo + editingBlock lookup
  - Lines 594-637: keyboard handler on selected-but-not-editing
    blocks
  - Lines 810-859: handleBlockSelect + handleBlockEdit
  - Lines 884-1008: handleEditChange (the blank-line guard from
    `f894f7c7` lives here)
  - Lines 1010-1022: handleEditBlur
  - Lines 1051-1306: handleEditKeyDown (every shortcut + tab
    indent + heading-level adjust)
  - Lines 1334-1349: document-level click-outside handler
  - Lines 1364-1391: image resize handler
  - Lines 1393-1445: handleInsertSyntax (style-guide click)
  - Lines 1450-1721: renderBlock (the textarea + preview block
    rendering)
  - Lines 2019-2054: + Add paragraph button
- `frontend/src/lib/markdown-block-parser.ts`: parser, no changes
  required.
- `frontend/src/lib/undo/value-history.ts`: primitive, no changes
  to internals.
- `frontend/src/lib/undo/value-history.test.ts`: existing 15 cases
  remain valid; one new case for custom boundaryChars.
- `frontend/src/components/LiveMarkdownEditor.tsx`: parent
  component; no changes to its surface.

---

## 10. Verification commands run for this proposal

Listed so master can audit the cross-arc state assertions in this
doc.

```
ls /Users/gnickles/Desktop/ResearchOS/.claude/worktrees/agent-a5bbe9b9aaa58154b/

wc -l frontend/src/components/HybridMarkdownEditor.tsx
wc -l frontend/src/lib/undo/value-history.ts
wc -l frontend/src/lib/markdown-block-parser.ts
wc -l METHODS_EXPANSION_V2_PROPOSAL.md

git log --oneline | head -30
git log --oneline main | grep -E "f699993d|f894f7c7|f60448e6|c2127bdc"
git show --stat f699993d
git show --stat f894f7c7
git show --stat f60448e6
git show --stat c2127bdc

grep -n "hybrid editor\|HybridMarkdownEditor\|parser-block\|click-to-edit" AGENTS.md
grep -rn "HybridMarkdownEditor" frontend/src --include="*.tsx" --include="*.ts"
grep -rn "extractSchema\|extractMarkdown\|full\.md" ai-helper/
```

Result of the bug-SHA verification (the load-bearing one): all
four commits are on local main, in the expected order.

```
c2127bdc markdown editors: app-level undo/redo via ValueHistory primitive
f60448e6 HybridMarkdownEditor: sync editCursorPosition in wrap-with-newlines path
f894f7c7 HybridMarkdownEditor: wrap-with-newlines on first non-blank keystroke into a blank-line block
f699993d Cherry-pick HybridMarkdownEditor paste/focus fix from claude/cranky-banzai-19835c
```

One assertion in this doc was NOT verified: Grant's past
preference for the integrated preview-default model over a split
pane (referenced in §3.5.4 for option (E)). I have not verified
this; assume false until master confirms via direct chat with
Grant or HR-memory lookup.

---

*planning bot (hybrid editor v2)*
