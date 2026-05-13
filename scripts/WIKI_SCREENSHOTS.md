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

Commit the regenerated PNGs alongside any wiki content changes.

## How fixture mode works

The capture relies on a `?wikiCapture=1` URL flag handled by
`frontend/src/lib/file-system/wiki-capture-mock.ts`. When the flag is
present, the mock:

- Patches the singleton `fileService` to read/write from an in-memory
  `Map<path, content>` (no real disk involved).
- Seeds the in-memory map with the fixtures in
  `wiki-capture-fixture.ts` (two users with realistic projects, tasks,
  methods, events, purchases, etc.).
- Writes "grant" into IndexedDB as the current user so the rest of the
  app sees them as signed in.

The flag is guarded so it can only activate in development mode, OR in
production when served from localhost. There is no scenario where a real
deployment will activate fixture mode.

## What gets captured

| Filename | Wiki page | Click target highlighted |
|---|---|---|
| `folder-connect.png` | Connecting Your Folder | Link Folder button |
| `home-projects.png` | Home & Projects | + New Project |
| `gantt-overview.png` | Gantt Chart | + Task |
| `experiments-list.png` | Experiments & Lab Notes | + New Experiment |
| `methods-library.png` | Methods Library | + New Method |
| `pcr-editor.png` | PCR Protocols | + New Protocol |
| `purchases-list.png` | Purchases & Funding | + New Purchase |
| `calendar-month.png` | Calendar | + New Event |
| `lab-mode.png` | Lab Mode | (whole-page view) |
| `search-results.png` | Search | search input |
| `links.png` | Lab Links | + New Link |
| `results-editor.png` | Results | (whole-page view) |
| `settings.png` | Settings | Connect Telegram |
| `notifications.png` | Notifications & Inbox | bell icon (cropped to header) |
| `telegram-pairing.png` | Telegram Bot | bot token input |
| `calendar-feeds-modal.png` | External Calendar Feeds | ICS URL input |

If you add a new wiki page that needs a screenshot, add an entry to
`PUBLIC_ROUTES` or `FIXTURE_ROUTES` in `capture-wiki-screenshots.mjs`
with the filename, route, optional `waitFor` selector, optional
`action` callback (e.g. click a button to open a modal), and optional
`highlight` spec.

## Known gaps

- **`user-login.png`** (referenced by `/wiki/getting-started/creating-a-user`)
  isn't captured. Fixture mode auto-signs in as "grant" so the user-picker
  screen never renders. A future variant `?wikiCapture=picker` could load
  the fixture without setting the current user, surfacing the picker. For
  now the placeholder shows on that wiki page.
- **Lab Mode** captures the empty state because the user-filter is empty
  by default. To make the screenshot richer, the script could click the
  user filter and select all users before capturing.
