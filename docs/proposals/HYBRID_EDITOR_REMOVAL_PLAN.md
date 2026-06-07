# HybridMarkdownEditor removal plan

Status: AUDIT + MIGRATION PLAN. Nothing is deleted by this document. No component changes in this task.

Author: Loro Phase 1 orchestrator, 2026-06-04. Flagged from the Loro Phase 1 smoke test.

## Why this matters now

The collaboration end-game (unified-data-model / Loro pilot) needs live remote cursors in the editing surface. A `<textarea>`-based block editor structurally cannot render another user's caret inside the text. CodeMirror 6 can. So the inline CM6 editor (`InlineMarkdownEditor`) is the strategic editing surface, and `HybridMarkdownEditor`'s removal sits on the path to collab. This plan makes the gap to a clean delete explicit.

## TL;DR

`HybridMarkdownEditor` is already runtime-dead. Every editing surface in the app routes through `LiveMarkdownEditor`, which now renders `InlineMarkdownEditor` (CM6) by default. The hybrid component survives only as a structural `else` branch that nothing reaches, plus a layer of stale comments and one direct unit test. The removal is therefore mostly mechanical, gated on a parity audit (one known small gap) and a tour/test cleanup, not on large feature work.

## 1. Usage map (every real reference)

Grep across `frontend/src` for `HybridMarkdownEditor` returns 21 files. Exactly ONE is a live component import. Everything else is comments or tour/test infrastructure.

### 1a. The one real importer

| Site | Kind | Notes |
| --- | --- | --- |
| `frontend/src/components/LiveMarkdownEditor.tsx:15` | import + render at `:2342` | The sole place the JSX `<HybridMarkdownEditor>` is mounted. It is the `else` branch of the render switch (see section 2). |

Every other editor consumer in the app imports `LiveMarkdownEditor`, never `HybridMarkdownEditor` directly. Confirmed consumers of `LiveMarkdownEditor`:

- `app/methods/page.tsx:1801`
- `components/NoteDetailPopup.tsx:1605`, `:1656`
- `components/TaskDetailPopup.tsx:4363`, `:4897`
- `components/methods/CompoundChildCreator.tsx:689`
- `components/methods/VariationNotesPanel.tsx:404`
- `components/methods/CreateMethodModal.tsx:906`

### 1b. Hybrid-only dependencies (dead once Hybrid is gone)

| Module | Imported by | Disposition |
| --- | --- | --- |
| `lib/undo/value-history.ts` (`ValueHistory`) | ONLY `HybridMarkdownEditor.tsx` | Delete with Hybrid. Inline owns a separate CM6 `history()` stack and does not use `ValueHistory`. |
| `lib/markdown-block-parser.ts` | ONLY `HybridMarkdownEditor.tsx` | Delete with Hybrid (verify its test is the only other importer). |

### 1c. SHARED dependency (must NOT be removed)

| Module | Imported by | Disposition |
| --- | --- | --- |
| `components/MarkdownShortcutsSidebar.tsx` | `LiveMarkdownEditor.tsx` (inline branch, `:2320`) AND `InlineMarkdownEditor.tsx` | KEEP. The inline editor renders this rail. Its file-header comment still claims "HybridMarkdownEditor still renders its own inline copy", which is now stale wording (Hybrid had its own private copy of the rail, not this component). Update the comment, do not remove the file. |

### 1d. Comment-only references (no code dependency)

These mention `HybridMarkdownEditor` only in prose. None import or render it. They need a comment sweep at delete time, nothing more.

- `components/RenderedMarkdown.tsx:35`
- `components/BeakerBotCursor.tsx:90`, `:552`, `:720`
- `components/InlineMarkdownEditor.tsx` (several comments contrasting its design with Hybrid)
- `components/TaskDetailPopup.tsx:681`
- `lib/undo/value-history.ts` header (moot once the file is deleted)
- `lib/markdown-block-parser.ts:239` (moot once the file is deleted)

### 1e. Onboarding / tour references

| Site | Kind | Notes |
| --- | --- | --- |
| `onboarding/v4/steps/walkthrough/InlineEditorStep.tsx` | comment-only | This step ALREADY replaced the old ~15-beat hybrid deep-dive. It spotlights `data-tour-target="inline-editor-surface"` (the CM6 surface). Comments mention Hybrid historically. No change needed beyond optional comment trim. |
| `onboarding/v4/steps/walkthrough/MethodsCreateStep.tsx` | comment-only (code already migrated) | The "methods-create-inline-typing" pass (2026-06-03) already rewired this from poking a hybrid `<textarea>` to dispatching the `tour:fill-method-body` event the modal listens for. Works against inline today. Header comments still describe the old textarea path. Comment-only cleanup. |
| `onboarding/v4/steps/walkthrough/HybridSaveConceptStep.tsx` | concept step, save model still valid | Teaches "ResearchOS does not auto-save, hit Save". That manual-save concept is TRUE of the inline editor too (the parent popup owns Save; the editor exposes the same `saveRef` / `onExplicitSave` / `onDirtyChange` contract). The step is pure narration with NO spotlight on a hybrid DOM node, so it does not break. The word "hybrid" in its id / filename is the only liability. Rename / re-voice during cleanup, do not delete the teaching beat. |
| `walkthrough/lib/cursor-script.ts`, `lib/synthetic-escape.ts`, `lib/targets.ts` | comment-only | Tour infrastructure. Mentions Hybrid in comments and (`targets.ts`) describes block-list anchors. No live dependency on the Hybrid component. Comment sweep only. |

### 1f. Tests

| Test | Kind | Disposition |
| --- | --- | --- |
| `components/__tests__/HybridMarkdownEditor.test.tsx` | mounts `<HybridMarkdownEditor>` directly | Delete in the final step with the component. |
| `components/__tests__/LiveMarkdownEditor.focusMode.test.tsx` | exercises the wrapper | Re-point any hybrid-branch assertions at the inline branch, or confirm they already drive inline. |
| `components/__tests__/BeakerBotCursor.test.tsx`, `onboarding/v4/__tests__/TourController.test.tsx`, `walkthrough/__tests__/cursor-script.test.tsx` | reference in fixtures/comments | Verify green after the component delete; adjust comment-derived fixtures if any. |
| `lib/markdown-block-parser.test.ts` | tests the hybrid-only parser | Delete with `markdown-block-parser.ts`. |

## 2. How the runtime already avoids Hybrid

`LiveMarkdownEditor` resolves a render mode and switches three ways (`LiveMarkdownEditor.tsx`):

- `currentMode = onModeChange ? mode : internalMode`, where `mode` DEFAULTS to `"inline"` (`:249`).
- `EditorMode = "hybrid" | "preview" | "inline"` (`:84`).
- Render switch (`:2290` onward):
  1. `previewMode` -> ReactMarkdown read-only preview.
  2. `enableInlineMode && currentMode === "inline"` -> `<InlineMarkdownEditor>` (`:2300`). `enableInlineMode` DEFAULTS to `true` (`:259`).
  3. otherwise -> `<HybridMarkdownEditor>` (`:2342`).

The toolbar exposes only two pills, "Edit" (sets `inline`) and "Preview" (`:1890`, `:1904`). No control sets `"hybrid"` anymore. A grep confirms NO caller passes `enableInlineMode={false}` and NO caller passes `mode="hybrid"`. So branch 3 is unreachable in the shipping app. Hybrid is a dormant fallback, not a live surface.

This is the key reason removal is low-risk. We are deleting dead code, not switching a live editor.

## 3. Inline vs Hybrid parity (what Inline is, or is not, missing)

The original worry list was toolbar, image/file drop, shortcuts sidebar, width presets, preview mode, manual-save buffer. Auditing the actual wiring, almost all of these live in the `LiveMarkdownEditor` WRAPPER (shared by both branches) rather than inside the Hybrid child, so the inline branch already inherits them.

| Capability | Where it lives | Inline status |
| --- | --- | --- |
| Toolbar (Edit / Preview / Focus / Add image) | Wrapper, above the branch switch | Shared. Inline gets it. |
| Preview mode | Wrapper branch 1 (ReactMarkdown) | Shared. Inline coexists with it. |
| Markdown-shortcuts / Style Guide rail | `MarkdownShortcutsSidebar`, rendered in the inline branch (`:2320`), insert via `insertRef` | Present. NOT a gap. |
| Width presets (Narrow / Comfortable / Wide / Full-bleed) | Wrapper computes `measureClass`, passed to inline (`:2337`) | Present. |
| Native OS file/image drop, ImageStrip drag, FileStrip drag | Wrapper `onDrop` / `onDropCapture` on `editorContentRef` (`:2023`, `:2036`, `:1870`), which wraps BOTH branches | Caught at wrapper level for inline too. `onImageDrop` / `onFileDrop` are wrapper props, still fire. |
| Form-B sidecar rehydration, broken-ref scan, blob-URL resolver | Wrapper | Shared. |
| Manual-save buffer | Different implementation. Hybrid uses a block buffer + `ValueHistory`. Inline uses the CM6 document + `history()` and the SAME outward contract (`saveRef` / `onExplicitSave` / `onDirtyChange`). | Equivalent contract, distinct internals. |
| Inline-reveal widgets + image widget (chip 2b) | `InlineMarkdownEditor` wires `inlineRevealExtension` + `imageBasePathExt` (`:178`, `:179`) | Present. The file-header comment claiming "chip 1 only / NO inline reveal" is STALE. |
| `autoStartEditing` empty-state textarea | Hybrid-only concept (click-to-start placeholder vs immediate textarea) | Moot for inline. The CM6 surface is always live and editable, which is exactly what `autoStartEditing` wanted. `CreateMethodModal` passes the prop; inline ignores it harmlessly. |

### Known parity gap (one, small)

- `imageBasePath` is NOT forwarded from `LiveMarkdownEditor` to `InlineMarkdownEditor` at the inline call site (`:2328`), even though `InlineMarkdownEditor` accepts it (`:95`) and uses it for the inline image widget's relative-src to blob-URL resolution. Hybrid receives `imageBasePath` (`:2347`). Effect: inline `Images/...` image widgets resolve against the data root instead of the surface's base path, so an image may fail to preview inline on surfaces that set a non-root `imageBasePath` (methods, task results). This is a one-line plumbing fix, not feature work, and it gates nothing structural. It should be fixed and verified BEFORE the safety-net delete in Phase 3.

### Verify-before-delete items (suspected fine, confirm in a real session)

- ImageStrip / FileStrip DROP insertion point. Confirm the wrapper inserts the `![](Images/...)` / `[name](Files/...)` snippet at the CM6 caret (via `insertRef`) and not via a hybrid-block path.
- Focus Mode buffer-safety portal. The portal re-parent guard (`commitBufferRef`) was written around the hybrid child. Confirm the inline child's save contract survives the focus-mode enter/exit re-parent (element identity is preserved today, so this should hold).

## 4. Phased removal plan

Principle: keep Hybrid as a dormant safety net until inline parity is verified on every surface in real use, THEN delete in one mechanical pass. Each phase is independently shippable.

### Phase 0. Plumb the parity gap (prep, no deletes)

1. Forward `imageBasePath` to `InlineMarkdownEditor` at `LiveMarkdownEditor.tsx:2328`.
2. Verify inline image preview on methods (`imageBasePath="methods/<slug>"`) and task results.
Gate for: Phase 3.

### Phase 1. Confirm inline is the only reachable branch (no code change, audit only)

1. Re-grep for `enableInlineMode={false}` and `mode="hybrid"` across the app. Expected: zero hits (current state).
2. Walk each `LiveMarkdownEditor` consumer (notes, methods page, CreateMethodModal, CompoundChildCreator, VariationNotesPanel, task notes, task results) in a real session and confirm the CM6 surface mounts, types, renders inline, and saves.
Outcome: documents that Hybrid is unreachable, justifying the delete.

### Phase 2. Tour and concept cleanup (low risk, user-visible wording only)

1. `HybridSaveConceptStep`: rename the step id / file to drop "hybrid" and re-voice to "the editor" (the manual-save concept stays; it is true of inline). Update `TourController` registration and any `targets.ts` reference.
2. Trim stale Hybrid mentions from `InlineEditorStep`, `MethodsCreateStep`, `cursor-script.ts`, `synthetic-escape.ts`, `targets.ts` comments.
3. Update the `MarkdownShortcutsSidebar` header comment so it no longer claims Hybrid renders a copy.
Gate for: nothing downstream, can land anytime. Verify the v4 tour still walks clean (persona break-bots).

### Phase 3. Delete the Hybrid branch and component (the switch flip)

Only after Phase 0 lands and Phase 1 confirms unreachability.

1. In `LiveMarkdownEditor.tsx`, delete the `else` branch (`:2341` to `:2367`) and remove the `import HybridMarkdownEditor` (`:15`). Collapse the now-redundant `enableInlineMode && currentMode === "inline"` guard if it becomes always-true (decide whether to keep `enableInlineMode` as a public prop or retire it too; retiring it is cleaner but touches `NoteDetailPopup`, which passes it).
2. Delete `components/HybridMarkdownEditor.tsx`.
3. Delete the now-orphaned hybrid-only deps `lib/undo/value-history.ts` and `lib/markdown-block-parser.ts` (re-grep to confirm zero non-test importers first).
4. Delete `components/__tests__/HybridMarkdownEditor.test.tsx` and `lib/markdown-block-parser.test.ts`.
5. Remove `"hybrid"` from the `EditorMode` union and any now-dead `mode === "hybrid"` handling.
6. Sweep remaining comment-only mentions (`RenderedMarkdown`, `BeakerBotCursor`, `TaskDetailPopup`, `InlineMarkdownEditor` self-comments) for accuracy.

### Phase 4. Final verification

1. `tsc` and `vitest` from `frontend/` (the `@` alias lives in `frontend/vitest.config.mts`; running from repo root fails all tests).
2. Full v4 tour walk plus a manual pass over every editor surface.
3. Grep `frontend/src` for `HybridMarkdownEditor` and expect zero hits.

## 5. Risk summary

- Lowest risk: the live app already never renders Hybrid, so Phase 3 removes dead code.
- Main residual risk: a surface that silently relied on a prop only Hybrid received (`imageBasePath` is the one found; addressed in Phase 0). The Phase 1 per-surface walk is the catch-net for any second instance.
- Tour risk: confined to wording and one concept-step rename. The interactive tour code was already migrated to inline on 2026-06-03.

## Appendix. Verification of this audit

- This doc only adds a markdown file under `docs/proposals/`. No component, test, or config was changed, so nothing builds or breaks as a result of this task.
- Findings derived from reading `LiveMarkdownEditor.tsx`, `InlineMarkdownEditor.tsx`, `HybridMarkdownEditor.tsx`, the walkthrough steps, and `grep` of `frontend/src` on 2026-06-04.
