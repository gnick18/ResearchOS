# TESTING

Manual smoke checklists kept alongside the codebase so a human (or a fresh
agent) can re-verify a feature in ~5 minutes against the Demo Lab fixture.
Use the Demo Lab data folder (`alex` and `morgan` users) for everything in
here — never run these scenarios against the real research data folder.

## Booting the Demo Lab

1. Boot the dev server: `cd frontend && npm run dev` (or `./start.sh`).
2. From the user-picker landing screen, click **🧪 Try the Demo Lab**. The
   button downloads `/demo-lab.zip`, asks the OS folder picker to point
   somewhere safe (e.g. `~/Desktop/demo-lab/`), unzips, and signs you in as
   `alex` (the lab admin).
3. To switch users, use the bottom-right user pill. The Demo Lab ships with
   `alex` and `morgan`; both have empty passwords by default.
4. To inspect on-disk state, open the demo data folder in Finder. Project
   sharing reads/writes live in:
   - `users/<owner>/projects/<id>.json` — project file with the
     `shared_with: [{username, permission}]` array.
   - `users/<receiver>/_shared_with_me.json` — receiver's manifest with
     `projects[]`, `tasks[]`, `methods[]` entries.
   - `users/<receiver>/_notifications.json` — receiver's notification feed.

---

## Project Sharing — Manual Test Checklist

Project sharing is the older sibling of editable shared tasks. It lets one
user expose a project (and its tasks) to another user, optionally with edit
permission so writes route back into the owner's directory via the
`ownerScoped*` wrappers (see [`ProjectDetailPopup.tsx:26`](frontend/src/components/ProjectDetailPopup.tsx#L26)).

These scenarios cover the full lifecycle: share, view, edit, unshare, plus
the cross-impact with per-tab attachment isolation.

### Scenario A — basic share (view-only)

**Goal.** Confirm that sharing a project surfaces it on the receiver's home
page with the right indicators, and that read-only really is read-only.

**Prerequisites.**
- Demo Lab signed in as `alex`.
- A project on alex's side with at least 3 tasks. The Demo Lab seeds a few;
  if not, create `DEMO: Sharing Test Project` and add 3 list tasks.

**Steps.**
1. As `alex`, click the project card → ProjectDetailPopup opens.
2. Click the share icon (the connected-circles SVG in the top right).
3. Pick `morgan`, set permission to **View**, click **Share**.
4. Switch user (bottom-right pill) → sign in as `morgan`.
5. On morgan's home page, look for the project card.
6. Click the project to open ProjectDetailPopup.
7. Look at the task list. Click an individual task to open
   TaskDetailPopup.
8. Try to edit the task (rename, change date, add a method).

**Expected.**
- Step 5: the shared project appears in morgan's project grid.
- Step 6: the popup shows alex's tasks (all 3+), grouped by In Progress /
  Upcoming / Overdue. **Pre-fix regression to watch for: empty task list,
  or a task list showing morgan's own tasks whose project_id collides with
  alex's project id.**
- Step 8: edits silently no-op or are blocked. Save button does nothing,
  or the popup closes without persisting. The owner column on the rendered
  card shows alex.

**Common failure modes.**
- Task list is empty → `tasksApi.listByProject` is not threading the
  owner. Check
  [`ProjectDetailPopup.tsx`](frontend/src/components/ProjectDetailPopup.tsx)
  uses `tasksApi.listByProject(project.id, taskListOwner)`.
- Tasks appear but they're morgan's, not alex's → per-user id collision.
  Same fix.
- "Failed to save" toast even on view-only → permission check missing in
  the popup; should be silent / hidden buttons rather than a server
  rejection.

---

### Scenario B — edit permission (writes route to owner)

**Goal.** Confirm that a receiver with edit permission can mutate the
project, and that the write physically lands in the owner's directory.

**Prerequisites.** Same as A but unshare first (or use a fresh project), so
the share permission is **Edit** instead of View.

**Steps.**
1. As `alex`: re-share the project with `morgan`, permission **Edit**.
2. Switch to `morgan`. Open the shared project popup.
3. Click the pencil icon → edit the project name, e.g. append `(edited)`.
4. Save.
5. Open Finder → navigate to the demo data folder →
   `users/alex/projects/`. Open the matching `<id>.json`. Verify the
   `name` field reflects the edit.
6. Back in morgan's UI, click into one of the tasks.
7. Open the **Lab Notes** tab, drop an image (any local PNG).
8. In Finder, navigate to
   `users/alex/results/task-<taskId>/notes/Images/`. Confirm the dropped
   image is there.
9. Confirm the image is **NOT** in `users/morgan/results/...`.

**Expected.**
- Step 5: alex's project file reflects the edit.
- Step 8: image lives under alex's directory tree, with the per-tab
  `notes/Images/` namespace (per
  [`results-paths.ts`](frontend/src/lib/tasks/results-paths.ts)).
- Step 9: morgan's tree is unchanged.

**Common failure modes.**
- Edit succeeds visually but morgan's local file gets the change instead
  of alex's → the popup is missing the `ownerScopedProjectsApi` wrapper.
  Verify
  [`ProjectDetailPopup.tsx:26`](frontend/src/components/ProjectDetailPopup.tsx#L26)
  is in use and `effectiveOwnerOf(project)` returns `alex`.
- Image lands in morgan's tree → `task.owner` is unset on the in-memory
  task. The per-tab path derives from `task.owner` via
  [`taskNotesBase`](frontend/src/lib/tasks/results-paths.ts). Confirm
  `fetchAllTasksIncludingShared` overlays `owner: entry.owner` on the
  shared record.

---

### Scenario C — unshare (owner-side)

**Goal.** Confirm that when the owner removes a share, the project
disappears from the receiver's view promptly.

**Steps.**
1. As `alex`, open the shared project popup.
2. Click share → see `morgan` listed under "Currently shared with."
3. Click **Remove** next to morgan.
4. Switch to `morgan`. Refresh (or close + reopen the home tab).
5. Confirm the project no longer appears in morgan's project list.
6. In Finder, open `users/morgan/_shared_with_me.json` and confirm the
   `projects[]` array no longer contains an entry for that project id +
   alex.

**Expected.**
- Step 5: project is gone from morgan's UI without a manual refetch
  beyond a normal navigation.
- Step 6: manifest is clean.

**Common failure modes.**
- Project lingers on morgan's home → React Query stale cache. Try
  signing out / back in as morgan; if it persists, the
  `_shared_with_me.json` write didn't happen — check
  [`removeReceiverShare`](frontend/src/lib/local-api.ts) and the call
  flow from `sharingApi.unshareProject`.

---

### Scenario D — per-tab isolation under sharing

**Goal.** Confirm per-tab attachment isolation continues to hold on the
shared side.

**Prerequisites.** From scenario B: morgan has edit permission on the
shared project, and at least one task is selected.

**Steps.**
1. As `morgan`, open a shared task → switch to **Lab Notes** tab.
2. Drop a PDF onto the Lab Notes editor (or onto the Files panel).
3. In Finder, confirm the PDF is at
   `users/alex/results/task-<id>/notes/Files/`.
4. Switch the same popup to the **Results** tab.
5. Look at the Files panel. The PDF dropped on Lab Notes must NOT appear.
6. Drop a different PDF onto Results. Confirm it lands in
   `users/alex/results/task-<id>/results/Files/`.
7. Switch back to Lab Notes. The Results-tab PDF must NOT appear.

**Expected.** Each tab sees only its own attachments, even though the
writes are crossing the user boundary.

**Common failure modes.**
- Both PDFs visible on both tabs → per-tab attachment base is collapsing
  to the legacy outer base. Inspect `attachBase` derivation in
  [`TaskDetailPopup.tsx:2062`](frontend/src/components/TaskDetailPopup.tsx#L2062)
  / `:2426`. If `task.owner` is wrong, `taskNotesBase` returns
  `users//results/...` and the lazy fallback hides the symptom.

---

### Scenario E — cross-tab refs on shared tasks

**Goal.** Confirm an image referenced from `notes.md` resolves correctly
when read by a receiver.

**Prerequisites.** Pick a task on alex's side that already has an image
embedded in its notes (e.g. `![alt](Images/foo.png)`), or create one:
1. As `alex`, open the task → Lab Notes → drop a PNG into the editor.
2. Confirm the image renders.

**Steps.**
1. Share the task's project with morgan (edit permission).
2. Switch to morgan, open the shared task → Lab Notes tab.
3. Confirm the embedded image renders in morgan's view.
4. Inspect the rendered `<img>`'s blob URL via DevTools. The underlying
   blob should resolve through
   [`blob-url-resolver`](frontend/src/lib/utils/blob-url-resolver.ts) to a
   path under `users/alex/results/task-<id>/`.

**Expected.** The image renders without a "broken image" placeholder.

**Common failure modes.**
- Broken image placeholder → the blob resolver is using the receiver's
  base path instead of the owner's. Check that the editor is passing
  `legacyOwner` (which falls back to `task.owner`) into
  [`migrateNoteImages`](frontend/src/lib/notes/migrate-images.ts).
- "Remove reference from note" popup appears → the file genuinely isn't
  found at the expected path. Check the `notes/Images/` vs `Images/`
  per-tab vs legacy split for that task.

---

### Scenario F — dependency cascade boundary

**Goal.** Confirm that dependency cascades stay namespace-bounded
(per AGENTS.md §6: `shiftTask` does not cross user boundaries).

**Prerequisites.** Two projects on alex's side.
- Project P (will be shared): contains experiment task X.
- Project Q (NOT shared): contains experiment task Y.
- Set up X → Y as a Finish-to-Start dependency (Y starts when X ends).

**Steps.**
1. As `alex`, share project P with morgan (any permission).
2. Switch to morgan. Open the GANTT.
3. Confirm: morgan sees X (because it's in shared project P) but does NOT
   see Y (because Y is in non-shared project Q).
4. As morgan, drag X to a new start date. The drag may or may not be
   allowed depending on permission; the test is what happens to Y.
5. Switch back to alex. Open the GANTT.
6. If morgan's drag was permitted: confirm X moved on alex's side too.
   Confirm Y did NOT cascade-shift relative to its old date.

**Expected.** Y's dates are unchanged on alex's side after morgan's drag,
because cascades stay inside the user namespace they originate in.

**Common failure modes / known gaps.**
- Y cascade-shifts unexpectedly → cross-user cascade leaked. Check
  [`engine/shift.ts`](frontend/src/lib/engine/shift.ts) for an `owner`
  parameter being passed where it shouldn't be (or vice versa).
- The UX gives no warning that morgan can move X but the cascade won't
  reach across to Y: this is the documented backlog item "Cross-user
  dependency cascades" in AGENTS.md §8. Not a bug — surface in a future
  UX pass.

---

## Notes for future agents

- The **most fragile** point in the project-sharing flow is per-user id
  collision. Numeric ids are independent across users, so anywhere code
  filters tasks by `t.project_id === p.id` without also gating on
  `t.owner === p.owner`, a receiver can see the wrong tasks under the
  wrong project. Audit any new task-listing surface for this.
- The **second-most fragile** is the on-read overlay. `is_shared_with_me`,
  `shared_permission`, and `owner` are added by
  `fetchAllTasksIncludingShared` and `fetchAllProjectsIncludingShared`. If
  a new code path bypasses those fetchers (e.g. calls `tasksStore.listAll`
  directly), the overlay is missing and downstream owner-routing breaks.
