# Experiment co-editing (full Loro collab + granular presence)

Status: PROPOSAL (design pass, no code yet). 2026-06-06.
Author: orchestrator.
Builds on the notes Loro pilot + the DO collab engine (see `project_unified_model_phase3`, `COLLAB_STORAGE_D1_DO_MIGRATION.md`).

## Goal

Bring full real-time co-editing to experiments, the same engine notes have (Loro + the Durable Object), adapted to the experiment's multi-tab, multi-text-box structure, with the richer presence Grant specified:
- Tab-level presence: show which tab the other person is on (Details, Lab Notes, Results, etc.).
- Box-scoped cursors: a collaborator's cursor shows in whatever text box they are editing, but ONLY to a viewer who is also looking at that box (same tab / same field).

## The experiment's editable structure (today)

An "experiment" is a Task (`ShareTarget kind: "experiment"` wraps a Task). `TaskDetailPopup` (~5160 lines) has tabs: Details, Lab Notes, Method, Results, Purchases. The freeform editable surfaces are TWO markdown documents:
- Lab Notes (`notes.md`, entity `task_notes`)
- Results (`results.md`, entity `task_results`)

Both use `LiveMarkdownEditor` (the same component notes use), but on the LEGACY (non-Loro) path. The Details tab holds structured fields (title, dates, sub-tasks, etc.).

## What becomes collaborative

- The two markdown docs (Lab Notes + Results): each becomes a Loro-backed doc, exactly like a note. This is the bulk of the freeform writing and the obvious first target.
- DECISION (Grant): the structured Details fields (title, dates, deviation log, etc.). Options: (A) leave them on the legacy autosave path for now (collab only the markdown), or (B) also Loro-back them via a meta map for live structured co-editing. Leaning A for v1 (the markdown is where co-writing happens), B later.

## Reuse vs new

REUSE (the engine is done): the relay DO collab store, the plaintext protocol, `GET /snapshot` adopt, auto-connect by `collab_doc_id`, the Loro CodeMirror cursor plugin (`safeLoroEphemeralPlugin`), the ephemeral heartbeat, the auto-refresh. The notes pilot already proved all of this.

NEW for experiments:
1. A Loro model + open path for the two task markdown docs (mirror `store.ts openNote` -> an `openTaskDoc(owner, taskId, which: "notes"|"results")`), each with its own `collab_doc_id` minted on share. So one shared experiment yields two collab docs.
2. Wire `TaskDetailPopup`'s Lab Notes + Results editors to those handles (mirror how `NoteDetailPopup` wires `LiveMarkdownEditor` to a `loroHandle`). This is the big surface (a 5160-line file).
3. Granular presence (the novel part), below.

## Presence model (the novel part)

Two layers, both over the EphemeralStore the collab session already provides:
1. Tab presence: each user writes their active tab into the ephemeral store (key `<peerId>-exp-tab`, value the tab id). The popup header shows "Sharron is on Results" from the remote entries. Cheap, one ephemeral key per peer.
2. Box-scoped cursors: each markdown editor (Lab Notes, Results) runs the Loro cursor plugin against ITS doc's ephemeral cursors. A remote cursor for the Results doc only renders for a viewer currently on the Results tab (because that editor is only mounted/visible there). So "show their cursor only where we are both looking" falls out naturally from mounting each editor's cursor layer only when its tab is active. The tab-presence layer gives the at-a-glance "who is where" even when not on the same tab.

Edge: a per-experiment "presence room" vs reusing the per-doc ephemeral stores. Simplest: tab presence rides one shared ephemeral channel for the experiment (a dedicated lightweight session keyed by the experiment id), while each markdown doc keeps its own cursor ephemeral (already the case per collab doc). Confirm at build time.

## Dependencies / reality

- `TaskDetailPopup` is ~5160 lines and central; likely touched by other agents. Build carefully / in a worktree.
- The notes Loro pilot was 5 chunks + many live-found fixes; experiments are at least that, because there are two docs + the presence work.
- Sharing an experiment must mint + grant the collab docs the same way notes do (grant-on-share), for both the notes and results docs.

## Phased build plan

1. Loro-back the Lab Notes doc: `openTaskDoc(..., "notes")`, wire the Lab Notes editor in TaskDetailPopup to it, mint/grant `collab_doc_id` on share, auto-connect. Single-doc co-editing of Lab Notes, cursors included (reuses everything from notes).
2. Same for the Results doc.
3. Tab presence: broadcast + render "who is on which tab."
4. Box-scoped cursor polish: confirm cursors only show on the shared tab; presence-route as needed.
5. (Optional) structured Details fields via Loro meta.

## Non-goals

- Not changing notes (the engine is shared, notes stay as-is).
- Not the structured Details fields in v1 (markdown docs first).
- Not external sharing (separate proposal); this is in-lab co-editing of experiments.
