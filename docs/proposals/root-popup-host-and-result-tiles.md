# Root popup host and BeakerBot result tiles

Status: design, decisions locked 2026-06-11. Build QUEUED behind the artifact-index land (both touch the system prompt and references.ts, so they cannot run concurrently). Author: HR, for Grant.
Related: docs/proposals/beakerbot-context-and-index.md, docs/proposals/ai-assistant.md.

House voice applies to this doc and every string it specifies, no em-dashes, no emojis, no mid-sentence colons.

## What the user asked for

After BeakerBot creates something (a note, and by extension anything it creates or affects), show a clickable result tile in the chat. Clicking it opens that item's popup in place, so the user can check the result without leaving the conversation or navigating to the item's full page. The user's words: "all created items on the site use the same popup system", so the tile should open the real popup, not a one-off.

## The reality this has to work around

The site does NOT have one shared popup system today (mapped 2026-06-11).
- Only two types open as popups: notes (NoteDetailPopup, 2441 lines, owned by NotesPanel via local `selectedNote` state) and tasks/experiments (TaskDetailPopup, owned by the page or root for the `?openTask=` deep link).
- Methods, sequences, Data Hub docs, molecules, and projects open as FULL PAGES, not popups.
- Popups are owned by the PAGE that renders them. BeakerBot is docked at the ROOT (app/layout.tsx inside Providers), outside any page, so it cannot summon a page-owned popup from where it lives.
- The only generic reference tile, ObjectChip (components/ObjectChip.tsx, rendered by RenderedMarkdown when a link parses as an object deep link), NAVIGATES via router.push. It does not open a popup.
- Shared popup infra that already exists and helps: lib/ui/popup-stack.ts (a Zustand store coordinating the blur/dim layer) and lib/lab-overview/popup-actions.tsx (PopupActionsProvider / usePopupActions for closing a popup from child content).

So the missing piece is a root-level popup host that any surface can call to open an object in place. Building it is the right move regardless of BeakerBot, it turns the fragmented page-owned popups into the one system the user already assumes exists.

## Decision (locked)

Build the root-level popup host and wire the two types that already have popups (notes, tasks/experiments) now. BeakerBot result tiles open those in place. Created items of other types get a tile that NAVIGATES for now (the ObjectChip fallback), and those types gain real popups incrementally later. Rejected for now: building new in-place popups for method/sequence/datahub/molecule/project in this pass (some are heavy editors), and a BeakerBot-only preview viewer (it would not be the site's real popup system, which the user explicitly wants).

## Architecture

### 1. The root popup host

A provider mounted once at the root (in lib/providers.tsx or app/layout.tsx inside Providers, above the BeakerBot dock so the dock can call it).
- State: the currently open object reference `{ type: ObjectRefType; id: string } | null` (single popup at a time, matching the current one-popup norm and the popup-stack blur layer).
- API exposed via a hook, `useObjectPopup()` returning `{ openObjectPopup(ref), closeObjectPopup() }`, plus a non-hook imperative entry (a small module-level opener, mirroring the navigation-bridge pattern) so tools and non-React callers can open a popup too. Reuse popup-stack.ts for the dim layer and PopupActionsProvider for close-from-child.
- Rendering: the host switches on `ref.type` and renders the matching popup, loading the record by id through the existing api (notesApi for note, the tasks/experiments api for task), so the popup does not depend on the calling surface having the record in hand. For a type with no popup yet, openObjectPopup falls back to navigation (objectDeepLink + router.push) rather than failing, so every type does something sensible.

### 2. Lifting NoteDetailPopup and TaskDetailPopup

The build must first ASSESS liftability, do not force it.
- NoteDetailPopup currently takes `note` and `onClose` from NotesPanel and may read NotesPanel-specific callbacks. The host needs to render it given only a note id (load via notesApi) and an onClose that calls closeObjectPopup. If NoteDetailPopup reaches into NotesPanel context or props that the root cannot provide, either thread sensible defaults or, if a clean lift is not feasible in this pass, REPORT the blocker before forcing a risky refactor. React Query mutations inside the popup are fine, the QueryClient is already at root.
- TaskDetailPopup already opens from the root for the `?openTask=` deep link, so it is the easier of the two. Reuse that existing root-open path as the model for the host.

### 3. The BeakerBot result tile

How a tile reaches the chat. The cleanest path reuses the inline-reference machinery rather than a new side channel.
- The create and affect tools return the artifact reference in their result, `{ type, id, name }` (write_note must return the new note id and title, run_datahub_analysis and make_datahub_graph already return ids, add the type). 
- The system prompt instructs the model, after creating, writing into, or finding an item, to reference it in its closing line using the object reference link form (objectReferenceMarkdown(type, id, name)). The model already gets the id back from the tool.
- RenderedMarkdown already upgrades an object-reference link to ObjectChip. Upgrade ObjectChip (or the BeakerBot markdown variant) so that for a popup-capable type it calls openObjectPopup(ref) instead of navigating, and for a non-popup type it navigates as today. This makes EVERY referenced artifact in a BeakerBot answer a clickable tile that previews in place when possible, created or found, with no per-tool UI plumbing.
- Visual: reuse ObjectChip's look, or a slightly larger card variant for a created item, consistent with the site. Keep it the site's component, not a BeakerBot one-off.

This also retires the auto-navigation question for write_note (it does not navigate today), the user stays in the chat and opens the note popup from the tile if they want to check it.

## Build sequence and conflicts

Queued behind the artifact-index land. Both edit system-prompt.ts (and references.ts is touched by the index bot for the molecule deep link), so they run sequentially off main, never as two concurrent worktree bots on the same files. Order: index lands, then this builds off the updated main, reusing search_my_work and the read tools (a found item's tile uses the same reference path).

## Open question to confirm at build time

Liftability of NoteDetailPopup to the root host (see 2). If it cannot be cleanly lifted, the fallback for this pass is, notes navigate like the other types until a lift or a lighter note-preview popup is built, and the host ships with tasks/experiments first. Report before forcing a 2441-line refactor.
