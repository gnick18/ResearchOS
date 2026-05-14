# Onboarding tips — proposal

> Scope: a folder-scoped, occasionally-firing tip system for brand-new
> ResearchOS accounts. A small mascot character points at a real
> affordance in the UI, says one thing about it, and links to the
> matching wiki page for the long version. Brand-new is detected by
> on-disk sidecar, not by browser state; demo and wiki-capture modes are
> exempt. Aesthetic is cute / anime-inspired stroke art that matches the
> rest of the iconography (no emoji).

## Context

ResearchOS now ships a long tail of features that are not obvious from a
cold-start UI walk-through. A new user who opens a fresh folder lands on
the home page, sees a few project cards, and has no in-app cue that
**drop-to-replace works on LabArchives images**, that **Telegram photos
arrive in an inbox with a send-to-task picker**, that **uploading a
file with the same name as an existing one prompts to dedupe or
rename**, that **a colleague's task can be shared into their project so
both Gantts stay in sync**, or that the 5-icon cluster in the
bottom-right corner is where the data-folder switcher, user switcher,
bug-report button, and dev-test notification live. The wiki documents
all of this — but only after the user knows to look for it.

The wiki page-view pattern is "explain a concept, then show how to do
it." That works for users who have already decided to learn a feature.
What it doesn't do is the *interruption* — the in-context cue at the
moment the affordance is on screen. Tips are the cue layer.

The brief is intentionally narrow: **brand-new accounts only**. Two
constraints follow:

1. **"Brand-new" must survive browser changes.** A user who creates a
   folder on her laptop, signs in, then opens the same folder on a
   different machine should not see "Hey did you know you can…" tips on
   the second machine — she already saw them on the first one. So the
   "brand-new" bit lives **on disk** in the research folder, not in
   `localStorage` / IndexedDB / sessionStorage.
2. **Demo and wiki-capture modes are exempt.** The `/demo` route and
   `?wikiCapture=1` fixture both seed a fresh in-memory fixture, which
   under a naive "no sidecar = brand new" rule would fire tips every
   page load and photo-bomb every screenshot the wiki capture script
   produces. The gate is `isDemoOrWikiCapture()`
   (`frontend/src/lib/file-system/wiki-capture-mock.ts:193`); when it
   returns true, the onboarding system is fully off.

This proposal lays out a detection model, a mascot direction, a trigger
+ cadence pattern, dismissal and re-entry, an initial tip set pointing
at features that actually shipped, and the open questions that need
Grant input before implementation kicks off.

## What "brand-new" means here

**LOCKED 2026-05-14 (Grant):** sidecar lives **per-user** at
`users/<u>/_onboarding.json`. Each user that signs into a folder gets
her own brand-new sequence — co-PIs sharing a laptop each get
onboarded independently. The trade-off is that a single human who
opens the same folder from a second machine sees tips again (since
identity is per-user-on-this-folder, not per-actual-human); judged
acceptable given there's no way to detect cross-machine humans
without server-side identity.

This is the same shape as `_telegram.json`, `_calendar-feeds.json`,
`_labarchives.json` — per-user sidecars at `users/<u>/_<feature>.json`.
Read/write path mirrors `frontend/src/lib/calendar/external-feeds-store.ts`
(version field, normalize-on-read, lazy default if missing).

**Sidecar shape (`users/<u>/_onboarding.json`):**

```jsonc
{
  "version": 1,
  // ISO timestamp of the first time THIS USER opened this folder
  // under a build that has the onboarding system. Set on first read
  // if the file is missing. Pure record-keeping; not used for the
  // freshness taper anymore (Grant's trigger model uses
  // active_seconds, see below).
  "first_seen_at": "2026-05-14T20:14:33.221Z",

  // Total wall-clock seconds the user has spent with at least one
  // ResearchOS tab visible-and-focused. Ticks at +1 every second
  // while document.visibilityState === "visible" AND document has
  // focus. Persisted to sidecar every ~30s + on visibility-hidden.
  // Used as the "time on website" budget Grant's trigger asked for.
  // After active_seconds > 3600 (1h cumulative), the taper rule
  // turns the system off — the user is no longer "brand new."
  "active_seconds": 412,

  // Last time any tip was successfully shown to this user, in
  // active-seconds (not wall-clock). The trigger fires only when
  // (active_seconds - last_tip_at) >= MIN_GAP_SECONDS (default
  // 300s = 5 minutes of active engagement). Initialized to 0.
  "last_tip_at": 180,

  // Per-tip dismissal record. Keyed by tip id (e.g.
  // "drop-to-replace"). Each entry is { shown_at: ISO,
  // dismissed_at: ISO|null, outcome: "x"|"later"|"got-it"|"read"
  //                          |"action-cancel" }.
  // outcome="action-cancel" means the user did the thing before
  // the tip fired — the tip never showed; we just record it as
  // already-served. outcome="later" means re-fire eligible next
  // session.
  "tips": {
    "drop-to-replace": {
      "shown_at": "2026-05-14T20:17:55.000Z",
      "dismissed_at": "2026-05-14T20:18:01.000Z",
      "outcome": "x"
    }
  },

  // Global off-switch. Set when the user clicks "Stop showing tips"
  // in any tip popup, or when the taper-off threshold trips. When
  // true, no tip ever fires regardless of `tips` state.
  "tips_off": false,

  // Total tips successfully displayed to this user (not counting
  // action-cancel records). Used as a secondary off-switch: after
  // 8 displays (= the entire initial set), system stops on its
  // own even if active_seconds is still under the cap.
  "shown_count": 1
}
```

Three things to notice about the shape:

- **Per-user, not folder-root.** Mirrors `_telegram.json` /
  `_calendar-feeds.json` / `_labarchives.json` — sits under
  `users/<u>/` so each user's onboarding sequence is independent.
  Locked in design call (2026-05-14).
- **No telemetry.** ResearchOS has no server backend for the data
  folder; the only file readers are the user(s) who picked the folder.
  `shown_count` and `active_seconds` are purely off-switch inputs.
- **`tips_off` is sticky per-user.** Once a user turns tips off, they
  stay off for that user (other users in the same folder are
  unaffected). Re-entry is via Settings → "Replay onboarding tips"
  (clears `tips`, sets `tips_off: false`, resets `last_tip_at` to
  `active_seconds` so the cooldown starts fresh; leaves
  `first_seen_at` + `active_seconds` so the freshness taper still
  applies).

**Brand-new threshold:**

Two heuristics are blended so a stale account that hasn't been opened
in a while doesn't get treated as brand-new just because a new build
introduced the system:

1. `active_seconds < 3600` (less than 1 cumulative hour of focused
   in-app time). After 1 hour of real engagement the user has seen
   enough of the app to not need orientation tips.
2. `shown_count < 8` (= the size of the initial tip set). After
   serving the whole set, system tapers off regardless.

Both must be true. The cumulative-active-seconds model (rather than
days since creation) is the active-engagement signal Grant asked for
in the trigger spec: it doesn't matter how long ago the user created
the account, only how much time they've actually spent using it.

## Demo + wiki-capture exemption

The whole system short-circuits when `isDemoOrWikiCapture()` is true.
Concretely:

- The provider doesn't mount the tip orchestrator at all when
  `isDemoOrWikiCapture()` is true. No state, no event listeners, no
  sidecar reads/writes in that branch.
- This also covers the picker variant (`?wikiCapture=picker`) — the
  fixture is installed but no user is signed in yet, so neither path
  fires.
- The demo's sticky `sessionStorage` flag (`researchos:demo-mode`)
  keeps the gate stable across in-tab nav so a user who pops into
  `/wiki/...` and back via `<OpenDocsButton>` doesn't trigger a
  mid-flight onboarding popup.

Tests: a single React-Testing-Library assertion that the orchestrator
returns `null` when `getDemoMode()` mock returns true is enough — the
gate is one line of code, the test guards regression.

## Mascot

The brief is "cute / anime inspired" and explicitly **not emoji-based**.
The rest of the app uses single-path stroke-SVG icons in the style of
the recent emoji sweeps (commits `f3e39af3`, `11054b2a`, `1bc9fe36`,
`72b0c385`) — all `fill="none" stroke="currentColor" strokeWidth={2}`
with rounded line caps + joins. The mascot should land in that visual
family so it reads as "another ResearchOS icon" rather than "imported
from a different design system."

Three directions were considered. Recommended: **Direction 1, the
beaker-bot**.

### Direction 1 — Beaker-bot (recommended)

A small round-bodied character built from a chemistry-beaker silhouette
with two dot eyes, a rounded square smile, and a single hair-tuft
flick. Two small floating measurement-mark dashes on the side of the
body double as cheek blush. The whole figure renders in
`stroke="currentColor"` at the same 2px weight as every other icon in
the app. Two pose variants — `idle` (eyes neutral, slight smile) and
`pointing` (one arm raised, finger extended; the finger renders as a
small triangle that points toward the affordance the tip is calling
out).

```
       ___
      /   \           <- hair flick
     | o o |          <- eyes
     |  ‿  |          <- mouth
     +-----+
    /|     |\
   / |     | \        <- arms (pointing pose: right arm up-and-out)
   \-+-----+-/
     |     |
     |  ─  |          <- measurement dashes (cheeks)
     |  ─  |
     +-----+
```

Roughly ~30 lines of SVG path data per pose. Inline as a component, not
fetched as a `.svg` asset — keeps the bundle small and lets us tint the
character with whatever Tailwind color class makes sense for the
surface it's on (`text-emerald-500` for "you did it!", `text-sky-500`
for "here's a thing," etc.).

**Why this:** The beaker silhouette is the strongest read-at-a-glance
visual cue that this is a *research-tool* mascot specifically. It's
cute without being saccharine. It composes naturally with the
measurement-dashes-as-blush detail, which is the anime-inflected
touch. The pointing pose with the triangle-finger doubles as a
directional arrow, removing the need for a separate "look over here"
chevron element on the tip card.

**Inline SVG draft (idle pose):**

```jsx
<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={2}
     strokeLinecap="round" strokeLinejoin="round">
  {/* hair flick */}
  <path d="M22 8 C 22 6, 24 4, 26 6" />
  {/* body — rounded-bottom beaker silhouette */}
  <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
  {/* beaker lip */}
  <path d="M11 12 L29 12" />
  {/* eyes */}
  <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
  <circle cx="23" cy="18" r="1.2" fill="currentColor" stroke="none" />
  {/* smile */}
  <path d="M18 22 Q 20 24, 22 22" />
  {/* measurement-mark cheek dashes */}
  <path d="M14 25 L15.5 25" />
  <path d="M24.5 25 L26 25" />
</svg>
```

The pointing variant adds:

```jsx
{/* arm extended right, finger triangle */}
<path d="M28 18 L33 16" />
<path d="M33 16 L32 14 L34.5 15 Z" fill="currentColor" />
```

### Direction 2 — Origami-fox

A folded-fox silhouette (triangular ears, wedge body, simple
fold-lines) that "pops up" from the corner of the tip card. Stays in
the same stroke style; very anime-adjacent (paper-craft mascots are an
established convention). Strength: cleanest geometry, easiest to
animate (small bounce-in works well with sharp angles). Weakness: less
research-tool-specific; reads as "cute mascot" without the lab
connection. Rejected on identity grounds — the beaker-bot's silhouette
says "ResearchOS" without an accompanying word; the origami-fox needs
the surrounding text to land.

### Direction 3 — Pencil-sprite

An anthropomorphized pencil with eyes near the eraser end, doubling as
a "writing tip" pun. Strength: cheapest to draw, single-path silhouette
is one of the simplest. Weakness: the pencil framing fights with the
fact that most of ResearchOS is about lab work, not writing
specifically — feels like a Microsoft-Word mascot in the wrong app.
Also: a pencil sprite that "points" by extending its tip toward the
affordance is too on-the-nose given that pencils literally have a
point.

### Mascot dynamics (recommended)

- **Idle**: the mascot sits in a small bubble at the corner of the tip
  card. No animation; the eyes don't blink (anti-uncanny). Pure
  stroke art, no fill colors other than the eye dots and the
  triangle-finger.
- **Entry**: 200ms fade-in + 8px slide-up. No bounce, no shimmer.
- **Pointing**: when a tip targets a specific affordance, the mascot
  faces it (mirror the SVG horizontally if the target is to its left)
  and a thin **dotted line** (4px gaps) animates out from the
  triangle-finger to the target's bounding-rect center. The line
  pulses once (300ms opacity transition) on entry and then settles.
  No persistent connector — once the user moves the mouse, the dotted
  line fades.
- **Exit**: 150ms fade-out, no slide.

The dotted-pointer-line is the single thing that distinguishes
this from a generic toast. It's the "look here" gesture the brief
asks for ("they should point to where to do the feature"). Implemented
with `getBoundingClientRect()` on the target ref + an SVG `<line>`
absolutely positioned in the document, recomputed on resize and on
scroll (passive listener, debounced 16ms).

## Trigger pattern

**LOCKED 2026-05-14 (Grant):** the trigger is driven by
**cumulative active-engagement time** on the website, not wall-clock
time. The sidecar's `active_seconds` field is incremented every
second the user has at least one tab visible-and-focused. Tips fire
when (a) the user is on a route that has an eligible un-shown tip,
and (b) at least **5 minutes of active engagement (300s)** have
passed since the last tip fired (`active_seconds - last_tip_at >=
300`). Only one tip on screen at a time — if a tip is currently
displayed, no other tip can fire under any condition.

The cumulative-active-time approach is what Grant specifically asked
for: a wall-clock cooldown ("30s ago a tip fired") punishes the user
who put the browser in the background, came back 20 minutes later,
and is now eligible by clock but not by engagement. Tracking
active-seconds means "we've shown you a tip recently in terms of
your actual time using ResearchOS" — which is the right axis.

**Rules:**

1. **One tip at a time.** If a tip is rendered (card visible on
   screen), no other tip is scheduled or fires. Period.
2. **Min gap is active-time-based, not wall-clock.** Default 300s
   (5 min) of *active* engagement between tips. So 5 minutes of
   actually using the app between any two consecutive tips, even if
   the user left the tab for an hour in between.
3. **Eligibility is "on the right page."** Each tip has a `route`
   matcher (pathname startsWith, e.g. `/`, `/methods`, `/lab`,
   `/inbox`). A tip becomes eligible when the user is on a matching
   route AND has spent at least **30 seconds of active time on that
   route in this session** (so we're not firing the instant they
   land — the page has to be the focused context for a moment).
4. **Random firing within eligibility.** Once eligible (right page,
   enough active time since last tip, page has been focused for
   ≥30s this session, tip is not in `tips` already), the
   orchestrator rolls a fire decision every ~5 seconds with a small
   probability (~15% per check). This produces the "appears sort of
   at random" feel Grant asked for — the tip lands somewhere in the
   minute or two after eligibility opens, not at a predictable beat
   right at the 300s mark.
5. **Action triggers cancel.** If the user starts doing the thing
   the tip would have explained (e.g. clicks the upload button
   before the duplicate-upload tip has fired), the tip is marked
   `outcome: "action-cancel"` in the sidecar and never re-fires.
   No condescending "I see you just uploaded!" tips.
6. **Page-leave cancels scheduled.** If the user navigates away
   from a tip's matching route before the random fire lands, the
   schedule is dropped (tip stays eligible to re-roll next time
   they're on that route).
7. **Tips_off and shown_count gates** sit above all of the above —
   neither fires anything when off.

The randomness is deliberate: Grant explicitly asked for "sort of
at random" so the experience feels organic rather than triggered.
A 15%/5s roll gives an expected firing time of ~33 seconds after
eligibility opens, with the variance that makes consecutive
sessions feel different.

Time accounting details:

- `active_seconds` only ticks while `document.visibilityState ===
  "visible" && document.hasFocus()`. Tab in background, tab without
  focus (clicked another window), and tab unloaded all stop the
  counter.
- Counter is in-memory + flushed to sidecar every 30s and on
  `visibilitychange` (to "hidden"). A crash mid-session loses at
  most 30s of count, which is fine.
- `last_tip_at` is in the same units (active-seconds), so the
  "5 minutes of active engagement since last tip" math is a plain
  subtraction.
- Implementation lives in
  `frontend/src/lib/onboarding/active-time.ts` — pure module-level
  state + a React hook that returns the current count. No
  setInterval-driven re-render of consumers (Grant's polling
  pattern from §6 is a useful reminder that setInterval-counters
  don't survive long FSA blocks; this counter explicitly does
  NOT need to be reactive at consumer level — the orchestrator
  reads it on its 5s roll tick).

## Cadence + dismissal

Each tip card has three exits:

1. **`X` (close)**: dismisses *this tip* only. Writes to
   `dismissed["<id>"]` so it never re-fires. The other tips continue.
2. **"Show me later"**: closes the tip but does NOT write to
   `dismissed`. The tip is eligible to re-fire on the next session
   (next time the orchestrator boots in this folder). Useful for "yes,
   interesting, but I'm in the middle of something."
3. **"Stop showing tips"**: sets `tips_off: true` on the folder
   sidecar. Confirmation popup first ("You won't see tips again until
   you turn them back on in Settings"). Hard off.

Plus the implicit:

4. **"Got it" / "Read the wiki page →"**: clicking either confirms the
   user engaged and dismisses the tip permanently. Read-the-wiki opens
   the linked page in a new tab; the tip card itself dismisses
   immediately.

**Taper rule** (folder-wide): after `shown_count >= 10` OR
`days_since(first_seen_at) > 14`, the orchestrator stops scheduling
new tips. Existing scheduled-but-not-yet-fired tips also drop. The
sidecar is left in place so "Replay onboarding tips" can re-enable.

**Replay entry point:** Settings page → "Show me the onboarding tips
again" button (`frontend/src/app/settings/page.tsx`). Clears
`dismissed`, sets `tips_off: false`, leaves `first_seen_at` in place
(the freshness taper still applies — you can't replay onboarding 6
months in). One toast confirmation: "Tips re-enabled. They'll fire as
you visit pages again." No retro-fire of the whole batch.

## Initial tip set

Each tip is a `{id, title, route, target, body, wikiPath}` record
loaded from a single source file
(`frontend/src/lib/onboarding/tips.ts`). Eight initial tips, all
pointing at features that landed in the last two weeks of work and
that a brand-new user is exactly the cohort least likely to discover
unaided.

| # | id | Route | Target | Body | Wiki link |
|---|---|---|---|---|---|
| 1 | `drop-to-replace` | `/` | the project-card image | "Drop a new image onto any existing image to replace it in place — no need to open the editor first." | `/wiki/features/markdown-editor#drop-to-replace` |
| 2 | `telegram-send-to-task` | `/inbox` (or the inbox panel on `/`) | the inbox toast | "Photos from your Telegram bot land in your Inbox. Click any image and pick a task to attach it to — no manual filing." | `/wiki/integrations/telegram` |
| 3 | `duplicate-upload` | `/methods` or `/` (any page with a Files strip) | the file-upload button on a task | "Upload a file with a name that already exists and ResearchOS will ask: dedupe, replace, or rename. No silent overwrites." | `/wiki/features/markdown-editor#duplicate-upload` |
| 4 | `cross-owner-share` | `/` (project card) or `/gantt` | the "share" affordance on a project | "Drop a colleague's task into your project to host it. Both their Gantt and yours stay in sync — they own the data, you see it in your timeline." | `/wiki/features/links#cross-owner` |
| 5 | `appshell-cluster` | any page | the 5-icon bottom-right cluster | "Bottom-right corner has five quick actions: data folder, user switch, bug report, support, and a notification test button. Hover to see labels." | `/wiki/features/settings` |
| 6 | `labarchives-import` | `/methods` or `/` | the LabArchives import affordance | "Import an entire LabArchives notebook as projects and tasks. The wizard walks you through page-to-project mapping; inline images are rehydrated automatically." | `/wiki/integrations/labarchives` |
| 7 | `lab-mode` | `/lab` | the lab-tab strip | "Lab Mode is the multi-user roll-up. Eight tabs — Activity, Gantt, Experiments, Roadmaps, Methods, Notes, Search — each answers one question across the whole lab." | `/wiki/features/lab-mode` |
| 8 | `wiki-entry` | any page | the docs button | "Every feature has a wiki page. Click the doc icon (bottom-right) any time you want the long version. No login, no separate tab management — it opens beside your work." | `/wiki/` |

(Numbering is the priority order. The orchestrator fires in priority
order when multiple tips match the current page; route matches break
priority ties.)

Each tip body is ≤140 chars in display and ends with the
"Read the wiki page →" link. The mascot's pointing-line targets the
`target` element by ref or by `data-onboarding-target="<id>"` data-attr
(simpler ref handoff for elements that don't already have a ref).

**Why these eight:** they map directly onto the features Grant has
shipped in the last two weeks of work that have **no obvious in-app
discovery surface today**. Drop-to-replace, duplicate-upload, and
send-to-task are all "you stumble onto this by trying the thing" —
brand-new users don't know to try. The cross-owner share, Lab Mode,
and LabArchives import are big-ticket features hiding behind
unobvious entry points. The 5-icon cluster is the highest-density
discoverability problem in the app (5 icons in a corner, no labels
unless you hover). The wiki entry point closes the loop.

Tips 1-4 are the highest-value (in-context "you can do this"
prompts). Tips 5-8 are lower-priority orientation prompts that the
orchestrator may or may not get to depending on the session-cap.

## Card surface

Each tip renders as a small card anchored near the bottom-right (out
of the way of the floating cluster's bottom-right corner; offset to
the right of where `<FloatingLeaveDemoButton>` lives in demo mode, but
demo mode is exempt so they never coexist). Approximate dimensions:
320px wide × 140px tall.

Card structure (top to bottom):

```
┌─────────────────────────────────────────────┐
│ ┌──┐                                    [x] │
│ │🧪│  Drop to replace images                │
│ │bb│  ─────────────────────────────────     │
│ └──┘                                        │
│      Drop a new image onto any existing     │
│      image to replace it in place — no      │
│      need to open the editor first.         │
│                                             │
│  Show me later   Stop showing   Read more → │
└─────────────────────────────────────────────┘
   └────┐
        │  (dotted pointer-line to target)
        ▼
```

(The "🧪bb" cell is just a stand-in for the inline beaker-bot SVG.)

Wraps in `<Tooltip>` aren't needed because the action buttons have
visible labels. Mascot's pointing-finger renders inside the bb cell
when the tip is pointing at a same-screen target; the dotted line
extends from the card edge to the target.

## Implementation sketch

**New files:**

- `frontend/src/lib/onboarding/sidecar.ts` — read/write helper for
  `_onboarding.json`, schema-versioned, mirrors the
  `external-feeds-store.ts` shape.
- `frontend/src/lib/onboarding/tips.ts` — the tip catalog.
- `frontend/src/lib/onboarding/orchestrator.tsx` — React context that
  owns the visit/idle/cooldown state machine, exposes
  `useOnboardingTarget(id)` for components to register targets, and
  renders the current tip card via portal.
- `frontend/src/components/BeakerBot.tsx` — the mascot SVG, idle +
  pointing variants, prop-controlled `direction: "left"|"right"` for
  the pointing pose mirror.
- `frontend/src/components/OnboardingTipCard.tsx` — the card UI
  rendered at the document root via portal, with the dotted
  pointer-line and the three exit buttons.

**Modified files:**

- `frontend/src/lib/providers.tsx` — wraps `<AppContent>` with
  `<OnboardingProvider>` when not in demo/wiki-capture mode.
- `frontend/src/app/settings/page.tsx` — adds "Show me the onboarding
  tips again" button under a new "Tips" section.
- A handful of components get one of `data-onboarding-target="<id>"`
  or an explicit `useOnboardingTarget(id)` ref to expose the target.
  Lightweight; no logic changes.

**No backend, no API, no migration.** Folder-root sidecar only.

Rough LOC estimate: ~200 for sidecar + tips catalog, ~250 for the
orchestrator state machine, ~150 for the card UI, ~120 for the
mascot SVGs. Total ~700-800 LOC, all new files except the small
provider + settings + target-registration touches.

## Migration / rollout notes

- **No feature flag.** Brand-new folders get the system from first
  open; existing folders are tapered-out by the freshness rule (see
  above) so they don't suddenly start firing tips on day-300 of use.
- **No migration of existing data.** First read of `_onboarding.json`
  creates it lazily; missing file is treated as `{first_seen_at: now,
  visited_routes: [], dismissed: {}, tips_off: false, shown_count: 0}`.
- **Demo zip should NOT include `_onboarding.json`.** Tips are
  cosmetic — adding the sidecar to `frontend/public/demo-data/` would
  matter only inside the demo, which is short-circuited anyway. Skip.
- **Real-folder gitignore.** `_onboarding.json` does not contain
  secrets and does not need to be `.gitignore`d on the data folder
  side. The existing data-folder gitignore convention
  (`frontend/src/lib/file-system/gitignore.ts`) handles known sensitive
  sidecars (`_telegram.json`, `_labarchives-deployer.json`); this
  sidecar can sit alongside `_demo_marker.json` un-ignored.
- **Wiki implications.** The wiki manager is the right owner for any
  new wiki page describing the onboarding system itself (e.g. "Tips
  and how to replay them" under `/wiki/features/settings/onboarding`).
  This proposal does NOT write that page. It will flag the page as a
  handoff in the implementation report.
- **AGENTS.md.** §8 should pick up an "Active bot branches" entry
  while Phase 2 is in flight, and a "Recently landed" entry on merge.
  Manager (this session) owns those edits.

## What this proposal does NOT decide

These are intentionally left for Grant to confirm via the open-question
list below, or for implementation to make local calls on.

- Exact pixel dimensions of the tip card and the mascot.
- Exact wording of each tip body. The drafts above are first-pass; a
  wiki-voice pass should follow once the system is wired.
- Whether the mascot has a name. (The wiki uses "ResearchOS"
  consistently; the mascot could remain unnamed, which avoids the
  question of accessibility for screen readers — alt text just reads
  "ResearchOS assistant.")
- Whether tips fire across user switches. Current proposal: folder-
  scoped, so a user switch does NOT reset the tip state. Discussable.
- Whether the dotted-line pointer should also animate at idle (subtle
  pulse) or be fully static once drawn. Current proposal: pulse once
  on entry, static after.
- Whether there's a "next tip" affordance in the card itself (skip to
  the next eligible tip without dismissing this one). Current
  proposal: no — keeps the card small and avoids the user
  tip-cycling instead of working.
- Whether the orchestrator should preempt itself if a higher-priority
  tip becomes eligible while a lower-priority one is on screen.
  Current proposal: no — first-firing-wins per session, the user gets
  to dismiss it cleanly.
- The shadcn / Tailwind component library to use for the card chrome
  (the project uses Tailwind directly without shadcn; the card should
  match the existing popover/modal styling so this is mostly a copy
  from `<Tooltip>` / `<LeaveDemoModal>`).

---

## Decision log (locked 2026-05-14)

- **Mascot:** Beaker-bot (Direction 1). SVG draft above is the
  starting shape; refinement during Phase 2 is fine.
- **Sidecar scope:** Per-user at `users/<u>/_onboarding.json`.
- **Trigger:** Active-engagement time-based, with one-at-a-time
  constraint and randomized fire after eligibility opens. Default
  min-gap 300s of active time between tips; 30s of active time on
  a matching route before eligibility; 15%/5s roll for fire timing.

## Open questions still pending

1. **Initial tip set — ship the 8, trim, or expand?** Grant asked
   for elaboration on the 8 tips (see the "Initial tip set" table
   above — each row spells out the trigger route, target affordance,
   one-line body, and linked wiki page). Once Grant confirms set
   composition, Phase 2 implementation can begin. The current
   recommendation is to ship all 8; with the 5-minute-of-active-time
   gap, most users will see ~3 tips per hour-long session, so the
   full set spreads naturally across the user's first ~5 hours of
   real use.
2. **Replay scope:** when the user clicks "Show me the onboarding
   tips again" in Settings, should it replay ALL tips (including
   ones the user explicitly dismissed via X) or only ones they
   didn't engage with? Proposal: all of them — replay means replay.
   Tunable in 1 line.
3. **Tip card placement:** bottom-right (proposed) keeps the center
   of the screen unobstructed and matches the
   `<FloatingLeaveDemoButton>` corner — but demo + onboarding are
   exempt from co-existing, so no collision in practice. Top-right
   and bottom-center are alternatives if bottom-right feels too
   crowded against the AppShell's 5-icon cluster.
4. **Future tip authoring:** is the catalog meant to grow over time
   as new features ship, with each new release adding 1-2 tips? If
   yes, the orchestrator should accept tips with a `min_build`
   field so a tip pointing at a feature that only exists in builds
   ≥ X isn't shown on stale builds. (Not in this proposal;
   trivially addable later.)
