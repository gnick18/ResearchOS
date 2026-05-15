# Telegram onboarding: proposal

> Scope: tighten the new-user experience around the Telegram bridge
> across three surfaces: the bot's reply copy (`/start`, `/help`,
> post-photo confirmations), the existing onboarding tip that
> introduces the feature, and an optional guided "send your first
> photo" walkthrough that lives inside the Phase-4 tutorial sequencer.
> Deliverable is one design proposal; no code changes. The wiki page
> at `frontend/src/app/wiki/integrations/telegram/page.tsx` is owned
> by the wiki manager and is read here but not touched.

## Context

The Telegram integration is one of the highest-value, lowest-discovery
features in ResearchOS. It collapses "take a phone photo at the
bench, sit down at your laptop, find the photo in your camera roll,
upload it, file it on the right experiment" down to a single SMS-style
send. The data model behind it is mature: photos either auto-attach
to whatever experiment popup is open in the current tab, or land in
the per-user inbox at `users/<u>/inbox/Images/` for later filing.

That dual-mode behavior is what trips brand-new users. Grant's
quote, verbatim:

> "I think we should fix the telegram set up instructions. The bot
> that you text should explain more about the send with an experiment
> or note open vs with nothing open goes to inbox to sort later.
> Maybe we can even build out a tutorial container that has the user
> try texting their first photo to an experiment that the tutorial
> pulls up. It can guide them through the process with the help of
> the telegram bot also being aware of the tutorial mode being
> activated. (...) In general i find the telegram thing useable but
> slightly confusing for new users."

There are three improvements packed in there, ranked by scope:

1. **Clearer bot-side copy** so a user who forgets the dual-mode
   behavior can re-derive it just by typing `/help` to the bot.
2. **An interactive first-photo walkthrough** inside the existing
   tutorial sequencer: the tutorial opens an experiment, asks the
   user to text a photo, the photo lands on that experiment, success.
3. **Bot-aware tutorial mode**: the bot knows the app is in tutorial
   mode and can hand-hold accordingly, possibly with a `/tutorial`
   command the user can invoke at any time to re-trigger the guided
   send.

This proposal audits the current state, discusses three design
considerations Grant flagged, lays out three implementation
directions with tradeoffs, and recommends a phased rollout. Bot-text
work is shippable on its own and should land first regardless of
what happens with the tutorial pieces.

## Current state

### What the bot says today

The reply copy lives in two places: `image-router.ts` for
post-pairing commands and per-photo confirmations, and
`TelegramPairingModal.tsx` for the one-time "you're paired" message
the modal sends from inside the pairing flow.

**`/start` reply** (`frontend/src/lib/telegram/image-router.ts:65-71`):

```
Already paired. Open an experiment in ResearchOS and send a photo
here — it'll appear in that experiment's image strip.
```

**`/help` reply** (`image-router.ts:73-80`):

```
Send a photo. While an experiment is open in ResearchOS, the image
is linked to that experiment. Reply with a description after each
photo, or send /skip to skip the caption.
```

**Pairing-success reply** (`TelegramPairingModal.tsx:90-97`):

```
✅ Paired with ResearchOS as <username>. Send photos here while an
experiment is open and they'll land in that experiment's image strip.
```

**Per-photo reply (active task)** (`image-router.ts:163`):

```
Saved to Experiment <id> (<name>). What is this? Reply with a
description, or send /skip.
```

**Per-photo reply (no active task)** (`image-router.ts:177`):

```
Saved to your inbox — open an experiment in ResearchOS to file it.
What is this? Reply with a description, or send /skip.
```

(The "What is this?" tail is appended by `image-router.ts:194-197`
whenever a photo arrives without a caption.)

Three things to notice about the as-shipped copy:

- **The pairing success message and `/start` both omit the inbox
  half of the dual-mode behavior.** They tell the user "open an
  experiment, send a photo, it'll attach" but never explain what
  happens if they DON'T have an experiment open. The user has to
  discover the inbox by sending a photo with nothing open and
  reading the bot's reply.
- **`/help` is one terse sentence.** It mentions experiment-attach
  but not inbox-fallback, and doesn't reference the `/skip` /
  caption-reply lifecycle as a recap. A user texting `/help` two
  weeks after pairing gets less information than a user reading the
  per-photo reply for the first time.
- **The inbox-fallback per-photo message is the one place the user
  ever learns about the inbox.** It's only seen once (the moment
  the user sends a photo with nothing open), and it doesn't link
  back to the inbox in the app; the user is left to find the
  Inbox badge on the AppShell on their own.

### What the pairing modal shows

`TelegramPairingModal.tsx` walks the user through token paste →
"send a message to your bot" → success in three states. The success
state is a 1.2s flash before auto-close (`TelegramPairingModal.tsx:99-100`):

```
Paired with @<botusername>.
```

No inbox-vs-active explainer in the modal itself either. The
"alreadyPaired" state (`TelegramPairingModal.tsx:180-217`) repeats
the same active-experiment framing:

```
Send any photo to @<botusername> while an experiment is open and
it'll appear in that experiment's image strip.
```

### What the existing onboarding tip says

`frontend/src/lib/onboarding/tips.ts:69-84` ships one Telegram tip
in the catalog. Body verbatim:

```
Title: Your phone is a lab notebook
Body:  Text me a photo while an experiment is open and I'll
       auto-attach it to that task on your laptop. Reply with a
       caption and I'll save that too.
Route: /
Target: telegram-send-to-task (the header pill)
Wiki:  /wiki/integrations/telegram
Setup: "Pair Telegram" → /settings#telegram
```

The body again only describes the active-experiment branch. (The
`setupAction` deep-links to `/settings#telegram` which presumably
opens the pairing modal.)

### What the wiki already covers

`frontend/src/app/wiki/integrations/telegram/page.tsx` is the
authoritative explainer. It covers both branches clearly
(`page.tsx:127-151`):

> An experiment popup is open. The photo is filed into that
> experiment's image strip.
> Nothing's open. The photo lands in your inbox at
> `users/<you>/inbox/Images/`, a yellow toast slides up...

The wiki page does the job. The gap is everything UPSTREAM of "the
user already decided to read the wiki": bot copy, modal copy, tip
copy. That's what this proposal targets.

### How the polling architecture constrains "bot-aware tutorial"

The Telegram "bot" is not a server-side process. The polling loop
runs in the user's browser tab via
`frontend/src/lib/telegram/use-telegram-polling.ts:67-155`, throttled
by a cross-tab `localStorage` lock so only one tab polls per
browser. The reply messages are sent client-side from
`routeTelegramMessage` (`image-router.ts:84-204`) using the bot's
token directly against `api.telegram.org`.

This has two implications for design consideration #3 below:

- "The bot knows the app is in tutorial mode" really means "the
  browser tab that's currently routing inbound photos knows about
  the tutorial." There's no server to share state with.
- The tutorial sequencer runs in `/demo?tutorial=1` (a separate tab,
  opened by the welcome modal; see
  `OnboardingTutorialSequencer.tsx:24-44`). The user's REAL paired
  bot is paired against the real folder, NOT against the demo's
  in-memory mock. So a tab open on `/demo?tutorial=1` is exactly
  the tab that the polling lock is most likely to NOT be held by:
  it's the demo tab, which never polls because `readPairing()`
  returns null in the mock fileService.

### Where the inbox toast actually lives

For completeness: when a photo lands in the inbox, the wiki says a
"yellow toast slides up from the bottom-right." That toast is owned
by the inbox panel, not by the Telegram code. The router writes the
file to `inboxBase(username)` (`image-router.ts:48-50`); UI updates
ride on `imageEvents.emitAttached()` (called inside
`attachImageToTask`). Anything the tutorial wants to do downstream
of "photo arrived" can listen on `imageEvents.onAttached(...)`.

## Design considerations

Three questions Grant's quote opens up. Each needs a pick before any
of Direction B or C below can ship.

### 1. Where does the first-photo walkthrough fire?

Three plausible homes:

- **Inside the existing tutorial sequencer.** `<OnboardingTutorialSequencer>`
  already walks the user through the catalog in priority order, so
  adding a "now go take your phone out and text a photo" step is
  the natural extension. The sequencer already opens specific
  popups on demand (`buildStepConfig` in
  `OnboardingTutorialSequencer.tsx:89-113`), so opening a demo
  experiment to receive the photo is a one-line addition to that map.
- **As a standalone, post-pairing modal.** The moment the user
  finishes pairing in `TelegramPairingModal.tsx`, instead of the
  1.2s success flash, transition straight into "Want to try sending
  your first photo? Here's how it'll look on this side." Modal
  stays open until the photo arrives or the user dismisses.
- **Both.** Tutorial sequencer for the "Walk me through it" path
  (the user picked the guided tour at signup); standalone post-pair
  modal for the "I just paired six months later" path (the user
  skipped onboarding originally and is now setting up Telegram on
  their own).

**Recommendation:** start with the sequencer-only path. The
post-pair modal is a nice second-chance affordance but lives outside
the welcome-modal flow Grant has been investing in. Adding it
doubles the surface area to design and test, and the tutorial
sequencer already has the infrastructure (back/skip/next chrome,
target polling, end-screen). Standalone post-pair flow can be added
in a Phase-2 follow-up if the analytics (well, the lack of
analytics) suggest users skip the tutorial and need a re-entry
point. Or just point them at the wiki from the success-modal copy.

### 2. Does the photo land in the demo lab or in the user's real folder?

This is the hardest design question. The tutorial runs inside
`/demo?tutorial=1`, which uses an in-memory mock fileService
(`frontend/src/lib/file-system/wiki-capture-mock.ts`). Any "photo
arrives at the experiment" success state in the demo would have to
either:

- **Path A: Photo lands in the demo lab.** Implementable only by
  having the tutorial-aware Telegram route bypass the real
  `inboxBase` / `attachImageToTask` and write into the in-memory
  mock instead. Practically that means adding a tutorial-mode
  branch to `image-router.ts` that routes to a mock destination
  when a sentinel flag is set. The user sees the photo appear on
  the demo experiment's image strip in the same tab they're
  watching, perfect closure on the success state. **But** it
  requires plumbing the tutorial flag from the demo tab into the
  router, which (per the polling architecture above) might be
  running in a totally different tab. And the user's REAL paired
  bot is what's sending the photo, so the photo bytes are real;
  they need to land somewhere on the user's real disk too, or
  they're lost when the demo tab closes.

- **Path B: Photo lands in the user's real folder, demo tab shows
  a "saw it!" notification.** Real bot routes the photo normally
  (to the user's inbox or active task in their real folder); the
  tutorial tab listens on a cross-tab signal and renders the
  success state without the photo actually appearing on the demo
  experiment's image strip. Easier to plumb (no router fork), but
  the demo loses its "look, here it is on the experiment!" moment;
  the user has to switch tabs to see the result. That switch is
  exactly the friction the tutorial is supposed to remove.

- **Path C: Hybrid.** Photo lands in the user's real folder
  normally, AND the tutorial tab pulls a thumbnail of the just-
  arrived photo and renders it inline on the demo experiment's
  image strip as a tutorial-only overlay. Best of both: real photo
  is preserved in the real folder, tutorial UI shows the success
  visually. Costs an extra "show me the most recent photo from
  this user" lookup that the demo tab doesn't normally do.

**Recommendation:** Path B. The demo tab's job is to teach the
mental model, not to be the source of truth for the photo. A clear
"Got it! Photo arrived in your real folder, and the bot just messaged
you back. Switch back to your real tab when you're done here." card
lands the lesson without forking the router. Path C is appealing
but the implementation cost (cross-tab thumbnail handoff with a
real Blob, demo overlay code path) doesn't pay back the small UX
gain over Path B. Path A is rejected because losing the real photo
is a non-starter.

The follow-on question Path B raises: **does the tutorial open a
real-folder experiment popup in the demo tab to receive the
demo-side highlight?** No. The demo tab can't open a real-folder
popup (different fileService, different data). Instead the tutorial
opens a demo experiment, and the success card on the demo says
"the photo is in your real folder, not here; switch back when
you're done." A small but real cognitive seam, worth flagging in
the open-questions list below.

### 3. How does the bot "know" the app is in tutorial mode?

Per the polling architecture above, "the bot" = "the browser tab
currently holding the polling lock." Three ways to share tutorial
state with that tab:

- **Sidecar flag in the user's real folder
  (`users/<u>/_telegram_tutorial.json`).** The tutorial tab writes
  `{ active: true, started_at: ISO, expected_task_id: number|null }`
  when it enters the first-photo step; the polling loop in the real
  tab reads it on each `getUpdates` cycle and changes its reply
  copy + routing accordingly. Sidecar is the same shape as the
  other per-user feature sidecars (`_telegram.json`,
  `_calendar-feeds.json`). Survives tab close + reload. Cleared by
  the tutorial when it ends or after a 30-minute TTL.

- **`localStorage` flag with cross-tab `storage` event.** Same idea,
  same browser only. Cheaper, no disk write, but breaks if the user
  somehow ends up running the tutorial in one browser and their
  real ResearchOS in another (Chrome vs Safari, work vs personal,
  etc.). Real-world this is unusual but not impossible.

- **The tutorial tab takes over polling.** The
  `useTelegramPolling` hook claims the cross-tab lock, so if the
  demo/tutorial tab is willing to also act as the Telegram poller,
  it sees inbound photos directly and can react in-process. Means
  the tutorial tab needs the user's `_telegram.json` (it's per-user
  on disk so the demo's mock fileService would have to be relaxed
  for that one path), and the demo's "photo lands here" semantics
  collide with "photo lands in real folder."

**Recommendation:** sidecar flag (option 1). It's the least clever
option: the same write/read pattern as everything else in the user
folder, no cross-tab event coordination quirks, no demo-mock
relaxation. The sidecar carries:

```jsonc
{
  "version": 1,
  "active": true,
  "started_at": "2026-05-15T19:21:00.000Z",
  // The tutorial-side experiment id the user was told to text a
  // photo for. The real-tab polling loop ignores this — it routes
  // photos to active task or inbox per usual — but it tells the
  // bot's reply copy what to call out ("Photo got to your real
  // folder. Head back to the demo tab when you're done.").
  "expected_task_id": null,
  // Hard 30-minute TTL. The polling loop checks `started_at` on
  // each read; if older than 30 min, it ignores the flag (and
  // best-effort deletes the file). Stops a stale flag from
  // permanently re-skinning the bot's replies.
  "ttl_minutes": 30
}
```

When this flag is active AND a photo arrives, the bot's reply
becomes the tutorial-aware variant (drafted under Direction C below)
instead of the normal one. When the tutorial ends, the sequencer
deletes the flag.

### 4. Is there a `/tutorial` command?

Useful for two scenarios:

- The user skipped onboarding originally, paired Telegram much
  later, and now wants the guided send-a-photo walkthrough.
- The user did the onboarding once but a teammate is being shown
  the app, and they want to re-trigger the demo to walk through it
  together.

**Recommendation:** yes, ship `/tutorial`. Implementation: when the
bot sees `/tutorial`, the router writes the `_telegram_tutorial.json`
sidecar with `active: true` and `expected_task_id: null`, and replies
"Open ResearchOS in your browser and a tutorial step will pop up
asking for your photo." On the app side, the orchestrator polls the
sidecar (or listens via the existing focus listener) and, if active,
mounts a small "Telegram tutorial in progress" coach-mark that walks
the user through the open-an-experiment-then-text-a-photo flow.
This gets the bot-aware tutorial mode without forcing the user to
restart the welcome-modal tutorial sequencer flow.

If `/tutorial` is judged out of scope for the first round, fine.
The sidecar mechanism still works, just driven only from the
welcome-modal tutorial entry point. `/tutorial` is a small additive
follow-up.

## Implementation directions

Three candidate scopes, ranked smallest to largest. They stack:
shipping A doesn't preclude later doing B + C.

### Direction A: Bot-text-only (recommended for v1)

Rewrite the four bot-side strings to clearly explain the dual-mode
behavior, mention the inbox upfront, and surface the
caption-reply / `/skip` lifecycle as a cohesive contract. No
tutorial container, no sidecar, no `/tutorial`. Just better copy.

**Proposed copy:**

```
/start (or post-pairing modal-success):
─────────────────────────────────────────
Hi! I'm your ResearchOS bot.

Send me a photo and I'll route it two ways:
• If you've got an experiment popup open in ResearchOS, the
  photo attaches to that experiment's image strip immediately.
• If nothing's open, the photo lands in your Inbox (badge in
  the top bar of ResearchOS) and you can file it later — even
  in a batch with right-click → "Send to task..."

After each photo I'll ask for a caption. Reply with a sentence
or send /skip.

Type /help any time for this refresher.
```

```
/help:
──────
Two routes for inbound photos:

1. Experiment popup OPEN in ResearchOS  →  photo attaches there.
2. Nothing open  →  photo lands in your Inbox (yellow badge,
   top bar). File it from there with "Move to active" or
   "Send to task...".

Captions: reply to my "What is this?" prompt with text, or
send /skip to leave a photo without one.

Token security: keep your bot token private. Disconnect from
the Telegram pill in ResearchOS at any time.
```

```
Per-photo reply (active task):
──────────────────────────────
Saved to Experiment <id> — "<name>".

What's the photo of? Reply with a sentence, or send /skip.
```

```
Per-photo reply (no active task → inbox):
─────────────────────────────────────────
No experiment open right now, so I dropped this in your Inbox
(top-bar badge). Open it in ResearchOS to file with
"Move to active" or right-click → "Send to task...".

What's the photo of? Reply with a sentence, or send /skip.
```

Plus the existing `telegram-send-to-task` tip body is updated to
match. It currently mentions only the active-experiment branch.
Proposed:

```
Title: Your phone is a lab notebook
Body:  Text me a photo. With an experiment open, it auto-attaches
       there; without one, it lands in your Inbox to file later.
       Captions land if you reply to my "What is this?" prompt.
```

(The tip stays under 140 chars per the onboarding-tip card brief
where possible; this draft is 211 chars, which is over. Wiki link
already covers the lifecycle so it can probably trim back to
"Text me a photo. With an experiment open it auto-attaches; without
one it lands in your Inbox." at 116 chars. Wording pass during
implementation.)

**Files touched:**

- `frontend/src/lib/telegram/image-router.ts`: `/start`, `/help`,
  active-task reply, inbox reply, caption prompt.
- `frontend/src/components/TelegramPairingModal.tsx`: pairing-success
  reply (the one sent from inside the modal at line 91).
- `frontend/src/lib/onboarding/tips.ts`: `telegram-send-to-task`
  body.

**Effort: S.** Roughly 30-50 LOC of string changes across 3 files.
No new files. No tests beyond eyeball-checking the bot replies in a
real chat.

**Tradeoffs:** zero risk, biggest UX-per-LOC ratio of the three,
but doesn't address Grant's "tutorial container" or "bot aware of
tutorial mode" asks. Recommended to ship regardless of what happens
with B + C; the better copy holds up on its own.

### Direction B: Tutorial container in the existing sequencer

Add a "Send your first photo" step to
`<OnboardingTutorialSequencer>` that:

1. Routes the demo tab to `/demo?openTask=<demo-experiment-id>&tutorial=1`
   so a demo experiment popup is open as the visual target.
2. Renders a tip card with the `telegram-send-to-task` target set to
   the header pill, body copy: "Got Telegram paired? Take your phone
   out and text the bot a photo. We'll watch for it here."
3. Sets up a cross-tab listener (a `localStorage` event or a custom
   `BroadcastChannel`) that fires when the real-tab polling loop
   processes a photo from this user.
4. On photo arrival, advances the step to a success card: "Got it.
   The photo's in your real folder; switch back to that tab to see
   it on the experiment's image strip."
5. Has a Skip button so a user without a paired Telegram (the demo
   user is `alex`, paired-state is per-user, so `alex` in the real
   folder may or may not be paired) can move past the step.

The cross-tab signal: when the real-tab's `routeTelegramMessage`
finishes a photo route, it writes a small `_telegram_last_photo.json`
sidecar with `{ at: ISO, basePath, filename }`. The demo tab polls
this sidecar (or attaches a `storage` event listener on a
`localStorage` mirror of the same data, since `_telegram_last_photo.json`
in the real folder is invisible to the demo tab's mock fileService)
and advances on first new entry.

**Cross-tab plumbing details:** the demo tab and the real tab both
have access to `localStorage` (same browser, same origin). The real
tab's polling loop already updates `localStorage` for the polling-tab
lock (`use-telegram-polling.ts:9`). Adding a second
`localStorage` key (e.g. `telegram-last-photo-at` set to a timestamp
on every successful route) gives the demo tab a `storage`-event
trigger to react to. No sidecar needed.

**Files touched:**

- `frontend/src/lib/telegram/image-router.ts`: emit
  `localStorage.setItem("telegram-last-photo-at", Date.now())` after
  a successful route.
- `frontend/src/lib/onboarding/tips.ts`: add a tutorial-only tip
  entry (or reuse the existing `telegram-send-to-task` tip with a
  tutorial-mode body override).
- `frontend/src/components/OnboardingTutorialSequencer.tsx`: add
  the cross-tab `storage` listener for the new tip, advance on
  photo arrival, render a success card variant.
- Possibly: a small "this step requires Telegram paired" gate that
  skips the step if `readPairing(currentUser)` returns null in the
  REAL folder. The demo tab's mock fileService would have to do a
  one-off real-folder read here, which is awkward. Cleaner: ALWAYS
  show the step, with a "Pair Telegram first" button that opens a
  new tab to `/settings#telegram` if the user isn't paired.

**Effort: M.** Roughly 150-250 LOC across 3-4 files plus the new
cross-tab event glue. No new sidecar files. New tip entry in the
catalog. The pairing-detection edge case adds ~50 LOC.

**Tradeoffs:** delivers the "interactive walkthrough" Grant asked
for; ships the dual-mode mental model in a hands-on way. The
demo-vs-real-folder seam (Path B in design consideration #2 above)
is real but explainable in one sentence on the success card. The
biggest risk is the user not having Telegram paired when they hit
the step, which the "always show the step + Pair Telegram button"
fallback addresses.

### Direction C: Bot-aware tutorial with `/tutorial` command

Direction B + the `_telegram_tutorial.json` sidecar from design
consideration #3, plus:

- The `image-router.ts` checks the sidecar on every inbound photo;
  when active, swaps the per-photo reply copy for the
  tutorial-aware variant: "(Tutorial active) Saved to your Inbox
  in the real folder. Head back to the tutorial tab; it's
  watching for this photo."
- `/tutorial` command in the router: writes the sidecar with
  `active: true`, replies with "Open ResearchOS in your browser
  and switch to the tutorial; I'll guide you through your first
  photo."
- The orchestrator (in any tab) polls the sidecar on each tick;
  when it sees `active: true` and the welcome-modal tutorial
  isn't already running, mounts a small "Telegram tutorial"
  coach-mark on the current page that walks the user through
  opening an experiment + texting a photo. (This is the "user
  skipped onboarding, types `/tutorial` later" entry path.)

**Files touched:** all of B, plus:

- `frontend/src/lib/telegram/telegram-tutorial-store.ts` (new):
  read/write helper for `_telegram_tutorial.json`, mirrors
  `telegram-store.ts` shape.
- `frontend/src/lib/telegram/image-router.ts`: `/tutorial`
  handler, sidecar-aware reply copy, sidecar-cleanup on success.
- `frontend/src/components/OnboardingTelegramCoachmark.tsx` (new):
  the small in-app coach-mark for the `/tutorial`-driven entry
  path. Different surface from the welcome-modal tutorial because
  it has to fit into the user's actual workflow rather than running
  in a separate demo tab.
- `frontend/src/lib/onboarding/orchestrator.tsx`: sidecar polling
  + coach-mark mount.

**Effort: L.** Roughly 400-600 LOC across 4-5 files (3 new). The
new in-app coach-mark is the chunkiest piece since it has to handle
"user is on /home with no experiment open" → "user opens an
experiment" → "user texts photo, photo lands, coach-mark shows
success" without the controlled environment of the demo tab.

**Tradeoffs:** delivers the full vision Grant sketched. The
`/tutorial` entry path is genuinely useful for users who skipped
onboarding. There's no other re-entry point for the Telegram
flow today other than the wiki page. But the coach-mark surface
duplicates a lot of the welcome-modal-sequencer machinery, and
the bot-aware tutorial-mode reply copy ("Tutorial active" prefix)
is the kind of thing that's neat in isolation but adds another
"why did the bot say that?" surface to debug if it sticks around
stale.

## Recommendation

Ship **A immediately** (one-day work, biggest UX-per-LOC ratio).
Build **B as a Phase 2** (one-week work) once A is live and Grant
has a feel for whether the bot-text changes alone close the gap.
Defer **C indefinitely** unless Grant explicitly wants the
`/tutorial` re-entry surface. The welcome-modal tutorial entry
covers the "new user" case and a smarter bot reply (Direction A)
covers the "I forgot how this works" case.

Justification, in the same shape as the experiments-redesign
recommendation:

The bot-text rewrite addresses the actual root cause Grant named:
"the bot that you text should explain more about the send with an
experiment or note open vs with nothing open." That's a copy
problem, not a tutorial-architecture problem. New users today learn
the dual-mode behavior either by texting a photo with nothing open
(and reading the inbox-fallback reply) or by reading the wiki;
neither happens during the typical first-pairing flow. Putting the
explainer in `/start` and `/help` means the first contact with the
bot is also the moment the user learns how it routes.

The interactive walkthrough (Direction B) is a force-multiplier on
top of A but isn't a substitute for it. A user who runs the
tutorial gets the hands-on lesson; a user who skips the tutorial
gets the bot-text lesson. Both audiences need to be served, and
Direction A serves both. Direction B only serves the tutorial-takers.

The `/tutorial` command (Direction C) is the only place where the
"bot-aware tutorial mode" framing pays off, and the payoff is
narrow: it's a re-entry point for users who skipped onboarding and
later want help with Telegram specifically. Useful, but every other
feature in ResearchOS ships without a per-feature `/tutorial`-style
re-entry; the wiki page is the standard re-entry. If Telegram
needs a dedicated re-entry, the cheaper version is a "Run me through
this" button on the wiki page itself or in the pairing modal's
already-paired state. That's a few lines of code, not a 600-LOC
sidecar + coach-mark stack.

## Implementation effort estimate

| Direction | Size | LOC | Files (new / modified) | Risk |
|---|---|---|---|---|
| A. Bot-text-only | S | 30-50 | 0 / 3 | Low |
| B. Tutorial container | M | 150-250 | 0 / 3-4 | Medium |
| C. Bot-aware + `/tutorial` | L | 400-600 | 3 / 5 | Medium-high |

(A + B together is roughly 200-300 LOC, since they don't overlap
much. A + B + C is 600-850 LOC.)

## Migration / rollout notes

- **Direction A is a strict copy improvement; no schema change, no
  sidecar, no migration.** Existing paired users will see the new
  `/help` reply the next time they type `/help`, and the new
  per-photo reply on their next inbound photo. The pairing-success
  message is post-pair only, so existing users won't see it
  retroactively.
- **Direction B's cross-tab `localStorage` key
  (`telegram-last-photo-at`) is purely additive.** Existing
  installations get an unused key once they upgrade; the demo
  tab's tutorial-only listener doesn't run for non-tutorial users.
- **Direction C's `_telegram_tutorial.json` sidecar needs the same
  gitignore handling as `_telegram.json`**: it carries no secrets
  but lives next to a file that does, so it's worth adding it to
  the ensured-gitignore list in `frontend/src/lib/file-system/gitignore.ts`
  if Direction C ships.
- **Wiki implications.** The wiki page already covers the dual-mode
  behavior accurately (see `frontend/src/app/wiki/integrations/telegram/page.tsx:127-151`).
  Direction A's bot-text rewrite means the wiki's "The bot's reply
  flow" section (line 210-221) needs a refresh to match the new
  copy verbatim, otherwise the wiki and the bot drift. Flag for
  the wiki manager. Direction B + C would each need a small
  "Tutorial" sub-section on the wiki page documenting the
  walkthrough. None of those are this proposal's job; wiki manager
  owns them.
- **No feature flag.** All three directions are safe to roll out as
  plain code changes. The bot-text changes are reversible by
  editing the strings back; the tutorial container is gated by
  `?tutorial=1` so it can't fire outside the welcome-modal flow;
  the `/tutorial` command is gated by being a typed slash command
  the user has to send themselves.

## What this proposal does NOT decide

These are intentionally left for Grant to confirm via the open
questions list below, or for implementation to make local calls on.

- Exact wording of the bot-text rewrites. The drafts above are
  first-pass; a wiki-voice pass should follow once the system is
  wired.
- Whether the tutorial container's success card should include a
  "Switch to your real tab" button (browser allows tab focus only
  for tabs that JS opened, since the demo tab was opened by the
  welcome modal so it could focus the opener back, but cross-window
  tab focus is best-effort).
- Exact polling cadence for the `_telegram_tutorial.json` sidecar
  if Direction C ships. Probably the same 5s rhythm the orchestrator
  already uses for tip rolls.
- Whether the `/tutorial` command should also work for users who
  haven't even paired yet (it could reply with the pairing-walk-
  through link). Current draft assumes paired-only; unpaired users
  get a "pair first" reply.
- Whether the existing `telegram-send-to-task` tip should be split
  into two tips (one pointing at the pill, one pointing at the
  inbox badge) once the inbox half of the story is being told. For
  now, single tip with both halves in the body is enough.

---

## Decision log (locked 2026-05-15)

Grant locked the design surface via the tip manager's clickable
review pass. Implementation bot treats this section as canonical;
where this conflicts with the recommendations earlier in the
proposal, this section wins.

- **Direction scope: A + B + C, full build.** Ship the bot-copy
  rewrite (A), the interactive tutorial container (B), AND the
  bot-aware tutorial mode + `/tutorial` command (C). Single
  implementation pass.
- **Demo-vs-real-folder routing during the walkthrough: Path B.**
  The first-photo step in B fires the user's REAL Telegram bot
  (the only one paired). Photo lands in the real folder via the
  normal inbox / auto-attach flow. Demo tab listens for the
  arrival via a cross-tab signal (BroadcastChannel preferred,
  sessionStorage fallback) and renders a "Got your photo, head
  back to your real folder to see it" confirmation card before
  advancing the tour to the next tip.
- **Em-dash style: find-and-replace applied.** This proposal gets
  swept clean by a parallel sub-bot that also handles the 3 older
  root-level proposals. New prose anywhere in ResearchOS follows
  the no-em-dash rule (commas, colons, parens, period splits).
  Memory item `feedback_no_em_dashes.md` codifies for future
  sessions.
- **Defaults locked from the open-questions list** (Grant did not
  override; tip manager kept the proposal's recommendations):
  - First-photo walkthrough home: sequencer-only (no separate
    post-pairing standalone modal). Direction A's bot-copy rewrite
    already covers tutorial-skippers.
  - Bot-aware mechanism (for C): per-user sidecar
    `users/<u>/_telegram_tutorial.json` (mirrors `_telegram.json`
    pattern). Polling tab reads this on each `routeTelegramMessage`
    invocation and adapts behavior.
  - `/tutorial` command: ship as part of C. Texts from the user
    that match `/tutorial` re-trigger the welcome modal in the
    user's open ResearchOS tab via a cross-tab broadcast (or, if
    no tab is open, the bot replies "Open ResearchOS in your
    browser, then text /tutorial again").
  - Tip body length: short variant. Captions stay in the bot's
    per-photo reply. Tip is for discovery, not full reference.
  - Pairing-modal already-paired copy: gets the full dual-mode
    explainer too.

## Open questions (for Grant)

These are the design choices that block implementation. Framed
AskUserQuestion-style so the tip manager can transcribe them into
clickable popups.

1. **Direction scope.** Ship A only, A+B, A+B+C, or A+C (skip the
   tutorial container)? **Default recommendation: A only for v1,
   then A+B as a Phase 2 once A's UX impact is observed.**
2. **First-photo walkthrough home.** If B ships, is it sequencer-
   only (during the welcome-modal "Walk me through it" flow), or
   also a standalone modal that fires post-pairing for users who
   skipped the welcome modal? **Default: sequencer-only.**
3. **Demo-vs-real-folder routing during the walkthrough.** Path A
   (photo lands in demo lab; implausible, photos lost on tab
   close), Path B (photo lands in real folder, demo tab shows a
   "got it!" notice), or Path C (photo lands in real folder, demo
   tab fakes a thumbnail on the demo experiment's image strip)?
   **Default: Path B.**
4. **Bot-aware tutorial mechanism.** If C ships, sidecar
   (`_telegram_tutorial.json`), `localStorage` flag with cross-tab
   `storage` event, or have the tutorial tab take over polling?
   **Default: sidecar.**
5. **`/tutorial` command.** Ship as part of C? Defer? Ship as a
   standalone Phase 3 (after A + B land)? **Default: defer until
   evidence of need.**
6. **Tip body length tradeoff.** The proposed updated tip body
   ("With an experiment open it auto-attaches; without one it
   lands in your Inbox") is shorter than the original but loses
   the caption-reply mention. Should the tip mention captions, or
   leave that to the bot's per-photo reply? **Default: leave
   captions to the bot's per-photo reply; the tip is about
   discovery, not full reference.**
7. **Pairing-modal already-paired copy.** Should the
   "alreadyPaired" state in `TelegramPairingModal.tsx:180-217` get
   the same dual-mode explainer the new `/start` reply does, or
   stay as the active-experiment-only one-liner? **Default: full
   dual-mode explainer in the modal too.**

// tip manager (planning sub-bot)
