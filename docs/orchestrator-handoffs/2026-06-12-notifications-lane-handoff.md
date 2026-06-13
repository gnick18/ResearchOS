# Handoff: notification-preferences lane (2026-06-12)

What this lane built, where it stands, and the two pieces left to build. Everything
below is on `origin/main` (pushed). Gate-verified (tsc 0, unit tests green); the
mobile + solo-settings pieces still want a human browser/device pass.

House voice for anything you add here and in the product: no em-dashes, no
emojis, no mid-sentence colons. State the WHY.

---

## The feature in one paragraph

Per-notification-type routing to channels. A user maps each notification CATEGORY
(shared, comments, lab, purchases, reminders) to any combination of CHANNELS
(in-app bell, laptop desktop pop-up, email, companion phone), with quiet hours.
The bell always collects; laptop / email / phone are the opt-in push channels.
Email and phone are account-tier only (a solo user never gets them, that is the
solo opt-out by design). Shipped in three phases plus three follow-ups.

Memory: `[[project_notification_preferences]]`. Backlog: AGENTS.md section 8,
"Queued, not in flight".

---

## What shipped (commits, all on origin/main)

| Commit | What |
| --- | --- |
| `9f21461f2` | Phase 1a. Data model + routing resolver. `frontend/src/lib/notifications/preferences.ts` (5 categories x 4 channels, `pushChannelsForNotification` resolver, quiet hours, `normalizeNotificationPreferences`). 10 unit tests. Additive optional `notificationPreferences` field on `UserSettings` with `normalize()` repair. |
| `5dde2d9d7` | Phase 1b. The Settings panel. `frontend/src/components/settings/sections/NotificationsSection.tsx` (the matrix, where-to-reach rows, quiet hours, solo-gating of phone/email rows with an upsell). Registered in `settings/page.tsx`. |
| `4d81fbe30` | Phase 1c. Laptop desktop pop-ups. `frontend/src/components/NotificationDesktopWatcher.tsx`, a headless watcher mounted in AppShell that turns a NEW notification into a browser Notification, gated on prefs + quiet hours + granted permission. Seeds its seen-set on first read so a fresh load never blasts a backlog. |
| `2f4d7fd27` | Phase 2. Email channel. `lib/notifications/notification-mailer.ts` + `app/api/notify-email/route.ts` (mirrors invite-mailer + invite-email route, Resend, `SHARING_ENABLED` guard + invite rate-limiter). The watcher fires it when an email-routed notification lands. |
| `650339ccf` | Phase 3 publish side. `frontend/src/lib/mobile-relay/notifications-snapshot.ts` (`publishNotificationsToAllDevices` + `buildNotificationsSnapshot`, mirrors `publishInventoryToAllDevices`), wired into `TodaySnapshotPublisher` under the `autoPublishSnapshotsToPhones` kill switch. Extracted the shared title/body builder to `lib/notifications/display.ts`. 4 unit tests. |
| `1c40a7608` | Phase 3 display side (companion app). `mobile/lib/snapshots.ts` `fetchNotificationsSnapshot` + types, a demo fixture, the new `mobile/app/notifications.tsx` screen, and a bell in the Notebook header that opens it. |
| `677696481` | Follow-up. Unread bell badge. `mobile/lib/unread-notifications.ts` (`useUnreadNotificationCount`) + a coral count badge on the Notebook header bell. |
| `e44c2b550` | Follow-up. Solo-settings audit. `settings/page.tsx` hides the Usage & billing group for solo users (`status !== "ready"`); new `AccountBenefitsUpsell.tsx` gentle "add a free account" section in the You group. |
| `133675589` | Follow-up. Web-push proposal doc, `docs/proposals/2026-06-12-phone-push-notifications.md`. |
| `2b0162bb9` | AGENTS.md backlog entry for the two unbuilt halves. |

---

## The delivery model (the part that is NOT obvious from the code)

Read this before touching anything, it is the whole design.

- **All channels fire from the recipient's OWN client while a tab is open.** The
  watcher polls (30s + the `ros-notifications-changed` event), and on a new
  notification it pops the laptop, mails the user's own address, and the phone
  snapshot republishes. "Reach me while fully offline" (sender-triggered) is the
  deferred phase 2.5 / push P2 work below.
- **Email** = the recipient mails their OWN address (set in Settings, account
  users only). Reuses `SHARING_ENABLED` + the invite rate-limiter. No email
  verification yet, which is safe because it only ever sends to the user's own
  stored address and is length-capped + rate-limited.
- **Phone is a SYNCED LIST, not an OS push buzz.** The companion has no service
  worker / web-push, it POLLS the relay. The laptop seals the phone-routed
  notifications into a `notifications` relay snapshot (same E2E seal-per-device
  model as today/inventory); the companion shows it on poll. The phone does NOT
  vibrate while the laptop is closed. Quiet hours do NOT blank the passive list
  (they silence active pop-ups, of which the phone has none).
- **The companion is a separate Expo surface** (`mobile/`, no route in
  `frontend/src/app`). It consumes relay snapshots via `mobile/lib/snapshots.ts`
  `fetchSnapshot(name)`. That is why phase 3 had two commits, one per surface.
- **Account-gating is free** via device pairing: only account users have the
  device keys the snapshot is sealed to, so `publishNotificationsToAllDevices`
  no-ops for solo users with no paired device.

---

## What is LEFT to build (Grant wants these done, not parked)

Both are in AGENTS.md section 8 and `[[project_notification_preferences]]`.

### 1. Real phone push (a buzz, not the synced list)

Design doc: `docs/proposals/2026-06-12-phone-push-notifications.md`. The key
insight: a real push CAN stay end-to-end encrypted via wake-and-fetch. The push
payload carries only a generic content-free body ("New activity in your lab"),
which wakes the companion to fetch + locally decrypt the sealed snapshot it
already reads. The relay and Apple/Google never see lab content.

Phasing:
- **P1 (laptop-open buzz).** Register the Expo push token at pairing, add a
  "send push" endpoint, have the existing laptop publisher (`TodaySnapshotPublisher`)
  call it when it publishes a phone-routed notification. `expo-notifications` is
  already a dep (~0.32.17); the Expo Push Service is free. Mostly additive, proves
  the wake-and-fetch path end to end.
- **P2 (laptop-closed cross-user buzz).** The relay seals-and-publishes the
  recipient's snapshot and sends the push for cross-user events (a share, a lab
  head flag). CO-DESIGN with phase 2.5 email below, they need the same relay
  capability. This is the real infra lift.
- **P3 (scheduled buzz).** A scheduled task pushes due shift alerts + reminders,
  reusing the standing scheduled-role infrastructure.

Every push MUST run through the existing `pushChannelsForNotification` gate
(quiet hours + per-category phone toggle). A category the user did not route to
the phone must never buzz. The single most important correctness check: the push
payload must carry NO research content (generic body only).

### 2. Phase 2.5 sender-triggered email

True offline reach for email. Today email only fires from the recipient's own
open tab. The sender-triggered path hooks cross-user creation server-side, which
is the same relay capability as push P2, so design them together.

---

## Verification status

- **Gate-verified everywhere:** tsc 0 (web + mobile), all unit suites green
  (`preferences.test.ts` 10/10, `notifications-snapshot.test.ts` 4/4), web
  notification-section lint clean, icon-guard clean (no new inline SVG, the
  bell/badge use existing Ionicons / a CSS dot).
- **Needs a human browser pass (orchestrator could not):**
  - Solo-settings: switch the active user to a solo (no-account) folder on a
    running `:3000` and confirm the Usage & billing group is gone and the "Add a
    free account" section is present. NOT browser-verified here because starting a
    second dev server against the master `frontend/` corrupts Turbopack's cache
    under Grant's `:3000` (the no-concurrent-dev-server rule).
  - Companion: demo mode on the Expo app shows the three sample notification rows
    + the unread bell badge. The RN app cannot be driven from the orchestrator.

---

## Gotchas for whoever continues

- **Shared main checkout.** Sibling sessions commit to the same working tree.
  Never bare-commit (`git commit --only <explicit paths>`), never `git add -A`,
  never `git stash`, never commit during a sibling merge (check `.git/MERGE_HEAD`
  first). New untracked files must be `git add`ed before `--only` will pick them
  up.
- **`vitest` mock quirk.** vitest v4 attributes any error THROWN from a mock
  implementation as a test failure even when the production code catches it. Test
  the empty-result path (mockResolvedValue) instead of the throw path. See the
  comment in `notifications-snapshot.test.ts`.
- **The companion display is a separate surface.** Anything that changes the
  snapshot shape (`mobile-relay/notifications-snapshot.ts`) must be mirrored in the
  companion reader (`mobile/lib/snapshots.ts` + `mobile/app/notifications.tsx`).
  All snapshot fields are tolerated-missing on the phone so an older laptop shape
  never crashes the screen.
- **One source of truth for display text.** `lib/notifications/display.ts`
  `notificationDisplayText` is shared by the laptop pop-up, the email body, and
  the phone snapshot. Add new content-field fallbacks there, not per-channel.
- **Solo gating signal.** `useSharingIdentity().status === "ready"` is the
  has-an-account check. `NotificationsSection` and `DevicesSection` and now the
  settings page all gate on it, mirror that, do not invent a new signal.

---

## Where to start

Read `docs/proposals/2026-06-12-phone-push-notifications.md`, then build push P1
(laptop-open buzz) as the smallest useful slice that proves the wake-and-fetch
path. It is mostly additive and does not need the relay changes that P2 + phase
2.5 share. Confirm the generic-payload (no content leak) before anything else.
