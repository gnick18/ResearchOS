# ResearchOS

A local-first research project management app. GANTT scheduling with dependency-aware date shifting, lab notes with rich markdown + image attachments, multi-user shared folders, Telegram image ingestion, external calendar overlays, and more.

Your data lives in a folder on your disk — JSON and markdown, version-controllable if you want, no database to host. The browser talks to that folder directly via the File System Access API.

---

## Two ways to run it

### Option A — Use the hosted version

Open **[research-os-xi.vercel.app](https://research-os-xi.vercel.app/)** in **Chrome, Edge, or Brave** and connect a folder on your machine. Nothing installs on your computer; data never leaves your disk. (Hosted on Vercel. The server-side code is a thin proxy used only for fetching Telegram media and external calendar feeds — your notes and files are never sent to it.)

### Option B — Run it locally

If you'd rather host the frontend yourself (offline use, dev work, or just preference):

**Prerequisites**

| Requirement | Version | Where to Get It |
|-------------|---------|-----------------|
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) |
| **Chromium browser** | Recent | Chrome, Edge, or Brave — Firefox/Safari aren't supported (File System Access API) |

**Setup**

```bash
git clone https://github.com/gnick18/ResearchOS.git
cd ResearchOS/frontend
npm install
```

**Run**

```bash
# macOS/Linux
./start.sh

# Windows
.\start.ps1
```

Then open [http://localhost:3000](http://localhost:3000).

### Option C — Deploy your own to Vercel

```bash
cd frontend
npx vercel
```

The repo is configured for Vercel out of the box. No environment variables are required for the core app; the Telegram and calendar features work with no extra setup because they use server-side proxy routes that pass the user's own credentials through (see [Telegram pairing](#telegram-pairing) below). After deploy, share the URL with your lab — each user picks the same shared folder (OneDrive, Dropbox, iCloud, …) and signs in under their own username.

---

## Features

### Core
- **Projects & GANTT chart** — organize work into projects, schedule tasks, drag to reschedule. Dependency-aware date shifts cascade through the chain.
- **Tasks with subtypes** — experiments, purchases, and simple checklists, each with their own UI affordances.
- **Lab notes & results** — hybrid markdown editor with toolbar, live preview, image strip, drag-drop attachments, and an in-app image gallery picker.
- **PCR protocol builder** — design PCR runs with temperature gradients and reagent calculators.
- **Methods library** — write methods as markdown documents, attach them to experiments, log per-experiment variations.
- **High-level goals** — long-running goals with SMART subgoals visible alongside the Gantt.

### Multi-user / sharing
- **Multiple users in one folder** — a single shared folder (OneDrive, Dropbox, iCloud) can host many users. Each picks the same folder and selects their username from the login screen.
- **Password-protected accounts** — optional per-user password gate (PBKDF2). Manageable from the login screen; recoverable by deleting `_auth.json` if forgotten.
- **Share experiments with edit permission** — owner shares with another user, receiver edits the task and the writes route back to the owner's directory. Drag-to-reschedule works through the dependency graph.
- **Lab mode** — view everyone's data side-by-side: combined Gantt, experiment list, purchases, and an activity feed.

### Integrations
- **Telegram image ingestion** — pair a Telegram bot once; photos you send the bot arrive in your inbox in seconds. Captions become image titles. Drag from the inbox onto any note to attach. See [Telegram pairing](#telegram-pairing).
- **External calendar overlays** — subscribe to public ICS feeds (Google Calendar, Outlook, iCloud, university calendars). The Calendar tab overlays those events on top of your task schedule. Read-only — your tasks don't sync back. See [External calendars](#external-calendars).

### UX niceties
- **Image strip** — every image attached to a note shown along the bottom; click to scroll to it; drag to the trash icon to delete.
- **Markdown editor** — three modes (raw, hybrid block-by-block, full preview) with keyboard shortcuts, image resize popover, broken-image auto-recovery.
- **Inbox + activity toasts** — Telegram arrivals fire a one-click toast that opens the inbox to that image.
- **Fast reconnect** — the app remembers the folder you picked. On reload you usually get the data back without going through the OS picker.

---

## First-time setup

1. Open the app (hosted URL or `localhost:3000`).
2. Click **Connect Folder**. Pick (or create) an empty folder on your disk. On macOS/Windows this can be a OneDrive / iCloud / Dropbox folder if you want sync.
3. The browser asks for read/write access. Click **Allow**.
4. Pick or create a username. Multiple users can share the same folder; each one's data lives at `users/{username}/`.
5. Optionally set a password on your user from the login screen's lock icon.

Subsequent visits: the app remembers the folder via IndexedDB and reconnects with a single click — no slow OS picker dialog unless you switch folders.

---

## Telegram pairing

Sending lab photos from your phone is way faster than uploading through the browser, so ResearchOS supports a one-bot-per-user Telegram pipeline.

**Setup (~5 minutes, one time):**

1. Open Telegram, chat with [@BotFather](https://t.me/BotFather), send `/newbot`, follow the prompts. Copy the **bot token** it gives you.
2. In ResearchOS, click the Telegram icon in the top bar → **Pair bot**.
3. Paste your token. The app verifies it and stores it locally (in your browser's IndexedDB; never written to your data folder, never sent to anyone but Telegram).
4. Open Telegram, find your new bot, click **Start**. Done.

**Daily use:** snap a photo with your phone, send it to your bot. Within a few seconds it shows up in the ResearchOS inbox with the caption as the title. Drag it onto any task's notes or use the inbox panel to file it.

**How private is this?**
- The bot token lives only in your browser. If you clear IndexedDB or switch browsers, you'll re-pair.
- Telegram's file CDN doesn't allow direct browser fetches (CORS), so ResearchOS proxies file downloads through a tiny Vercel function (`/api/telegram-file`). The function just passes bytes through — never stores or logs them.
- If you self-host on Vercel, that proxy runs in your project; if you use the public hosted version, it runs in mine. Either way the bot token isn't logged.

---

## External calendars

The Calendar tab can overlay events from any ICS-compatible feed.

**Add a feed:**

1. Calendar tab → **Manage feeds** → **Add subscription**.
2. Paste the ICS URL. Examples:
   - **Google Calendar** — Calendar settings → Integrate calendar → Secret address in iCal format.
   - **Outlook / Office365** — Calendar settings → Shared calendars → Publish a calendar → ICS link.
   - **iCloud** — Calendar.app → right-click calendar → Share → Public Calendar → copy URL (rewrite `webcal://` to `https://` if needed; the app handles both).
3. Pick a color and name. Save.

Feeds are read-only — your ResearchOS tasks don't push back into Google/Outlook. Subscriptions are stored in your data folder (per-user) so they're shared / synced like everything else.

**How it works:** ICS feeds are fetched through a Vercel function (`/api/calendar-feed`) for the same CORS reason as Telegram. The function refuses to fetch private/internal IPs and caches responses for 15 minutes at the edge, so it stays well within Vercel's free-tier limits.

---

## How data storage works

```
+-----------------------------+
|        Your Browser         |
|  (Chrome / Edge / Brave)    |
|                             |
|  ResearchOS                 |
|     |                       |
|     | File System Access    |
|     v                       |
|  Folder on your disk        |
|  - users/{username}/...     |
|  - methods/...              |
|  - results/task-{id}/...    |
+-----------------------------+
```

Everything lives in the folder you picked. To back up, sync, or share with collaborators, point a tool you already trust at that folder (OneDrive, Dropbox, iCloud, git, rsync, Time Machine, …). The server-side proxy routes (`/api/telegram-file`, `/api/calendar-feed`) only see traffic for those specific integrations — never your notes, tasks, or projects.

---

## Project structure

```
ResearchOS/
├── frontend/                  # Next.js + React app — all the application code
│   ├── src/
│   │   ├── app/              # Pages and Vercel API routes
│   │   │   ├── api/          # Server-side: Telegram file proxy, calendar feed proxy
│   │   │   ├── gantt/        # GANTT chart page
│   │   │   ├── calendar/     # Calendar view + ICS overlays
│   │   │   ├── methods/      # Methods library
│   │   │   ├── purchases/    # Purchase tracking
│   │   │   ├── lab/          # Multi-user lab mode
│   │   │   └── …
│   │   ├── components/       # React components (Task popup, image strip, etc.)
│   │   └── lib/              # FSA layer, telegram client, calendar parser, …
│   └── package.json
├── scripts/                   # One-off maintenance scripts (e.g. legacy-image cleanup)
├── start.sh                   # Local dev launcher (macOS/Linux)
└── start.ps1                  # Local dev launcher (Windows)
```

---

## Development

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
npm test             # unit tests (vitest)
npx tsc --noEmit     # type check
npx eslint src/      # lint
```

The app is fully client-side; there is no backend server to run. The two Next.js API routes (`/api/telegram-file`, `/api/calendar-feed`) are pure passthrough proxies and only run when their respective integrations are in use.

---

## Troubleshooting

**Folder picker is slow / browser looks frozen** — Normal for OneDrive / iCloud folders on first open. The OS has to spin up the file provider. The "Don't refresh" callout that appears on the loading screen explains this; just wait.

**Port already in use (local install)** — `start.sh` already kills port 3000 before launching. If something else is stuck:
```bash
lsof -ti tcp:3000 | xargs kill -9    # macOS/Linux
netstat -ano | findstr :3000          # Windows — then taskkill /PID <pid> /F
```

**Telegram bot says "Conflict: getUpdates"** — Another browser tab or another device is polling the same bot. ResearchOS holds a per-tab lock; close other tabs / devices.

**Forgot password** — Open your shared data folder, navigate to `users/<your-username>/`, delete `_auth.json`. Sign in normally.

**Calendar feed isn't updating** — Feeds are edge-cached for 15 minutes to keep server invocations low. Force a refresh by removing and re-adding the feed.

---

## Supporting the project

ResearchOS is a solo side project; the hosted version is paid for out of pocket. If it's useful to you, there's a tiny "Support this project" link in the app (PayPal / Venmo) — entirely optional.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Issues

Open an issue on [GitHub](https://github.com/gnick18/ResearchOS/issues).
