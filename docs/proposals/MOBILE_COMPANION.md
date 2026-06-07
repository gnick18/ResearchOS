# Mobile companion app

Status: DESIGN DRAFT, needs Grant sign-off. No code yet.
Author: orchestrator (master bot).
Date: 2026-06-07.
Related: `COLLAB_STORAGE_D1_DO_MIGRATION.md` (the backend this rides), `EXTERNAL_COLLAB_SHARING.md` (the DO access-control pattern reused for auth), `project_passkey_identity_unlock` (mobile login), the existing Telegram bench-capture path in `frontend/src/lib/telegram/`.

## The one-line pitch

A free, thin mobile companion to the desktop ResearchOS app. The laptop stays the main workspace. The phone does the handful of things a phone is genuinely better at, snap a photo at the bench and have it land in your inbox, get a push when something needs you, glance at today's tasks and calendar. Nothing more for v1.

## What this is NOT

This is deliberately narrow, so we say up front what it is not, the same way the cross-boundary docs do.

- NOT a port of the desktop app. The Gantt editor, the methods builder, the sequence editor, the full notes editor, none of that comes to mobile in v1. The desktop owns deep work.
- NOT a second source of truth. The phone never holds the canonical data folder. It captures into an inbox and reads a thin projection. The desktop (and the user's synced folder) remain authoritative.
- NOT a paid product. Free, no in-app purchases, no subscription. This matters for the cost math below, a free app pays Apple and Google no commission.
- NOT a replacement for Telegram on day one. Telegram bench capture keeps working. The app starts by riding the same inbox, then becomes the nicer first-party version of it.

## Cost (the question that started this)

The honest dollar cost is small. The only true recurring cost is Apple's developer fee.

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99/yr | Required for the App Store and TestFlight. Possibly waivable to $0 if enrolled under UW's accredited-institution status rather than the LLC, at the cost of tying the listing to UW. |
| Google Play registration | $25 once | One-time, lifetime. |
| Store commission | $0 | The 15 to 30 percent cut applies only to paid apps and in-app purchases. A free app with no IAP owes nothing. |
| Build infrastructure (Expo / EAS) | $0 | iOS builds locally on Grant's Mac, plus the free EAS cloud tier for Android. The $99/mo EAS plan is optional and unneeded at beta scale. |
| Backend / sync (Cloudflare) | ~$0 to $5/mo | Rides the D1 + DO + R2 migration already in flight. R2 has no egress fees, and the Workers, D1, and DO free tiers cover beta traffic. |

Bottom line, roughly $124 the first year, then ~$99/yr, and plausibly $0 if the UW Apple waiver applies and we build locally. The path to "hundreds of dollars" requires a contractor or a paid build service, neither of which this needs. The real cost is build time, not cash. We will not lose money making this free.

## The core problem (this is where the effort actually is)

The desktop reads the user's synced folder through the File System Access API. That API does not exist on iOS or Android, so the phone cannot touch the OneDrive, Dropbox, or iCloud folder the way the laptop does. ResearchOS is also deliberately backendless for private data. So the real design question is how a capture made on the phone gets home to the user's folder without the phone touching the folder directly.

Three ways to bridge, in rough order of effort.

1. Piggyback Telegram (v0, near-zero new infrastructure). The app is a polished first-party client into the same inbox the Telegram bot already feeds. The desktop already polls and files those arrivals. The phone just becomes a better capture surface than the Telegram chat. Fastest path to something on a phone.
2. Ride the Cloudflare Durable Object backend already being stood up for collab (the v1 destination). The collab DO is live on prod and the D1 + DO + R2 migration is mid-flight, so the backend the companion needs largely already exists. The phone authenticates with the user's directory identity (the same Ed25519 signature the DO already verifies on connect, per `EXTERNAL_COLLAB_SHARING.md`), uploads a capture to an R2-backed inbox, and the desktop drains it into the folder. This reuses the access-control work from migration chunk 3 rather than inventing a mobile-only channel.
3. Direct cloud-provider upload via the OneDrive, Dropbox, and iCloud mobile APIs. The phone writes straight into the user's synced folder through each provider's SDK. Most per-provider work, three integrations to maintain, least appealing, kept here only for completeness.

Recommendation. Option 2 is the destination because the backend is already being built and the identity model already fits. Option 1 is the fast first cut that gets a real app into Grant's hands while option 2's inbox endpoint is finished. Option 3 is not pursued.

## Tech stack, Expo over Capacitor

Two realistic ways to build it.

- Capacitor, wrap the existing Next.js web build in a native shell. Tempting because it reuses the React and Tailwind UI, but the desktop UI depends on the File System Access API that does not exist in the webview, the app is heavy, and Apple regularly rejects thin website wrappers under guideline 4.2 (minimum functionality). A companion needs a different, slimmer UI anyway, so the reuse is smaller than it looks.
- Expo (React Native), a purpose-built thin companion (RECOMMENDED). One TypeScript codebase ships to iPhone and Android together. Native camera, push notifications, and biometric or passkey unlock are first-class. It shares the repo's TypeScript types and pure logic (capture shapes, identity, the inbox protocol) without dragging the FSA-bound desktop UI along. A purpose-built native companion with real camera, push, and offline capture clearly clears Apple's minimum-functionality bar.

Recommendation. Expo. One codebase for both platforms, no fight with FSA, and it passes App Store review cleanly.

## Login and identity

A correction worth locking, because the initial framing assumed Google sign-in. ResearchOS identity today is a local Ed25519/X25519 keypair plus an optional passkey unlock (the Google calendar OAuth was removed in May 2026, so there is no "Sign in with Google" surface to inherit). Mobile is the best possible home for this. iOS and Android both support synced passkeys and biometric unlock natively, so Face ID or a fingerprint unwraps the same identity key the desktop uses. The "same factor on both devices" goal is met through passkeys, which is smoother than Google sign-in would have been and reuses the passkey work already shipped (`project_passkey_identity_unlock`).

Pairing flow, sketch. The desktop shows a QR code (or short code) carrying a one-time pairing grant signed by the user's identity key. The phone scans it, enrolls a passkey, and from then on signs its own inbox uploads. No password typed on the phone.

## Platform sequencing

iPhone first, both built from day one. Grant's instinct is right, most US users are on iPhone, and TestFlight is the natural beta channel. Because Expo is cross-platform, Android comes nearly free, so we build cross-platform from the start and simply ship iOS first. Grant does not need to own an Android to develop, the free Android emulator plus EAS cloud builds cover dev and debugging. The one real gap is physical-device Android testing, which waits for a beta tester or a cheap used phone and does not block an iOS-first launch.

## Feature scope by phase

v0 (proof, on Grant's phone fast)
- Camera capture into the existing Telegram-fed inbox (option 1 bridge).
- Passkey pairing with the desktop identity.
- A bare "today" read view (tasks due, calendar) if cheap.

v1 (the real companion, on the DO backend)
- First-party capture inbox over the Cloudflare DO + R2 (option 2). Photo plus caption, queued offline, synced when online.
- Push notifications for shift alerts, comments on shared tasks, and inbox-filed confirmations.
- Read-only glance surfaces, today's tasks, this week's calendar, recent inbox.
- Quick text note capture into the inbox (not the full editor).

Explicitly deferred past v1
- Editing notes, methods, experiments, or Gantt on the phone.
- The sequence editor, calculators, and other deep desktop surfaces.
- Any offline-first local store of the whole folder on the phone.

## Open questions for Grant (decisions to lock before building)

1. Sync path for v1. Confirm option 2 (ride the Cloudflare DO backend) as the destination, with option 1 (Telegram bridge) as the v0 first cut. Or skip v0 and go straight to the DO inbox.
2. Telegram's future. Does the first-party capture app eventually replace the Telegram bot entirely, or do both coexist (Telegram for users who never install the app)? This shapes how much we invest in the Telegram bridge.
3. Read surfaces in v1. Is the phone read-only for tasks and calendar in v1, or do we want even light mutation (check off a task, leave a comment)? Light mutation needs more of the API to be reachable from the DO, which is more work.
4. Apple enrollment entity. Enroll the developer account under the LLC ($99/yr) or chase the UW educational waiver ($0 but UW-bound)? This is a positioning call as much as a cost one.
5. Build timing. The DO/D1/R2 migration is actively in flight. Do we want to start the companion now in parallel (v0 on the Telegram bridge while the backend settles), or wait until the migration's chunk 3 access-control lands so v1 has a stable backend to target?

## What this doc does NOT commit to

No code, no Expo project, no developer-account purchase yet. This is the scoping pass. Once Grant locks the five questions above, the next artifact is a chunked build plan (v0 first), in the same shape as the cross-boundary and collab build plans.
