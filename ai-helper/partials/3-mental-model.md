This is the conceptual map you'll need to navigate the schemas in §4. Read it before drafting anything.

**Per-user folder layout, by folder.** Each `users/<username>/` directory holds canonical research data for that user, entity-typed:

- `projects/`, `tasks/`, `dependencies/`, `notes/`, `goals/`, `events/`, `lab_links/`, `purchase_items/`: one JSON file per record, named by id.
- `methods/<id>.json`: Method records carrying a `method_type` discriminator. The discriminator points at how the body lives: `markdown` source path, `pdf` source path, or one of three structured types (`pcr`, `lc_gradient`, `plate`) whose payload lives in a sibling protocol folder and is referenced via `source_path`: `pcr://protocol/<id>`, `lc_gradient://protocol/<id>`, `plate://protocol/<id>`.
- `pcr_protocols/`, `lc_gradients/`, `plate_layouts/`: full protocol payloads for the structured method types.
- `results/task-<id>/`: per-task results folder (`notes.md`, `results.md`, `Images/`, `Files/`).
- `inbox/Images/`: Telegram bot arrivals waiting to be filed into a task.

The `_*.json` sidecars at the user-folder root carry per-user state that doesn't fit one entity per file: `_counters.json` (auto-increment id source), `_auth.json` (optional PBKDF2 password), `_shared_with_me.json` (entries from other users), `_notifications.json`, `_shifted-alerts.json`, `_calendar-feeds.json` (ICS subscriptions), `_telegram.json` (bot token, auto-gitignored).

`users/public/` is the cross-user pool for shared methods, PCR protocols, LC gradients, and plate layouts. Anything `is_public: true` lives here and is readable by any user of the same folder. `users/lab/` holds shared lab notes for Lab Mode.

**Per-user ID namespaces.** This is the trap that catches every contributor. Each user has their own `_counters.json`, so `task.id = 1` in alex's folder and `task.id = 1` in morgan's folder are two completely different tasks. Project ids, method ids, every entity id is per-user-namespaced.

The codebase handles this with a composite `taskKey()` whenever a task can appear next to one from a different owner:

```typescript
taskKey(task: { id, owner, is_shared_with_me }): string
  // "self:5"  for a task the current user owns
  // "alex:5"  for a task shared into the current user from alex
```

When you draft a task and reference its id, **always say which owner it belongs to**. "alex's task 5" or "self:5" or "the task at `users/alex/tasks/5.json`." If the user pastes you "task 5," ask which user's namespace before doing anything that might collide.

**Sharing model.** Tasks, projects, and methods can be shared with a `view` or `edit` permission. The mechanism:

1. Sender calls `sharingApi.shareTask(taskId, recipientUsername, permission)`. Sender's task gets `shared_with: [{ username, permission }]` appended.
2. Recipient gets an entry written to **her** `_shared_with_me.json` overlay: `{ id: 5, owner: "alex", permission: "edit", shared_at: "..." }`.
3. When the recipient's UI loads, it reads her own data PLUS the source files from each `_shared_with_me.json` entry's owner directory. Shared items get decorated at read time with `is_shared_with_me: true` and `shared_permission: "edit"` (NEVER persisted, only set by the read-overlay layer).

Editable shared tasks (`shared_permission === "edit"`) work by routing every `tasksApi.update` / `move` / `delete` / `addMethod` call through `ownerScopedTasksApi(task)` so the write lands in the original owner's folder, not the recipient's. The recipient never copies the source file; she edits the canonical original through the wrapper.

**Cross-owner project hosting (Option C).** A more advanced variant where alex's task gets "shared into" morgan's project, so it appears on morgan's Gantt timeline alongside her own tasks. Both sides must agree:

- The task carries `external_project: { owner: "morgan", id: 3, sharedAt: "..." }`.
- The destination project owner stores a sidecar manifest at `users/morgan/projects/3-hosted.json` listing the foreign-hosted task: `{ owner: "alex", taskId: 5, sharedAt: "...", sharedBy: "alex" }`.

If only one side agrees, that's drift. The read-time normalizer drops mismatched manifest entries; the next `unshare` call cleans up stale `external_project` refs. The `tasksApi.shareIntoProject` / `unshareFromProject` API wraps both writes; never touch one side raw or you'll create drift.

**Lazy-normalize + on-demand-repair pattern.** When a field gets renamed or restructured, ResearchOS doesn't do hard cutovers. The read boundary detects legacy shapes and rewrites in-memory; a one-shot "Repair X" button under Settings → Data maintenance can iterate every stored file and write back. Shared files from other users with legacy shapes keep working transparently. When you draft a JSON entity, you don't need to worry about which schema version a field came in on; the read path normalizes it.

**Snapshot semantics for method attachments.** When a method is attached to a task, certain method types let the user customize the protocol per-task without writing back to the source method. The snapshot fields on `TaskMethodAttachment` carry these per-task copies as JSON-stringified blobs:

- `pcr_gradient` / `pcr_ingredients`: JSON of `PCRGradient` and `PCRIngredient[]` for per-task PCR cycling and reagents.
- `lc_gradient`: JSON of `LCGradientProtocol` (gradient steps + column metadata).
- `plate_annotation`: JSON of `{ wells: { "A1": {...}, ... } }`, the per-well annotations on top of the source plate's region labels.
- `body_override`: plain markdown for per-task variation of a markdown method's body.

Edits on the experiment page modify the snapshot only. Source method stays canonical and reusable. A diff overlay (red strikethrough on removed, green underline on added, amber background on modified) shows what's customized. A "Reset to source" button clears the snapshot. There's also a `variation_notes` markdown field on every attachment for documenting the why.

**Why this matters when drafting.** If a user says "draft a PCR experiment using the standard 25-cycle protocol but with annealing at 58°C instead of 60°C," produce a `Task` with `task_type: "experiment"`, `method_ids: [<PCR method id>]`, and a `method_attachments` entry whose `pcr_gradient` is the JSON-stringified modified `PCRGradient`. Source PCR protocol stays untouched. Add a `variation_notes` line. Pattern: source method = reusable, attachment snapshot = per-experiment customization, variation_notes = the why.
