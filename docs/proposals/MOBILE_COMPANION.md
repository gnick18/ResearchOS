# Mobile companion app

Status: DESIGN DRAFT with research-backed recommendations. Needs Grant sign-off on the five decisions. No code yet.
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

Grant confirmed the v1 anchor set 2026-06-07, bench photo capture, lab timers with push, the barcode-driven reorder/inventory loop, and the today glance with push. The phone leans into what it is good at (camera, push, quick capture while hands are busy), it does not shrink the desktop down.

v0 (proof, on Grant's phone fast)
- Camera capture into the existing Telegram-fed inbox (option a bridge).
- Passkey pairing with the desktop identity.
- A bare "today" read view (tasks due, calendar) if cheap.

v1 (the real companion, on the DO backend)
- Bench photo capture into the first-party inbox over the Cloudflare DO + R2. Photo plus caption, queued offline, synced when online. This is the anchor.
- Quick note capture (text or voice) into the inbox, for hands-busy moments.
- Lab timers with push. Start an incubation or a PCR step and get a notification when it fires, even after walking away from the bench. Phone-native, the desktop owns calculators, the phone owns timers.
- Barcode-driven reorder and inventory capture (see the dedicated section below). The phone is the scanner.
- Read-only glance surfaces, today's tasks, this week's calendar, recent inbox.
- Push notifications for shift alerts, comments on shared tasks, and inbox-filed confirmations.

Explicitly deferred past v1
- Light mutation (check off a task, leave a comment). Real value, but it means the phone writing canonical records, so it waits until the read path and DO write path are both proven.
- Editing notes, methods, experiments, or Gantt on the phone.
- The sequence editor, on-phone calculators, and other deep desktop surfaces.
- Any offline-first local store of the whole folder on the phone.

## Barcode inventory loop (Grant, 2026-06-07) and its dependency

Grant wants the reorder feature built around barcode scanning, tied to an inventory feature ResearchOS will build but has not yet. The phone is the natural scanner, which makes the mobile app the front-end for inventory rather than just a capture utility. This matches the public roadmap, which already lists "lab inventory with barcode scanning, beta-requested, pairs with the mobile app."

The two-mode scan loop Grant described:
- Scan to register. Point the phone at a barcode (a manufacturer UPC or GTIN on the bottle, or a lab-printed label) to create or identify an inventory item and set its details. The barcode becomes the item's identity key.
- Scan to consume. Scan a registered item to mark it used. That auto-decrements stock and drops the item into the existing Purchases needs-ordering queue when it runs low.

The dependency that gates this. The inventory data model does not exist yet, and the roadmap explicitly says it needs a design doc before building. The full loop (register, consume, auto-reorder) needs that model. So there is a sequencing fork to decide before the build plan.

- Option A, co-design inventory first. Write the inventory model design doc now (it is roadmap-pending anyway), then the mobile app ships the full barcode loop in v1. The app and inventory are co-designed, with the phone as the primary scanner. Larger up-front scope, but the app launches with its headline inventory feature intact.
- Option B, stepping-stone reorder in v1. Ship a simpler manual quick-add to the needs-ordering queue in v1 (no barcode, no inventory model), and add the barcode loop once the inventory model lands. The app launches sooner, the barcode loop follows in a fast v1.x once inventory is designed.

This fork is the main open feature decision. Everything else in the v1 set is independent of it.

## Open questions for Grant (decisions to lock before building)

1. Sync path for v1. Confirm option 2 (ride the Cloudflare DO backend) as the destination, with option 1 (Telegram bridge) as the v0 first cut. Or skip v0 and go straight to the DO inbox.
2. Telegram's future. Does the first-party capture app eventually replace the Telegram bot entirely, or do both coexist (Telegram for users who never install the app)? This shapes how much we invest in the Telegram bridge.
3. Read surfaces in v1. Is the phone read-only for tasks and calendar in v1, or do we want even light mutation (check off a task, leave a comment)? Light mutation needs more of the API to be reachable from the DO, which is more work.
4. Apple enrollment entity. Enroll the developer account under the LLC ($99/yr) or chase the UW educational waiver ($0 but UW-bound)? This is a positioning call as much as a cost one.
5. Build timing. The DO/D1/R2 migration is actively in flight. Do we want to start the companion now in parallel (v0 on the Telegram bridge while the backend settles), or wait until the migration's chunk 3 access-control lands so v1 has a stable backend to target?

## Research findings and recommendations (2026-06-07)

A deep-research pass gathered facts from primary sources (developer.apple.com, support.google.com, docs.expo.dev) plus targeted follow-up fetches. The automated verification phase hit a harness bug and abstained on every claim, so the facts below are taken from their primary sources directly rather than from the workflow's (broken) verdict. Each decision now has a recommendation.

### Decision 1, sync path. RECOMMENDATION: ride the Cloudflare DO + R2 backend (option b) as the destination, Telegram bridge (option a) as the v0 first cut. Option c (direct provider SDKs) is rejected.

The deciding fact is a pattern, not a single citation. Every local-first notes app with a mobile client (Obsidian, Joplin, Logseq, Standard Notes, Anytype) syncs its phone through a sync server or a provider sync API. None give the phone raw access to an arbitrary user-picked folder, because mobile operating systems do not expose the desktop's File System Access model. So routing the phone through a backend is the normal, expected architecture here, not a compromise of local-first values. We already have that backend (the collab DO is live on prod) and the identity it needs (the DO already verifies the Ed25519 directory signature on connect, per `EXTERNAL_COLLAB_SHARING.md`). Option a (Telegram inbox) is the fastest way to get a working app in hand because the desktop already drains that inbox. Option c means building and maintaining three separate provider integrations, the worst effort-to-value ratio.

### Decision 2, Telegram future. RECOMMENDATION: COEXIST, do not replace, at least through v1.

The Telegram bot already works and costs nothing to keep running. It is the zero-install capture channel for users who never download the app. The first-party app becomes the better capture surface (native camera, an offline queue that retries, push confirmations) for users who do install it. There is no reason to remove a working zero-friction path, and removing it would strand existing Telegram users. Revisit deprecation only once the app's capture is proven and adopted. This also means we keep the Telegram bridge investment small, it is the v0 scaffold, not a long-term product surface.

### Decision 3, read vs mutate in v1. RECOMMENDATION: capture (append-only to the inbox) plus READ-ONLY glance views in v1. Defer general mutation to v2.

Capture is already a write, but it is append-only into an inbox the desktop owns, which is safe and conflict-free. General mutation (checking off a task, editing a record) means the phone writing to canonical records that live in the user's folder, which reopens the no-FSA-on-mobile problem and adds conflict and merge concerns against the desktop as the authoritative writer. Read-only glance plus append-only capture is meaningfully cheaper and safer to ship, and it is the standard v1 shape for productivity companion apps (capture and view first, edit later). Light mutation (a checkbox, a comment) is a clean v2 once the v1 read path and the DO write path are both proven.

### Decision 4, Apple enrollment entity and cost. RECOMMENDATION: enroll under the ResearchOS LLC at $99/yr. Do NOT chase the UW fee waiver.

Verified facts from Apple and Google primary sources:
- Apple Developer Program is $99 USD per membership year (developer.apple.com/support/compare-memberships, developer.apple.com/programs/whats-included).
- Google Play is a one-time $25 registration, not recurring (support.google.com/googleplay/android-developer/answer/6112435).
- Free apps with no in-app purchases owe no commission to Apple or Google. The 15 to 30 percent cut applies only to paid apps and in-app purchases.
- Apple's fee waiver is real and current, but it is restricted to nonprofit organizations, accredited educational institutions, and government entities, AND only for accounts distributing exclusively free apps. Individuals, sole proprietors, and single-person businesses are explicitly excluded (developer.apple.com/help/account/membership/fee-waivers).

The sharpening finding. A for-profit LLC does NOT qualify for the waiver, so enrolling under ResearchOS LLC costs the normal $99/yr. The $0 path runs through UW-Madison (a public university qualifies as an accredited educational and government entity), but enrolling under UW means UW's institutional Apple account owns the listing, the app is attributed to and governed by UW, and it entangles the listing with the same UW and WARF institutional-IP questions that already make the AGPL relicensing sensitive. The recommendation is to pay the $99/yr under the LLC (which now has an EIN and banking) and keep full ownership, brand, and control of the listing. The $99/yr is trivial against what UW enrollment would cost in control and entanglement.

### Decision 5, toolchain and timing. RECOMMENDATION: Expo (React Native), build v0 now in parallel, target the v1 DO inbox after migration chunk 3 lands.

Verified facts:
- EAS Build free tier is 15 iOS and 15 Android cloud builds per month, 1 concurrency, 45-minute timeout, low-priority queue (expo.dev/pricing). The lowest paid tier is $19/mo and is not needed at beta scale.
- Local builds via `eas build --local` run entirely on your machine and consume zero cloud build credits (docs.expo.dev/build-reference/local-builds). iOS local builds need a Mac with Xcode, fastlane, and CocoaPods, all of which you have or can install free. So build cost is effectively $0.
- Android can be developed and tested without owning a device, the free Android emulator (Android Studio) plus EAS cloud builds cover dev and debug. Only physical-device Android testing needs hardware, and that can wait for a beta tester.
- Expo's push service abstracts both APNs (Apple) and FCM (Google) under one API and is free to use, you only need a free Apple push key and a free FCM project (docs.expo.dev/push-notifications/overview, docs.expo.dev/push-notifications/sending-notifications-custom).
- App Store guideline 4.2 (minimum functionality) is a top rejection reason for thin webview wrappers, and the standard remedy is to ship genuine native features, push, camera or photo capture, and offline handling. A purpose-built Expo companion has exactly those, so it clears 4.2, whereas a Capacitor wrap of the existing web app carries real rejection risk (multiple App Store review guides converge on this).
- Desktop-to-mobile passkey pairing has an established pattern, a QR code encoding a time-sensitive session identifier that the phone scans and signs, with the private key never leaving the device (corbado.com/blog/webauthn-passkey-qr-code). This validates the pairing sketch above.

Timing follows the migration naturally. Build v0 now on the Telegram bridge while the D1 + DO + R2 migration settles, then target v1's DO-backed inbox once migration chunk 3 (DO access control) lands, because chunk 3 is exactly the authenticated-member check the phone's uploads need.

## What this doc does NOT commit to

No code, no Expo project, no developer-account purchase yet. This is the scoping pass. Once Grant locks the five questions above, the next artifact is a chunked build plan (v0 first), in the same shape as the cross-boundary and collab build plans.
