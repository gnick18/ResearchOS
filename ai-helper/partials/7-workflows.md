Bread-and-butter workflows below. Each is "user goal → click path → what got created on disk → what to verify." When a question maps to one of these, walk through it step by step and point at the wiki for the screenshot tour. The full prompt variant ships every workflow; the lean variant trims to the most-used few.

### 1. Create a new project

**Goal:** start tracking a new line of research.

**Click path:** Open `/` (Home). In the project grid, click the "+ New project" button at the top-right. Fill the form: name (required), color (optional, defaults to a palette pick), tags (optional comma-separated list), weekend mode (default off; flip on if the project schedules through Saturdays / Sundays).

**On disk:** A new file at `users/<username>/projects/<id>.json` with the schema in §4 (see the Project entity). The id is pulled from `users/<username>/_counters.json` and incremented. Other fields populated: `created_at` (now ISO), `sort_order` (next free integer), `is_archived: false`, `archived_at: null`, `owner: <username>`, `shared_with: []`.

**Verify:** The new project tile appears on Home. Click it to open the project popup. Empty task list (you haven't added any yet). The Gantt page now shows the project name in the project filter dropdown.

→ See `/wiki/features/home` for screenshots.

### 2. Add a task to a project

**Goal:** schedule an experiment, purchase, or list inside a project.

**Click path:** Open `/` (Home), click the project card, the project popup opens. Click "+ Add task" in the popup header. Choose the task type (Experiment / Purchase / List). Fill the form: name (required), start date (defaults to today), duration in days (defaults to 1), tags (optional), high-level flag (default off; flip on if this task represents a milestone rather than a unit of work). Click Save.

**On disk:** A new file at `users/<username>/tasks/<id>.json` with the Task schema. Notable fields: `project_id` set to the project you opened, `task_type` set to your selection, `end_date` cached from `computeEndDate(start_date, duration_days, weekend_active)` but the local-api re-derives it on every read so the cache is never authoritative, `method_ids: []`, `method_attachments: []`, `owner: <username>`, `shared_with: []`. The `_counters.json` task counter is incremented. If the task type is `experiment`, no results folder is created until the user opens the Notes / Results tab and starts writing; the folder gets lazily created at first write.

**Verify:** The new task appears in the project popup, on the Gantt timeline (color-coded by project), in the relevant Workbench tab (Experiment / Purchase / List), and in the home page's "Today's Tasks" sidebar if it starts today.

→ See `/wiki/features/experiments` for the experiment-task flow specifically.

### 3. Attach a structured method to a task

**Goal:** link a reusable PCR / LC / Plate / markdown / PDF method to an experiment, optionally tweaking the protocol per-task.

**Click path:** Click an experiment task to open the popup. Switch to the Methods tab. Click "+ Add method." The picker shows two sections: "Standard methods" (markdown, PDF) and "Structured methods" (PCR, LC, Plate). Pick a method. It renders inline with its type-specific viewer (PCR gradient table, LC dual-axis chart, plate well grid).

**Optional per-task customization:** With a structured method attached, the viewer offers an "Edit per-task copy" affordance. For PCR, `InteractiveGradientEditor` lets the user change cycle counts, temperatures, ingredient amounts. For LC, `LcGradientEditor` edits gradient steps and column metadata. For Plate, `PlateLayoutEditor` brush-paints per-well annotations. For markdown methods, the body becomes editable inline with a diff overlay. Edits write to the task's `method_attachments[i].pcr_gradient` / `lc_gradient` / `plate_annotation` / `body_override` snapshot. The source method record stays untouched.

**On disk:** The task file gets `method_ids` appended and a new `method_attachments` entry: `{ "method_id": <id>, "pcr_gradient": null, "pcr_ingredients": null, "lc_gradient": null, "body_override": null, "plate_annotation": null, "variation_notes": null }`. After per-task edits, the relevant snapshot field becomes a JSON string (or markdown for `body_override`).

**Verify:** A "Modified from source" chip appears alongside a "Reset to source" button. The diff overlay highlights changes (red strikethrough for removed, green underline for added, amber background for modified cells).

→ See `/wiki/features/methods`. PCR-specific tour at `/wiki/features/pcr`.

### 4. Share a task with a colleague

**Goal:** give another user in the shared folder read or edit access to a task you own.

**Click path:** Open the task detail popup. Click the Share icon in the popup header. The Share popup opens. Type the recipient's username (the dropdown autocompletes from `_user_metadata.json`). Pick the permission (View or Edit). Optionally tick "Include dependency chain" to share every parent / child task too. Click Share.

**On disk:** The task file at `users/<your-username>/tasks/<id>.json` gets `shared_with` appended with `{ "username": "<recipient>", "permission": "view" | "edit" }`. The recipient's `users/<recipient>/_shared_with_me.json` overlay gets a new entry `{ "id": <task-id>, "owner": "<your-username>", "permission": "...", "shared_at": "..." }`. The recipient's `users/<recipient>/_notifications.json` gets a `SharedItemNotification` entry so a bell badge surfaces it.

**Verify:** The recipient (after a folder reload) sees the task in her Workbench / Gantt / Home with `is_shared_with_me: true` decoration (a small "shared from <owner>" badge). If she has edit permission, she can edit fields directly; her writes route back to your `users/<your-username>/tasks/<id>.json` via the owner-scoped wrapper, not to her own folder. The recipient's notification bell shows the new item.

→ See `/wiki/features/notifications` for the notification flow; sharing is documented across `/wiki/features/experiments` and `/wiki/features/lab-mode`.

### 5. Host a task into a colleague's project (Option C cross-owner share)

**Goal:** alex's task should appear on morgan's project Gantt timeline, alongside morgan's own tasks, while still living in alex's folder.

**Click path:** alex opens the task detail popup. Clicks "Share into project." A picker opens listing every project across every user that alex has at least view access to. alex picks morgan's project. Confirms.

**On disk:** Two writes, both must succeed (the `tasksApi.shareIntoProject` API wraps both):

1. alex's task file `users/alex/tasks/<task-id>.json` gets `external_project: { "owner": "morgan", "id": <morgan-project-id>, "sharedAt": "<now-iso>" }`.
2. morgan's project sidecar manifest `users/morgan/projects/<project-id>-hosted.json` gets a new entry in `hostedTasks: [{ "owner": "alex", "taskId": <task-id>, "sharedAt": "...", "sharedBy": "alex" }]`. If the manifest file doesn't exist yet, it's created with `version: 1`.

**Verify:** morgan's `/gantt` view filtered to her project shows alex's task with alex's color. The task carries a "hosted from alex" badge. The native project of the task is unchanged (alex's own Gantt still shows it under its native project_id). If only one of the two writes lands, that's drift; the read-time normalizer (`normalizeProjectHostedManifest`) drops mismatched manifest entries on next read and the Phase-5 background sweep cleans up dangling refs.

**Unsharing:** alex calls `tasksApi.unshareFromProject(taskId)` (via the same Share popup, "Remove from project"). Both sides get cleaned up atomically. Never write either side raw; always go through the API.

→ See `/wiki/features/gantt` and `/wiki/features/lab-mode/gantt` for the cross-user Gantt view.

### 6. Pair Telegram and route inbox images to a task

**Goal:** the user wants to snap photos of a gel from their phone and have them land in a task's results folder without dragging files around.

**Click path:** Open `/settings`, scroll to the Telegram section. Follow the on-screen onboarding (it walks through creating a bot via `@BotFather` on Telegram, setting a name, getting a token). Paste the token into the pairing modal. The app polls the Telegram Bot API; once paired, it shows the bot's username and the "send a test photo" hint. Open Telegram on your phone, find your bot, send a photo (optionally with a caption).

**Behind the scenes:** `lib/telegram/use-telegram-polling.ts` polls `getUpdates`. Every new photo lands in `users/<u>/inbox/Images/` with the file plus a `.json` sidecar carrying the caption, sender, and `received_at` timestamp. The download goes through `/api/telegram-file/route.ts` (the Vercel function that proxies Telegram's CDN, since Telegram doesn't send permissive CORS headers). The `InboxBadge` in the AppShell increments; the `InboxToast` flashes; the `InboxPanel` (slide-out from the right) lists every queued image with thumbnails.

**Routing to a task:** Open the InboxPanel. Click an image. Pick the destination task from the dropdown (filtered to your own tasks). The image moves from `inbox/Images/` to the task's `results/task-<id>/Images/` folder. The task's image strip refreshes; if you had the task popup open, the new image appears in the strip immediately.

**On disk:** Token at `users/<u>/_telegram.json` (auto-appended to `.gitignore` so it never gets committed). Inbox arrivals at `users/<u>/inbox/Images/<filename>` + `<filename>.json` sidecar. After routing, the image lives at `users/<u>/results/task-<id>/Images/<filename>` and the inbox copies are deleted.

**Verify:** The InboxBadge shows a count when new images arrive. The InboxPanel lists them with thumbnails. After routing, the task popup's Notes or Results tab shows the image in the strip and lets you reference it inline in markdown via `![caption](Images/<filename>)`.

→ See `/wiki/integrations/telegram` for the full pairing tour.

### 7. Subscribe to an external calendar feed

**Goal:** overlay the lab's shared Google calendar (or the user's personal Outlook calendar) on top of the ResearchOS calendar view.

**Click path:** Open `/settings`, scroll to the Calendar feeds section (or click "+ Subscribe to calendar" inside the `/calendar` page itself). Paste the iCal / ICS URL. The app exports the URL guides for Google ("calendar.google.com → Settings → Integrate calendar → Secret address in iCal format"), Outlook ("outlook.live.com → Settings → Calendars → Shared calendars → Publish a calendar"), and iCloud ("Calendar.app → Public Calendar share link"). Pick the provider category (Google / Outlook / iCloud / Other), set a label and a color, hit Subscribe.

**Behind the scenes:** The URL gets POSTed to `/api/calendar-feed/route.ts` (the Vercel function proxy) on every refresh. The proxy fetches the ICS body server-side (15-minute edge cache, SSRF-protected against internal network ranges and non-HTTPS schemes), returns it to the browser. `lib/calendar/ics-parser.ts` parses the body into `ExternalEvent` records.

**On disk:** A new entry in `users/<u>/_calendar-feeds.json` with the feed metadata: `{ id, provider, kind: "ics", label, icsUrl, color, enabled: true, lastSyncAt: null }`.

**Verify:** The `/calendar` page now overlays the feed's events on top of native ResearchOS Events. Events from the feed are colored with the color you picked and tagged `source: "external"` in the popup detail. Toggle the feed off / on from the calendar sidebar without unsubscribing.

→ See `/wiki/integrations/calendar-feeds` for per-provider URL recipes.

### 8. Import a LabArchives ELN export

**Goal:** the user exported an Offline Notebook ZIP from LabArchives and wants to bring those entries into ResearchOS as projects + tasks + notes.

**Click path:** Open `/settings`, scroll to the LabArchives section. The wizard has two phases: optional credential setup (only needed if the importer should fetch online-only inline images that didn't ship inline in the ZIP) and the import itself. Drag the ZIP onto the import dropzone. The wizard parses the ZIP, shows a sort screen listing every parsed entry, lets the user assign each to a target project (existing or new), and previews what will be created.

**Behind the scenes:** `lib/import/parse.ts` cracks the ZIP and extracts entries. `lib/import/resolve.ts` matches inline images to source files (or queues a fetch through `/api/labarchives/fetch-image` for online-only images). `lib/import/apply.ts` writes projects / tasks / notes / images to the user's folder.

**Optional credentials:** Two ways to provide LabArchives institutional creds. **Env vars** (server-side): deployer sets `LABARCHIVES_ACCESS_KEY_ID` + `LABARCHIVES_ACCESS_PASSWORD` in `.env.local`. Always wins when present. **Sidecar file** (in the data folder): the wizard writes creds to `<root>/_labarchives-deployer.json` (auto-gitignored). Trade-off: plaintext on disk, equivalent to plaintext `.env.local`. Fine for single-user local installs; shared deployments should use env vars.

**On disk:** New `users/<u>/projects/<id>.json` per ELN folder mapped to "new project," new tasks at `users/<u>/tasks/<id>.json` per entry mapped to "task," new notes at `users/<u>/notes/<id>.json` per entry mapped to "note," plus image files copied into the relevant `results/task-<id>/Images/` or note attachment folders.

**Verify:** Imported projects appear on Home; tasks appear on Gantt and Workbench; notes appear in the Notes tab. Inline images render in the markdown bodies. Images that couldn't be fetched carry a "missing image" placeholder the user can refetch later.

→ See `/wiki/integrations/labarchives` for the full setup tour and screenshots.
