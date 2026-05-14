# Master-Agent Handoff Doc

This file briefs an orchestrator agent (a "master bot") on what ResearchOS is, how the codebase is organized, and the working conventions established over a long collaboration on it. Read this end-to-end before suggesting work, spawning sub-agents, or committing. For deeper architecture (data flow, FSA wrapper internals, store layout), read `ARCHITECTURE.md` next.

---

## 1. What ResearchOS is

A local-first research project management app for science labs:

- GANTT scheduling with dependency-aware date shifts.
- Lab notes + results: markdown editor with image strip, drag-drop attachments, image gallery picker.
- PCR protocol builder with reagent calculators.
- Methods library with reusable protocols.
- Multi-user shared folders (OneDrive / Dropbox / iCloud) with per-user accounts, password gates, and shared-task editing.
- Telegram bot ingestion → image inbox.
- External ICS calendar overlays.

**Architecture:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind. **No backend.** All data lives in a folder on the user's disk, accessed via the **File System Access API**. The only server-side code is two thin proxy routes (`/api/telegram-file`, `/api/calendar-feed`) that exist purely to bypass CORS for those integrations.

**Hosted at:** [research-os-xi.vercel.app](https://research-os-xi.vercel.app/). Also runs locally via `./start.sh` (frontend only; the old FastAPI backend was deleted).

---

## 2. Repo layout

```
ResearchOS/
├── frontend/                           ← all app code
│   ├── src/
│   │   ├── app/                        ← Next.js pages
│   │   │   ├── api/
│   │   │   │   ├── telegram-file/      ← Telegram CDN proxy (server)
│   │   │   │   └── calendar-feed/      ← ICS proxy (server)
│   │   │   ├── page.tsx                ← home / dashboard
│   │   │   ├── gantt/                  ← GANTT view
│   │   │   ├── calendar/               ← calendar w/ ICS overlays
│   │   │   ├── methods/                ← methods library
│   │   │   ├── purchases/              ← purchase tracking
│   │   │   ├── results/                ← results editor
│   │   │   ├── experiments/            ← experiment list
│   │   │   ├── lab/                    ← multi-user lab mode
│   │   │   └── search/, links/, pcr/   ← misc views
│   │   ├── components/                 ← React components (60+)
│   │   └── lib/
│   │       ├── local-api.ts            ← THE API layer (was a FastAPI replacement)
│   │       ├── file-system/            ← FSA wrappers + provider context
│   │       │   ├── file-service.ts     ← read/write/list primitives + read-count instrumentation
│   │       │   ├── file-system-context.tsx ← FileSystemProvider, connect / reconnectWithStoredHandle
│   │       │   ├── indexeddb-store.ts  ← persists directory handle + current user
│   │       │   └── user-discovery.ts   ← scans `users/` dir
│   │       ├── storage/
│   │       │   └── json-store.ts       ← JsonStore<T>: CRUD by entity; getForUser/saveForUser for cross-user routing
│   │       ├── engine/
│   │       │   ├── dates.ts            ← weekend-aware date math
│   │       │   └── shift.ts            ← shiftTask: dependency cascade (accepts optional owner)
│   │       ├── notes/migrate-images.ts ← one-shot per-note image-ref rewriter
│   │       ├── telegram/               ← bot client + polling hook + token store (writes users/<u>/_telegram.json + auto-appends a .gitignore rule)
│   │       ├── calendar/               ← ICS parser + feed store + useExternalEvents hook
│   │       ├── attachments/            ← image folder utils, move-image, image-events bus
│   │       ├── auth/password.ts        ← PBKDF2 per-user password gate
│   │       └── utils/blob-url-resolver.ts ← FSA path → blob: URL, used everywhere an <img> renders
│   ├── package.json
│   └── tsconfig.json
├── installer/                          ← Electron wrapper (optional desktop launcher)
├── scripts/
│   └── cleanup-migrated-images.mjs     ← legacy image cleanup w/ Desktop-zip backup
├── AGENTS.md                           ← (this file)
├── ARCHITECTURE.md                     ← deeper architecture doc — read if relevant
├── README.md                           ← user-facing
├── start.sh / start.ps1                ← local launcher (frontend-only — no backend)
└── frontend/src/lib/local-api.ts       ← single most-touched file in the codebase
```

Data folder layout (on user's disk):

```
{root}/
├── users/
│   ├── {username}/
│   │   ├── projects/{id}.json
│   │   ├── tasks/{id}.json
│   │   ├── dependencies/{id}.json
│   │   ├── methods/{id}.json
│   │   ├── notes/{id}.json
│   │   ├── goals/{id}.json
│   │   ├── pcr_protocols/{id}.json
│   │   ├── purchase_items/{id}.json
│   │   ├── results/task-{id}/
│   │   │   ├── notes.md
│   │   │   ├── results.md
│   │   │   ├── Images/                 ← per-task image folder
│   │   │   └── Files/
│   │   ├── inbox/Images/               ← Telegram arrivals waiting to be filed
│   │   ├── _counters.json              ← per-user auto-increment IDs
│   │   ├── _auth.json                  ← optional PBKDF2 password
│   │   ├── _shared_with_me.json        ← entries from other users
│   │   ├── _notifications.json
│   │   └── _calendar-feeds.json        ← ICS subscriptions
│   ├── public/                         ← shared methods/PCR protocols (cross-user)
│   ├── lab/
│   └── _user_metadata.json             ← username → color/created_at/hide_goals_from_lab
└── _global_counters.json
```

**Each user has its OWN id space** (separate `_counters.json`), so `task.id` alone isn't unique across users. Use `taskKey(task)` from `lib/types.ts` (`"self:N"` for own tasks, `"{owner}:N"` for shared) anywhere uniqueness matters: React keys, Map lookups, store selection, React Query keys.

---

## 3. The local-api surface

`frontend/src/lib/local-api.ts` is the most-touched file in the codebase (~2000+ lines). It exports a set of APIs that mirror what used to be the FastAPI backend:

- `projectsApi`, `tasksApi`, `dependenciesApi`, `methodsApi`, `pcrApi`, `goalsApi`, `eventsApi`, `purchasesApi`, `lab_linksApi`, `notesApi`, `inbox*`, `sharingApi`, `usersApi`, `labApi`, `attachmentsApi`, `filesApi` (was `githubApi`, kept aliased for legacy callers — renamed in commit ~`128033bf`).

Editable shared tasks: most mutating `tasksApi` methods (`update`, `move`, `delete`, `addMethod`, etc.) take an optional `owner` argument. When the popup is for a task that's `is_shared_with_me` + `shared_permission === "edit"`, the wrapper in `TaskDetailPopup` (`ownerScopedTasksApi(task)`) automatically threads `owner` through every call. `shiftTask` in `engine/shift.ts` is similarly owner-aware — when `owner` is set, every read and write (deps, tasks, project weekend lookups) is routed to that owner's directory.

---

## 4. Working conventions

### Sub-agents (spawn vs inline)

Big chunks of work were done by spawning fresh agents in their own worktrees via `mcp__ccd_session__spawn_task`.

**Spawn when:**

- Multi-hour work that doesn't depend on this chat's state (audit sweeps, large refactors, isolated features).
- Anything where the user explicitly says "spawn an agent."

**Don't spawn — do it inline — when:**

- Single-file fixes.
- Anything that needs ongoing dialogue with the user.
- Trivial cleanup.

Reliable recipe for a spawn prompt:

- **Self-contained briefing.** Spawned agents don't see prior chat history. Include the project's one-liner, the specific files to touch, the current commit they should expect to see, and what's out-of-scope.
- **Scope guards.** Always say what NOT to do (don't touch on-disk JSON format, don't refactor unrelated things, don't migrate to a new component if scope is "add `title` attrs").
- **Reproduction recipe** if you can give one (`as Grant open Kritika's shared task — should …`).
- **Worktree bootstrap.** A fresh worktree has no `node_modules` — without it, `npx tsc` falls through to a placeholder ("This is not the tsc command you are looking for") and the verification gate is silently bypassed. The spawn prompt must include `cd frontend && npm install` as a precondition. **Note (2026-05-13):** symlinking the main checkout's `node_modules` into the worktree was attempted as a shortcut but **breaks under Turbopack** ("Symlink node_modules is invalid, it points out of the filesystem root" — the linked path is outside the worktree's filesystem root, so `npm run dev` won't boot). Symlink works for typecheck-only but not for live tests; just do a real `npm install`.
- **Verification gate**: `cd frontend && npx tsc --noEmit` must pass with exit 0. Optionally `npx eslint src/`. Live test in `http://localhost:3000`.
- **Staleness check.** Tell them: "If you don't see `frontend/src/lib/local-api.ts` or recent commit `<hash>`, the worktree is stale — stop and report." This catches the case where the spawned worktree is branched off pre-FSA-migration state.

### Commits

- Subject line: present tense, concise (under 70 chars). Body explains the **why**, not just the what.
- Sign-off: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Never commit without explicit user confirmation.** When unsure, ask.
- **Never push without explicit user confirmation.** "Push when ready" is the default until the user says push.
- Default remote is `origin`; `main` is the canonical branch. Feature work lives on `claude/*` branches and merges into local `main` after the user verifies the UI. Push to `origin` only on explicit confirmation. **Never `--force` push to `main`.** If the user asks for a force push, double-check the target branch first.
- `git add` specific paths, not `-A`. Other agents may have parallel uncommitted work in the tree.
- Use `git commit -F /tmp/researchOS-commit-msg.txt` for multi-paragraph messages with apostrophes — shell HEREDOCs choke on `'` inside `'…'`-quoted shells.

### Editing

- When the same worktree is shared with parallel agents, expect to see "intentional, do not revert" system reminders about files modified outside your scope. Treat those files as authoritative; don't undo their changes.
- Typecheck after every significant change: `cd frontend && npx tsc --noEmit`. The bar is exit 0.
- ESLint warnings are fine; new errors are not.
- **Icon-only buttons** → wrap in `<Tooltip>` from `frontend/src/components/Tooltip.tsx`. Native HTML `title=` is functionally invisible in this app (custom rendering layer hides it) — never use it for tooltips on new code. The native-tooltip migration sweep is mostly done; any new component should default to `<Tooltip>`.

### Field migrations

When a field on Task / Method / Project / Note / etc. is renamed or restructured, follow the **lazy-normalize + on-demand-repair** pattern the cleanup pass landed (commit `147db270`, 2026-05-13). The whole point is that shared on-disk files from other users with legacy shapes keep working transparently — no flag-day cutovers, no broken receivers.

1. **Rename the field** in `frontend/src/lib/types.ts` and update every caller in lockstep. (See the §6 "Field renames" trap for the grep checklist — partial renames silently typecheck.)
2. **Add a `normalize<Entity>Record` helper** at the read boundary in `frontend/src/lib/local-api.ts`. Templates: `normalizeMethodRecord`, `normalizeTaskRecord`. The helper detects the legacy shape, rewrites it in-memory to the new shape, returns the normalized record. Apply on every read path (`.get`, `.list`, `fetchAllXIncludingShared`, …) so callers never see the legacy shape.
3. **Add a one-shot repair button** to `frontend/src/app/settings/page.tsx` under "Data maintenance." It iterates every stored file of that entity, normalizes, writes back. Report scanned / repaired / already-clean counts. Safe to re-run.

Use this for any field rename. **Do NOT do hard on-disk cutovers** — rewrite-and-leave-no-fallback breaks shared-from-another-user files at the moment the migration lands.

---

## 5. Integrations in flight

### Telegram (live)
- One bot per user. Token paired via `TelegramPairingModal`, written to `users/<u>/_telegram.json` with an auto-appended `.gitignore` rule so it doesn't get committed.
- `lib/telegram/use-telegram-polling.ts` polls `getUpdates`. New photos land in `users/{user}/inbox/Images/` with `.json` sidecar containing caption / sender / received_at.
- `/api/telegram-file/route.ts` is the Vercel function that proxies file CDN downloads through (CORS workaround).
- `InboxPanel`, `InboxToast`, `InboxBadge`, `TelegramStatusBadge` render the inbox; `ImageStrip` reads from the inbox + task Images folder.

### External calendar (live)
- `lib/calendar/external-feeds-store.ts` persists ICS subscriptions in `users/{user}/_calendar-feeds.json`.
- `lib/calendar/ics-parser.ts` parses the feed text.
- `/api/calendar-feed/route.ts` is the Vercel function proxy (15-min edge cache, SSRF-protected).
- `useExternalEvents()` hook merges external events into the calendar view.

### Wiki + screenshot pipeline

- **Content lives at** `frontend/src/app/wiki/<path>/page.tsx` as pure TSX server components (no MDX). One default-exported component per page returning a `<WikiPage>` wrapper.
- **Shared primitives** (`frontend/src/components/wiki/`): `<WikiPage>`, `<Callout variant="info|tip|warning|danger">`, `<Screenshot src caption width height noZoom>`, `<Steps>` + `<Step>`, `<Kbd>`. Note: `<Tip>` / `<Warning>` / `<Highlight>` do **not** exist as separate components — use `<Callout variant=...>`.
- **Navigation tree** is the single source of truth at `frontend/src/lib/wiki/nav.ts` (`WIKI_NAV`). When adding a page, register a node and the sidebar/breadcrumbs/prev-next links update automatically.
- **Pre-auth bypass**: `frontend/src/lib/providers.tsx` short-circuits the FS-picker gate for `/wiki/*` so visitors can read setup guides before connecting a folder. Don't break this.
- **Screenshot capture is automated** via Playwright. Script: `scripts/capture-wiki-screenshots.mjs`. NPM: `cd frontend && npm run wiki:screenshots`. Pre-req: `npx playwright install chromium` once. PNGs land in `frontend/public/wiki/screenshots/<name>.png` at 1440×900 @ 2× DPR. Red-ring highlights are injected via `page.evaluate()` at capture time (inline CSS, no React component) — the PNG comes pre-annotated. Documentation: `scripts/WIKI_SCREENSHOTS.md`.
- **Fixture mode**: appending `?wikiCapture=1` (signed-in) or `?wikiCapture=picker` (folder-picker) to any URL installs an in-memory file-service mock seeded from `frontend/src/lib/file-system/wiki-capture-fixture.ts` (2 users, 4 projects, realistic data). Hard-blocked outside `localhost`. The script runs three route phases (PUBLIC, PICKER, FIXTURE) in separate browser contexts so IndexedDB doesn't bleed.
- **🚨 NEVER capture screenshots against the user's real data folder.** Grant's `users/` folder contains unpublished research. All wiki / demo / docs screenshots MUST use fixture mode. The fixture is gated by URL flag + hostname; bots adding new captures stay inside this system. If a story needs richer fake data, **enrich** `wiki-capture-fixture.ts` with believable-but-fake content (the test: "embarrassing if leaked to a competitor lab?" → too real).
- **Adding a new screenshot**: add a route entry `{path, file, waitFor, highlight?, action?}` to the appropriate list in `capture-wiki-screenshots.mjs`, update `scripts/WIKI_SCREENSHOTS.md`, re-run the script. Naming convention: `<page-key>.png` matches the `<Screenshot src=…>` value on the consuming page.
- **Capture-time gotchas**: production `next build && next start -p 3001` is much faster than `next dev` (Turbopack first-compile is slow). Don't use port 3000 (the user runs dev there). `?wikiCapture=picker` requires a fresh browser context if a signed-in capture ran first — the script handles this.
- **Wiki voice** (from tone pass `5ebfc8d6`): no em dashes, no semicolons except in code, use `(e.g., …)` / `(i.e., …)` for asides, contractions throughout, brand names properly capitalized. ALL CAPS reserved for the Shared Lab Accounts danger callout only.

### Vercel
- Deployed at `https://research-os-xi.vercel.app/`.
- No environment variables required for the core app. The two proxy routes work with no setup.
- Vercel Web Analytics is integrated (commit history; branch `vercel/install-vercel-web-analytics-ruqdgf` exists upstream).
- `cd frontend && npx vercel` works for self-hosting.

---

## 6. Known traps / things I've stepped on

- **The "drag image to trash deletes a sibling too" bug.** Fixed in commits `6d77e739` and `6f068e1d`. Root cause was `gcUnreferencedAttachments` not counting subfolder-style refs (`Images/{folder}/foo.png`) as protecting `foo.png` at the top of `Images/`. Fixed by extracting basenames at any depth. If you see similar "this code is dropping refs to legacy paths," look for `referencedRelativeNames` and `migrateNoteImages`.

- **`h-full` chain only works under a definite-height ancestor.** Non-fullscreen popups used `max-h-[90vh]` (no explicit height) and the editor's internal scroll broke. Fix: ensure `h-[Nvh]` or equivalent on the popup. (Commit `c0876e3d`.)

- **OneDrive / iCloud picker can block JS for 30-60s.** `connect()` flips into a staged loading screen BEFORE calling `showDirectoryPicker` and yields two `requestAnimationFrame` ticks so React commits. CSS animations on the loading screen continue running during the JS block; `setInterval`-driven counters don't. See `StagedLoadingScreen.tsx`.

- **FSA handles persist via IndexedDB but permission grants don't.** On reload, call `handle.queryPermission({ mode: "readwrite" })` first; if `"granted"`, reconnect silently. Otherwise show a "Continue" button that fires `requestPermission` (needs user gesture). See `reconnectWithStoredHandle` in `file-system-context.tsx`.

- **Per-user ID collisions.** Grant's task id 1 and Kritika's task id 1 are different tasks. Always use `taskKey(task)` for in-memory uniqueness.

- **Cross-user dependency cascade is namespace-bounded.** `shiftTask(taskId, …, owner)` only walks deps in that one user's directory. There's a planned chain-share feature that mirrors dependency edges across users' dependency dirs; it's spawned but unmerged.

- **Field renames sometimes outpace callers.** When you see a typecheck error in `local-api.ts` for a Notes/Project/etc field that doesn't exist on the inferred type, it's usually because an interface in `lib/types.ts` was renamed by another agent and a caller wasn't updated. The typical fix touches **three layers in lockstep**: (1) the TypeScript interface in `frontend/src/lib/types.ts`, (2) the corresponding `*Api` adapter in `frontend/src/lib/local-api.ts` (read/write/normalize paths, including any lazy migration), and (3) the React component callers that pass the field. Grep the old name across all three before declaring the rename complete — partial renames often typecheck because callers go through `any`-shaped intermediaries. **Note:** Zod runtime validation was consolidated out (commit `f1e3d7be`, 2026-05-13); types are now hand-written TS interfaces in `types.ts`. If runtime validation is ever wanted again, reintroduce it surgically at the call site rather than as a parallel schema file.

- **Drops over `<img>` need native capture-phase listeners — React's `onDrop` doesn't win.** When a user drops a native OS file over a rendered `<img>` inside the markdown body, Chrome's per-element drop default ("replace image with file URL") fires BEFORE React's synthetic event delegation reaches inner element handlers. React's `onDrop` on the `<img>`, the markdown block, and the editor wrapper all silently miss the event; the file falls through to the window-level `GlobalDropGuard`. The fix that actually works: register a native `dragover`/`drop` listener via `useEffect` + `addEventListener(..., true)` (capture phase) on the editor's outer wrapper. Capture fires top-down BEFORE inner elements get the event. Pattern is in `frontend/src/components/LiveMarkdownEditor.tsx` around line 575 (added by `4ae53082`, 2026-05-13). Don't waste time trying React-side fixes for drops on `<img>` — skip straight to native capture-phase.

---

## 7. Recent landed work (top of `main`)

**Snapshot frozen at commit `1b19b524` (2026-05-13).** This list will drift as new work lands — always prefer `git log --oneline -20` over this section for the current state, and treat anything below as historical context only. Highlights from this collaboration:

- README revamp with hosted-URL + Telegram + calendar sections.
- Drag-to-trash double-delete fix + middle-state image-ref migration persistence.
- Image strip + scroll-to-image, sticky in non-fullscreen.
- Fast reconnect (skip picker when permission is still granted).
- Markdown editor scrolls internally in all popup modes.
- Composite-key task identification for shared-task collisions.
- Chain-share spawn (in flight on a branch).
- Editable shared tasks (receiver writes route to owner's directory).
- Image gallery rewrite (FSA-direct).
- Real `sharingApi.shareTask` / `unshareTask` with notifications.
- Multi-user data isolation fix (user switch actually switches data).
- Backend deletion + dead code purge.

---

## 8. Open backlog / things worth queuing

### Active bot branches (in flight)

`claude/*` branches with unmerged work, or parallel manager-session work that's still landing commits. Spawn scopes must not collide with these areas. **Update this list as bots land or spawn** — it's the manager bot's quickest read on what's off-limits to a new spawn.

- **Wiki screenshot recapture** — queued, managed by the parallel manager session. Full re-capture against Demo Lab data now that the fixture infrastructure landed (`6acf27c1`). Plus 5 new shots (markdown-editor language picker + Hybrid block selection + image resize, Results list, Telegram inbox), 2 re-specs (gantt-zoom-controls labels, purchases-funding-panel-not-modal), and the existing `results-editor.png` retired in favor of new `results-list.png` + `results-tab.png`. Off-limits to other sessions: `frontend/src/app/wiki/`, `frontend/src/components/wiki/`, `scripts/capture-wiki-screenshots.mjs`, `frontend/src/lib/file-system/wiki-capture-fixture.ts`.
- **Calendar integrations** — `claude/festive-spence-378806`. Recent: Google Calendar OAuth M1, Outlook OAuth M2, two-way sync M3, calendar OAuth setup wiki, wiki top bar. Status: possibly idle but branch still alive. Off-limits: `frontend/src/lib/calendar/`, `frontend/src/app/calendar/`, `/api/calendar-feed/`.

### Master-bot's spawned bots — 2026-05-13 late afternoon, chips clicked and running

(Delete this subsection once all four have landed and merged.)

- **Outlook OAuth 404 fix** — `claude/festive-curran-aad95c`, commit `4deb8009`. **Reported back**: split `ProviderConfig.key` into `OAuthProviderId` ("outlook") for caller-facing / persistence and `OAuthUrlSegment` ("microsoft") for URL paths so the popup hits `/api/auth/microsoft/login` instead of the 404 `/api/auth/outlook/login`. 2 files, 25 lines. No persisted-state migration needed. Merge into main and push when next session catches up. Off-limits to other sessions during merge: `frontend/src/lib/calendar/oauth-config.ts`, `frontend/src/lib/calendar/oauth-connect.ts`.
- **Markdown editor follow-ups** — chip running (branch TBD). Spec: (1) Mirror the broken-image "Remove reference from note" popup for broken `[name](Files/foo.pdf)` references; (2) Fix `HybridMarkdownEditor.tsx` line ~568 pre-resolve regex (`[^)\s]+` truncates at whitespace, so filenames with spaces don't render inline) using the same fix pattern as `gc.ts` `IMG_REF_REGEX`. ~40 lines, files in scope: `LiveMarkdownEditor.tsx`, `HybridMarkdownEditor.tsx`. Off-limits during merge.
- **API route hardening** — chip running (branch TBD). Spec: SSRF guards, scheme allowlist, response-size caps, redirect limits, content-type allowlists on `/api/telegram-file/route.ts` and `/api/calendar-feed/route.ts`. Files in scope: those two route files plus any small shared helper. Off-limits during merge.
- **Project-wide lint pass** — chip running (branch TBD). Spec: sweep ESLint warnings, real-fix exhaustive-deps + set-state-in-effect where they're real bugs, suppress with one-line comments where they're false positives. **Skip list baked in** (markdown editor, API routes, OAuth config, wiki) so it doesn't collide with the other three. Lower warning count, zero new errors.

### Handoff snapshot — 2026-05-13 late afternoon

(Master-bot session about to roll over to a fresh chat due to context-window limits. Delete this subsection once the new session confirms it's picked up the state.)

**Punch list — items Grant has verified ✓:**
1. Note popup GC
2. Image regression (PNG drop → Images/)
3. Drop on rendered image (capture-phase fix, see §6 above)
4. Stamp redesign + "Repair stamp formats" Settings button
5. File drag-to-delete via `FileTrashDropZone`
6. "Remove reference from note" button on broken image popup
7. Per-tab attachment isolation (basic per-tab flow; migration scenarios optional)

**Punch list — items still pending Grant's live test:**
- **ResultsEditor consolidation** — `/results` card → opens TaskDetailPopup on Results tab?
- **Universal drop on Details tab** — drop a PDF on Details → green toast, file lands in last-active-tab's `Files/`?
- **(Optional polish)** Settings → "Split Lab Notes / Results attachments" button → run on real data, confirm sensible scanned/repaired counts.

**Status of the four spawned bots** — see "Master-bot's spawned bots" subsection above. Outlook OAuth has reported; the other three are still running.

**Wiki manager (parallel session)** — idle except for one queued screenshot bot (8 missing PNGs + 3 editor-*.png wirings + 3 stale capture-script selector fixes). Not blocking the master bot.

### Recently landed (2026-05-13)

- **Demo Lab** (rebased + merged `b8d11669`, body at `a8e4cbb5`): yeast synthetic-biology demo lab under `frontend/public/demo-data/`. `DEMO:`-prefixed projects, watermarked PNGs (`@napi-rs/canvas` via `scripts/generate-demo-*.mjs`), `_demo_marker.json` detection wired to `<DemoLabBanner />` in `AppShell`. "🧪 Try the Demo Lab" button on the user-picker downloads `/demo-lab.zip` (866 KB, prebuilt via `prebuild` script). `wiki-capture-fixture.ts` rewrote to load from the on-disk demo data; mock signs in as `alex`.
- **Fixture infrastructure** (`6acf27c1`): wiki-capture mock now seeds the 10 watermarked PNGs from `public/demo-data/` into its in-memory blob map, and `discoverUsers` routes through `fileService.listDirectories` so the Lab Mode user filter auto-populates with alex + morgan under fixture mode. Unblocks Results-gallery / image-strip / Telegram-inbox screenshots and a meaningful `lab-mode-activity.png`.
- **File-attachments stack** (commits up to `c0189f58`): FileStrip + Images/Files tabs in `LiveMarkdownEditor`, native drop wiring on TaskDetailPopup + methods, drop-zone ring on the editor, amber toast for unsupported surfaces.
- **NoteDetailPopup file/image attachments + GC** (`fec7b2ce` + `ce854ba5`): note popups now write to `users/<you>/notes/<noteId>/Files/` and `Images/`. `gcUnreferencedAttachments` extracted to `lib/attachments/gc.ts` and wired into the debounced-save flush + popup close.
- **Universal popup drop** (`3c123d11`): drops anywhere on a task popup now upload to `Files/` or `Images/`, regardless of which tab is active. Replaces the amber "not supported" toast that lived on the methods tab.
- **Wiki concept-first rewrites + markdown-editor page** (commits `351a7957` through `f62da377`): 12 pages reshaped + a new dedicated `/wiki/features/markdown-editor` page registered in `nav.ts`. Voice pass corrected an architect-speak failure mode (see `feedback_wiki_voice.md` memory).
- **Markdown stamp redesign** (`3a401d14`): HTML comments + lazy normalize for image-position stamps in markdown bodies.
- **Results consolidation** (`eb9a4fb3`): `/results` is now a list of result-worthy tasks that opens via `TaskDetailPopup`; `ResultsEditor.tsx` deleted. **Wiki page is now stale** and needs a rewrite (queued, next on the manager-tier list).
- **Per-tab attachment isolation** (`1613be79`, merged on `43932f01`): each task popup's Lab Notes and Results tabs have their own `Files/` and `Images/` under `results/task-N/notes/` and `results/task-N/results/`. Lazy fallback to legacy shared folder, plus eager Settings → Data maintenance → "Split Lab Notes / Results attachments" button.
- **Drop-routing endgame** (commits `7f670d05` through `58a5e000`): final pass on the file-attachments stack. GlobalDropGuard now ignores supported popups so the misleading "not supported" toast no longer appears on Lab Notes. Drops on rendered `<img>` elements route correctly (Chrome's image-replace default no longer eats the event — solved with a native capture-phase listener on the editor wrapper). Images go to `onImageDrop` even when `onFileDrop` is also wired (the routing split bug that landed PNGs in `Files/`). File-strip entries drag-to-trash like image-strip entries do (`FileTrashDropZone` + `fileEvents.emitDragStart/End`). Broken `![alt](Images/missing.png)` references get a "Remove from note" button in the not-found popup.

### Queued (confirm before spawning)

- **Chain-share** (Version B): when a task with a dependency chain is shared, share the whole connected component. Spawned earlier; in flight on a branch. The chain-share agent is supposed to coordinate with the composite-key work (already landed).
- **Cross-user dependency cascades** in `shiftTask`. Today it stays in one user's namespace; a fully connected chain that spans users won't cascade end-to-end.
- **Cross-owner task→project sharing (Option C).** Today the `TaskDetailPopup` project-move dropdown is own-only — a task can only live in a project owned by the same user. The clean semantic model is to treat "move my task into someone else's shared project" as a *sharing* operation, not a move: the task file stays in the original owner's directory (so `ownerScoped*` editability still works), and a new cross-namespace association registers it as "appearing in" the destination project. Concretely this needs either a composite ref on the task (e.g. `external_project: { owner, id }`) or a project-side manifest of hosted-from-others tasks, plus an analog to `fetchAllTasksIncludingShared` at the project level so the destination project's GANTT/timeline pulls in the external tasks. UX: dropdown becomes a "share into project" action with confirmation, a badge on the affected task, and a remove flow. **Coordinate with chain-share** — both build on cross-namespace references and should share one primitive rather than introducing two competing ones. Don't spawn until chain-share lands so this has a concrete substrate to extend.
- **Lab notes from the inbox panel.** Filing a Telegram image currently means dragging it into a note. Could add a "send to → task" picker.
- **Native tooltip → `<Tooltip>` migration.** Mostly done by a spawned agent; verify all icon-only buttons are using the new component.
- **Settings/migration UI cleanup.** Big chunk landed already; one more pass to delete `DataSetupScreen` / `DataPathCheckPopup` / `ResearchFolderSetup` if confirmed unused.
- **API route hardening.** The Telegram + calendar proxies have basic SSRF guards; a security pass wouldn't hurt.

---

## 9. Quick-start playbook for the master bot

1. Read this file end-to-end.
2. Run `git log --oneline -20` and `git status` to see where main is.
3. For any new request: decide inline vs spawn. Inline if < 1 hour and self-contained; spawn if larger or parallelizable.
4. For spawned tasks, write a prompt that's a complete briefing — see Section 4 above for the recipe.
5. Default to a 2–3 sentence recommendation when the user asks an exploratory question. Don't dive into code until they greenlight.
6. After landing a fix, run typecheck. Then ask the user to test before pushing.
7. Push only when the user says push.

---

## 10. Useful commands cheat-sheet

```bash
# Dev
cd frontend
./start.sh                     # or npm run dev — Next on :3000

# Typecheck / lint
npx tsc --noEmit
npx eslint src/

# Where the data lives during dev (example only — this is Grant's local path;
# other users / dev environments will have different roots, and the app
# accepts any directory the user picks via showDirectoryPicker)
/Users/gnickles/Library/CloudStorage/OneDrive-UW-Madison/ResearchOS_FungalInteractionsLab

# Cleanup script (zips originals to Desktop, then deletes migrated copies)
node scripts/cleanup-migrated-images.mjs "<data-folder>" --dry-run
node scripts/cleanup-migrated-images.mjs "<data-folder>" --prune-empty-dirs

# Hosted URL
https://research-os-xi.vercel.app/
```

Good luck.
