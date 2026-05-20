# ResearchOS

**Local-first research management. Experiments, lab notes, methods, calendar, all on your disk.**

ResearchOS is a browser-based tool for planning experiments, writing lab notes, managing reusable methods, and tracking the day-to-day of a research project. Your data lives in a folder you pick on your own computer (JSON + markdown, no database). The app talks to that folder directly through the File System Access API. There is no server account to create, and your notes never leave your machine unless you ask them to (via export, or by pointing your own backup tool at the folder).

ResearchOS is for benchwork researchers, computational scientists, lab managers, postdocs, PhD students, undergrads, staff scientists, and solo researchers in academic, industry, and startup settings. The welcome wizard asks a few questions about how you work and tailors the interface accordingly.

<p align="center">
  <img src="frontend/public/wiki/screenshots/home-projects.png" alt="ResearchOS home screen showing project overview cards with progress bars, tags, and team avatars." width="720" />
</p>
<p align="center"><em>The home screen: every project at a glance, with progress, tags, and the people working on it.</em></p>

> Try the hosted demo: **[research-os-xi.vercel.app/demo](https://research-os-xi.vercel.app/demo)**. The demo runs entirely in your browser against synthetic fixture data, so you can poke around without picking a folder.

---

## What ResearchOS does

**Plan and schedule**

- Projects + Gantt with dependency-aware date shifting (drag one task, everything downstream moves with it).
- Workbench: a single view that surfaces what is ready, blocked, running, awaiting writeup, and recently done.
- Calendar with external ICS feed overlays (Google Calendar, Outlook, iCloud, university calendars).
- High-level goals with SMART subgoals running alongside the schedule.

![Gantt chart view of a research project with dependency-linked tasks across multiple lanes.](frontend/public/wiki/screenshots/gantt-overview.png)

**Document and iterate**

- Lab Notes and Results tabs per experiment, both backed by a hybrid markdown editor with image attachments, file drops, and click-to-edit blocks.
- Methods library with ten different method types: free-form markdown, PDF, PCR protocol, LC gradient, well-plate layout, cell culture passage schedule, coding workflow, mass spec parameters, qPCR analysis, and compound methods that bundle the others into reusable kits.
- Per-task method variations: attach a method, then record deviations on the experiment.
- Experiment comparison view for side-by-side outcomes across runs.

![Experiment editor with the hybrid markdown editor, lab-notes tab, and attached images on the right.](frontend/public/wiki/screenshots/experiments-editor.png)

**Collaborate**

- Multiple users in one shared folder (OneDrive, Dropbox, iCloud, git, network share). Each user picks the folder, picks their username from the login screen, and gets their own subdirectory.
- Project sharing across users with optional edit permission. Writes route back to the owning user's directory so the owner stays in control of their data.
- Lab Mode: a multi-user overview of combined experiments, purchases, methods, and activity.
- Receiver-side editing for shared tasks, including drag-to-reschedule through the dependency graph.

![Lab Mode overview showing combined experiments and activity across multiple lab members.](frontend/public/wiki/screenshots/lab-mode.png)

**Connect**

- **Telegram image inbox.** Pair a Telegram bot once; photos you send the bot arrive in your inbox in seconds with captions as titles. Drag onto any note to attach.
- **Calendar feed overlays.** Subscribe to public ICS feeds; events overlay on your Gantt and Calendar views (read-only).
- **AI Helper prompts.** Generate a prompt that turns Claude, ChatGPT, or Gemini into a ResearchOS-aware assistant. Paste into your own chat tier (no API key needed); the model knows your schemas, examples, and feature inventory.
- **LabArchives ELN import.** Bring existing notebooks from LabArchives offline ZIP exports as ResearchOS projects + tasks with attachments preserved.

![Telegram inbox panel with photos sent from a phone, ready to drag onto a note.](frontend/public/wiki/screenshots/telegram-inbox.png)

---

## How data is stored

```
+-----------------------------+
|        Your Browser         |
|  (Chrome / Edge / Brave)    |
|                             |
|  ResearchOS UI              |
|     |                       |
|     | File System Access    |
|     v                       |
|  Folder on your disk        |
|  - users/<username>/...     |
|  - results/task-<id>/...    |
+-----------------------------+
```

Everything lives in the folder you picked. To back up, sync, or share, point a tool you already trust at that folder. The two server-side routes (`/api/telegram-file` and `/api/calendar-feed`) are pure passthrough proxies that exist only because some third-party CDNs block direct browser fetches; they never store or log the traffic that flows through them. Settings has a "Data inventory" diagnostic that lists every file the app has ever written, and `/wiki/security` walks through the privacy model in detail.

---

## Run it

### Option A: hosted

Open **[research-os-xi.vercel.app](https://research-os-xi.vercel.app/)** in Chrome, Edge, or Brave. Click "Connect folder," pick (or create) an empty folder on your machine, allow the read-write prompt, then pick or create a username. Your folder can live anywhere on disk; OneDrive, Dropbox, iCloud, or a plain local directory all work.

### Option B: run it yourself

```bash
git clone https://github.com/gnick18/ResearchOS.git
cd ResearchOS/frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Convenience launchers `./start.sh` (macOS, Linux) and `.\start.ps1` (Windows) handle port cleanup.

### Option C: deploy your own to Vercel

```bash
cd frontend
npx vercel
```

The repo is preconfigured for Vercel. No environment variables required for the core app. After deploy, share the URL with your team; each user picks the same shared folder and signs in under their own username.

**Browser support.** Chrome, Edge, and Brave only. Firefox and Safari do not implement the File System Access API the app depends on.

---

## First-time setup: the welcome wizard

The first time you open ResearchOS against a fresh folder, a multi-step welcome wizard asks what brings you to the tool. You pick from nine use cases (PhD experiments, lab manager, teaching, computational research, postdoc, solo researcher, staff scientist, undergrad researcher, or just exploring; multi-select), the wizard tailors which tabs you see by default, then offers optional inline setup for Telegram, calendar feeds, and the AI Helper prompt. Everything is reversible: tabs can be toggled in Settings, and Settings has a "Re-run welcome wizard" button if you want to start the flow over.

<p align="center">
  <img src="frontend/public/wiki/screenshots/onboarding-wizard-step-1-welcome.png" alt="Step 1 of the welcome wizard: BeakerBot mascot and a two-sentence intro." width="520" />
</p>
<p align="center"><em>Step 1: a two-sentence intro from BeakerBot, then on to picking how you work.</em></p>

<p align="center">
  <img src="frontend/public/wiki/screenshots/onboarding-wizard-step-2-use-cases.png" alt="Step 2 of the welcome wizard: nine use-case chips with two selected." width="320" />
</p>
<p align="center"><em>Step 2: pick the ways you'll use ResearchOS (multi-select). The picks drive which tabs are visible by default.</em></p>

<p align="center">
  <img src="frontend/public/wiki/screenshots/onboarding-wizard-step-7-wrapup.png" alt="Step 7 of the welcome wizard: 'You're all set' confirmation with setup decisions and an optional feature tour link." width="600" />
</p>
<p align="center"><em>Step 7: confirmation. Each setup decision is echoed back, with an optional feature tour link before "Go to home."</em></p>

Skip the wizard entirely if you prefer; it never re-fires for the same user, and all features remain reachable from the navbar and Settings.

---

## Recovery and trust

ResearchOS treats your data folder as the source of truth, but a few small safety nets exist for the credentials and identity state that live alongside it:

- **Atomic file writes.** Every write goes through a temp-file plus rename so a torn write (tab crash, OS reboot) leaves the old contents intact rather than zero bytes.
- **Per-user tombstones for deleted accounts.** Tombstones survive cloud-sync round-trips so re-created cloud-stub directories never re-resurrect a user you intended to delete.
- **Three-layer Telegram bot-token recovery.** Plaintext `_telegram.json` sidecar on disk is the primary; a browser-scoped IndexedDB cache backs it up per-user-per-folder; an opt-in encrypted backup (AES-GCM-256 with a key derived from your login password via PBKDF2-SHA-256) survives across browsers and machines. Settings shows what is enabled and lets you wipe any layer.

See `/wiki/security` for a full security audit, threat model, and findings.

---

## Continuous integration

ResearchOS runs lint, type-checking, unit tests (vitest), and end-to-end tests (Playwright) on every pull request and push to `main`. Test coverage reports are uploaded as workflow artifacts. The CI configuration lives at `.github/workflows/ci.yml`.

The project is preparing for submission to the [Journal of Open Source Software (JOSS)](https://joss.theoj.org). The CI pipeline, test coverage, and contribution guidelines target JOSS reviewer expectations.

---

## Project structure

```
ResearchOS/
├── frontend/                              Next.js + React app (all the application code)
│   ├── src/
│   │   ├── app/                           Pages and the two Vercel passthrough proxies
│   │   ├── components/                    React components
│   │   ├── lib/                           FSA layer, telegram client, calendar parser, methods, onboarding
│   │   └── __mocks__/                     FSA mock layer for headless CI tests
│   ├── e2e/                               Playwright end-to-end specs
│   ├── playwright.config.ts
│   ├── vitest.config.mts
│   └── package.json
├── scripts/                               One-off maintenance scripts (legacy folder sweep, AI Helper builder, demo zip)
├── ai-helper/                             Prose partials + eval harness for the AI Helper prompt build pipeline
├── SECURITY_AUDIT.md                      Security audit + threat model + findings
├── AGENTS.md                              Repo conventions, traps, and audit trail
├── .github/workflows/ci.yml               Lint + tsc + vitest + Playwright
├── start.sh / start.ps1                   Local dev launchers
└── README.md                              This file
```

---

## Development

```bash
cd frontend
npm install
npm run dev                 # http://localhost:3000
npm test                    # vitest run (node environment)
npm run test:coverage       # vitest with v8 coverage report
npm run test:e2e            # Playwright against a started dev server
npx tsc --noEmit            # type check
npm run lint                # eslint
```

The app is fully client-side. The two Next.js API routes (`/api/telegram-file`, `/api/calendar-feed`) are pure passthrough proxies and only run when their respective integrations are in use.

---

## Telegram pairing

Sending lab photos from your phone is faster than uploading through the browser, so ResearchOS supports a one-bot-per-user Telegram pipeline.

![Telegram pairing modal with a bot-token input ready for the value pasted from BotFather.](frontend/public/wiki/screenshots/telegram-pairing.png)

1. Open Telegram, chat with [@BotFather](https://t.me/BotFather), send `/newbot`, follow the prompts. Copy the bot token.
2. In ResearchOS, click the Telegram icon in the top bar, then **Pair bot**.
3. Paste your token. The app verifies it and writes the pairing to your folder.
4. Open Telegram, find your new bot, click **Start**.

After pairing, snap a photo on your phone, send it to your bot, and it shows up in the ResearchOS inbox within a few seconds with the caption as the title. Drag it onto any note to attach. Telegram pairings are per-user, so a shared lab folder can host one bot per researcher.

---

## External calendars

The Calendar tab can overlay events from any ICS-compatible feed.

![External Feeds modal with the provider picker expanded showing iCloud, Google, Outlook, and Other.](frontend/public/wiki/screenshots/calendar-feeds-modal.png)

1. Calendar tab, then **Manage feeds**, then **Add subscription**.
2. Paste the ICS URL. Google Calendar, Outlook / Office 365, iCloud, and university calendars all expose one (usually under Calendar settings, "Share" or "Publish").
3. Pick a color and a name. Save.

Feeds are read-only; your tasks do not push back to Google or Outlook. Subscriptions are stored in your data folder (per-user), so they sync alongside everything else.

---

## AI Helper

ResearchOS does not run any AI models. Instead, the app generates a structured prompt that teaches your existing AI assistant (Claude, ChatGPT, or Gemini) what ResearchOS is, what entities it tracks, and how features connect. You paste the prompt into your usual chat and get a ResearchOS-aware helper for the duration of that conversation.

![Settings AI Helper section: size picker with Lean (recommended) preselected, copy button, and Open-in shortcuts for Claude, ChatGPT, and Gemini.](frontend/public/wiki/screenshots/settings-ai-helper.png)

Settings has an "AI Helper" section with a one-click copy button and three "Open in" shortcuts that paste the prompt into a fresh chat in each provider. Three size variants exist (full for big-context models, lean for the default, minimal for small-context or local models with an explicit "you got the degraded variant" disclaimer).

The prompt build pipeline auto-extracts entity schemas from `types.ts` and canonical examples from fixture data, so it stays in sync with the codebase release-by-release. No API key is required, no usage is metered through ResearchOS, and your chat tier (Claude Max, ChatGPT Plus, Gemini Advanced) works fine without adding API credits.

---

## Documentation

Detailed feature documentation lives in the in-app wiki at `/wiki/`, also reachable on the hosted version. Highlights:

- `/wiki/getting-started` for first-time setup paths
- `/wiki/security` for the privacy model, threat surface, and findings
- `/wiki/features/methods` for the ten method types and how they compose
- `/wiki/integrations/telegram`, `/wiki/integrations/calendar-feeds`, `/wiki/integrations/labarchives`, `/wiki/integrations/ai-helper` for setup details

The wiki uses fixture-mode screenshots (`?wikiCapture=1`), so anything pictured is synthetic data; your real folder is never captured.

---

## Troubleshooting

**Folder picker is slow or browser looks frozen.** Normal on first open of an OneDrive or iCloud folder. The OS has to spin up the file provider. The "Don't refresh" callout on the loading screen explains this; just wait.

**Port already in use (local install).** `start.sh` kills port 3000 before launching. If something else is stuck:

```bash
lsof -ti tcp:3000 | xargs kill -9    # macOS, Linux
netstat -ano | findstr :3000          # Windows, then taskkill /PID <pid> /F
```

**Telegram bot says "Conflict: getUpdates".** Another browser tab or another device is polling the same bot. ResearchOS holds a per-tab lock; close the other tabs or devices.

**Forgot your account password.** Open your shared data folder, navigate to `users/<your-username>/`, delete `_auth.json`. Sign in normally.

**Calendar feed isn't updating.** Feeds are edge-cached for 15 minutes to keep serverless function invocations low. Remove and re-add the feed to force a refresh.

**Hero card on the Workbench shows an image I removed.** ResearchOS migrated to a per-tab attachment layout in May 2026. If you have legacy `results/task-N/Images/` content from before that migration, run `node scripts/sweep-legacy-task-folders.mjs <your-folder> --dry-run` to see what is left, then re-run with `--apply` to migrate or report unrecognized content.

---

## Contributing

Pull requests welcome. The repo is set up for clean CI runs:

```bash
cd frontend
npm install
npm test                    # vitest (438+ tests as of 2026-05-20)
npm run test:e2e            # Playwright baseline against the dev server
npx tsc --noEmit
npm run lint                # 0 errors expected on main
```

Before opening a PR, please run all four locally. The CI workflow runs them on every push to `main` and on every pull request. Coverage reports and Playwright traces are uploaded as workflow artifacts.

See `AGENTS.md` for repo conventions, known traps, and the development audit trail. New features that touch network paths, IndexedDB writes, or on-disk credential storage should be discussed in an issue first so the security model stays coherent.

---

## License

MIT. See [LICENSE](LICENSE).

---

## Issues

[github.com/gnick18/ResearchOS/issues](https://github.com/gnick18/ResearchOS/issues)
