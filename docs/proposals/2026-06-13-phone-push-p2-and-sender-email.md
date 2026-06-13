# Phone push P2 + sender-triggered email (laptop-closed cross-user reach)

Status: design, not built. Author: orchestrator (notifications lane), 2026-06-13.
Continues `docs/proposals/2026-06-12-phone-push-notifications.md` (P1 is built and
on origin). House voice: no em-dashes, no emojis, no mid-sentence colons.

## The goal

Today a phone buzz (P1) and the email channel both fire only from the recipient's
OWN open tab. So if Alex shares a task with Bao, or a lab head flags Bao's result,
and Bao's laptop is closed, nothing reaches Bao until the laptop comes back. P2
(phone) and phase 2.5 (email) close that gap for the cross-user events that
warrant it, without giving up the end-to-end-encrypted posture.

## What the code map established

- Every cross-user notification is synthesized on the RECIPIENT's own laptop
  (it appends to `users/<recipient>/_notifications.json` when the recipient's
  laptop scans shares / runs the lab action). The relay has no server-side
  notification writer and sees no cross-user event stream.
- The relay already stores, per user identity pubkey, that user's bound devices
  with their X25519 seal key and (since P1) their Expo `push_token`, in the
  `CaptureInbox` Durable Object keyed by `idFromName(userPubkey)`.
- Durable-Object-to-Durable-Object addressing already exists in the worker
  (`fetchRoster` reaches the lab record DO), so a handler CAN address a
  recipient's `CaptureInbox` given that recipient's identity pubkey.
- The sender already looks up the recipient's identity + X25519 public keys from
  the directory when sealing a share, so the SENDER holds the recipient pubkey.
- The phone reads the sealed `notifications` snapshot from a fixed R2 key
  (`<u>/snap/<device>/notifications`) and unseals it with the device X25519 key.

## The model: sender-triggered, not relay-detected

The relay never needs to watch for events. The SENDER drives it, because the
sender is online at the moment of the cross-user action and already holds the
recipient's identity pubkey:

1. The sender does the action (share / assign / flag / announce). Its laptop
   still writes the recipient's local notification exactly as today (unchanged).
2. The sender ALSO calls a new relay route, "notify recipient", passing the
   recipient's identity pubkey + a coarse category (shared / lab / comments /
   purchases / reminders) + the already-sealed event content for the recipient.
3. The relay addresses the recipient's `CaptureInbox` DO, reads that user's
   per-category routing + quiet-hours gate (see Decision A), and if the category
   is phone-routed and not quiet, seals the event into the recipient's snapshot
   and sends a generic, content-free Expo push to the recipient's device tokens.

This reaches the recipient whether their laptop is open or closed, because the
sender (not the recipient) is the one online and talking to the relay. It is the
same shape phase 2.5 email needs (the relay sends to the recipient's stored email
instead of a push), so both ride one new "notify recipient" capability.

The hard P1 rules carry over unchanged: the push payload to Expo/APNs/FCM is
generic and content-free; the real text lives only in the snapshot sealed to the
recipient's device (which the relay seals but cannot read, since it is encrypted
to the device key). The gate (per-category phone toggle + quiet hours) must hold.

## The three decisions that change the architecture

### Decision A: how does the relay honor the recipient's gate?

The hard rule is "a category the user did not route to the phone must never
buzz, and quiet hours silence pushes." But the recipient's routing matrix +
quiet hours live in the recipient's LOCAL settings, which the relay does not
have. Options:

- **A1 (recommended): sync the gate to the relay.** The recipient's laptop
  publishes its notification ROUTING CONFIG (the 5x4 channel matrix + quiet
  hours + which categories are phone/email enabled) to its own `CaptureInbox`
  DO, the same way it already publishes snapshots. This carries NO research
  content, only channel toggles and a time window, so it is safe to store. The
  relay then runs the existing `pushChannelsForNotification` gate server-side
  (ported to the worker). DATA-SHAPE: a new `notify_config` row on the DO + the
  laptop publishing it on settings change and on the snapshot cadence.
- **A2: gate only by account + leave fine routing to the device.** The relay
  pushes for any cross-user event to any account device, and the phone applies
  the per-category filter on receipt (it already has the snapshot list filter).
  Simpler, but it buzzes for categories the user muted (the push fires before
  the device can filter), which violates the rule. Not recommended.

### Decision B: snapshot collision (relay vs laptop both publish)

The recipient's laptop owns the full `notifications` snapshot at the fixed R2
key. If the relay writes the same key, the two clobber each other (and the relay
cannot merge, since the existing blob is sealed to the device, not the relay).
Options:

- **B1 (recommended): a separate relay-owned "pending" snapshot.** The relay
  publishes to `notifications-pending`; the phone fetches both and merges
  (dedup by id), and the laptop clears pending entries once it has synthesized
  them into its own list. No clobbering, the laptop stays the source of truth.
- **B2: relay replaces the main snapshot with just the new event.** Simplest,
  but the phone briefly shows only the one event until the laptop republishes
  the full list. Loses the existing list during the offline window.

### Decision C: who composes the event text the phone shows?

The push payload is always generic. But the SEALED snapshot the phone unseals
can carry real text (sender name, item name), since only the recipient's device
opens it. Options:

- **C1 (recommended): the relay synthesizes a generic per-category line**
  ("A new item was shared with you", "Your lab head flagged a result"). No
  sender-controlled text reaches the recipient's device, which is safest for
  cross-lab and external shares. The recipient's laptop fills in the real
  details when it next syncs.
- **C2: the sender passes the sealed detail text.** Richer (the phone shows the
  actual item name immediately), fine inside a trusted lab, but lets the sender
  put arbitrary text on the recipient's screen. More surface to abuse.

## Scope of events for the first cut

Recommended starting subset, highest value and clearest "warrants a buzz":
shared-and-assigned (`task_shared`, `method_shared`, `project_shared`,
`lab_task_assignment`, `lab_flag_for_review`) and lab announcements. Comments and
purchases can follow once the path is proven. Every trigger is additive at the
existing sender-side call sites (`addReceiverShare`, `assignTask`,
`setFlagForReview`, `dispatchAnnouncementNotifications`).

## Build outline (after the decisions land)

1. Relay: port `sealToRecipient` (X25519 sealed box, @noble already present) into
   the worker; add `notify_config` storage (Decision A1) + a `notifications-pending`
   snapshot lane (Decision B1).
2. Relay: new device-or-user-signed route `POST /capture/notify-recipient` that
   addresses the recipient `CaptureInbox` by pubkey (DO-to-DO), runs the gate,
   seals the pending snapshot per device, and sends the generic push.
3. Web: recipient laptop publishes `notify_config` (the routing matrix + quiet
   hours) on settings change + on the publisher cadence.
4. Web: each sender-side cross-user action also calls `notify-recipient` with the
   recipient pubkey + category (fire-and-forget, never blocks the action).
5. Mobile: `fetchNotificationsSnapshot` merges `notifications` + `notifications-pending`.
6. Phase 2.5 email rides the same route with channel "email" (needs the recipient
   email synced too, same non-sensitive config sync as Decision A1).

## What this is not

Not a server-side re-derivation of the recipient's local data (the relay only
ever forwards what the sender supplies + the recipient's own synced routing
config). Not a change to the synced-list default. The account-only gating is
unchanged.

## P3: scheduled buzz (the two reminders-category types)

The `reminders` category has two sources, and they split:

- **`shift_alert` (a shared task moved): BUILT as P3a 2026-06-13** (commit
  64a16b1c5). NOT scheduled at all, it has an ONLINE actor (the shifter).
  `recordShiftAlerts` already runs on the shifter's laptop at shift time; it now
  also collects the set of users each shifted task is shared with (minus the
  shifter) and fires the existing P2 `notify-recipient` route per recipient with
  category `reminders` (resolving each recipient's Ed25519 from their
  `_sharing_identity.json` sidecar). No relay change. Fire-and-forget.

- **`event_reminder` (a calendar reminder is due): the true scheduled case,
  P3b, designed below, not yet built.** Calendar reminders are computed purely on
  the recipient's OWN laptop (`use-event-reminders.ts` walks local events + ICS
  feeds + the lead-time pref and queues setTimeouts; the tab must be open). There
  is no online actor and the server has no view of the user's calendar, so the
  only E2E-preserving mechanism is: the laptop PRE-REGISTERS upcoming due times,
  and a server scheduler fires the ones that come due while the laptop is closed.

### P3b mechanism (recommended, smallest viable)

1. The laptop, when it computes upcoming reminders (the existing 24h horizon),
   publishes a CONTENT-FREE schedule to the relay over a new user-signed
   `POST /capture/register-reminders`: a capped list of `{ id, fireAt }` (an
   opaque id + a timestamp, no event name). It republishes the full upcoming set
   each cadence (REPLACE, not append) and stamps `remindersRegisteredAt = now`.
2. The `CaptureInbox` DO sets a single Durable Object alarm (the same
   `state.storage.setAlarm` pattern CollabRoom uses for backups) to the NEAREST
   future `fireAt`. On `alarm()` it finds due entries, delivers, deletes them, and
   reschedules to the next-nearest. One alarm per DO, rescheduled forward.
3. Delivery reuses the P2/2.5 path (the recipient's own `reminders` gate + quiet
   hours, seal a generic content-free pending snapshot, generic push, + email if
   routed). Refactor the post-gate body of `handleNotifyRecipient` into a shared
   `deliverToRecipient(category)` the alarm also calls.

### The one real P3b decision: avoiding a double-buzz

When the laptop is OPEN it fires the reminder locally and the P1 watcher already
buzzes the phone; if the relay alarm ALSO fired, the phone would buzz twice.
Resolution = a DEAD-MAN'S SWITCH: the alarm delivers a reminder only when
`remindersRegisteredAt` is STALE (the laptop has not re-registered in ~3 min, so
it has gone offline). Laptop online -> laptop + P1 handle it, alarm stands down;
laptop offline -> alarm delivers. Cost: a reminder coming due in the ~3 min window
right after the laptop closes fires via neither path until the laptop reopens (it
is still in the synced list). That tradeoff is the thing to confirm before build.

### Why P3b is held

P3b is the one piece that adds NEW server infra (a DO alarm + a registration sync
surface) that cannot be orchestrator-verified without a live relay / miniflare,
and the whole lane is already inert pending the relay redeploy + EAS dev build. So
it is designed here and held for an explicit go, ideally after the already-built
P1 / P2 / phase-2.5 / P3a are device-verified.
