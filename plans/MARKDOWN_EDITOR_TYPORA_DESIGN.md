# Markdown Editor: Getting Closer to Typora

Author: typora-editor design bot (for HR), 2026-05-29

## 0. What Grant asked for

Two pain points, repeated:

1. "It is a markdown file, so why lock the editing space to a constant size?" The writing surface, including the new Focus Mode, is pinned to a fixed-width box. He wants it to BREATHE: content- and viewport-driven, not a constant box.
2. "If we could get closer to the real live preview feature to help me concentrate on the content itself that would be AMAZING." Typora renders markdown IN PLACE as you type, revealing the raw syntax only contextually around the cursor, with NO separate Preview tab and no split pane. He wants to concentrate on content, not toggle modes.

This is design only. No code, no installs, no builds. Concepts first, then a concrete recommendation per question, then a phased plan and open questions for Grant.

## 1. How the editor actually works today (read from source)

The markdown stack is two components plus a parser and a renderer:

- `HybridMarkdownEditor.tsx` (3268 lines) is the core and is BLOCK-BASED.
  - `parseMarkdownBlocks(content)` (`markdown-block-parser.ts:222`) walks the source line by line and groups it into typed blocks (heading, paragraph, codeBlock, blockquote, list, table, thematicBreak, html, blankLine), each carrying its exact `startOffset` / `endOffset` / `startLine` / `endLine` into the source string (`markdown-block-parser.ts:37-61`). The parser is CommonMark-aligned and deliberately hand-rolled (the comment block at `:1-18` and `:200-221` documents the paragraph rules).
  - The editor renders one node per block via `renderBlock` (`HybridMarkdownEditor.tsx:2428`). A non-editing block is a `<div className="hybrid-block preview-block ...">` whose body is a `<ReactMarkdown>` render of just that block's markdown (`:2487-2552`, prose wrapper at `:2589`). A SINGLE click selects the block (`onClick` -> `handleBlockSelect`, `:2498-2501`); a DOUBLE click enters edit (`onDoubleClick` -> `handleBlockEdit`, `:2502-2505`).
  - The block being edited renders instead as a raw `<textarea>` seeded with that block's markdown source (`:2444-2459`). So at any moment AT MOST ONE block is a textarea and every other block is rendered HTML. This is the "hybrid" model.
  - The whole document is `blocks.map(renderBlock)` inside `<div className="hybrid-editor p-4 ... overflow-y-auto">` (`:3132-3137`), with a "+ Add paragraph" affordance at the end (`:3140-3187`).

- The MANUAL-SAVE BUFFER model (the load-bearing part):
  - Entering a block calls `beginEditSession()` (`:892`), which snapshots the current document into `editSessionSnapshot` (state) and `editSessionSnapshotRef` (ref). While that snapshot is non-null, the surrounding blocks are parsed against the FROZEN snapshot, not the live `value` (`effectiveValue` at `:1221-1226`, `blocks` memo at `:1227`). Keystrokes write only to local buffer state (`editingBlockContentRef`, `:912`) so the rest of the document does not re-parse or re-render per keystroke.
  - The buffer is composed back into the document by `commitBufferedEdit()` (`:937-975`), which splices the buffer at the active block's offset and calls `pushAndCommit` (`:854`). Commit happens on EXPLICIT signals only: Escape in `handleEditKeyDown` (`:1769-1796`), a block switch via `handleBlockSelect` (`:1507`), or structural transforms (Shift+Enter split, Backspace merge). There is deliberately NO `onBlur` on the textarea (`:2439-2443`): a native blur does not commit, because the clipboard subsystem / extensions used to blur the textarea mid-paste and drop content.
  - Nothing reaches the parent until an EXPLICIT save: the `Save` button (`SaveChrome`, `:490-541`), Cmd/Ctrl+S (document-level keydown, scoped to `containerRef.current.contains(document.activeElement)`), or the parent's own disk button via `saveRef` / `onExplicitSave` (`:340-349`). Until then everything lives in a local `pendingDocument` layer (`pushAndCommit` -> `pendingDocumentRef`, `:858`).
  - Undo history is a per-editor `ValueHistory` (`:751`, `:982`) that operates against the LOCAL working document only; undo/redo do NOT call `onChange`. The whole edit session collapses into a single "paste"-kind undo step (`:970-973`).
  - `useUnsavedChangesGuard(editBufferDirty)` (`:1113`) is the browser/nav-away dirty guard. An `UnsavedChangesModal` (`:558-615`) fires when the parent tries to swap `value` while the buffer is dirty.

- Keyboard shortcuts (`KEYBOARD_SHORTCUTS`, `:151-305`): Cmd+B/I/U/K, Cmd+Shift+X (strike), Cmd+Ctrl+C (code block), Cmd+1..6 (headings), Ctrl+Q (quote). All operate on the active block's textarea selection (`applyMarkdownFormatInBlock`, `:438`). Tab, soft-break Enter, Shift+Enter hard-split, Backspace-merge are handled in `handleEditKeyDown` (`:1684-2181`).

- `LiveMarkdownEditor.tsx` (the wrapper): renders the toolbar (Hybrid / Preview two-way toggle at `:1709-1739` on main, `EditorMode = "hybrid" | "preview"` at `:54`; raw-Edit mode was removed), the Add File / Browse / Strip controls and the attachments tray, and the body slot that mounts either the Preview render or the child `HybridMarkdownEditor` (`:1782`). It also owns the new FOCUS MODE: `focusMode` state (`:217`), `toggleFocusMode` (`:288`), a body-level `createPortal` overlay, the enter button (`data-tour-target="hybrid-editor-focus-toggle"`, `:1745`) and exit control (`hybrid-editor-focus-exit`, `:2516`). The Focus Mode column is `flex flex-col w-full max-w-5xl h-full mx-auto` (`:1692`) -- the constant box Grant dislikes. The full Focus Mode spec is `plans/FOCUS_WRITING_MODE_DESIGN.md` (which itself recommended `max-w-3xl`).

- `RenderedMarkdown.tsx` is read-only display only (react-markdown + `remark-gfm` + `remark-underline` + `rehype-raw` / `rehype-sanitize` / optional `rehype-highlight`, with a blob-URL image resolver). It explicitly points editable contexts at the two editors (`:33`).

- Surfaces: all full markdown editing mounts the SAME `LiveMarkdownEditor`: experiment Lab Notes and Results (`TaskDetailPopup.tsx:4022`, `:4545`), standalone Notes (`NoteDetailPopup.tsx:1214`, `:1242`), Methods write-up (`app/methods/page.tsx:1595`), plus the method create modal and variation/compound panels.

- STRUCTURED method types are NOT plain markdown. `PlateLayoutEditor`, `LcGradientEditor` / `InteractiveGradientEditor`, `MassSpecEditor`, `QpcrAnalysisEditor`, `CellCultureScheduleEditor`, `CodingWorkflowEditor`, `PurchaseEditor` are dedicated structured editors with their own data shapes. A Typora-style change applies ONLY to the markdown surfaces above and must not touch the structured editors.

- The renderer dependencies already present: `react-markdown@10`, `marked@18`, `remark-gfm`, `remark-parse`, `remark-rehype`, `rehype-raw`, `rehype-sanitize`, `rehype-highlight`, `rehype-stringify`. There is NO CodeMirror / ProseMirror / Lexical / TipTap / Milkdown in the tree today. Build is a plain `next build`; the app is local-first (File System Access API via `file-service`), no server round-trip for content.

## 2. The gap: where we are vs Typora

Three concrete differences:

| Axis | ResearchOS today | Typora |
| --- | --- | --- |
| Modes | A wrapper-level Hybrid / Preview toggle, plus a Focus Mode toggle. The user picks a mode. | NO modes. One surface, always live. |
| Render granularity | Per-block: exactly one block is a raw `<textarea>`; the rest are rendered HTML. You see RAW markdown for the whole block you are editing (e.g. a `## Heading` shows the `##`, a list shows every `-`). | Per-span / per-line in place: markdown renders as you type and the raw tokens (the `**`, the `#`, the `[]()`) collapse/reveal only right around the caret. You almost never see raw syntax except on the active token. |
| Edit affordance | DOUBLE-click a block to turn it into a textarea (single click selects). Switching blocks is a remount of the textarea. | Click anywhere and type; the caret lives directly in rendered content. |
| Writing surface width | Block list fills its flex parent in the normal hosts; Focus Mode pins it to `max-w-5xl` (a constant box). | Fluid, content/viewport-driven, with a comfortable measure; user-resizable in many themes. |

The honest summary: our "hybrid" is a MODE-LITE block swapper, not inline WYSIWYG. It is a good local-first fit (it round-trips to clean markdown trivially, because each block's textarea literally holds the source substring), but it is two steps from the Typora feel: you still (a) see whole-block raw syntax while editing, and (b) double-click to edit. Typora's hallmark is that raw syntax appears only on the active token and you never think about editing vs viewing.

## 3. The sizing fix (the quick win, shippable first, independent of everything else)

This is the cheapest, highest-satisfaction change and it is decoupled from the live-preview question. Two surfaces to fix:

A. NORMAL hosts. Today the block list (`hybrid-editor p-4 ... overflow-y-auto`, `HybridMarkdownEditor.tsx:3135`) and the Preview render (`prose ... max-w-none`, `LiveMarkdownEditor.tsx:1688`) fill the host slot edge to edge. In a wide popup or the Methods page that produces uncomfortably long line lengths. Recommendation: introduce a single shared "measure" wrapper around the block list and the preview render that defaults to a readable line length but is fluid below it. Concretely a centered column with a max measure expressed in `ch` (text-relative), e.g. `max-w-[72ch] mx-auto w-full px-6`, where 72ch is a comfortable prose measure (Typora's default body is in this range). Below that width it is 100% fluid; above it the text stops growing but the surrounding surface keeps breathing. This is a content-driven measure, not a constant pixel box.

B. FOCUS MODE. Replace the constant `max-w-5xl` box (`LiveMarkdownEditor.tsx:1692`) with the SAME `ch`-based measure, and make it user-adjustable. Recommended default and behavior:

- Default to a comfortable measure (recommend `~72ch`, a touch wider than the design doc's `max-w-3xl` because Focus Mode is the dedicated writing surface and benefits from a little more room), centered on the calm full-bleed surface.
- Add a small, persistent width control in the Focus Mode top bar (three presets: Narrow `~60ch` / Comfortable `~72ch` / Wide / Full-bleed), inline-SVG icon, project `<Tooltip>`, no native `title=`, no emoji. Persist the choice in `localStorage` (per the existing per-editor preference pattern) so it sticks across sessions.
- "Full-bleed" = drop the measure cap entirely and let text span the viewport with generous side padding, for users on small screens or who simply prefer it.

Why this is the recommended default rather than "always full-bleed": an unbounded measure on a 27-inch monitor produces 200-character lines that hurt readability, which is the opposite of Focus Mode's goal. A `ch`-based comfortable measure that the user can widen or remove gives "it breathes" without giving "it is painful to read," and the Full-bleed preset honors Grant's literal request for anyone who wants it.

One-line recommendation: replace the fixed `max-w-5xl` / edge-to-edge boxes with a fluid `ch`-based readable measure (default ~72ch, centered) plus a Narrow / Comfortable / Wide / Full-bleed width control in Focus Mode, persisted per user.

This phase touches only Tailwind classes and one small width-preset state. It does NOT touch the block model, the buffer, or the tour, so it can ship on its own immediately. (UI-only, so per house workflow it can merge to local main on report.)

## 4. The live-preview model: the two realistic paths

### Path A: EVOLVE the current block model (in-house)

Keep the block parser + per-block render, but push it toward inline preview:

A1. Render-in-place per block (drop the textarea swap for inline-formatted blocks). Instead of swapping a block to a raw `<textarea>`, make the focused block a `contentEditable` region that shows the RENDERED inline result (bold is bold, links are links) while revealing the raw markers only on the line/span containing the caret. The block parser already gives clean block boundaries; the new work is intra-block inline tokenization (bold / italic / code / link / strike / underline) plus caret-aware marker reveal.

A2. Drop the separate Preview tab. With in-place rendering the Hybrid / Preview toggle loses its reason to exist; the surface is always "live." Preview becomes redundant (you are always seeing the rendered result).

Tradeoffs:
- Local-first / round-trip: EXCELLENT. We still own the source string; serialization is "block.source spliced back into the document," exactly as today. No serializer to write for block structure.
- Manual-save / versioning: EXCELLENT. The buffer model is unchanged in spirit (a focused block holds in-flight content, committed on explicit signals). `pushAndCommit` / `ValueHistory` / `useUnsavedChangesGuard` are untouched.
- Tour: GOOD but needs care. The tour resolves a real `<textarea>` inside `[data-tour-target="hybrid-editor-textarea"]`, sets its value via `safeTypeAction`, and dispatches a real Escape `KeyboardEvent` to commit (`hybrid-editor-helpers.tsx:84-110`, `commitOpenEditAction`). A `contentEditable` is NOT a textarea: `safeTypeAction` and the value/`onChange` plumbing would break. Mitigation: keep a real `<textarea>` as the inline editing primitive for the FOCUSED line/span only (a "single live line" textarea overlaid on the rendered block), so the tour's typing target and Escape-commit handshake survive with minimal selector changes. This is the single biggest implementation risk in Path A and must be designed against the tour helpers explicitly.
- Bundle size: ZERO new deps. We already ship react-markdown + remark/rehype. The inline tokenizer is small in-house code (we already hand-roll the block parser and `remark-underline`).
- Migration cost: MEDIUM. The block parser, surfaces, save model, and most shortcuts are reused as-is. The new code is the inline-token caret-reveal layer and the contentEditable/overlay-textarea focus handling, which is fiddly (selection mapping, IME/composition, caret math). Risk concentrated in one component.
- Typora feel: GOOD, not perfect. You get "no modes" and "rendered while editing," which is most of the win. Caret-precise per-token reveal (Typora's signature) is achievable but is the hard 20% and where polish bugs live.

### Path B: ADOPT a WYSIWYG markdown library

Swap the editing core for a library that does inline rendering and serializes to markdown. Candidates and their fit for THIS app:

- CodeMirror 6 (+ a markdown live-preview setup): a source-of-truth-is-text editor with decorations that render markdown inline. Closest in PHILOSOPHY to our model (text is the source; decorations reveal/hide markers near the caret), which is exactly Typora's mechanism. Real `textarea`-like editing semantics, strong IME, modest bundle (~150-250KB depending on extensions), tree-shakeable. Serialization is trivial because the document IS markdown. Best fit of the libraries for local-first + the tour (it has a real text document and dispatchable transactions).
- Milkdown (ProseMirror-based, markdown-native): purpose-built Typora-like WYSIWYG with markdown round-trip via remark. Closest in FEEL to Typora out of the box. But it is a ProseMirror document model under the hood, serialized to markdown on demand: round-trip is lossy for anything the schema does not model (our `<u>` HTML, raw HTML blocks, exotic GFM), and the tour's textarea-typing + synthetic-Escape handshake does not map onto a ProseMirror contentEditable. Heavier (ProseMirror core + plugins, ~300KB+).
- TipTap (ProseMirror) / Lexical / Slate: rich-text-first frameworks. Markdown is an import/export concern, not the native document. Highest round-trip risk for a local-first plain-markdown-on-disk app, biggest tour rework, largest bundle. Not recommended here.

Tradeoffs (for the realistic candidate, CodeMirror 6, with Milkdown noted):
- Local-first / round-trip: CodeMirror EXCELLENT (document is text). Milkdown RISKY (PM-to-markdown serialization; our `<u>`/raw HTML and any non-schema content can drift). This is the dealbreaker axis for a notebook whose contract is "clean markdown on disk."
- Manual-save / versioning: workable but a REWIRE. We would drive saves off the library's transaction/state rather than our buffer refs; `ValueHistory` is replaced by the library's own history (CM6 and PM both have history extensions). The explicit-save-only contract must be reimposed (do NOT let the lib autosave to the parent on every keystroke). Achievable, but the existing battle-tested buffer code is discarded.
- Tour: HIGH cost. Every `data-tour-target` typing/commit beat (`hybrid-editor-textarea`, the Escape-commit, `+ Add paragraph`) must be re-authored against the library's API. With CM6 we can dispatch transactions/synthetic input deterministically (cleaner than PM); with Milkdown/PM the synthetic-typing-into-contentEditable story is the worst of the lot.
- Bundle size: +150-350KB depending on choice (CM6 leanest, PM-stack heaviest). Today we ship zero editor lib.
- Migration cost: HIGH. Replaces the core editing surface; must keep image blob resolution, attachment drag-drop, the file-link click flow, shortcuts, sanitize schema, and the manual-save contract. Big, single-shot risk.
- Typora feel: Milkdown BEST out of the box; CM6 GOOD with a live-preview config (and matches Typora's actual underlying technique).

### Recommendation

EVOLVE in-house (Path A), staged, with CodeMirror 6 held as the explicit fallback if Path A's caret-precise inline reveal proves too fiddly to polish.

Headline tradeoff: Path A protects the three things that are genuinely load-bearing here -- lossless plain-markdown round-trip (we keep the source string as truth), the manual-save + version-history contract, and the v4 tour's textarea-typing + synthetic-Escape handshake -- at the cost of writing the hard caret-aware inline-reveal layer ourselves and not getting Typora's last-10% polish for free. Adopting a library (Path B) buys the Typora feel faster but puts the round-trip contract at risk (Milkdown) or forces a full rewrite of the save model and the entire tour (any library), for +150-350KB of bundle. For a local-first notebook whose entire value proposition is "your data is just clean markdown files you own," the round-trip risk and the tour rework outweigh the speed-up. CodeMirror 6 is the right fallback precisely because its document IS text, so it shares Path A's round-trip and tour-friendliness while giving us the inline-decoration machinery for free.

## 5. Phased plan

- Phase 1 (ship now, standalone): the sizing fix. Fluid `ch`-based readable measure (default ~72ch, centered) replacing the edge-to-edge normal surface and the `max-w-5xl` Focus Mode box, plus a Narrow / Comfortable / Wide / Full-bleed width control in Focus Mode, persisted per user. No block-model, buffer, or tour changes. UI-only.
- Phase 2 (live-preview groundwork): drop the Hybrid / Preview MODE toggle in favor of always-live; build the intra-block inline tokenizer (bold / italic / code / link / strike / underline) and render the NON-focused blocks with inline formatting already shown (they mostly are today via per-block ReactMarkdown -- the real change is removing the toggle and the textarea-shows-raw-markers behavior for inline spans).
- Phase 3 (the Typora core): in-place editing of the focused block with caret-aware raw-marker reveal. Keep a real `<textarea>` as the focused-line editing primitive so the tour's typing + synthetic-Escape commit handshake survives; re-point `data-tour-target="hybrid-editor-textarea"` and re-verify every editor walkthrough beat. This is the high-risk phase; gate it behind the post-redesign auto-verify loop (mechanics + spec-compliance + fresh-eyes) before it becomes default.
- Phase 4 (decision gate): if Phase 3's caret-precise inline reveal cannot be polished to Grant's bar in-house, pivot the editing core to CodeMirror 6 live-preview (document stays text, so Phases 1-2 and the round-trip contract carry over), and re-author the tour beats against CM6 transactions.

## 6. Open questions for Grant (HR to relay)

1. How far to go: true inline WYSIWYG where raw syntax hides until the caret reaches it (full Typora), or an "improved hybrid" that drops the modes and shows rendered blocks but still reveals whole-line raw markers on the active line? The first is more work and more polish risk; the second is most of the feel for much less risk.
2. Appetite for a 3rd-party editor library vs evolving in-house? If yes to a library, is CodeMirror 6 (text-native, ~lean, best local-first/tour fit) acceptable, and is a +150-250KB bundle increase OK? (Milkdown gives the best Typora feel but risks lossless markdown round-trip, which seems contrary to the local-first promise -- confirm that round-trip fidelity is non-negotiable.)
3. Width behavior preference: fluid readable measure (recommended default ~72ch, centered), fixed-readable, or user-resizable presets including Full-bleed? Confirm the default and whether Full-bleed should even be offered.
4. Should the Hybrid / Preview MODE toggle disappear entirely once editing is always-live, or do you still want a one-click "clean read-only render" (e.g. for proofreading / presenting)?
5. Scope: apply the new model to ALL markdown surfaces at once (Lab Notes, Results, Notes, Methods write-up, method create/variation panels), or pilot it on one surface (e.g. standalone Notes) first?
6. Confirm the structured method editors (PCR, plate, LC gradient, mass spec, qPCR, cell-culture, coding-workflow, purchases) stay entirely out of scope -- the Typora change is markdown-surfaces-only.
