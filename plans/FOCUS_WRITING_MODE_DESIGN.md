# Writing Focus Mode: Design Doc

Author: focus-writing-mode design bot (for HR), 2026-05-29

## 0. Decisions locked (Grant, 2026-05-29)

All four open questions from §11 are resolved. Build to these:
1. Escape: GUARDED exit (§5 tertiary). Escape exits focus mode only when parked (no block mid-edit, no block selected, no tour cursor lock active) and early-returns on `isTourSyntheticEscape`. While editing, Escape keeps its existing block-commit behavior and never exits focus mode. When the guard does act, it `stopPropagation()`s so the host popup does not also close.
2. Shortcut: Cmd/Ctrl+Shift+F toggles focus mode on and off, bound on the editor's existing document-level keydown and scoped to the focused editor (`containerRef.current.contains(document.activeElement)`).
3. Save: focus mode renders its OWN Save affordance in the overlay (reusing `saveRef` + `onExplicitSave` where the host provides them, otherwise the editor's internal `manualSave`), because the host disk-Save button is covered by the overlay.
4. Preview: KEEP a compact Hybrid/Preview toggle on the calm surface; hide Add File / Browse / Strip. Attachments stay reachable via a single collapsed toggle.

Open questions §11.5 (Methods in scope) and §11.6 (NoteDetailPopup Escape inconsistency) stand as written: Methods IS in scope for the first cut; the NoteDetailPopup Escape gap is a pre-existing nit to fix separately, moot while focus mode is open.

## 1. What this is, and what it is not

ResearchOS centers on one rich markdown surface: `HybridMarkdownEditor` (block-level click-to-edit, manual save) wrapped by `LiveMarkdownEditor` (toolbar, attachments, preview toggle). The same wrapper is mounted inside experiment Lab Notes, experiment Results, standalone Notes, and the Methods write-up. In every one of those hosts the actual writing column is squeezed by chrome: the host popup frame (tabs plus a top-right icon rail), the editor toolbar (Hybrid / Preview / Add File / Strip), the left Shortcuts / Style Guide rail, and the bottom Images / Files tray.

Writing Focus Mode promotes ONLY the editor: it pops the writing column to take over the full viewport on a calm surface, hides or de-emphasizes the surrounding chrome, keeps Save reachable, and lets the user return to the normal view cleanly.

It is a distinct feature from the experiment popup's existing Fullscreen toggle. That toggle lives on `TaskDetailPopup` and grows the popup card to `inset-4` (`TaskDetailPopup.tsx:820-825`), driven by an `isExpanded` boolean (`TaskDetailPopup.tsx:152`). It still shows tabs, header rail, toolbar, rails, and tray. Focus Mode is editor-scoped, host-agnostic, and strips chrome rather than just enlarging the card. The two can coexist (see §8).

This doc is design only. No code, no file moves. Concepts first, then a concrete recommendation per question.

## 2. The surfaces (verified call sites)

Every full markdown editing surface mounts `LiveMarkdownEditor`. The complete set:

1. Experiment Lab Notes tab: `frontend/src/components/TaskDetailPopup.tsx:4022` (inside `LabNotesTab`, section marker at `TaskDetailPopup.tsx:3414`).
2. Experiment Results tab: `frontend/src/components/TaskDetailPopup.tsx:4545` (inside `ResultsTab`).
3. Standalone Notes (single note and running-log entries): `frontend/src/components/NoteDetailPopup.tsx:1214` (running-log branch) and `:1242` (single-note branch).
4. Methods write-up edit view: `frontend/src/app/methods/page.tsx:1595`.

Secondary mounts that also use the full editor (worth opting in for consistency, lower priority than the four Grant named):

5. Method create modal: `frontend/src/components/methods/CreateMethodModal.tsx:831`.
6. Method variation notes panel: `frontend/src/components/methods/VariationNotesPanel.tsx:404`.
7. Compound child creator: `frontend/src/components/methods/CompoundChildCreator.tsx:689`.

`RenderedMarkdown.tsx` is read-only display only (`RenderedMarkdown.tsx:33` explicitly points editable contexts at `LiveMarkdownEditor` / `HybridMarkdownEditor`); it is NOT a focus-mode surface.

Because all seven mount the SAME `LiveMarkdownEditor`, putting Focus Mode inside `LiveMarkdownEditor` gives all of them the feature from one implementation. That is the core of the reuse argument in §6.

## 3. The chrome map (who renders what)

Splitting the chrome by owner matters because Focus Mode must hide the right pieces and must NOT depend on a host to do it.

`LiveMarkdownEditor` (the wrapper) renders:
- The top toolbar row: Hybrid / Preview toggle, Add File / Add Image, optional Browse, Strip toggle (`LiveMarkdownEditor.tsx:1428-1513`). Gated by `showToolbar`.
- The bottom Images / Files attachment tray (`LiveMarkdownEditor.tsx:1809-1846`), gated by the internal `showAttachmentStrip` state (`:255`).
- The body slot that renders either the preview render or the child `HybridMarkdownEditor` (`LiveMarkdownEditor.tsx:1782-1798`).
- Outer container is `flex flex-col h-full` (`LiveMarkdownEditor.tsx:1419`).

`HybridMarkdownEditor` (the child) renders:
- The left Shortcuts / Style Guide rail (`helperCollapsed` state at `HybridMarkdownEditor.tsx:711`; rail JSX at `:2991-3114` for the main branch, `:2746-2870` for the empty-state branch), gated by `showShortcutsHelper`.
- A floating `SaveChrome` button pinned top-right of the editor surface (`HybridMarkdownEditor.tsx:3125-3131`, component at `:490-541`), gated by `hideSaveButton`.
- The block list and "+ Add paragraph" affordance (`:3137-3147`).

The HOST renders the rest: tabs, the top-right icon rail (edit / export / deposit / share / fullscreen / delete / close at `TaskDetailPopup.tsx:1106-1226`), and in the popup hosts a dedicated "Save notes" / "Save results" disk button (which is why those hosts pass `hideSaveButton` and own Save via `saveRef` / `onExplicitSave`, e.g. `TaskDetailPopup.tsx:4042-4045`).

Implication: a Focus Mode that lives inside `LiveMarkdownEditor` can hide its own toolbar and tray and the child's rail with local state, but it canNOT reach up and hide the host popup chrome from inside. The recommended visual treatment (§5) sidesteps this by rendering Focus Mode as a full-viewport overlay that simply COVERS the host chrome rather than trying to mutate it.

## 4. The Escape problem (the hard part)

Grant is right that Escape is overloaded. Reading the live handlers, here is the precedence as it actually resolves today, from innermost to outermost:

1. Block-edit Escape, `HybridMarkdownEditor.tsx:1769-1796` (`handleEditKeyDown`). When a block textarea is focused and the user hits Escape, this commits the buffered edit, blurs the textarea, calls `handleEditBlur`, then `e.preventDefault()` AND `e.stopPropagation()`. The stopPropagation is deliberate (comment at `:1770-1776`): it stops the host popup's window-level keydown from ever seeing this Escape and closing the popup mid-edit.
2. Selected-block Escape, `HybridMarkdownEditor.tsx:1309-1310`. When a block is selected (not editing), Escape clears the selection. This handler early-returns if focus is in an input / textarea / contentEditable (`:1283-1290`), so it only fires when the editor has a non-text selection.
3. Host popup Escape. `TaskDetailPopup.tsx:577-598`: if focus is on a text-shaped input (`isTextInputEl`, `:554-576`) it returns and lets the field own Escape; else if `isExpanded` it shrinks the popup; else it closes. `NoteDetailPopup.tsx:369-376` is similar BUT has no text-input guard: it shrinks if expanded, else closes, unconditionally. The Methods page host has its own handlers; `app/methods/page.tsx` does not pair the editor with a popup-style Escape-to-close.
4. Tour Escape. `TourController.tsx:2152-2174`: while a walkthrough is mounted, Escape opens a skip-confirm. It skips when the event is a tour-synthetic Escape (`isTourSyntheticEscape`, `:2169`) and skips when focus is in an editable element and the cursor lock is not active.
5. Document-level Cmd/Ctrl+S, `HybridMarkdownEditor.tsx:2228-2253`, is the only save shortcut; it is NOT Escape but is listed because Focus Mode must not break it (it scopes to `containerRef.current.contains(active)`, so it keeps working as long as the editor container stays mounted, which the overlay preserves, see §7).

Why a naive "Escape exits Focus Mode" is unsafe: Escape is consumed at layer 1 with stopPropagation whenever a block is mid-edit, so a Focus-Mode-level Escape listener would NOT even receive the event in the most common writing state (actively typing in a block). It would only receive Escape when no block is being edited and nothing is selected, i.e. the user is parked. In that parked state a Focus-Mode Escape listener competes directly with the host popup's "Escape shrinks / closes" (layer 3) and, during the tour, with the skip-confirm (layer 4). Relying on Escape ordering here is brittle: it depends on listener registration order between a Focus-Mode window listener and the host's window listener, which is not guaranteed across the four hosts (and `NoteDetailPopup` has no text-input guard at all).

## 5. Recommended exit mechanism

Primary: a dedicated, always-visible floating "Exit focus" control in a fixed top-right corner of the Focus Mode overlay. It is a real button (inline SVG "collapse" glyph, no emoji, no native `title`), wrapped in the project `<Tooltip label="Exit focus mode (Esc)" placement="bottom">` per house style (`Tooltip.tsx:21-27`). Clicking it always exits, in every host, regardless of edit state. This is the reliable path and the one the tour drives.

Secondary (keyboard): a non-colliding shortcut, Cmd/Ctrl+Shift+F (mnemonic: Focus). It is bound on the same document-level keydown the editor already owns for Cmd+S (`HybridMarkdownEditor.tsx:2228`), scoped the same way (only fires when `containerRef.current.contains(document.activeElement)`), so it does NOT fight any of the Escape layers and cannot leak to other editors on the page. The same chord toggles Focus Mode on and off, mirroring the Cmd+S precedent of one document-level binding that the editor owns when it has focus. Avoid Cmd/Ctrl+Period: it is a common OS / app text-substitution and emoji-picker shortcut on macOS.

Escape as a tertiary, conditional exit (recommended ON, but only as a convenience, never the sole path): bind an Escape listener on the Focus Mode overlay that exits ONLY when there is no active block edit (`isEditingRef.current === false`) AND no selected block (`selectedBlockOffset === null`) AND no tour cursor lock is active. In that parked state, layer 1 never fires (no textarea focused) and layer 2 only clears a selection (which the guard already excludes), so the overlay listener can safely claim Escape and call `e.stopPropagation()` to keep it from reaching the host popup. When the user IS mid-edit, we do NOT touch Escape: layer 1 commits and exits the block (existing, correct behavior), and Focus Mode stays up. This gives the familiar "Escape backs me out" feel without ever stealing Escape from a block edit or from the tour, and the always-visible button covers the cases where the precedence guard declines to act.

Rationale for offering all three: every comparable editor (Notion, iA Writer, Typora) offers a visible affordance AND a shortcut; the visible button is the contract the tour and accessibility lean on, the shortcut is for power users, and the guarded Escape matches muscle memory without regressing the four existing Escape behaviors.

Backdrop click is explicitly NOT an exit. The whole point is a distraction-free full surface; a dismiss-on-outside-click would fire on stray clicks at the column margins and feel fragile. The overlay fills the viewport, so there is effectively no "outside" anyway.

## 6. Enter mechanism and the one reusable abstraction

Enter control: a new icon button in the `LiveMarkdownEditor` toolbar, placed next to the Hybrid / Preview toggle (`LiveMarkdownEditor.tsx:1428-1459`), an inline SVG "expand to full screen" glyph wrapped in `<Tooltip label="Focus mode (Cmd+Shift+F)">`. It only renders when `showToolbar` is true, which is the case for all four primary surfaces. The toolbar is the natural home: it already groups view-affecting controls (Hybrid / Preview) and lives in the wrapper that owns the feature.

One reusable mechanism: add Focus Mode state to `LiveMarkdownEditor`, not to each host.
- A single boolean `focusMode` (default false), owned by `LiveMarkdownEditor` as internal state, with an optional controlled `focusMode` / `onFocusModeChange` prop pair for hosts or the tour that need to drive it programmatically (same controlled-or-internal pattern the wrapper already uses for `mode` / `onModeChange` at `LiveMarkdownEditor.tsx:197-209`).
- When `focusMode` is true, the wrapper renders its existing subtree inside a full-viewport overlay via `createPortal(node, document.body)`. The project already uses `createPortal` widely (Tooltip, TourSpotlight, the BeakerBot scenes), so this is an established pattern, not a new dependency.
- Inside the overlay the wrapper hides its own toolbar's non-essential controls and the attachment tray, and tells the child to collapse the rail (see §5 chrome decisions below). Save and Exit stay.

What each surface passes in: nothing new is required for the four primary surfaces beyond what they already pass; Focus Mode rides on the existing `LiveMarkdownEditor` mount. The popup hosts that own Save (`hideSaveButton` + `saveRef` + `onExplicitSave`) keep doing so; Focus Mode must surface a Save affordance even when `hideSaveButton` is set (see §7), because in those hosts the disk-save button lives OUTSIDE the editor and would be hidden behind the overlay. The tour passes the controlled `focusMode` prop (or drives the toolbar button via a `data-tour-target`, see §9).

Chrome decisions inside Focus Mode:
- Hide: the wrapper's Hybrid / Preview toggle is debatable; recommend KEEP a compact Hybrid / Preview toggle (writers do flip to Preview), but hide Add File / Browse / Strip from the top bar to keep the surface calm.
- Keep the attachment tray reachable but collapsed by default: expose a single "Attachments" toggle in the Focus Mode top bar that re-shows the existing Images / Files tray on demand, reusing `showAttachmentStrip`. This satisfies "decide on the images/files access" without cluttering the calm surface.
- Collapse the child's Shortcuts / Style Guide rail by default in Focus Mode (set `helperCollapsed` true on enter), with its existing expand chevron still available. The rail is a distraction for focused writing but should remain one click away.
- Always keep: a Save affordance (top-right) and the Exit focus control (top-right corner).

Comfortable column: center the editor body in a fixed-width reading column, recommend `max-w-3xl` (about 768px) with generous vertical padding, on a calm near-white full-bleed background (`bg-white` or a very light neutral, matching the editor's existing surface), so line length stays comfortable rather than spanning a 27-inch monitor. The overlay itself is `fixed inset-0 z-50` (mirroring `UnsavedChangesModal` at `HybridMarkdownEditor.tsx:567-569`), with the centered column inside it.

## 7. Buffer and state safety (top correctness risk)

This is the single most important correctness constraint, because of the MANUAL-SAVE MODEL (`HybridMarkdownEditor.tsx:1662-1695`). Under that model the in-flight edit lives in a buffer that is only committed to the pending document on explicit exit signals (Escape, block switch, structural transforms), and only flushed to the parent via `onChange` on manual Save (button or Cmd+S). A native blur does NOT commit (that is the whole point of the model).

The danger: if entering or exiting Focus Mode re-parents the editor DOM (e.g. moving the subtree into a portal), React would UNMOUNT and REMOUNT `HybridMarkdownEditor`. A remount wipes all the buffer refs (`editingBlockContentRef`, `editSessionSnapshotRef`, `pendingDocumentRef`, the undo `historyRef`) and drops any uncommitted typing. That would lose work silently, which is unacceptable.

Two ways to avoid it, recommend the second:
- Option A (CSS-state, no portal): do not portal at all. Instead toggle a `focusMode` class on the wrapper's existing container that promotes it to `position: fixed; inset: 0; z-index: 50` in place. The DOM node never moves, so no remount, so the buffer is safe. Downside: a `position: fixed` element is positioned relative to the nearest ancestor with a transform / filter / will-change; the popup card and the tour overlay both use transforms, so "fixed" may not escape the popup's stacking context, leaving Focus Mode trapped inside the popup card rather than covering the viewport.
- Option B (portal, but commit-before-move): RECOMMENDED. Before toggling into the portal, call the editor's existing buffer-flush path so no edit is in-flight across the re-parent, then render through the portal. The editor already exposes exactly this: `saveRef` publishes a function that flushes the buffer and returns the latest document synchronously (`HybridMarkdownEditor.tsx:340-345`), and `commitBufferedEdit` / `handleEditBlur` are the internal commit paths. The cleanest version keeps the SAME React element identity across the toggle so there is no unmount at all: render the wrapper subtree once and only change WHERE it portals to (body vs. in-place). React preserves component state when only the portal container changes between renders, so the buffer refs survive untouched. As a belt-and-suspenders guard, call the flush-to-pending path (not flush-to-disk) on the frame the portal target changes, so even if a future refactor breaks element identity the worst case is "your in-flight block is committed to pending," never "your typing is gone."

Save reachability across the move: in the popup hosts the disk-save button is outside the editor and gets covered by the overlay. Focus Mode must therefore render its OWN Save affordance even when `hideSaveButton` is set. Recommend: in Focus Mode, always show a top-right Save button that, when `onExplicitSave` is provided, flushes via `saveRef` and calls `onExplicitSave` (the same wiring the popup's own button uses), and otherwise falls back to the editor's internal `manualSave`. The Cmd+S document-level binding (`HybridMarkdownEditor.tsx:2228-2253`) keeps working unchanged because the editor container stays mounted and keeps focus.

Unsaved-changes guard on exit: exiting Focus Mode must NOT auto-save and must NOT discard. It simply returns to the normal view with the buffer intact (pending edits stay pending, the host's own dirty / nav-away guard still applies, `useUnsavedChangesGuard` at `HybridMarkdownEditor.tsx:22`). Focus Mode is a view state, not a persistence boundary.

## 8. Interaction with the popup's existing Fullscreen

Recommendation: independent, with Focus Mode visually superseding. Focus Mode is a full-viewport overlay (`z-50`) that covers everything including the expanded popup, so whether the popup is expanded or not underneath does not matter visually. Keep them independent in STATE (Focus Mode does not toggle `isExpanded`), so exiting Focus Mode returns the user to exactly the popup size they had before (expanded or not). This matches the tour's existing flow, where `hybrid-editor-scope` expands the popup first (`HybridEditorScopeStep.tsx:62-65`) and the cluster runs inside the expanded popup; Focus Mode would simply layer on top during the markdown beats and peel back off to reveal the still-expanded popup. Do NOT make Focus Mode auto-collapse or auto-expand the popup; that would surprise the user and complicate the tour state.

## 9. Tour integration

Goal: enter Focus Mode right before the markdown-teaching beats and exit after them, modeled as two action steps in `TOUR_STEP_ORDER` (`step-machine.ts:49`).

Where the markdown phase sits today: the hybrid-editor cluster runs from `hybrid-notes-vs-results` (HE-0, `step-machine.ts:254`) through `hybrid-save-concept` (`:281`). The framing beat `hybrid-editor-scope` (`:260`) already demos the popup Fullscreen toggle by clicking `task-popup-fullscreen` (`HybridEditorScopeStep.tsx`). The actual markdown typing beats are `hybrid-editor-mechanic` through the bold / italic / underline / h1-h3 / shortcuts / image / file beats (`:264-275`).

Proposed two new steps, both universal (NOT gated for any account type, exactly like `hybrid-editor-scope` which returns `false` from `isStepGatedOut`):
- `hybrid-focus-enter`: insert immediately AFTER `hybrid-editor-scope` (`:260`) and BEFORE `hybrid-markdown-intro` (`:261`). A BEAKERBOT_DEMO step modeled on `HybridEditorScopeStep.tsx`: its `cursorScript` glides to the new Focus Mode toolbar button (a `data-tour-target`, e.g. `hybrid-editor-focus-toggle`, added to the enter button) and `safeClickAction`s it so the overlay pops; brief `pause`; advances on `manualAdvance("Got it, next")`. Speech: "Let's clear away everything but the page." This is the exact pattern already used to drive the Fullscreen toggle, so it needs no new machinery.
- `hybrid-focus-exit`: insert immediately AFTER `hybrid-save-concept` (`:281`) and BEFORE `workbench-notes-intro` (`:291`). Its `cursorScript` clicks the always-visible Exit focus control (target `hybrid-editor-focus-exit`) so the overlay peels back to reveal the still-expanded popup. Speech: "And back to the full view." Advances on `manualAdvance`.

Modeling notes grounded in the machine:
- New ids are plain strings (`TourStepId = string`, `step-types.ts:27`), inserted into the `TOUR_STEP_ORDER` array; bodies registered in `TOUR_STEPS` (`step-registry.ts:545`) the same way `hybridEditorScopeStep` and `hybridSaveConceptStep` are (`step-registry.ts:397, 417`). No gate predicate is needed (universal), so `isStepGatedOut` is untouched and `getNextStep` / `firstApplicableStep` traverse them like any other ungated beat.
- Drive Focus Mode via the toolbar button click (the established "perform an action" pattern), NOT a hidden state poke, so the demo teaches the real affordance.
- Escape interplay during the tour: the markdown typing beats fire programmatic Escapes via `dispatchTourSyntheticEscape` to commit open blocks (`hybrid-editor-helpers.tsx:104`). Those carry the `isTourSyntheticEscape` marker, so neither the TourController skip-confirm (`TourController.tsx:2169`) nor a guarded Focus-Mode Escape listener should act on them. The Focus-Mode Escape guard from §5 must therefore also early-return on `isTourSyntheticEscape(e)`, matching the TourController contract, so the in-cluster Escapes keep committing blocks without bouncing the user out of Focus Mode mid-demo.
- Buffer safety in the tour: because the demo types into blocks during the cluster, the enter step should NOT re-mount the editor (see §7 Option B). With element identity preserved across the portal toggle, the typed-in content survives the enter, and the exit step leaves the buffer intact for the `hybrid-save-concept` teaching that immediately precedes it.

## 10. Accessibility

- The overlay is a modal surface: set `role="dialog"` and `aria-modal="true"` on the overlay root, with an `aria-label="Writing focus mode"`.
- Focus trap: on enter, move focus into the editor body (or the first block); while open, keep Tab focus cycling within the overlay (the editor, the Save button, the Exit control, the optional Hybrid / Preview and Attachments toggles). The project does not appear to ship a focus-trap utility, so implement a minimal trap on the overlay root keydown (wrap Tab / Shift+Tab at the boundary focusable elements).
- Restore focus on exit: capture `document.activeElement` at enter time and restore it on exit so keyboard users land back where they were (the toolbar enter button).
- The Exit control and enter button are real `<button>` elements with `aria-label`s and `<Tooltip>` (never native `title`), consistent with `SaveChrome` (`HybridMarkdownEditor.tsx:514-537`) and the popup rail buttons.
- Announce nothing intrusive; the dialog role plus a labelled region is enough. Cmd+Shift+F and the guarded Escape are conveniences layered on top of the always-focusable Exit button, so keyboard-only users always have a reliable exit.

## 11. Risks and open questions for Grant

1. Save button duplication in popup hosts: in Lab Notes / Results / Notes the disk-save button lives in the host and is covered by the overlay. The plan is for Focus Mode to render its own Save that reuses `saveRef` + `onExplicitSave`. Confirm this is the desired behavior (one Save inside Focus Mode that writes to disk), versus exiting to Save.
2. Exit shortcut choice: recommended Cmd/Ctrl+Shift+F (toggle). Acceptable? Alternative was Cmd/Ctrl+Period (rejected for OS collisions).
3. Guarded Escape: do we want Escape to exit Focus Mode in the parked (not-editing, not-selected) state, or should Escape NEVER exit Focus Mode (button + shortcut only) to keep the model dead simple? §5 recommends the guarded version; it is the one piece that touches the existing Escape precedence.
4. Preview toggle inside Focus Mode: keep the Hybrid / Preview toggle on the calm surface, or hide it for maximum minimalism? §6 recommends keeping a compact one.
5. Methods page host: `app/methods/page.tsx` has no popup-style Escape-to-close around the editor, so Focus Mode there is purely additive. Confirm Methods is in scope for the first cut (Grant named Methods, so assumed yes).
6. `NoteDetailPopup` Escape has no text-input guard (`NoteDetailPopup.tsx:369-376`), unlike `TaskDetailPopup`. The overlay's own Escape handling makes this moot while Focus Mode is open, but it is a pre-existing inconsistency worth a separate fix outside this feature.
