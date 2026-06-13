# Testing the notification push lane (P1 / P2 / 2.5 / P3)

How to verify the offline-notification stack without (and eventually with) a real
phone. Built 2026-06-13. The lane is layered, and only the final OS buzz needs a
device, so most of it is verifiable today.

## Layer 1: relay integration harness (automatable, no phone, no email)

`relay/scripts/smoke-notify.mjs` (`npm run smoke:notify`) drives a local
`wrangler dev` CaptureInbox DO end to end as sender + laptop + phone, with real
crypto. It proves the parts that cannot be unit-tested:

- `notify-config` is accepted and the worker-side seal opens with the REAL
  `openSealed` the phone uses (no byte drift).
- the recipient gate is honored server-side: a muted category and quiet hours
  both return `reason: "gated"` with no seal.
- the cooldown drops a rapid second buzz.
- `register-reminders` stores the schedule AND the DO alarm actually fires a due
  reminder (the P3b path).

Run it:

```
cd relay
npx wrangler dev --port 8787 --var NOTIFY_COOLDOWN_MS:4000 --var REMINDER_STALE_MS:0
# in another shell:
BASE_URL=http://127.0.0.1:8787 npm run smoke:notify
```

The two `--var` overrides relax the 30s cooldown / 3-min dead-man's-switch so the
test does not have to wait (prod uses the real constants; the overrides are unset
there). Expected: `ALL PASS: 10 passed, 0 failed`. Verified passing 2026-06-13.

The ONE thing this cannot prove is the real OS buzz (Expo -> APNs/FCM -> a
device); it sends to a placeholder Expo token, which Expo accepts then drops.
Everything up to and including the sealed snapshot the phone fetches is real.

## Layer 2: laptop-open path in the browser (Claude-in-Chrome, you enable notifs)

This verifies the P1 desktop pop-up + the email fire-from-own-client path. It does
NOT exercise the phone buzz (a browser has no paired device token). Run it as a
self-contained Claude-in-Chrome prompt while the app is open on `:3000` or prod.

Prerequisites: an ACCOUNT user (email + phone channels are account-tier), a dev
notification email you can read (Layer 3), and Chrome notifications enabled for
the site.

Prompt to hand the Chrome agent:

> Open the ResearchOS app (already on a connected account folder). Go to Settings
> -> Notifications. (1) Click the control that requests desktop-notification
> permission and accept the Chrome prompt. (2) In the matrix, for the "Reminders &
> schedule changes" row, turn ON Laptop and Email. (3) In the email field, enter
> `<DEV_EMAIL>` and blur the field to save. Then find the dev-only "Send a test
> notification" button (bottom-left dev dock) and click it. ASSERT: a Chrome
> desktop notification appears within a few seconds. Report whether it appeared,
> its title/body text, and any console errors. Do NOT enter any real research
> data; this is a notification-pipeline test only.

Then check the dev inbox (Layer 3) for the email.

## Layer 3: dev email

Email fires from the recipient's own client (the watcher POSTs `/api/notify-email`)
to the address set in Settings -> Notifications. For a dev test:

- Set the notification email to a throwaway inbox you control (a Gmail `+tag`
  alias like `researchos.llc+notiftest@gmail.com`, or a Mailosaur/Resend test
  inbox). The relay/Vercel email path (phase 2.5) sends to that same stored
  address, so there is no way to mail an arbitrary third party.
- `/api/notify-email` needs `SHARING_ENABLED` + a `RESEND_API_KEY`. Prod has both,
  so test email on a preview/prod deploy, or set `RESEND_API_KEY` in a local
  `.env` to test on `:3000`. Without a key the POST is a no-op (no crash).
- Verify by reading the inbox (the Chrome agent can open Gmail and confirm a
  "ResearchOS" message arrived with the generic body).

## Layer 4: the real OS buzz (needs the EAS dev build + a phone)

The only un-fakeable part. After `wrangler deploy` (the relay routes/tables) and an
EAS companion dev build (remote push fails in Expo Go):

1. Pair the phone to the account (Settings -> Devices QR). Grant the OS
   notification permission on the phone when prompted (this registers the Expo
   push token via `mobile/lib/push-token.ts`).
2. Route a category to the phone in Settings -> Notifications.
3. Exercise each trigger and confirm the phone buzzes + tapping opens the
   notifications screen with the item:
   - P1 (laptop open): click the dev test-notification button.
   - P2 (laptop closed): from a SECOND account, share a note/experiment with you,
     or have a lab head flag/assign/announce; close your laptop first.
   - P3a: have someone shift a shared task whose dates you depend on.
   - P3b: create a calendar event with a near reminder, leave it ~5 min, close the
     laptop, and wait for the lead-time to pass.

## What is proven where

| Path | Layer 1 (smoke) | Layer 2 (Chrome) | Layer 4 (device) |
| --- | --- | --- | --- |
| seal == phone openSealed | yes | - | yes |
| recipient gate + quiet hours | yes | - | yes |
| cooldown | yes | - | - |
| DO reminder alarm fires | yes | - | yes |
| laptop desktop pop-up | - | yes | yes |
| email delivery | - | yes (with key) | yes |
| real OS push buzz | no (placeholder token) | no | yes |
