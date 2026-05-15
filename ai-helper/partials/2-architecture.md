**ResearchOS is local-first.** That's the single most important thing about the architecture, and it shapes every other answer.

The app is a Next.js 16 + React 19 + TypeScript single-page web app. It runs at [research-os-xi.vercel.app](https://research-os-xi.vercel.app/), and also locally via `./start.sh`. There is **no backend, no database, no user accounts on a server.** Every piece of research data lives in a folder on the user's disk, accessed through the **File System Access API** (FSA). Chrome, Edge, and Brave support FSA; Firefox and Safari don't, so those browsers see a "please switch browsers" splash.

On first visit the user picks a folder via `showDirectoryPicker()`. The folder handle persists in IndexedDB so reloads skip the picker, but **permission grants don't persist** on a cold reload (the app calls `queryPermission` first and either reconnects silently or shows a "Continue" button that fires `requestPermission`).

The folder layout is fixed by convention:

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
│   │   ├── lc_gradients/{id}.json
│   │   ├── plate_layouts/{id}.json
│   │   ├── purchase_items/{id}.json
│   │   ├── results/task-{id}/
│   │   │   ├── notes.md
│   │   │   ├── results.md
│   │   │   ├── Images/
│   │   │   └── Files/
│   │   ├── inbox/Images/
│   │   ├── _counters.json
│   │   ├── _auth.json
│   │   ├── _shared_with_me.json
│   │   ├── _notifications.json
│   │   ├── _shifted-alerts.json
│   │   ├── _calendar-feeds.json
│   │   └── _telegram.json (auto-gitignored)
│   ├── public/                          ← cross-user shared methods + protocols
│   ├── lab/                             ← lab-mode shared notes
│   └── _user_metadata.json
└── _global_counters.json
```

§3 covers what each subdirectory holds; §4 has the verbatim TypeScript types. The point: data is **just files on disk**, in formats the user can open in any text editor, version-control with git, or back up by copying the folder.

**The privacy story.** Research data never flows through ResearchOS's servers. There are exactly **two server-side proxy routes**, both pure CORS workarounds:

- `/api/telegram-file` proxies Telegram's CDN (Telegram doesn't send permissive CORS headers).
- `/api/calendar-feed` proxies ICS feed URLs (15-minute edge cache, SSRF-protected).

That's it. No data uploads, no telemetry, no central account registry. Vercel sees the request URL but never the user's research data. Both routes are stateless passthroughs.

**Multi-user is folder-shared, not server-shared.** Labs put the root folder on OneDrive, Google Drive, Dropbox, or iCloud. Each member has their own `users/<username>/` subdirectory plus an optional PBKDF2 password gate. Sharing happens entirely through file conventions: a `_shared_with_me.json` overlay tells the receiver which items the sender shared, and the receiver reads the source files directly out of the sender's directory. See `/wiki/shared-lab-accounts/...` for per-provider setup.

**Free and open source.** That's why the AI Helper feature works the way it does: instead of building an API integration that would burn a budget, the app gives users a hand-tuned prompt to paste into the Claude / ChatGPT / Gemini account they already have. When the user pastes folder data into the chat, that conversation lives in **their** chat session only. It doesn't flow back to ResearchOS, isn't cached anywhere ResearchOS controls, and nothing's logged on Vercel. Standard provider-side caching applies (Anthropic / OpenAI / Google retention) but ResearchOS adds zero new exposure surface.
