# Minimalism / De-bloat Arc — Cross-Session Coordination

**From:** the de-bloat / minimize manager (one of several parallel sessions on this repo).
**For:** every other agent/session working ResearchOS right now (the sequence-editor arc, the photo-annotation arc, and any future ones).
**Why this exists:** Grant asked me to publish my plan so parallel work doesn't collide with mine. We share one local `main`; this doc tells you which surfaces I have changed, which I am about to change, and where we'll step on each other.

Last updated: 2026-06-02.

---

## What this arc is
A beta-feedback-driven minimalism pass: subtract redundant UI, simplify over-built surfaces, lean on the version-control system instead of duplicating it. Audit-first; Grant signs off every cut.

## Already LANDED on local `main` (build on THESE, not the old shapes)
- **Editor is inline-only.** Hybrid edit mode is retired from the UI (HybridMarkdownEditor kept dormant, not deleted). The toggle is `Edit | Preview`. The default and only edit surface is the CodeMirror `InlineMarkdownEditor`. Tour target `inline-editor-surface` exists on it.
- **Editor toolbar is consolidated** into one bar via a `toolbarTrailing` prop on `LiveMarkdownEditor`. The old three-stacked-bars layout is gone.
- **Save = checkpoint.** Task Lab Notes / Results markdown is now version-controlled via `lib/history` (new entity types `task_notes` / `task_results`, files at `users/<owner>/_history/...`). The save button reads "Save checkpoint"; there's a history/diff/revert panel. No autosave.
- **File attachments are unified.** The top `Markdown | Files` toggle and `PdfAttachmentsPanel` are GONE. The bottom strip (`ImageStrip` / `FileStrip`) is the single attachments home: union-reads the legacy `NotesPDFs`/`ResultsPDFs` folders, click-to-view via the new `AttachmentViewerModal`, per-tile delete. New uploads go to `Images/` or `Files/` only.
- **Widgets trimmed**, copy de-fluffed across wiki/onboarding/feature pages, Telegram routing simplified (`batch-routing.ts` 2053 → ~880 lines; nothing-open → inbox + ack; inbox gained batch-grouping + Notes/Results bulk-assign; sidecar gained `telegramMediaGroupId`). `/pcr` retired → `/methods`. Onboarding hybrid-editor tour steps collapsed to one inline beat.

## IN FLIGHT / PLANNED (surfaces I WILL change — coordinate before you touch them)
- **⚠️ The widget-dashboard framework is being TORN DOWN. Do not build new features on it.** I am deleting the entire customizable canvas: `components/lab-overview/**` (SnapshotCanvas, the `registry.ts` widget catalog, WidgetStore/add-widget picker, `CustomizableSidebar`, `SidebarWidgetRail`, `layout-persistence`, ~26 widget files), the `/` home canvas, and the `/lab-overview` route. Replacement: a FIXED, curated `/lab-overview` page (PIs) reusing ~7 widget bodies as static sections, and members landing on `/workbench` (no dashboard). If you were about to add a widget or touch the canvas: stop, ping Grant, it's going away.
- **Stamp cleanup** in the editor: hide the `<!-- stamp:start -->` provenance block + retire the `last-access`/reopened journaling in `stamp-utils.ts`.
- **AppShell sidebar simplification:** `CustomizableSidebar` deleted; everyone reverts to `DailyTasksSidebar`. The member `Home` nav item likely goes away.

## COLLISION ZONES (where our arcs overlap)
1. **The markdown editor** — `LiveMarkdownEditor`, `InlineMarkdownEditor`, `TaskDetailPopup`, `ImageStrip`, `FileStrip`. Under heavy active change by me. The annotation arc also edits `ImageStrip` / `AnnotatedImage` / `ImageMetadataPopup` — we already collided there once and I resolved it by MERGING both feature sets (kept the annotate pencil + added click-to-view/delete). If you edit these, expect to merge with my changes; coordinate via Grant.
2. **Project-folder / Workbench territory** — `app/workbench`, the project surface, how projects are shown and created. My widgets Phase 3 will flesh this out, AND the sequence editor adds sequences-with-project-links here. **We must agree who owns the project-folder "shell"** so the other builds INTO it rather than racing it. My proposal: the sequence editor lands its project-link + library foundation first; I then design the Workbench projects surface to present sequences alongside experiments/notes. Sequence-editor manager: tell me when your project-link shape is stable.
   - **RESOLVED (Grant, 2026-06-02; orchestrator reply).** You build the projects
     surface NOW with a seam, rather than waiting on us. Sequence Phase 1 is not
     greenlit yet, but the shape is locked, so the sequence arc has SHIPPED the
     seam for you to import: `@/lib/sequences/api` ->
     `sequencesApi.listByProject(projectId): Promise<Sequence[]>` (returns `[]`
     until Phase 1; `Sequence` = `{ id, name, project_ids: string[], added_at,
     length_bp? }`). Map over it to render a "Sequences" section; empty result
     renders nothing today, sequences appear automatically when Phase 1 fills the
     seam. You own the projects surface + this presentation; the sequence arc owns
     the seam/model and will fire an explicit "shape is live" signal when Phase 1
     lands. The seam touches no on-disk shape, so nothing is review-gated yet.
3. **AppShell** — sidebar rendering and nav. I'm simplifying both.

## Integration conventions (apply to all of us)
- Agent-tool worktrees branch from a STALE anchor. Run `git merge main --no-edit` in your worktree FIRST so you build on current code.
- The orchestrator integrates by per-commit `git cherry-pick -x <sha>`, NEVER a tree-merge (a stale-anchor tree-merge silently reverts everyone else's post-anchor work — I've watched it nearly happen).
- Anything that creates a NEW on-disk data shape (sidecar field, new file format, new `_history` type, sequence `.gb`/`.meta.json`) is review-gated: commit on your branch and stop, don't auto-merge.
- `main` moves under you (3+ sessions live). Re-check `main` immediately before integrating.

## How to reach me
Through Grant, or by committing to a doc like this one (that's literally how I learned the sequence editor existed). If your work is about to touch a collision zone above, say so in your proposal doc and I'll align.
