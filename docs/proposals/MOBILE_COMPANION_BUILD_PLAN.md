# Mobile companion v0 build plan

Status: BUILD PLAN, needs Grant sign-off on the open decisions, then scaffold. No app code yet.
Author: orchestrator (master bot).
Date: 2026-06-07.
Builds on `MOBILE_COMPANION.md` (the scoped design + the 5 locked decisions). Inventory v1 (the barcode-reorder dependency) is now done, which unblocks this.

## Goal

Get a thin Expo companion onto Grant's iPhone fast (v0 = proof), then grow it to v1 (the real companion on the Cloudflare DO backend). v0 is deliberately tiny: it proves the hard parts (identity pairing + a capture that reaches the laptop) so the rest is incremental.

## The reality check up front (verification)

Most of this CANNOT be orchestrator-verified. A mobile app needs a simulator or a real device, and TestFlight needs the Apple account. So the working model is build-then-Grant-tests-on-his-phone, the same shape as the collab work that needed two browsers. I will lean on Expo Go (the free Expo client app) so Grant can run a build on his own iPhone over wifi during dev WITHOUT the $99 account or a TestFlight build. The account + TestFlight only become necessary to ship to others.

## Open decisions (need Grant before scaffolding)

### D1. Where the app lives
- Option A, a `mobile/` workspace in this repo (RECOMMENDED). The Expo app sits beside `frontend/`, sharing pure TypeScript (the capture/inbox shapes, the identity types, maybe the count-first inventory helpers) via relative imports or a small shared package. One repo, one place, easiest to keep types in lockstep. Caveat, Expo's Metro bundler + Next's build are separate toolchains in one repo, manageable but needs care so they do not fight over config.
- Option B, a separate repo. Cleaner toolchain isolation, but TS types drift and it is a second thing to manage.
- Recommendation, Option A (`mobile/`), with a tiny `shared/` of pure types both can import.

### D2. The v0 capture sync path (the one real wrinkle)
The proposal said "piggyback Telegram for v0." On closer look that has an auth wrinkle, the phone would have to post to the user's own Telegram bot as the user, which means handing the app the bot token. Two cleaner choices:
- Option A, a tiny dedicated capture endpoint NOW (RECOMMENDED). Stand up one small Cloudflare Worker + R2 "capture inbox" the phone uploads to (authenticated by the user's Ed25519 identity, the same signature the collab DO already verifies). The desktop polls/drains it into the folder, exactly like the Telegram inbox does today. This is a slice of the v1 DO backend, built small now, so v0 is not throwaway. It sidesteps the Telegram-token problem entirely.
- Option B, true Telegram piggyback. The app sends to the user's bot. Reuses zero new backend but needs the bot token on the phone (a real secret-handling problem) and feels like a hack.
- Recommendation, Option A. It is barely more work than the Telegram hack, has no secret-on-phone problem, and is a real step toward v1 rather than throwaway scaffolding.

### D3. Apple account timing
- The $99/yr LLC enrollment is only needed for TestFlight / App Store. For v0 dev on Grant's own phone via Expo Go, it is NOT needed. Recommendation, defer the purchase until v0 works and we want it on TestFlight. (Matches the cost research, the account is the only real dollar cost and there is no reason to spend it before the app does anything.)

## v0 chunks (the fast proof)

Each chunk is independently runnable in Expo Go on Grant's phone.

- Chunk 0, scaffold. A `mobile/` Expo (TypeScript) app, expo-router for navigation, the BeakerBot brand palette (reuse the `brand/` tokens), a tab or two of empty shell. Gate, it boots in Expo Go on Grant's iPhone over wifi.
- Chunk 1, identity pairing. Desktop shows a QR encoding a one-time, identity-signed pairing grant. The phone scans it (expo-camera), enrolls a device passkey / stores the granted key in the secure enclave (expo-secure-store), and can thereafter sign its own uploads. Reuses the shipped WebAuthn/identity work conceptually. This is the hardest v0 piece, do it second so the scaffold is proven first.
- Chunk 2, bench capture. expo-camera to snap a photo, queue it locally (offline-tolerant), and upload to the capture inbox (D2) signed by the paired identity. The desktop drains it into `users/<u>/inbox/Images/`, so it shows up in the existing inbox UI with zero desktop changes. This is the heart of v0.
- Chunk 3, today glance (if cheap). A read-only list of today's tasks pulled from the same capture backend or a thin read endpoint. Optional for v0, can slip to v1.

## v1 outline (after the D1/D2/D3 platform settles + migration chunk 3)

Not built now, listed so v0 aims the right way. First-party capture inbox on the full DO+R2 backend, push notifications (Expo push over APNs+FCM, free), lab timers with push, today/calendar glance, and the barcode-driven reorder that ties into the inventory we just built. Read-only in v1; mutation is v2.

## What v0 does NOT include
Push notifications, timers, the barcode/inventory surface, offline-first whole-folder sync, Android testing on a physical device (the emulator covers dev). All v1+.

## Recommended first move
Lock D1 (mobile/ workspace), D2 (small capture Worker now), D3 (defer the Apple purchase), then I scaffold Chunk 0 and get it booting in Expo Go on your phone. Chunk 0 is low-risk and gives you something to hold this week.
