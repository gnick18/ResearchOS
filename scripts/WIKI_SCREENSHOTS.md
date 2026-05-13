# Wiki screenshots

The in-app `/wiki/*` pages embed screenshots from
`frontend/public/wiki/screenshots/`. When a PNG is missing the `Screenshot`
component renders a gray "screenshot pending" placeholder, so the wiki is
fully readable without any captures — but it looks better with them.

## What's automated

`scripts/capture-wiki-screenshots.mjs` is a Playwright script that captures
two categories:

1. **The wiki pages themselves** — `/wiki/*`. Useful for QA: open the PNGs
   to see what the wiki looks like at a glance.
2. **The folder-connect screen** at `/` — the screen new users see before
   they pick a folder.

These don't need a connected folder, so the script can run unattended.

### Running it

```bash
# 1. Start the dev server in one terminal
cd frontend
npm run dev

# 2. In another terminal, install playwright (one-time)
cd <repo root>
npx playwright install chromium

# 3. Run the capture
npm run wiki:screenshots --prefix frontend
# or directly:
node scripts/capture-wiki-screenshots.mjs
```

Output lands in `frontend/public/wiki/screenshots/`. Commit the regenerated
PNGs along with any wiki content changes.

## What's NOT automated (yet)

In-app feature pages — Home, Gantt, Experiments, Methods, PCR, Purchases,
Calendar, Lab, Search, Links, Results, Settings, Notifications — need a
connected folder with realistic fixture data to look like anything. The
File System Access API isn't easily automatable in headless Playwright
(the OS folder picker is not scriptable, and the in-browser handle is
stored in IndexedDB).

Two viable approaches for these:

### Option A — Interactive Chrome session

1. Start `npm run dev`.
2. Open a Chrome window manually.
3. Pick a fixture folder (e.g. `scripts/wiki-fixture/` once we populate it).
4. Sign in as the fixture user.
5. For each feature page: open it, take a screenshot via DevTools'
   command palette (`Ctrl/Cmd+Shift+P → Capture full size screenshot`),
   rename, drop into `frontend/public/wiki/screenshots/`.

Or drive Chrome interactively via the Chrome MCP server — same flow, but
the agent does the clicks.

### Option B — Fixture mode (TODO)

The plan from `plans/i-want-to-make-peppy-pony.md` describes a
`?wikiCapture=1` query flag that swaps in an in-memory FileService backed
by `scripts/wiki-fixture/`. Once that lands, the Playwright script can
loop over every in-app route with `?wikiCapture=1` appended and the
captures become fully automated.

To implement it:

1. Add a `WikiCaptureFileService` in
   `frontend/src/lib/file-system/` that satisfies the same interface as
   the production FileService but reads its JSON from a bundled fixture
   object.
2. In `FileSystemProvider`, when `window.location.search` contains
   `wikiCapture=1` AND `NODE_ENV !== "production"`, return that mock
   service and a hard-coded `currentUser`. Treat the connect step as a
   no-op.
3. Extend `PUBLIC_ROUTES` in `capture-wiki-screenshots.mjs` with the
   in-app routes, each with `?wikiCapture=1` appended.

The fixture itself can be a single TypeScript object with sample
projects, tasks, methods, etc.

## Expected filenames

The wiki references these filenames. Use these names exactly when saving
screenshots so the wiki's `<Screenshot src=...>` props pick them up:

### Getting Started
- `folder-connect.png` — `/wiki/getting-started/connecting-your-folder`
- `user-login.png` — `/wiki/getting-started/creating-a-user`

### Features
- `home-projects.png` — `/wiki/features/home`
- `gantt-overview.png` — `/wiki/features/gantt`
- `experiments-list.png` — `/wiki/features/experiments`
- `methods-library.png` — `/wiki/features/methods`
- `pcr-editor.png` — `/wiki/features/pcr`
- `purchases-list.png` — `/wiki/features/purchases`
- `calendar-month.png` — `/wiki/features/calendar`
- `lab-mode.png` — `/wiki/features/lab-mode`
- `search-results.png` — `/wiki/features/search`
- `links.png` — `/wiki/features/links`
- `results-editor.png` — `/wiki/features/results`
- `settings.png` — `/wiki/features/settings`
- `notifications.png` — `/wiki/features/notifications`

### Integrations
- `telegram-pairing.png` — `/wiki/integrations/telegram`
- `calendar-feeds-modal.png` — `/wiki/integrations/calendar-feeds`

If you add a new wiki page that needs a screenshot, follow the naming
pattern `<page-key>.png` and update both this README and the
`PUBLIC_ROUTES` array in the capture script.
