# Handoff: notifications + companion push lane (2026-06-13)

The full offline-notification system went from idea to deployed-and-verified this
session. This doc is the inheritor briefing: what shipped, what is deployed, what
is verified versus not, how to test it, and the one thing left to witness.

House voice for anything added here and in the product: no em-dashes, no emojis,
no mid-sentence colons. State the why.

Memory: `[[project_notification_preferences]]`. Designs:
`docs/proposals/2026-06-12-phone-push-notifications.md` (P1) and
`docs/proposals/2026-06-13-phone-push-p2-and-sender-email.md` (P2 / 2.5 / P3).
Test guide: `docs/testing/2026-06-13-notification-push-test-guide.md`.

## The lane in one paragraph

Per-category notification routing (bell / laptop pop-up / companion phone / email)
shipped earlier in phases 1-3. This session built the four offline-delivery
phases on top, deployed the relay, set up FCM, and verified everything except the
literal on-device push. The whole thing stays end-to-end encrypted: a push payload
is generic and content-free, and it wakes the companion to fetch + locally decrypt
the sealed snapshot it already reads (wake-and-fetch). Phone push is free (Expo
Push Service to APNs/FCM); the only cost lever is email (Resend). Phone + email are
account-only by design, which is both the solo opt-out and an acquisition funnel.

## Delivery model (the non-obvious part, read before touching)

- **P1 (laptop-open buzz).** The `NotificationDesktopWatcher` already new-detects
  notifications and runs `pushChannelsForNotification` (quiet hours + per-category
  toggle + account gate). On a new phone-routed notification it publishes the
  fresh sealed snapshot, then POSTs the paired devices' Expo tokens to
  `frontend/src/app/api/send-push/route.ts`. This path does NOT need the relay
  config (it reads local prefs + posts to the Vercel route), so it is the simplest
  way to make the phone buzz.
- **P2 (laptop-closed cross-user buzz) is SENDER-TRIGGERED.** The relay sees no
  cross-user event stream, so the online sender drives it. New relay routes on the
  `CaptureInbox` DO: `POST /capture/notify-config` (the recipient's laptop mirrors
  its routing matrix + quiet hours + tz offset so the relay can run the recipient's
  gate server-side) and `POST /capture/notify-recipient` (sender-signed; relay runs
  the recipient's gate, seals a generic content-free snapshot to each recipient
  device X25519 key into a `notifications-pending` R2 lane, sends a generic Expo
  push, coarse per-DO cooldown). The worker's `sealToRecipient` is a byte-for-byte
  port of the frontend seal, proven by a round-trip test through the real
  `openSealed`.
- **Phase 2.5 (sender-triggered email)** rides the SAME `notify-recipient` route:
  the handler evaluates both phone and email channels; when email is routed and the
  recipient email is synced it sends a generic mail to the recipient's OWN address
  via the existing Vercel `/api/notify-email` (Resend), using `APP_BASE_URL`.
- **P3a (shift_alert)** is not scheduled; the shifter is online, so
  `recordShiftAlerts` (local-api.ts) collects each shifted task's shared_with set
  (minus the shifter) and fires `notify-recipient` per recipient.
- **P3b (scheduled calendar reminders)** is the one true scheduled path. The laptop
  pre-registers upcoming due times (content-free id + fire_at) via
  `POST /capture/register-reminders`; the `CaptureInbox` DO arms an alarm and fires
  due ones while offline. A DEAD-MAN'S-SWITCH stands the alarm down while the laptop
  is online (so the laptop + P1 handle it, no double-buzz). Delivery reuses the
  shared `deliverToRecipient`, so P2 / 2.5 / P3b share one seal + push + email path.

## What shipped (all on local main; Grant pushes when he wants)

Core push + triggers + email:
- P1: merge `d233b6dd3` (send-push route, push_token column, device-signed
  `/capture/devices/push-token`, mobile push-token.ts, tap-to-open).
- P2 capability + seal + round-trip test: merge `d2cec30c7`.
- All P2 triggers (sendShare, sendRawShare, 4 lab actions in pi-actions.ts) +
  phase 2.5 email: merge `7f026df03`.
- P3a shift_alert: merge `17026f1bc`. P3b reminder alarm: merge `af8c98487`.
- Pre-deploy 404 silenced (notify-config/register-reminders treat 404 as
  not-yet-deployed): `16b26c37c`.

Test system:
- `relay/scripts/smoke-notify.mjs` + env-tunable timing (NOTIFY_COOLDOWN_MS /
  REMINDER_STALE_MS): merge `ceb1c64f9`. One-command `npm run test:notify`
  (`scripts/smoke-notify-local.sh`): merge `6082a8f82`. Manual push tool
  `relay/scripts/fire-notify.mjs <pubkey> [category]`.

Demo-sync fix (was blocking the device test):
- `c2a89889e`. Two root causes fixed: the demo/wiki-capture branch in
  `providers.tsx` omitted the relay headless block (so the publisher never
  mounted), and the publisher's run-lock/throttle were component refs stamped
  before the async identity load (so a demo remount wedged it). Plus the demo
  sidecar now persists to localStorage so the dev identity survives a refresh
  (it was re-minting, orphaning the relay binding).

Companion + notification UX:
- Companion toggles mirrored into main Settings: merge `bb40f0d46`.
- Pairing-bar freshness (Live / Last synced) + tap-to-Sync-now: merge `c99922d36`;
  single-cue consolidation (ConnectionBanner + ConnectionStatusChip removed,
  offline folded in): `eb8e40287`.
- Phone notification routing mirrored into the Companion Settings tab (Advanced
  disclosure): merge `090609522`.
- Companion account-gate conversion screen (6 capabilities, dev buttons demoted):
  merge `1a07c124c`. Mockup: `docs/mockups/2026-06-13-companion-connect-conversion.html`.
- Permanent "Send a test notification" button in Settings -> Notifications (all
  users, fires through the real configured channels): merge `5ba511e72`.

(Unrelated same-session work: About-page journey rail, coffee-animation removal,
welcome-footer link fixes. Not part of this lane.)

## Deployed + credentials state

- **Relay DEPLOYED to prod** (Grant ran `npm run deploy` in relay/; `wrangler` is
  not global, use `npm run deploy` / `npx wrangler deploy`). Confirmed live:
  `researchos-collab-relay.gnick317.workers.dev` returns 405 (not 404) on GET to
  the new POST-only routes. The new SQLite tables/columns self-create in the DO
  constructor (no wrangler migration needed; no new DO class).
- **FCM V1 credentials uploaded to Expo** via `eas credentials` (Android ->
  production -> Google Service Account -> FCM V1). Firebase project
  `researchos-d22c4`, package `app.researchos.companion`.
  `mobile/google-services.json` is committed-able (public client ids); the
  service-account PRIVATE key lives in `~/Documents/ResearchOS_LLC/` (gitignored
  pattern in mobile/.gitignore).
- **EAS Android dev build** built + installed on Grant's Samsung + paired. A dev
  build is required for remote push (Expo Go cannot receive it); it loads JS from
  Metro (`npx expo start --dev-client`, use `--tunnel` if the phone cannot reach
  the Mac on the LAN).
- `mobile/app.json` now has the `expo-notifications` plugin + `android.googleServicesFile`.

## Verification scorecard

| Layer | Status |
| --- | --- |
| Relay logic (seal, gate, quiet hours, cooldown, DO reminder alarm) | VERIFIED, `npm run test:notify` 10/10 against a local wrangler-dev relay |
| Worker seal == phone openSealed | VERIFIED, round-trip unit test |
| Laptop desktop pop-up | VERIFIED, Claude-in-Chrome test (permission + dev/test button + bell badge) |
| Email delivery | VERIFIED, POST to prod /api/notify-email landed in the Inbox, branded, from support@research-os.app |
| Real phone OS buzz (Expo -> FCM -> device) | NOT YET WITNESSED. This is the only open verification. |

Why the phone buzz was never seen: every manual `fire-notify` returned
`reason: "no config"` because the demo session never synced the recipient config
to the relay (the demo-sync bug, now fixed), and the harness sends to a placeholder
token by design. So a real push was never actually sent to the device. The
demo-sync fix removes that blocker.

## How to test (4 layers; only the last needs a phone)

- **Layer 1 (automated relay):** `cd relay && npm run test:notify` -> expect
  `ALL PASS: 10 passed`. Proves the whole relay core incl the DO alarm.
- **Layer 2 (laptop pop-up, Chrome):** prompt in the test guide.
- **Layer 3 (email):** `curl -X POST https://research-os.app/api/notify-email
  -H 'Content-Type: application/json' -d '{"to":"<addr>","title":"...","body":"..."}'`
  (prod has RESEND_API_KEY + SHARING_ENABLED). Done; landed in inbox.
- **Layer 4 (device):** out of demo or on a real folder, pair the phone + allow
  notifications, then Settings -> Notifications -> "Send test" (P1 path), OR fire
  `relay/scripts/fire-notify.mjs <recipientPubkeyHex> shared` at the relay (now
  that config syncs). Read the recipient pubkey from the browser IndexedDB
  (`researchos-sharing-identity` -> `identity` -> `self` -> keys.signing.publicKey,
  hex).

## Open items

1. **Witness the phone buzz (the close).** Reload :3000 to pick up the demo-sync
   fix + the Send-test button, confirm paired + Reminders->Phone on, click
   "Send test." With the publisher now posting config and the identity stable,
   a real push should land. This is the last green.
2. **Pricing brainstorm (decision, not built).** Grant wants to drop the free
   cloud pool from 5GB to ~1GB + throttle, and add cheap paid tiers (1-2 dollars)
   billed annually/semi-annually so Stripe per-charge fees do not eat them (a
   1 dollar monthly charge loses ~33% to fees; 12 dollars/year loses ~5%). Phone
   push is free, email is the only cost (Resend free to ~3k/mo). The analysis +
   numbers belong in `~/Documents/ResearchOS_LLC/` (sensitive, not the public
   repo); the tunables are `frontend/src/lib/pricing/assumptions.ts` placeholders;
   customer copy is `docs/branding/BILLING_FACTS.md`. Offered to draft the LLC
   analysis; awaiting Grant's go.
3. **Email footer CAN-SPAM address.** The notification email footer reads
   "University of Wisconsin-Madison" as the physical address; CAN-SPAM wants the
   ResearchOS LLC mailing address (UW is the funder, not the merchant). Flagged,
   not yet fixed.
4. **Remaining push phases (optional).** P3b's laptop-side reminder pre-register
   could be smarter; the cost circuit breaker could gate email sends as a runaway
   guard. Neither is required.

## Gotchas for whoever continues

- **The seal is duplicated in three places and must stay byte-identical:**
  `frontend/.../sharing/encryption.ts`, `relay/src/worker.ts` (sealToRecipient),
  and the smoke scripts. Construction: epk(32) || nonce(24) ||
  XChaCha20-Poly1305(HKDF-SHA256(ECDH, salt=epk||rpk, info="researchos.sharing.seal.v1")).
  The round-trip test (`relay-seal-format.test.ts`) is the guard.
- **Relay timing is env-tunable for tests only:** NOTIFY_COOLDOWN_MS (default 30s)
  and REMINDER_STALE_MS (default 3min) read from env via cooldownMs()/staleMs();
  prod constants apply when unset. The smoke runner sets them low.
- **Never type/paste into a running `wrangler dev` terminal** — its interactive
  hotkeys read stdin, and a stray key opens a public cloudflared tunnel (spams
  tunnel/SIGTERM errors; the local server is fine). The one-command runner detaches
  stdin to avoid it.
- **The recipient pubkey is the relay routing key** = `encodePublicKey(signing
  .publicKey)` hex = the `?u=` the laptop uses + the IndexedDB self identity. Read
  it from the browser when you need to fire a manual push.
- **Demo mode WAS hostile to this lane** (publisher unmounted, identity re-minted
  on refresh); `c2a89889e` fixed both. If demo companion behavior regresses, that
  is the commit to check.
- Shared main checkout: build in worktrees, merge clean, never git add -A, commit
  immediately after a --no-commit merge and grep the staged set for foreign bleed.

## Where to start

Reload :3000 and click "Send test" (Settings -> Notifications). If the Samsung
buzzes, the lane is fully closed. If not, capture the console `/api/send-push`
line and fall back to firing `fire-notify.mjs` at the relay.

Notifications / companion-push lane
