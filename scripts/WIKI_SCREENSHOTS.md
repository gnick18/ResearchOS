# Wiki screenshots

The in-app `/wiki/*` pages embed screenshots from
`frontend/public/wiki/screenshots/`. When a PNG is missing the `Screenshot`
component renders a gray "screenshot pending" placeholder, so the wiki is
fully readable without any captures.

## Capturing every screenshot

`scripts/capture-wiki-screenshots.mjs` is a Playwright script that captures
every page the wiki references, in one run. The capture loop:

1. Boots a headless Chromium against the local dev / prod server.
2. For the folder-connect page (no auth required), loads `/` in a fresh
   browser context.
3. For every in-app feature page, appends `?wikiCapture=1` to the URL. The
   app's `wiki-capture-mock.ts` swaps in an in-memory FileService seeded
   with fixture data (`wiki-capture-fixture.ts`), so the page renders with
   realistic projects, tasks, methods, etc. without needing a real folder.
4. Injects CSS / DOM hacks to hide dev/beta UI (Test Notification, Test
   Error, Report Bug, Beta donation widget, Telegram status pill).
5. Highlights the primary click target on each page with a red ring + glow
   so readers can find it at a glance.
6. Writes PNGs into `frontend/public/wiki/screenshots/` at 1440×900 logical
   pixels, 2× device scale (Retina-crisp).

### Running it

```bash
# 1. Build + start the prod server (fastest path; fixture mode honors the
#    flag on localhost in both dev and prod):
cd frontend
npm run build
npm run start -- -p 3001 &

# 2. Capture (requires `npx playwright install chromium` once):
npm run wiki:screenshots
```

The `wiki:screenshots` script points at `http://localhost:3000` by default.
Override with `WIKI_CAPTURE_BASE_URL=http://localhost:3001 npm run
wiki:screenshots` when running on a different port.

To capture only a subset (instead of regenerating every PNG), pass file-name
substrings as positional args or set the `WIKI_ONLY` env var to a comma-separated
list, e.g. `WIKI_ONLY=calc-builder-wizard,calc-builder-form npm run wiki:screenshots`.

Commit the regenerated PNGs alongside any wiki content changes.

### Feature-flagged captures (held)

A few shots live behind a feature flag and only render when that flag is set in
the build that the capture runs against:

- `calc-builder-wizard.png`, `calc-builder-form.png`, and
  `calc-template-library.png` (the build-your-own section of
  `/wiki/features/lab-calculators`) need `NEXT_PUBLIC_CALC_BUILDER=1` in the
  build, or the Build your own button and the template library do not render.
  Capture them with the flag on, e.g.
  `NEXT_PUBLIC_CALC_BUILDER=1 npm run build && npm run start -- -p 3001`, then
  `npm run wiki:screenshots`.

- The 8 `chemistry-*.png` shots (`/wiki/features/chemistry`) need
  `NEXT_PUBLIC_CHEMISTRY_ENABLED=1` in the build, or `/chemistry` renders the "not
  enabled" gate. Unlike calc-builder these are ALREADY captured, so a wiki-wide
  re-capture that forgets the flag will OVERWRITE the good shots with the disabled
  gate. Build with the flag on, e.g.
  `NEXT_PUBLIC_CHEMISTRY_ENABLED=1 npm run build && npm run start -- -p 3001`, then
  `npm run wiki:screenshots`. The same rule applies to any other flag-gated route
  whose shots get captured (e.g. Data Hub's `NEXT_PUBLIC_DATAHUB_ENABLED`), so a
  full re-capture should build with every such flag on at once.

These three are HELD until the builder UI is locked. Until they are captured the
wiki shows the "screenshot pending" placeholder for them, which is fine. Their
route entries (with the modal-open + builder click steps) already live in
`capture-wiki-screenshots.mjs`; the builder-specific click selectors there are
best-effort and should be confirmed against the live builder when the capture is
actually run.

## How fixture mode works

The capture relies on a `?wikiCapture=1` URL flag handled by
`frontend/src/lib/file-system/wiki-capture-mock.ts`. When the flag is
present, the mock:

- Patches the singleton `fileService` to read/write from an in-memory
  `Map<path, content>` (no real disk involved).
- Seeds the in-memory map with the fixtures in
  `wiki-capture-fixture.ts` (two users with realistic projects, tasks,
  methods, events, purchases, etc.).
- Writes "alex" into IndexedDB as the current user so the rest of the
  app sees them as signed in (the demo lab's PI).
- Fetches the watermarked demo PNGs from `public/demo-data/` and seeds
  them into the in-memory blob map, so Results gallery / image strip /
  Telegram inbox shots render real (fake) images.
- Seeds a handful of synthetic `notes.md` / `results.md` bodies with
  inline markdown image refs so editor-mode shots (Hybrid block select,
  Preview-mode image-resize popover) have body content to interact with.

The flag is guarded so it can only activate in development mode, OR in
production when served from localhost. There is no scenario where a real
deployment will activate fixture mode.

## What gets captured

| Filename | Wiki page | Click target / action |
|---|---|---|
| `folder-connect.png` | Connecting Your Folder | Link Folder button |
| `user-login.png` | Creating a User | username input (picker mode) |
| `home-projects.png` | Home & Projects | + New Project |
| `home-project-popup.png` | Home & Projects | clicks the DEMO biofuel project card |
| `gantt-overview.png` | Gantt Chart | + Task |
| `gantt-zoom-controls.png` | Gantt Chart | `3M` zoom button (cropped to top of page) |
| `gantt-task-popup.png` | Gantt Chart | clicks the "Yeast transformation" bar to open the task popup |
| `experiments-list.png` | Experiments & Lab Notes | + New Experiment |
| `experiments-editor.png` | Experiments & Lab Notes | clicks an experiment tile to open its popup |
| `editor-language-picker.png` | (markdown editor refs) | Lab Notes → Edit → types `` ``` `` to fire the language picker |
| `editor-hybrid-selected.png` | (markdown editor refs) | Lab Notes (Hybrid) → single-clicks a paragraph block |
| `editor-image-resize.png` | (markdown editor refs) | Lab Notes → Preview → clicks an inline image |
| `methods-library.png` | Methods Library | + New Method |
| `pcr-editor.png` | PCR Protocols | + New Protocol |
| `purchases-list.png` | Purchases & Funding | + New Purchase |
| `purchases-funding-panel.png` | Purchases & Funding | clicks "Manage Funding Accounts" (inline panel) |
| `calendar-month.png` | Calendar | + New Event |
| `lab-mode.png` | Lab Mode | (whole-page view) |
| `lab-mode-activity.png` | Lab Mode | Activity feed (auto-populated user filter) |
| `search-results.png` | Search | search input (query = DEMO) |
| `links.png` | Lab Links | Add Link |
| `workbench-earlier.png` | Experiments & Notes (Workbench page) | scrolls to the Earlier archive at the bottom of the Workbench |
| `settings.png` | Settings | Connect Telegram |
| `notifications.png` | Notifications & Inbox | bell icon (cropped to header) |
| `telegram-pairing.png` | Telegram Bot | bot token input |
| `telegram-inbox.png` | Telegram Bot / Inbox | clicks the Inbox header button to open the tray |
| `calendar-feeds-modal.png` | External Calendar Feeds | ICS URL input |

If you add a new wiki page that needs a screenshot, add an entry to
`PUBLIC_ROUTES` or `FIXTURE_ROUTES` in `capture-wiki-screenshots.mjs`
with the filename, route, optional `waitFor` selector, optional
`action` callback (e.g. click a button to open a modal), and optional
`highlight` spec.

## Capture variants

The `?wikiCapture` flag has two values:

- `?wikiCapture=1` (default) — installs the fixture and signs in as
  "alex". The home page and every feature page render with realistic
  data. This is what `FIXTURE_ROUTES` in the script uses.
- `?wikiCapture=picker` — installs the fixture but doesn't sign in. The
  app shows the user-picker screen with "alex" and "morgan" already
  in the list, plus a "Create New Account" form. Used to capture
  `user-login.png`.

Each picker-mode capture runs in its own fresh browser context so the
IndexedDB current-user from a previous signed-in capture doesn't carry
over.

## Known gaps

- None currently outstanding. The fixture mock now auto-populates the
  Lab Mode user filter via `discoverUsers` so the Activity feed renders
  entries for both seeded users without a click sequence.
