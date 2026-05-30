# CM6 Inline-Reveal Layer (Typora editor chip 2 / T4): build-design

Author: CM6-inline-reveal design pass (for HR), 2026-05-30. Companion to MARKDOWN_EDITOR_TYPORA_DESIGN.md (the parent design) and the CM6 readiness report (dep manifest + chip 1 mount/save). This designs the hard part: the caret-aware inline-reveal feel. Read-only design; no code yet. Untracked until the editor arc is greenlit.

## Headline decision: TOUR STAYS ON HYBRID (Option A), zero tour cost
The new CM6 inline editor ships as an OPT-IN third EditorMode ("inline") alongside "hybrid"/"preview". The v4 onboarding tour mounts the editor in HYBRID mode (its current default), so every textarea-typing + synthetic-Escape tour beat keeps working verbatim. Root cause confirmed: BeakerBotCursor.typeInto only types into a native textarea/input, and the commit beat is a synthetic Escape on the textarea; CM6 .cm-content is a contentEditable div with neither, so both type + commit beats are inert against CM6. Keeping the tour on hybrid avoids re-authoring 7 beats + the persona break-bots. Option B (re-author the bold/italic/underline/h1-3 + hybrid-shortcuts beats onto CM6 EditorView.dispatch transactions via a new cmTypeInto helper + a cm-inline-editor data-tour-target) is DEFERRED to Phase 3, only if CM6 becomes the onboarding default. The build chip brief MUST state Option A so the builder does not touch the tour.

## Core mechanic: one ViewPlugin holding a DecorationSet
- ViewPlugin.fromClass with decorations field; update() rebuilds when: docChanged || viewportChanged || selectionSet || syntaxTree(startState) !== syntaxTree(state). The selectionSet trigger is the Typora reveal (caret move un-hides the token under it); the tree-identity trigger handles lezer incremental/async parse finishing a tick later.
- provide BOTH EditorView.decorations AND EditorView.atomicRanges (the replace-only set), so the caret jumps over a hidden marker instead of landing inside it.
- buildDeco walks syntaxTree over view.visibleRanges ONLY (viewport-scoped, so per-caret rebuild is bounded by viewport size, not doc size).

## Hide / reveal rule
- Markers are SEPARATE lezer child nodes: EmphasisMark (in Emphasis/StrongEmphasis), HeaderMark (ATXHeading1..6), LinkMark/URL/LinkTitle (Link/Image), CodeMark (InlineCode/FencedCode), QuoteMark, StrikethroughMark; GFM adds Strikethrough + Table/TableHeader/TableDelimiter/TableRow/TableCell.
- For each container node, revealed = selectionTouchesNode(sel, node.from, node.to) using CLOSED-interval overlap (r.from <= nodeTo && r.to >= nodeFrom) so a bare caret at either boundary reveals the token. Nesting (bold inside link): each containing container reveals independently; markers are disjoint so no decoration conflict.
- Not revealed: Decoration.replace({}) over each marker child (collapses to zero width, no layout shift) + Decoration.mark({class}) over the content so it stays styled (cm-strong/cm-em/cm-underline/cm-strike/cm-inline-code/cm-h1..h6).
- Revealed: emit no replace for that container's markers (they render as source text); keep the content mark so it stays styled.
- Atomicity: only the replace ranges go into EditorView.atomicRanges (mark ranges are NOT atomic, so the caret can sit inside bold text).

## Block widgets (tables, fenced code)
- A Table or FencedCode block NOT touched by the selection becomes a single block:true Decoration.replace({ widget }) over the node's full line span; WidgetType.toDOM renders it (table via remarkGfm + rehypeRaw + [rehypeSanitize, markdownSanitizeSchema]; fenced code via rehype-highlight or CM6 highlighter), memoized by source via eq().
- Caret enters the block range -> no widget emitted -> raw source shows as editable text. selectionSet-driven, same as inline tokens. Atomic so the caret cannot land in the collapsed source; optional mousedown-to-enter polish in the widget DOM.

## Dialect preservation (byte-for-byte round-trip)
- The layer NEVER dispatches a doc-changing transaction; every op is a Decoration (replace/mark/widget). So view.state.doc.toString() == the user's keystrokes exactly; saveRef.current = () => view.state.doc.toString().
- Single-_ underline: handled DECORATION-ONLY by reading the delimiter char from the doc (sliceDoc(from,from+1)==="_"), same test as remark-underline; underscore-Emphasis content gets cm-underline, asterisk-Emphasis gets cm-em. NO grammar change, NO source change. (A custom lezer Underline node is an optional nicety, out of scope for chip 2.)
- Literal <u>, <!-- stamp:* --> comments (recommend hide-via-replace to match the rendered allowComments:true behavior), raw <img> (optional inline widget), GFM tables/strike: all source-preserving.

## Sanitize reuse
Every HTML-rendering widget (image inline widget resolving relative src via the existing blob-URL resolver; table block widget; any raw HTML block) reuses markdownSanitizeSchema (allowComments:true) from @/lib/markdown/sanitize-schema. Do NOT construct a fresh schema, do NOT drop allowComments.

## Keymap
Prec.high(keymap.of([...])) of changeByRange wrap commands for the 8 hybrid shortcut families: Cmd+B (**..**), Cmd+I (*..*), Cmd+U (<u>..</u> literal, NOT _, to preserve the two-form underline contract), Cmd+Shift+X (~~..~~), Cmd+K ([sel](url) caret in url), code-fence combo, Cmd+1..6 (heading marker on line), Ctrl+Q (> blockquote). Toggle semantics by reading the tree at the selection; insert-only is acceptable parity if toggle is too much for chip 2.

## Build-task breakdown (chip 2 / T4), dependency-ordered
1. Marker-node taxonomy module (marker vs container node names + underscore/asterisk Emphasis disambiguator). 2. selectionTouchesNode + reveal predicate (pure, unit-test nesting + boundary). 3. buildDeco(view) viewport-scoped stack-pass producing the combined set + the replace-only atomic set. 4. The inlineReveal ViewPlugin (4-trigger update + dual provide). 5. Theme/styling classes. 6. Block widgets (TableWidget + FencedCodeWidget, sanitize-routed). 7. Image inline widget (blob-resolver + sanitize). 8. Keymap (Prec.high). 9. Round-trip assertion test over the dialect fixture (_underline_, <u>literal</u>, **bold**, <!-- stamp -->, raw <img>, GFM table, ~~strike~~): caret across every token, type-then-revert, assert doc.toString()===input (the go/no-go gate). 10. Tour Option-A lock test (assert the tour-mounted editor is in hybrid mode; no tour edits).

Deferred to Phase 3 (NOT chip 2): the Option-B tour re-author. See reference_cm6_dep_manifest for the install, and the readiness report for chip 1 (mount + save contract).
