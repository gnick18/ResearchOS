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
- **Commit explicitly, don't push, don't merge.** Sub-bots have misread "don't push, don't merge" as "don't commit" and left uncommitted work that the orchestrator then had to copy file-by-file (the export-arc Sub-bot F mishap, 2026-05-13). Brief explicitly: "commit your changes on your branch in coherent chunks; do NOT push, do NOT merge — the orchestrator handles integration via branch merge." If the bot is in a worktree, this lets the orchestrator pull the branch cleanly.
- **Double-check shape claims against types/regex sources, not memory.** Two factual errors in the export-arc PCR-rendering brief (`pcr_gradient` was described as markdown when it's JSON-encoded, `source_path` was described as `pcr://{id}` when the real format is `pcr://protocol/{id}`) were caught by the sub-bot, not the orchestrator. When the brief asserts a data shape or path format, grep the actual `types.ts` or the regex source first.

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

### Bot-driven UI verification (2026-05-13)

The master bot can spawn a sub-agent with Chrome MCP access to verify UI fixes against `?wikiCapture=1` fixture mode (`mcp__Claude_in_Chrome__*`). The constraint set that proved necessary on the first run:

- **Never load `localhost:3000`.** That's the live app pointed at the user's real research folder. Drive the parallel `localhost:3001` instance instead (start it ahead of time with `next build && next start -p 3001`). Re-check before each navigation — a redirect can quietly land on `/`.
- **Append `?wikiCapture=1` to every URL** to skip the File System Access picker and seed fixture data (2 users: alex + morgan). The mock signs in as alex by default. The fixture covers the methods/PCR/results/lab-mode surfaces today; `users/alex/_shared_with_me.json` seeds a shared project (morgan/1) and a shared task (morgan/5) for receiver-side verification.
- **Use `mcp__Claude_in_Chrome__tabs_create_mcp` for every navigation.** Bots should not navigate the user's existing tabs. Close every MCP tab via `tabs_close_mcp` when done.
- **React `onClick` handlers don't appear as inline `onclick` attributes in the DOM** — they're bound on the React fiber. A bot that greps the rendered HTML for `onclick=` will erroneously report "no handler wired" when the click handler is actually there. Brief the bot explicitly on this so it doesn't false-FAIL React-handled events. Use `tabs_context_mcp` + actual click events to test, not DOM inspection.
- **Unsaved-changes "Leave site?" guards trap tab close.** If the bot edits any markdown body during verification, the popup's beforeunload guard will block subsequent `tabs_close_mcp` calls. Either don't edit (read-only verification only), or dismiss the dialog before closing.
- **Bot brief shape that worked:** project one-liner → expected commit hash → setup steps (ToolSearch deferred tools, list_connected_browsers sanity check, dev-server URL) → hard rules (no :3000, no non-fixture URLs, read-only, MCP tabs only, time budget) → recipe table (one row per fix with explicit pass/fail criteria) → cleanup step → report format (one line per recipe, max 300 words). See the chip-sweep verification recipe in the 2026-05-13 session for a working template.

Fixture coverage gaps to think about when adding new verifications: if a recipe needs `is_shared_with_me` data, extend `scripts/generate-demo-data.mjs` (the fixture is regenerated from there into `wiki-capture-fixture.ts`). If a recipe needs to verify a real-data behavior (the user's actual files on disk, real telegram/calendar tokens, prod OAuth env), it's not bot-doable — punt to the user.

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

### External calendar (live, ICS-only)
- `lib/calendar/external-feeds-store.ts` persists ICS subscriptions in `users/{user}/_calendar-feeds.json`.
- `lib/calendar/ics-parser.ts` parses the feed text.
- `/api/calendar-feed/route.ts` is the Vercel function proxy (15-min edge cache, SSRF-protected).
- `useExternalEvents()` hook merges external events into the calendar view.
- **OAuth (Google + Microsoft) was removed 2026-05-14.** Earlier builds had read/write OAuth integrations under `/api/auth/{google,microsoft}/*` writing tokens to `users/{user}/_calendar-oauth.json`. Grant decided the maintenance overhead (PKCE flow, refresh-token rotation, deployer-side OAuth-client registration, Google's CASA verification) wasn't worth it; ICS subscriptions cover the read use case. The whole surface is gone (routes, lib clients, UI). Legacy `_calendar-oauth.json` files in users' folders are orphaned but harmless. Legacy `kind: "google"|"outlook"` entries in `_calendar-feeds.json` are silently filtered out by the v3 normalizer in `external-feeds-store.ts` (they can't be fetched anymore — user resubscribes via ICS). Wiki page `/wiki/integrations/calendar-oauth` deleted; `/wiki/integrations/calendar-feeds` is now the only calendar-integration doc.

### Wiki + screenshot pipeline

- **Content lives at** `frontend/src/app/wiki/<path>/page.tsx` as pure TSX server components (no MDX). One default-exported component per page returning a `<WikiPage>` wrapper.
- **Shared primitives** (`frontend/src/components/wiki/`): `<WikiPage>`, `<Callout variant="info|tip|warning|danger">`, `<Screenshot src caption width height noZoom>`, `<Steps>` + `<Step>`, `<Kbd>`. Note: `<Tip>` / `<Warning>` / `<Highlight>` do **not** exist as separate components — use `<Callout variant=...>`.
- **Navigation tree** is the single source of truth at `frontend/src/lib/wiki/nav.ts` (`WIKI_NAV`). When adding a page, register a node and the sidebar/breadcrumbs/prev-next links update automatically.
- **Pre-auth bypass**: `frontend/src/lib/providers.tsx` short-circuits the FS-picker gate for `/wiki/*` so visitors can read setup guides before connecting a folder. Don't break this.
- **Screenshot capture is automated** via Playwright. Script: `scripts/capture-wiki-screenshots.mjs`. NPM: `cd frontend && npm run wiki:screenshots`. Pre-req: `npx playwright install chromium` once. PNGs land in `frontend/public/wiki/screenshots/<name>.png` at 1440×900 @ 2× DPR. Red-ring highlights are injected via `page.evaluate()` at capture time (inline CSS, no React component) — the PNG comes pre-annotated. Documentation: `scripts/WIKI_SCREENSHOTS.md`.
- **Fixture mode**: appending `?wikiCapture=1` (signed-in) or `?wikiCapture=picker` (folder-picker) to any URL installs an in-memory file-service mock seeded from `frontend/src/lib/file-system/wiki-capture-fixture.ts` (2 users, 4 projects, realistic data). Hard-blocked outside `localhost`. The script runs three route phases (PUBLIC, PICKER, FIXTURE) in separate browser contexts so IndexedDB doesn't bleed.
- **🚨 NEVER capture screenshots against the user's real data folder.** Grant's `users/` folder contains unpublished research. All wiki / demo / docs screenshots MUST use fixture mode. The fixture is gated by URL flag + hostname; bots adding new captures stay inside this system. If a story needs richer fake data, **enrich** `wiki-capture-fixture.ts` with believable-but-fake content (the test: "embarrassing if leaked to a competitor lab?" → too real).
- **Adding a new screenshot**: add a route entry `{path, file, waitFor, highlight?, action?}` to the appropriate list in `capture-wiki-screenshots.mjs`, update `scripts/WIKI_SCREENSHOTS.md`, re-run the script. Naming convention: `<page-key>.png` matches the `<Screenshot src=…>` value on the consuming page.
- **Capture-time gotchas**: production `next build && next start -p 3001` is much faster than `next dev` (Turbopack first-compile is slow). Don't use port 3000 (the user runs dev there). `?wikiCapture=picker` requires a fresh browser context if a signed-in capture ran first — the script handles this. **`npm run demo:data` wipes `frontend/public/demo-data/` and only writes JSON/MD** — it does NOT regenerate the watermarked PNGs. If you regen demo data and then capture, you'll get 35-of-36 timeouts on `networkidle` because the fixture mock tries to load 404'd PNGs and Playwright's in-flight set never empties. **Always run `npm run demo:images` after `npm run demo:data`** to restore the PNGs, then restart `next start` (Next 16's prod server doesn't pick up new `public/` files added after boot). **Same trap for `demo-lab.zip`**: `npm run demo:data` does NOT regenerate it — only `npm run prebuild` (via `build-demo-zip.mjs`) does. After regenerating demo data, also run `npm run demo:zip` (or `npm run prebuild`) so the downloadable zip stays in sync with the on-disk tree + fixture. Surfaced 2026-05-14 stamp-fixture worker.
- **Wiki voice** (from tone pass `5ebfc8d6`): no em dashes, no semicolons except in code, use `(e.g., …)` / `(i.e., …)` for asides, contractions throughout, brand names properly capitalized. ALL CAPS reserved for the Shared Lab Accounts danger callout only.
- **Wiki coverage gate** (`scripts/check-wiki-coverage.mjs`). Runs as part of `prebuild` (so Vercel deploys + local `npm run build` both invoke it). Scans `frontend/src/app/` for top-level routes with a `page.tsx`, diffs against `APP_ROUTE_TO_WIKI` in `nav.ts`, and fails the build on UNMAPPED (app route with no wiki entry) or ORPHANED (map entry pointing at a missing wiki page) drift. STALE entries (map → missing app route) warn but don't fail. **When you add a new top-level app route, add a matching entry to `APP_ROUTE_TO_WIKI` in `nav.ts` and create the wiki page**; the build will refuse to deploy until you do. Routes that intentionally have no docs (alternate entry points, server-only paths) go in `EXCLUDED_PREFIXES` inside the script. Manual report: `npm run wiki:coverage` (no `--ci` flag, just prints).

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

- **Cross-user dependency cascade is namespace-bounded.** `shiftTask(taskId, …, owner)` only walks deps in that one user's directory. The chain-share feature in `sharingApi.shareTask` (`include_chain: boolean` → `getTaskAncestors`) covers the share-side traversal but `shiftTask` doesn't yet walk cross-user dep edges — a fully connected chain that spans users won't cascade end-to-end. Queued in §8 for follow-up.

- **Field renames sometimes outpace callers.** When you see a typecheck error in `local-api.ts` for a Notes/Project/etc field that doesn't exist on the inferred type, it's usually because an interface in `lib/types.ts` was renamed by another agent and a caller wasn't updated. The typical fix touches **three layers in lockstep**: (1) the TypeScript interface in `frontend/src/lib/types.ts`, (2) the corresponding `*Api` adapter in `frontend/src/lib/local-api.ts` (read/write/normalize paths, including any lazy migration), and (3) the React component callers that pass the field. Grep the old name across all three before declaring the rename complete — partial renames often typecheck because callers go through `any`-shaped intermediaries. **Note:** Zod runtime validation was consolidated out (commit `f1e3d7be`, 2026-05-13); types are now hand-written TS interfaces in `types.ts`. If runtime validation is ever wanted again, reintroduce it surgically at the call site rather than as a parallel schema file.

- **Drops over `<img>` need native capture-phase listeners — React's `onDrop` doesn't win.** When a user drops a native OS file over a rendered `<img>` inside the markdown body, Chrome's per-element drop default ("replace image with file URL") fires BEFORE React's synthetic event delegation reaches inner element handlers. React's `onDrop` on the `<img>`, the markdown block, and the editor wrapper all silently miss the event; the file falls through to the window-level `GlobalDropGuard`. The fix that actually works: register a native `dragover`/`drop` listener via `useEffect` + `addEventListener(..., true)` (capture phase) on the editor's outer wrapper. Capture fires top-down BEFORE inner elements get the event. Pattern is in `frontend/src/components/LiveMarkdownEditor.tsx` around line 575 (added by `4ae53082`, 2026-05-13). Don't waste time trying React-side fixes for drops on `<img>` — skip straight to native capture-phase.

- **Worktree edits silently land on the main checkout if you Read/Edit by main-checkout absolute path.** When operating in a worktree (`.claude/worktrees/<name>/`), `Read` and `Edit` use whatever absolute path you give them — the harness does NOT redirect paths under `/Users/<u>/Desktop/ResearchOS/frontend/...` to the equivalent worktree path. So if you `Read` a file at the main-checkout path while exploring, every subsequent `Edit` to that file also goes to main. You'll find this out when `git status` inside the worktree returns clean but `git status` in main shows your changes. Recovery is easy (the diff is real, just on the wrong branch), but the cleaner habit is: in a worktree, either `cd` to the worktree first and use relative paths, or pass the explicit worktree-anchored absolute path. Hit this on 2026-05-13 mid-chip-sweep; nothing broke but a few seconds of confusion.

- **Next.js 16 client-component `params` are async.** A change from Next 15: in client components, route params are now a `Promise<{...}>` rather than a plain object. Code that does `const { slug } = params;` typechecks but throws at runtime. Discovered by the Demo v2 catch-all route bot on 2026-05-14; the implementer worked around it cleanly using `usePathname()` + string slice (no `params` access at all). For dynamic-segment client components, either `await` the Promise via `use(params)` from React, or sidestep `params` entirely with `usePathname()`. Server components are unaffected — they can `await params` normally.

- **Verification bot's dev server running from a stale worktree.** When a verification bot probes `localhost:3001` (or wherever your dev server is), Next.js serves whatever the dev process's `cwd` was when started — which can be a sub-bot's worktree that was checked out earlier in the day, not the current `main` checkout. Symptom on 2026-05-14: verification bot reported ALL 7 Demo v2 recipes INCONCLUSIVE because the bundle was missing `FloatingLeaveDemoButton.tsx`, `OpenDocsButton.tsx`, `TryInDemo.tsx`, and the catch-all `[[...slug]]/page.tsx` route — those existed in `main` (`74ecd115`, `80471925`) but not in the worktree the dev server happened to be in (`competent-tesla-1c0608` at `412a9fe0`). The failure mode looks like "the feature didn't ship" (broken-looking pages, hung loading screens) rather than "the server is wrong" — easy to misdiagnose. Diagnose by `ps -o pid,command,cwd <pid>` on the dev process or by grepping for one of the merge SHAs in the served bundle. Fix is just `kill <pid>` + restart from the right cwd. Bot brief should ideally tell the bot to verify the bundle freshness first (e.g. check that a known-new component name appears in the page source) and INCONCLUSIVE-out the whole run cleanly if not.

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
- **Calendar OAuth removal** — landed via worker bot on this orchestrator's branch (2026-05-14). All OAuth surface gone; ICS-only going forward. The `claude/festive-spence-378806` branch is now stale (its M1/M2/M3 OAuth work is what got reverted). The `/api/calendar-feed/` proxy is the remaining live integration and stays untouched.

### Handoff snapshot — 2026-05-14 end of day

(Master-bot session winding down for the day. Delete or fold into Recently-landed once the next session has picked up state.)

**Manager sessions (EOD final check-ins):**
- **Wiki manager** — STANDBY. Nothing in flight, no chips queued, no half-finished branches. Pencil-gate cleanup just landed. Available for new direction; idle otherwise. PNG state 36/36, coverage current.
- **Export-revamp manager** — provisionally closed; reachable for a single final answer (EOD response captured here). Detailed PDF audit checklist + methods/unattached Option C recommendation + 6 latent-concerns list filed into §8 above. Session goes away when Grant archives the chat.
- **ELN-import manager** — STAYING OPEN until Grant returns from `offline_14681.zip` verification. Page→project recipe captured above. If Grant signs off: ELN manager closes out (AGENTS.md log + scratch tooling commit + wiki features-page handoff). If issues: ELN manager fixes or spawns fixes. Master can pick up close-out if ELN session closes before Grant verifies.
- **HR (retired master)** — STANDBY, on-call for chip-writing / translation. Spawned Demo v2 (`74ecd115`) + consolidation (`06cd33e5`) earlier today. Context compressed once already; will retire fully if context compresses again. Note: HR's mention of "Export manager chip never clicked" was based on compressed-context view — chip WAS clicked and shipped the entire export-revamp arc.

**Items Grant needs to live-verify (priority order):**
1. **Demo v2 R1–R7 + 5 edge cases** — floating Leave button + catch-all `/demo/[[...slug]]` + sessionStorage stickiness + URL strip + Read-the-docs round-trip + LeaveDemoModal (don't click final actions) + `?wikiCapture=1` still works. Earlier verification bot was INCONCLUSIVE because the `:3001` dev server was running from a stale worktree at `412a9fe0` — see §6 entry. Restart from main checkout first. **5 additional edge cases worth poking** (HR EOD note): (i) `?wikiCapture=1` while inside `/demo` — confirm fixture doesn't re-install mid-flight; (ii) `/demo/methods` catch-all if fixture install fails or times out — does user get stuck with no fallback, or is there a sensible error state?; (iii) multi-tab cross-contamination — open `/demo` in tab A AND tab B, sessionStorage is per-tab but the singleton `fileService` mock is module-global, in-memory edits in A might bleed to B; (iv) browser-back from `/wiki/features/methods` back to `/methods` (inside demo) — does React re-mount and lose in-memory edits?; (v) `<TryInDemo>` clicked while already in a demo session — should be idempotent, watch for flicker / double-redirect.
2. **ELN wizard against `offline_14681.zip`** — critical-path before ELN feature ships. **Concrete page→project mapping from ELN manager** (5 pages → 4 projects per the cleaned[0] rule): page 10 "meetings" → Sam O; page 11 "meetings" → Grant N; page 12 "meetings" → Justin E; page 56 "del_laeA del_slaeA del_slaeB" → Justin E (shares project_id with page 12); page 92 "meetings" → Daniel CG. Projects rendered as `<name> (imported)`. Pages 10 and 12 are entry-empty (header-only `notes.md`); page 11 has 8 entries, page 56 has 2, page 92 has 2. **Quick correctness signal**: after apply, `ls users/<you>/projects/ | wc -l` jumps by 4; `ls users/<you>/tasks/ | wc -l` by 5. Per-task: `start_date = max(entry.updatedAt)`, `is_complete = true`, `task_type = "experiment"`. Per-task disk shape: `results/task-{id}/{notes.md, notes/Files/*, notes/Images/missing-*, notes/_import_source.json}`. After sign-off, ELN manager queues wiki handoff.
3. **PDF export audit** — Inter local-bundle (`dedac195`) closed the jsdelivr URL risk. Now needs `pdftotext`/`pdffonts`/`pdfinfo` confirmation on a fresh PDF export. Combine with stamp-stripping check (export a task whose notes were authored via the editor) to also close that audit gap.
4. **MethodTabs owner-routing live test** — `44a3f12c` patched 6 callsites (addMethod, removeMethod, updateMethodPcr, resetPcr, saveVariationNote ×2) to route through `ownerScopedTasksApi`. Bot couldn't drive the browser; fixture's task 5 is `permission: "view"` so the bug path isn't exercised by `?wikiCapture=1`. To live-confirm: switch fixture task 5 to `"edit"` and attach a method as morgan, OR use a real two-user folder.
5. **Older backlog** still pending (no time pressure): ResultsEditor consolidation walkthrough, Universal drop on Details, File-link UX, `TESTING.md` A-F scenarios, lint pass spot-check, Export-revamp 5-scenario panel (cross-user round-trip needs real two-user setup). (Outlook OAuth dropped from this list — the whole calendar OAuth surface was removed 2026-05-14.)

**Items already verified by Grant ✓** (from prior sessions): Note popup GC, image regression, drop on rendered image, stamp redesign, file drag-to-delete, broken-image popup, per-tab attachment isolation, spaces-in-filename inline image render. R6 (file-link UX clickable + View/Download modal) confirmed by Grant during 2026-05-13 session.

**EOD worker bots** — both reported + merged during the same session:
- `source_instance` field worker landed at `db235a82` (closed §8 export-audit item #3 + bonus typed-manifest interfaces).
- Native `title=` → `<Tooltip>` migration audit landed at `fcf857ad` (25 icon-only-button bugs fixed inline; 6 sites flagged for follow-up — see §8 Queued).

**Stale local branches worth pruning** (work landed elsewhere, branches just clutter `git branch`): `claude/epic-dubinsky-f36fb5` (Export Sub-bot F PCR-rendering), `claude/sharp-kirch-4345ef` (unknown), `claude/competent-tesla-1c0608` (the worktree that caused the stale-dev-server trap). Confirm-and-delete is safe but optional.

### Recently landed (2026-05-14 EOD verification cycle)

End-of-day Grant-driven verification session walked Demo v2 / ELN wizard / PDF audit / MethodTabs / Universal-drop tiers via clickable popups. **8 debugger bots spawned + integrated** during the session. Net: 0 ship-blockers found, several real bugs surfaced and patched on the spot.

- **R1 floating button occlusion** (`82d3f5e4`). Home page's data-folder + profile icons at `bottom-6 right-6/right-20` occluded the floating Leave button. Bumped to `bottom-20 right-4`.
- **E4 demo state lost on browser-back** (`e2f3bb39`). `OpenDocsButton` uses plain `<a>` (full browser nav), so `FloatingLeaveDemoButton`/`OpenDocsButton`/`DemoLabBanner` had stale React state after back-nav. All three now re-read `getDemoMode()` on every `pathname` change.
- **Methods editor Save/Cancel** (`e2f3bb39`, same merge). `MarkdownMethodViewer` had no `originalContent` baseline — Save looked clickable when clean, Cancel didn't reset state. Both now mirror the `TaskDetailPopup` pattern. **Hybrid-mode editor glitches deferred** (structural in `HybridMarkdownEditor`).
- **PDF image dedup investigation + docs** (`319fc5ea`). PDF uses `@react-pdf/renderer`'s native imageCache (data URIs byte-deterministic → single XObject), HTML inlines per-section by design. Grant's +80KB observation was a misread. Comments added to prevent future "optimizations."
- **PDF method body fix** (`319fc5ea`, lazy-normalize). Demo seed wrote `Method` records with `source_path: null` + a fictional `attachments[0].path`. `normalizeMethodRecord` in `local-api.ts:538-565` self-heals on read. Also fixed the methods page UI ("Method file not found.").
- **Demo fixture: shared task swap + `shared_with` shape fix** (`70e9115b` + `8d198375`). Tier 4 needed an experiment-type shared task; flipped from morgan task 5 (list) to task 3 (qPCR setup, experiment with method attached). Then SharePopup crashed with "Cannot read properties of undefined (reading 'charAt')" because the fixture wrote `shared_with: ["alex"]` (string) instead of `[{username, permission}]` (SharedUser). Fixed both fixture sites.
- **Variation-notes refetch fix** (`89a31237`). MethodTabs refetched on `["task", task.id]` but popup's `useQuery` keys on `["task", taskKey(task)]` (composite). Keys never matched, refetch was a no-op, reopening the panel blanked the just-typed text. Same composite-key pattern as the 8-file sweep, but in a surface the sweep missed. Fix: bubble updated task through existing `onTaskUpdate` callback. **Latent bug flagged**: `TaskDetailPopup.tsx:194-199` `queryFn: () => tasksApi.get(initialTask.id)` doesn't pass `owner` — fine today since refetch isn't keyed correctly, but if anyone fixes the key they hit this.
- **E3 multi-tab cross-contamination — verdict: no leak** (`a77863ac` debugger investigation, no code change). Mechanically traced every persistence surface; module-scope Maps are per-realm, IDB only stores 3 constants (handle/currentUser/mainUser), no BroadcastChannel/SharedWorker/cookies. Grant's earlier observation was a misread. Retest with distinctive `ZZZ_LEAK_TEST` string confirmed no leak.

### Recently landed (2026-05-14)

- **Tooltip ref-forwarding refactor** (`b978f66c`, worker bot). Closes the 2 hardest sites from yesterday's EOD audit follow-ups (the TaskDetailPopup checkbox callback-ref cases). Approach: inline `composeRefs<T>(...refs)` helper in `Tooltip.tsx`; reads existing child ref off `child.props.ref` (React 19 prop convention), memoizes the composed ref, fans the DOM node out via cloneElement. Backwards-compatible — surveyed 35+ existing `<Tooltip>` callsites; none currently pass a child ref, so `composeRefs(captureRef, null)` reduces to just `captureRef`. Migrated TaskDetailPopup `:709` + `:1464` to `<Tooltip>` while preserving the `checkboxRefs.current.set(...)` collection logic. 4 remaining sites in §8 Queued are design calls (responsive labels, non-button `<img title=>`, nested-context spans), not refactor cases.
- **`methods/unattached/` round-trip probe** (`5298c432`, worker bot). 274-LOC test at `lib/import/unattached-roundtrip.test.ts` documents current behavior + the cross-half asymmetry (export carries the bytes, import parses them, apply silently drops). Not a bug — the drop is intentional and commented — but the export-side comment doesn't reflect this. Three design follow-ups documented in §8 export-audit subsection.
- **Stamp-stripping for HTML/PDF — verified** (`e3380945`, worker bot). Added a stamped header to alex's task-2 `notes.md` in the demo seed (canonical format from `stamp-utils.ts:14-20`), plus a verification probe `frontend/scripts/test-stamp-strip-on-export.mjs` that exercises the actual `parseContent` call `extractUserContent` makes. Probe PASSES: stamp markers stripped, demo banner + body survive, `hasUserContent` still true.
- **API proxy hardening round 2** (`6610b7f5`, worker bot). Round-2 security audit found 3 real bugs in `/api/telegram-file` + `/api/calendar-feed` + shared `url-guards.ts`, all fixed inline: (a) timer leak on early-return error paths — every error now `clearTimeout`s the AbortController watcher; (b) error-message leakage to client — generic strings on the wire, internal detail via `console.warn` server-side only; (c) calendar `?url=` length cap at 2KB (was unbounded). Audit also confirmed multiple surfaces already safe: method allowlist (Next.js auto-405s non-exported), CORS (no `*` set), no client header forwarding, only `content-type` + `content-length` copied from upstream, SVG-via-Telegram blocked by content-type denylist, AbortController wiring is real. 5 residual items queued as round-3 chips — see §8 Queued ("API hardening round-3 follow-ups").
- **Native tooltip → `<Tooltip>` migration audit (closed)** (`fcf857ad`, EOD worker). Surveyed ~170 `title=` callsites across `components/` + `app/` (ex-wiki). Most legit (custom-component props, iframe a11y, truncation tooltips, form-validation hints). 25 icon-only-button bugs fixed inline across 11 files (HighLevelGoalSidebar, Toolbar, InteractiveGradientEditor, TaskDetailPopup, SidebarContentsPopup, CalendarFeedsModal, TaskQuickPopup, DayDetailDrawer, CalendarRemindersModal, purchases page, links page). 6 sites flagged for follow-up — see §8 Queued.
- **Export `source_instance` field + typed manifests** (`db235a82`, EOD worker). Closes another §8 export-audit item. Adds optional `source_instance: "{ownerLabel}@{YYYY-MM-DD}"` to Raw, HTML, and PDF manifests (PDF in Document `keywords`). Bonus: formalized three inline manifest object literals into proper `RawManifest` / `HtmlManifest` / `PdfManifest` TypeScript interfaces; helper `buildSourceInstance()` centralizes the format.
- **Shared-task method-mutation owner routing** (`44a3f12c` MethodTabs fix + `1689b2cf` circular-import extraction). Sub-bot's static analysis widened my 2-callsite brief to 6: `addMethod`, `removeMethod`, `updateMethodPcr`, `resetPcr`, plus `saveVariationNote` ×2 in `VariationNotesPanel`. All routed through `ownerScopedTasksApi` via `useMemo`. Sub-bot's initial fix created a circular dep (MethodTabs imported from TaskDetailPopup, which imports MethodTabs); extracted the wrapper to leaf module `lib/tasks/owner-scoped-api.ts` (46 LOC). Live verification still owed — bot couldn't drive the browser; fixture's task 5 is permission "view" so the bug path isn't exercised by `?wikiCapture=1`.
- **Demo v2 — floating Leave button + catch-all `/demo/[[...slug]]` + `<TryInDemo>` wiki CTAs** (`74ecd115`, merged). New `<FloatingLeaveDemoButton>` + `<OpenDocsButton>` fixed bottom-right on all `/demo/*` routes; `<TryInDemo>` CTAs wired into 5 wiki pages. Mode predicate now sessionStorage-sticky (`markDemoMode`/`clearDemoMode`) so navigation `/demo/methods` strips URL to `/methods` while preserving demo state. New catch-all `app/demo/[[...slug]]/page.tsx` replaces the old `app/demo/page.tsx`. HR-spawned chip.
- **Demo Mode wiki updated for v2** (`4df9951c`, wiki manager). One-paragraph fix to `/wiki/getting-started/demo-mode` — the "URL stays at /demo the whole time" claim was wrong after the catch-all redirect.
- **Route→wiki map consolidation** (`06cd33e5`). HR-spawned chip. Removed parallel `lib/demo/route-to-wiki.ts`; one canonical `APP_ROUTE_TO_WIKI` map in `lib/wiki/nav.ts` with two consumer-facing variants — `appRouteToWikiRoute()` (fallback, for the "?" help icon) and `getWikiForRoute()` (null-returning, for `OpenDocsButton`).
- **Export polish — deterministic bytes + HTML/PDF manifest markers** (`80471925`). B.4: JSZip 3 doesn't accept a top-level `date` option, so the implementation iterates `zip.files` after add and sets each entry's `.date = new Date(payload.meta.exportedAt)`. Applied to `raw.ts`, `html.ts`, `orchestrate.ts` (multi-experiment wrapper uses `payloads[0].meta.exportedAt`), and `pdf.ts` (PDF Document `creationDate`). B.5: HTML output zip now includes `_export-manifest.json` at the root (same shape as Raw); PDF JSON-stringifies the manifest into Document `keywords`, `subject` left as `project.name`. Closes 2 of the 6 §8 export-audit backlog items.
- **`method_attachments` orphan rows hygiene** (B2 sub-bot). Investigation found no runtime detach path leaks orphans — `tasksApi.removeMethod` already prunes both arrays. The state on disk came from `scripts/generate-demo-data.mjs` hard-coding `method_ids: []`. Generator fixed (derive `method_ids` from `method_attachments`); on-disk demo regenerated for 7 affected tasks; invariant enforced at `tasksApi.update`; lazy-normalize at read in `normalizeTaskRecord`; belt-and-braces filter in `extract.ts`.
- **Dead-code sweep — `SidebarTree.tsx` deleted + §8 audit pass** (worker bot `53bc46a8`, merged). Confirmed orphan removed (285 LOC) + stale comment cleaned in `app/gantt/page.tsx:166`. Audited the three "Settings/migration UI cleanup" candidates from §8 Queued — all three entries were stale: `DataSetupScreen.tsx` is **not** an orphan (actively imported by `app/page.tsx:10`), `DataPathCheckPopup.tsx` already deleted in a prior pass, `ResearchFolderSetup.tsx` already deleted (only `ResearchFolderSetupNew.tsx` remains). Both §8 Queued entries removed. Net: -286 LOC, zero behavior change.

### Recently landed (2026-05-13)

- **`?wikiCapture=1` stale-state regression fix** (`2be9af8c`): the `/demo` author flagged but didn't fix this — visiting `?wikiCapture=1` then navigating to `/` left `name: "wiki-capture-fixture"` fake handle + `currentUser` + `mainUser` in IndexedDB, breaking the next visit with a "Reconnect to wiki-capture-fixture" screen because `queryPermission` on the fake throws. In `initialize()`, detect the sentinel-named handle and clear all three IDB entries before the silent-reconnect path runs. Same helpers `<LeaveDemoModal>` Discard uses.
- **Per-user project-ID collision sweep — fully closed** (commits `36816a9d` → `b086fb4c`, 8 files, single template applied throughout). `/search` first (`36816a9d`), then a 6-file sweep landed at `41a9dd6e` (`app/page.tsx`, `experiments`, `results`, `gantt`, `DailyTasksSidebar`, `TaskModal`). Three follow-ups closed the remaining surface in parallel: group-by-project buckets in `DailyTasksSidebar.tsx` + `results/page.tsx` (`f534495f`, rekey + module-scope helpers for useMemo stability), `MethodExperimentsSidebar.tsx` (`8c2d3e66`, also swapped `methodsApi.getExperiments` → `tasksApi.listByMethod` because the old shape lacked `owner`), and gantt's `projectColors: Record<number, string>` prop type migrated through `GanttChart` / `Toolbar` / `SidebarTree` to `Record<string, string>` keyed on `${owner}:${id}` (`b086fb4c`). Pattern: `projectKey(p)` and `taskProjectKey(t)` helpers compose `"{owner}:{id}"` mirroring `taskKey()` from `lib/types.ts`. All popup `projects.find()` calls now match on both `p.id` AND `p.owner === expected.owner`. Sweep means alex's project 1 and morgan's project 1 no longer collide in any project-keyed lookup, color map, or group bucket the user can hit.
- **Public `/demo` route** (`dc0a74ea`, merged `d1d32079`): in-browser demo at `localhost:3001/demo` (and the deployed equivalent) renders the wiki-capture fixture as `alex` without ever showing the FSA picker. New components: `<LeaveDemoModal>` (Save-as-zip / Discard CTAs), `<DemoLabBanner>` extended to render "Leave Demo" in in-browser-demo mode only. New helper `lib/demo/export-fixtures-to-zip.ts` fetches the canonical `/demo-lab.zip` and overlays fixture-mode runtime edits onto it before download. `ResearchFolderSetupNew` reshuffled to promote "Explore demo in browser" as the primary CTA, "Or download as a starter folder" as secondary. The mode predicate `isWikiCaptureMode()` was unioned into `isDemoOrWikiCapture()` so the `/demo` route piggybacks on the same fixture-bypass gate in `providers.tsx`. `indexeddb-store.ts` gained `clearMainUser()` for the Discard-and-reset flow. Risk areas to keep an eye on (the swap touched `providers.tsx`, `file-system-context.tsx`, `wiki-capture-mock.ts`): the normal FSA picker flow, the `?wikiCapture=1` localhost flow, and the demo-lab.zip download flow.
- **Export revamp — full arc shipped** (commits `f77155dd` → `23de5b14`, ~3,700 LOC under `lib/export/` + `lib/import/` + dialogs): old 622-line html2canvas-rasterized `export-utils.ts` deleted; new three-format pipeline (PDF via `@react-pdf/renderer` with selectable text + clickable TOC + bookmarks pane, HTML via `marked`, Raw bundle for cross-instance) under `frontend/src/lib/export/{types,slug,markdown,extract,orchestrate,raw,html,pdf}.ts`. Inter typography (jsdelivr-fetched, Helvetica fallback offline). Receiver-side import flow under `frontend/src/lib/import/` with conflict-resolution dialog (per-project + per-method use-existing / import-new auto-suffixed / skip). New UI: `<ExportFormatDialog>` three-card picker, `<ImportExperimentDialog>` resolution preview, multi-select on `/search` (user view) + `LabSearchPanel` (Lab Mode) with per-experiment zip packaging. Method-id matching replaced name-substring lookups (`methodId?: number` on `ExperimentAttachment`); PCR rendering pre-fetches `PCRProtocol` (`pcrProtocol?: PCRProtocol | null` on `MethodPayload`) so format generators stay sync; `pcrApi.get` gained optional owner for shared-task private-protocol routing. PCR round-trip: Raw bundle carries `methods/method-N-pcr-protocol.json`; import side calls `pcrApi.create` in the receiver's namespace and rewrites `source_path` to the new id. Eight sub-bots total (A extract, B raw, C HTML, D PDF, E UI, F PCR rendering, G import, H PCR cross-instance) — all integrated.
- **Demo lab dynamic dates** (`b3782349`, merge of `716d2a74`): on-disk + fixture-mode demo lab now rebases all task/goal/event `start_date`/`end_date` + project `created_at` + `_shared_with_me.json` `shared_at` on connect, idempotent via `last_rebased_at` in `_demo_marker.json`. New module `frontend/src/lib/demo/rebase.ts` with `isDemoLab` predicate, dependency-injected so it works against `fileService` and the fixture mock. Strict gate on `is_demo: true` — can't touch the user's real folder. Method/PCR/note timestamps intentionally frozen (history, not schedule). 20-assertion unit test covers 7-day delta, month rollover, year rollover, idempotency.
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
- **Outlook OAuth 404 fix** (`4c0c079e`): split `ProviderConfig.key` into `OAuthProviderId` ("outlook", caller-facing) and `OAuthUrlSegment` ("microsoft", URL path) so the popup hits the existing `/api/auth/microsoft/*` routes instead of 404'ing on `/api/auth/outlook/*`. No persisted-state migration; caller-facing "outlook" identifier preserved.
- **API route hardening** (`18b7f0c3`): SSRF + scheme allowlist + private-IP/IPv6 guards + DNS-rebinding mitigation + redirect cap (3 hops) + response-size cap (20 MiB Telegram, 10 MiB ICS) + content-type denylist + 30s timeout on `/api/telegram-file` and `/api/calendar-feed`. Shared helper at `frontend/src/lib/api/url-guards.ts` so future proxies inherit the same posture. 24 curl probes verified rejection of localhost/metadata-IP/scheme/credentials-in-URL/nip.io-rebinding attacks; legit Telegram and ICS feeds still proxy correctly.
- **Markdown editor follow-ups** (`f1d21366`): spaces-in-filename images render inline now (regex updated in `HybridMarkdownEditor` line 585 + `LiveMarkdownEditor` line 694, plus a `canonicalizeRefSrc` helper that strips CommonMark titles and angle brackets so the blob-URL cache key stays consistent). Broken file-link popup extended from the existing broken-image popup with a `kind: "image" | "file"` discriminant — same queue, same dismiss flow.
- **File-link UX revamp** (`claude/trusting-wright-f1b4ad`, merged): file-link snippets now URL-encode the filename so `[READ ME.md](Files/READ%20ME.md)` parses as a clickable hyperlink. Custom `<a>` click handler intercepts file-link clicks and prompts View (text-like + PDF inline via blob URL) vs Download (binary). New `FileViewerModal` component renders text-like files inline.
- **Project-wide lint pass** (`claude/sharp-turing-5f32ab`, merged): swept ESLint warnings across the codebase. 51 files changed, ~340 lines removed (unused imports, dead code), real-fix exhaustive-deps + set-state-in-effect where they were genuine bugs, one-line eslint-disable comments where they were false positives. Skip-list honored the in-flight bot territories.
- **Project-sharing audit + first regression fix** (`claude/beautiful-moore-3682dd`, merged): caught and fixed a real regression — `fetchAllTasksIncludingShared` only loaded individually-shared tasks, missing tasks that belonged to a shared *project*. Extended the fetcher to also pull from each shared-project's owner directory, with composite-key de-dup. Updated `tasksApi.listByProject` to accept optional `owner` and route to `tasksStore.listAllForUser`. `ProjectDetailPopup` threads `project.owner` through. `app/page.tsx` (home) gates the `t.project_id === p.id` membership predicate on `t.owner === project.owner` to dodge per-user id collisions. New `TESTING.md` at the repo root documents 6 manual-test scenarios (A-F) for the sharing flow. Five follow-ups flagged in §8 Queued.
- **Quick-win chip sweep** (commits `62ad62c0` → `845afe17`, 2026-05-13 evening): nine small backlog chips landed inline across one master-bot session, each its own atomic commit on `main`. (1) `projectsApi.create` now persists `currentUser` as `owner` instead of `""`, matching the equivalent in `tasksApi.create`. (2) Share button now hidden on tasks / projects / methods (markdown / PDF / PCR variants) when the item was shared TO the current user — receivers can't grant access to something that isn't theirs. (3) `FileTrashDropZone.stripReferences` now runs its regex against both the raw filename and `encodeURIComponent(filename)`, so `Files/READ%20ME.md` links get cleaned when the underlying file is dragged to trash. (4) `providers.tsx` error-handler init moved from a module-level flag + side-effect-during-render into a `useEffect` with cleanup return so React strict-mode double-mounts unwind correctly. (5) `LabUserDetailPanel` `topFunding` `useMemo` hoisted above the `if (!user) return null` early-return guard — was a real rules-of-hooks violation. (6) GC sweep (`lib/attachments/gc.ts`) now also matches non-image markdown links and HTML anchors, and `decodeURIComponent`s the captured basename so URL-encoded file refs (`Files/READ%20ME.md`) actually protect their files from sweep. (7) Five callers of `tasksApi.listByProject` (purchases / experiments / search / results / TaskModal) now thread `p.is_shared_with_me ? p.owner : undefined` so shared-project tasks load — the audit fix that paired with the `ProjectDetailPopup` change from `b0e8d0c7`. (8) `no-explicit-any` cleanup: `lib/dom.asynciterable` added to tsconfig and the three FSA `(handle as any)` casts in `local-api.ts` dropped (modern lib.dom has the types); the loop now narrows on `entry.kind` with two precise casts. (9) `InteractiveGradientEditor.tsx` `delete (newCycleStep as any).cycleIndex` simplified to `delete newCycleStep.cycleIndex` since `cycleIndex` is already optional on `GradientBlock`.

### Queued (confirm before spawning)

- **Cross-user dependency cascades** in `shiftTask`. Today it stays in one user's namespace; a fully connected chain that spans users won't cascade end-to-end. **Note**: chain-share landed in `sharingApi.shareTask` (`include_chain: boolean` → `getTaskAncestors(taskId)`), so the chain-of-tasks primitive exists. What's still missing: when alex shifts a task and morgan has dependents on alex's task in her own namespace via `_shared_with_me.json`, the cascade should walk into morgan's deps dir too. Needs careful design — re-reads from receiver's `_shared_with_me` aren't free, and the cascade is recursive.
- **Cross-owner task→project sharing (Option C).** Today the `TaskDetailPopup` project-move dropdown is own-only — a task can only live in a project owned by the same user. The clean semantic model is to treat "move my task into someone else's shared project" as a *sharing* operation, not a move: the task file stays in the original owner's directory (so `ownerScoped*` editability still works), and a new cross-namespace association registers it as "appearing in" the destination project. Concretely this needs either a composite ref on the task (e.g. `external_project: { owner, id }`) or a project-side manifest of hosted-from-others tasks, plus an analog to `fetchAllTasksIncludingShared` at the project level so the destination project's GANTT/timeline pulls in the external tasks. UX: dropdown becomes a "share into project" action with confirmation, a badge on the affected task, and a remove flow. **Now unblocked** — chain-share is landed (see above) and the cross-namespace primitive it uses (`getTaskAncestors` + receiver's `_shared_with_me.json` write) is a working precedent.
- **Lab notes from the inbox panel.** Filing a Telegram image currently means dragging it into a note. Could add a "send to → task" picker.
- **`FloatingLeaveDemoButton` focus-visible ring** (HR EOD note, low-priority). The amber-500-on-white background already passes WCAG-AA contrast, but the focus state relies on browser default. Fix is ~5 lines: add `focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2` to the button className. Skip dedicated chip — fold into the next chip that touches `FloatingLeaveDemoButton.tsx`.
- **PickFormatStep "Coming soon" cards re-enable** (HR EOD note, ELN-side). The ELN-copy-tightening chip will downgrade `labarchives-pdf` + `chrome-pdf` import options to disabled "Coming soon" state on the wizard's format-picker step. When/if those importers ship later, the cards need re-enabling. Track via `// TODO(eln-pdf)` in `components/import-eln/steps/PickFormatStep.tsx`.
- **Wiki page: `/wiki/getting-started/labarchives-export`** (HR EOD note + ELN domain). New how-to page covering how a user generates the offline ZIP from LabArchives in the first place, since the ELN import feature consumes that format. **ELN manager note**: this is already in flight on a sibling chip (the rename-bot's report mentioned it landing); not from ELN manager's session. Confirm where it landed before queuing duplicate work.
- **LabArchives OAuth image rehydration** (Grant authorized 2026-05-14 EOD). Currently ~50% of inline images in offline LabArchives ZIPs are Form-B URLs to LabArchives' API — not bundled in the export. Wizard writes broken `![](Images/missing-{ts}.jpg)` placeholders today; user manually removes via the "Remove reference from note" popup. **Real fix**: build LabArchives OAuth flow (mirror the Google/Microsoft pattern at `/api/auth/{google,microsoft}/`), add a wizard step between Preview and Apply for "Sign in to LabArchives," extend apply pipeline to fetch each Form-B URL with auth + save to `users/<u>/results/task-{id}/notes/Files/<image>` + rewrite the markdown ref to the local path. Manager-tier — likely 3 sub-bots: (a) OAuth route + token storage, (b) LabArchives API client for image fetch, (c) wizard step + apply integration. Estimate: 1–2 dev days. Spawn when ready.
- **Variation-notes autosave-as-you-type** (Grant UX request, 2026-05-14 EOD). Today's variation-notes UI has an explicit Save button; users can lose typed content by closing the panel without clicking it. Debounced save-on-input would prevent that. Depends on the variation-notes save path working (✅ fixed `89a31237`). ~30 LOC: convert the Save button to a "Saved" indicator that updates on input idle + debounced commit via existing `tasksApi.saveVariationNote`.
- **Edit-mode affordance on Details page** (Grant UX request, 2026-05-14 EOD). When a user clicks into an editable field on a task popup's Details tab, there's no visible cue that they're now in edit mode. No border highlight, no cursor focus indicator, no Save/Cancel button row appearing. Easy to type without realizing you're in edit mode. Fix: visible focus-state border + a "Save/Cancel" row that fades in when the field becomes dirty. Mirrors the methods-editor pattern just landed in `e2f3bb39`.
- **PCR method create — default gradient + ingredients template** (Grant UX request, 2026-05-14 EOD). Newly-created PCR methods (Methods page → Create new method → PCR) start with empty gradient + empty reagent table. Tedious for users. Pre-fill with a sensible default: 95°C 3min initial / 30 cycles of 95-15s + 60-30s + 72-30s / 72°C 5min final / 12°C hold; reagent template with placeholder rows for buffer + primers + template + dNTPs + polymerase + H2O. Touchpoint: `app/methods/page.tsx` PCR-create handler, around the `pcrApi.create` call.
- **Latent: `TaskDetailPopup.tsx:194-199` queryFn doesn't pass owner** (flagged by variation-note debugger 2026-05-14). `queryFn: () => tasksApi.get(initialTask.id)` should be `tasksApi.get(initialTask.id, ownerForTask(initialTask))`. Currently dormant because the refetch key didn't match anyway; if anyone fixes the dead refetch they'll hit this. ~3-line fix.
- **Drop Google/Microsoft OAuth, revert calendar to read-only ICS** (Grant decision 2026-05-14). Current calendar OAuth surface (`/api/auth/google/*` + `/api/auth/microsoft/*`) gives write-sync, but the read-only ICS subscription path via `/api/calendar-feed` is "more than fine" per Grant. Remove the OAuth code paths + token storage + the calendar OAuth UI. Keep ICS feed subscriptions intact. **Migration**: users with existing OAuth tokens lose write-sync; surface a one-time deprecation notice on next load. **Bonus**: makes the API hardening round-3 OAuth audit chip unnecessary. Estimate: ~half day single worker. Spawn after LabArchives OAuth lands so the OAuth pattern stays consistent (LabArchives is gaining what Google/MS are losing).

— Export pipeline backlog (Export manager EOD final, ranked by manager's worry level):
- **Multi-select export OOM at scale.** Multi-export of 50+ experiments buffers everything in memory before download (extract payloads w/ image bytes + per-experiment results + outer wrapper zip). 100 experiments × image-heavy notebooks could blow the browser heap. JSZip supports streaming via `generateNodeStream` / `generateInternalStream` but `orchestrate.ts` uses `generateAsync({ type: "blob" })` which buffers. Real ceiling for power users; not urgent.
- **Windows-reserved filenames in slugify** (`lib/export/slug.ts`). Doesn't strip `CON`, `PRN`, `AUX`, `NUL`, `COM1–COM9`, `LPT1–LPT9`. A task named "AUX prep" exports as `aux-prep.pdf` — unopenable as a literal filename on Windows. One-line fix: append `-task` suffix when the slug exactly matches a reserved name.
- **Broken file refs in markdown body → inline placeholder.** If `notes.md` has `[old report](Files/old-report.pdf)` but the file was deleted before export, `extractor.filterByBodyRefs` drops the attachment but HTML still emits `<a href="attachments/Notes/old-report.pdf" download>` pointing at nothing. Render an inline `[missing file: old-report.pdf]` placeholder instead. Same idea for PDF generator.
- **Font.register surface-once-on-failure.** `Font.register` is called per-export inside `buildPdf`, not at module init. react-pdf caches globally so repeated calls are no-ops on success, but a failed first registration silently retries on every subsequent export rather than throwing once at startup. Move to module-init or memoize the success.
- ✅ **`source_instance` privacy** — Export manager flagged this in their final report as a concern (could leak hostname / OneDrive path). **Verified at `types.ts:135-140`: `buildSourceInstance` returns just `${ownerLabel}@${exportedAtIso.slice(0, 10)}` — no hostname, no filesystem path, no leakage.** Concern allayed.
- **No unit tests for `lib/export/` or `lib/import/`.** Vitest is in devDeps. A `lib/export/__tests__/orchestrate.test.ts` (~200 lines covering raw/html/pdf happy paths with mock payloads) would meaningfully reduce regression risk. Currently any refactor of the pipeline only has typecheck + build as the net.
- **`MethodPayload.pcrProtocol` silent fallback.** When a PCR method's `pcrApi.get` returns null (shared task → private protocol in owner's namespace, owner-routing fails for whatever reason), format generators fall back to `"PCR Method (protocol could not be loaded)"`. Add a `console.warn` at extract time so the user sees a clearer signal than silent fallback.

— ELN import backlog (ELN manager EOD, ranked by manager's worry level):
- **`tasksApi.update(id, { project_id: null })` type widening** (ELN manager's most-worrying item). The bulk-sort screen casts through `Parameters<typeof tasksApi.update>[1]`. If the underlying setter rejects `null` at runtime, the "(no project)" bulk action breaks silently. Worth a runtime check + a test against a real null write.
- **Multi-GB notebook OOM.** Parser holds the full JSZip + linkedom DOM in memory. Sample 2 (310 MB) was fine. Multi-GB would OOM the browser tab with no graceful fallback. Worth a size-cap warning before the parse step (e.g. ">500 MB might exceed browser memory").
- **Turndown tables — never visually eyeballed.** Sample 2 had tables; CLI stress test wrote 77 KB body markdown without warnings but no one rendered the task body to confirm tables read sensibly. Could be visually cramped. Manual spot-check during Grant's verification.
- **Missing-inline-images list rendering at scale.** Done step renders a list of inline images that didn't bundle (Form-B). Sample 2's ~30+ inlines never seen rendered — could be a 20-screen-long unvirtualized list. Cosmetic but ugly.
- **Date TZ drift.** `isoDatePortion(updatedAt)` slices the first 10 chars of the ISO string. A `2026-03-26T00:30:00Z` updatedAt in a `-05:00` timezone slices to `2026-03-26` even though it's `2026-03-25` locally. Subtle but real.
- **Page-level re-import dedup is silent.** Edit one entry on a page in LabArchives → re-export → re-import: the page is silently skipped because its dedupKey matches. There's no "this page changed; re-import overwriting?" prompt.
- **Form-B broken-image recovery UX validation.** The wizard writes `![](Images/missing-{ts}.jpg)` to `notes.md` but never creates the file. Per AGENTS.md §7 the broken-image popup has a "Remove reference from note" button (`4ae53082`-era work) — that's the intended recovery flow. **Validate that flow works for an importer-placed missing-image marker, not just a user-pasted one.**
- **Tooltip migration — 4 design-call follow-ups** (residual from the 2026-05-14 EOD audit + ref-forwarding refactor). The bulk migration closed 25 sites + the 2 hardest (checkbox callback refs) via `b978f66c` (Tooltip now composes child refs via inline `composeRefs<T>` helper, fully backwards-compatible — 35+ existing callsites surveyed, all take the null branch). 4 sites still need design decisions: (a) `BetaDonationButton.tsx:42` and `app/page.tsx:675` — `hidden sm:inline` text means icon-only on small viewports only; judgment call. (b) `HybridMarkdownEditor.tsx:1513` and `LiveMarkdownEditor.tsx:2356` — `<img title="Click to resize">` on a non-button element; would need a floating popover or inline label. (c) `DayDetailDrawer.tsx:228` + `app/page.tsx:389` — `<span title="...">` nested inside a clickable parent; wrapping in Tooltip creates nested hover/focus contexts. Could be addressed individually as small chips.
- **API hardening round-3 follow-ups (from the round-2 audit at `6610b7f5`)**: (a) **rate limiting via Vercel KV / Upstash** — per-IP token bucket on both proxies; currently unbounded, can be DoS'd or abused as a low-volume open proxy. In-memory store would die on cold starts. (b) **IP-pinned dispatch to close the DNS-rebinding TOCTOU** — would require a custom undici Dispatcher; only worth doing if SSRF posture must be airtight for the public deploy. (c) **OAuth callback routes audit (round 3)** — `/api/auth/{google,microsoft}/{login,callback,refresh}` haven't had a security pass; cookie attributes (HttpOnly/SameSite=Lax/Max-Age=600) look correct but the `postMessage` payload to `window.opener` deserves an explicit `origin` check. (d) **Force HTTPS for ICS feeds** — drop `http:` from the scheme allowlist in `calendar-feed` (currently intentional for university calendars, MITM accepts malicious VCALENDAR entries). (e) **Tighten Telegram path length** from 512 → 80 chars (real Telegram file paths are <80).

### From the export-feature audit (2026-05-14, 4 real export zips)

Audit pass against actual export artifacts surfaced findings beyond what unit-level review caught. Acted-on items merged inline (`b3f79196`, commit subject "Export polish: image dedup, empty-block, heading demotion, attachments-dir guard"). Remaining items below as future-improvement queue and verification gaps:

- ✅ **Deterministic export bytes** — closed by `80471925` (export polish merge, B.4). JSZip 3 doesn't accept a top-level `date` option, so the implementation iterates `zip.files` after entries are added and sets each entry's `.date = new Date(payload.meta.exportedAt)`. Applied to `raw.ts`, `html.ts`, `orchestrate.ts` (multi-experiment wrapper uses `payloads[0].meta.exportedAt`), and `pdf.ts` (PDF Document `creationDate`).
- ✅ **HTML + PDF manifest marker** — closed by `80471925` (export polish merge, B.5). HTML output zip now includes `_export-manifest.json` at the root (same shape as Raw). PDF output JSON-stringifies the manifest into the `@react-pdf/renderer` Document `keywords` field; `subject` left as `project.name`.
- ✅ **`source_instance` field in manifests** — closed by `db235a82` (EOD worker). Added optional `source_instance: "<ownerLabel>@<YYYY-MM-DD>"` field in Raw, HTML, and PDF manifests (PDF stores in Document `keywords`). Bonus: bot formalized the three inline manifest object literals into proper `RawManifest` / `HtmlManifest` / `PdfManifest` TypeScript interfaces. Centralized in `buildSourceInstance()` so re-export determinism (B.4) is preserved. Importer untouched — extra optional field is silently ignored on read. Future iteration could add hostname or folder-display-name to disambiguate further; the current form covers user@date which is sufficient for v1 disambiguation.
- ✅ **Stamp-stripping for HTML/PDF** — closed by stamp-fixture worker. Added a stamped header to alex's task-2 `notes.md` in `scripts/generate-demo-data.mjs:585-606`. The actual canonical stamp format lives at `frontend/src/lib/stamp-utils.ts:14-20` + `generateStamp` at `:146-170`: HTML-comment-bounded block with body lines ending in two trailing spaces (markdown hard break), followed by `___` separator. Three legacy formats parsed via `STAMP_BOUNDARIES` (`:57-66`). Verification probe at `frontend/scripts/test-stamp-strip-on-export.mjs` exercises the actual `parseContent` call `extractUserContent` makes and asserts (a) stamp markers/lines stripped, (b) demo banner + body survive, (c) `hasUserContent` still true. PASS.
- **PDF artifact audit gap (partially closed; Grant owes 7 specific checks).** All four supplied zips were Raw or HTML; no PDF was provided. Inter-via-jsdelivr risk retired by `dedac195` (Inter `.ttf`s bundled locally). Remaining audit checklist from Export manager's EOD report, beyond `pdftotext` / `pdffonts` / `pdfinfo`: (1) **PCR appendix pagination** — `wrap: false` on cycle-header + step rows keeps individual cycles intact, but a tall PCR table (header + initial + 3 cycles + final + hold + ingredients) might split between gradient and reagents tables. Test with a real 3-cycle protocol. (2) **Files appendix labels** — three groups ("From Lab Notes / Results / Methods"). Confirm empty groups disappear vs render empty heading. (3) **Image aspect ratios** — `image: { maxWidth: 432 }`; test both landscape and portrait inline images, portraits can render small. (4) **Italic markdown** — only Inter-Regular + Inter-Bold registered; `*italic*` falls back to synthesized slant. Cosmetic; flag only if Grant cares about typography polish. (5) **TOC anchor clicks** — diverge across PDF readers. `<Link src="#anchor">` reliable in Preview, sometimes ignored in Chrome's built-in viewer. Click-test both. (6) **Method body markdown edge cases** — marked AST walker falls through to plain text on unknown token types. Test a method body with fenced code block, GFM table, blockquote, nested ordered list. Single line of plain text = fallback bug. (7) **PCR deviation tables** — when a task has `pcr_gradient` / `pcr_ingredients` JSON overrides, three tables stack visually (canonical protocol + gradient deviation + reagent deviation). Worth seeing in real layout.
- ✅ **method_attachments orphan rows on disk** — closed by B2 sub-bot (integrated on manager branch). Investigation: no live runtime detach path leaks orphans — `tasksApi.removeMethod` already prunes both arrays. The state on disk came from the demo seed `scripts/generate-demo-data.mjs` hard-coding `method_ids: []`. Generator fixed (derive `method_ids` from `method_attachments`); on-disk demo regenerated for the 7 affected tasks (alex 2/5/10/11, morgan 1/2/3); invariant enforced at `tasksApi.update`; lazy-normalize on read in `normalizeTaskRecord`; belt-and-braces filter in `extract.ts`.
- ✅ **Shared-task method-mutation owner routing** — closed by `44a3f12c` (MethodTabs fix) + `1689b2cf` (extracted `ownerScopedTasksApi` to leaf module `lib/tasks/owner-scoped-api.ts` to break the circular import). Bot's audit widened the scope from the 2 callsites I'd flagged (addMethod, removeMethod) to 6 total: `addMethod`, `removeMethod`, `updateMethodPcr`, `resetPcr`, plus `saveVariationNote` ×2 in `VariationNotesPanel`. All now route through the owner-scoped wrapper via `useMemo(() => ownerScopedTasksApi(task), [task])`. **Live verification still owed**: bug confirmed by static analysis only — fixture seeds task 5 at `permission: "view"` so the bug path isn't exercised by `?wikiCapture=1`. To live-confirm: switch fixture task 5 to `"edit"` and click attach-method as morgan, OR use a real two-user folder.
- ✅ **`methods/unattached/` round-trip — investigated** (`5298c432`). Probe at `lib/import/unattached-roundtrip.test.ts` pins current behavior: bytes survive the export-side flat `methods/unattached/{filename}` shape (no method-N/ subdir as the brief mistakenly described), the import parser correctly extracts them into `payload.attachments`, but `apply.ts:209-213` silently drops them (with an explicit comment: "the receiver has no clean place to land them"). Real producer is rare: only the PDF-magic-bytes fallback at `extract.ts:259-271` emits anything via this path today (after the upstream filter at `extract.ts:392-394` prunes orphans). Three design follow-ups left for Grant — none urgent: (A) write orphans into a receiver scratch dir like `users/<u>/imported-orphans/`, (B) surface them in the conflict-resolution dialog as opt-in, (C) just document the drop in the import dialog ("N files in this bundle weren't attached to any method and will be dropped") — visible enough that if anyone actually hits it they'll report it, costs nothing if `parsedFiles.unattached.length === 0`. **Export manager's recommendation: option C**, reasoning: B2 confirmed no live source produces orphans except the rare PDF-magic-bytes fallback, so in practice this is empty; A adds a new on-disk concept without UI; B adds dialog complexity for a near-zero-frequency case. Path to B is straightforward if C reveals demand.

### For the wiki manager (cumulative — refreshed 2026-05-14 EOD)

**Already covered by wiki manager** (per their EOD report): Demo v2 (`4df9951c`), PDP pencil + archive/delete gates (verified `458c62be` description still accurate), Export revamp (`064b77f6`), Project sharing receivers (`458c62be`). The original "5-item handoff" from 2026-05-13 is fully addressed.

**Still queued for wiki manager** after Grant signs off Demo v2 + ELN wizard verification:

1. **New page: `/wiki/features/import-from-eln`** — feature reference for the ELN wizard (Upload / Pick format / Preview / Project mapping / Bulk sort / Apply progress / Done) and bulk-sort screen. Brief should include the 6 wizard steps, how a LabArchives ZIP becomes ResearchOS tasks, source_instance reconciliation if applicable, entry points (Settings → Import + user-picker / folder-setup integration). Wiki manager will draft; HR or master spawns the writer-bot when wizard is signed off. **Also: add `/wiki/features/import-from-eln` to `APP_ROUTE_TO_WIKI`** once the page lands (wiki coverage gate will flag this if forgotten).

2. **`/wiki/getting-started/labarchives-export`** — flagged by both HR and ELN manager. ELN manager's note: this is already in flight on a sibling chip (the rename-bot's report mentioned it landing). Confirm where it landed before queuing duplicate work.

3. **3 screenshot recaptures** (wiki manager EOD report): (a) `demo-mode-banner.png` — currently shows banner-only; v2's floating bottom-right Leave Demo + 📖 Read the docs ↗ buttons aren't visible. Recapture with corner buttons in frame. (b) NEW `home-shared-project-popup.png` — popup opened on a shared-to-me project showing disabled pencil + Archive + Delete + tooltips. Fixture already seeds `users/alex/_shared_with_me.json` with morgan's project, so shot is feasible. (c) NEW `home-shared-task-popup.png` — TaskDetailPopup on a shared task showing disabled Delete + tooltip.

4. **Stale `scripts/WIKI_SCREENSHOTS.md`** — some shots added (`editor-`, `lab-mode-`), some retired (`results-editor.png`). Re-syncing isn't urgent but worth a 10-min pass. Wiki manager has this flagged.

5. **Plan doc (`EXPORT_REVAMP_PLAN.md` at repo root) — already deleted** during the export-arc cleanup at `c5de0eb3`. Removed from this list as resolved.

**Wiki manager session state (EOD)**: standby. Nothing in flight, no chips queued, no half-finished branches. Available for new direction; otherwise idle.
5. **Plan doc (`EXPORT_REVAMP_PLAN.md` at repo root) will get deleted** after Grant verifies + the export branch merges to main. Don't link to it from wiki content.

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
