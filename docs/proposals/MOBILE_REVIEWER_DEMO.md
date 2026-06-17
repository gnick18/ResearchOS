# Mobile reviewer demo mode (scope)

STATUS (2026-06-17): BUILT. The demo path is live in the app, so this doc is now a
reference for what shipped, not a to-do. Implementation: `Pairing.demo?: boolean`
plus `setDemoPairing()` in `mobile/lib/pairing.ts`; `fetchSnapshot()` in
`mobile/lib/snapshots.ts` short-circuits to fixtures when `pairing.demo` is true;
a "No desktop? Try the demo" link on `mobile/app/pair.tsx` (testID
`pair-try-demo`); the timers / method / wiki tabs already work offline. So a
reviewer with no desktop can reach the core features. The remaining work to ship
is store-side (build, listing, data-safety, screenshots), not this.

Goal: let an App Store / Play reviewer (and any curious user) see the companion
app's core features with no desktop, no account, and no real pairing. This is the
gate that blocks submission, a reviewer who only sees the pairing wall rejects the
app under "we could not access the core features."

House style applies to all copy added (no em-dashes, no emojis, no mid-sentence
colons, BeakerBot is the only mascot).

## Why this is small

The app already keys everything off one thing: a `Pairing` record in SecureStore,
read through `usePairing()` (`lib/pairing.ts`). `paired = !!pairing` flips the whole
experience from "pairing wall" to "working app." And all relay data flows through a
single function, `fetchSnapshot()` in `lib/snapshots.ts`, used by exactly two tabs:

- `app/(tabs)/notebook.tsx` (the Today glance + capture pipeline)
- `app/(tabs)/inventory.tsx`

The other three tabs (`timers`, `calc`, `wiki`) already work fully offline with no
pairing, so they need nothing. That means demo mode is: fake the pairing record,
and short-circuit the two data seams to fixtures.

## What gets built

1. **A demo marker on the pairing record.** Add an optional `demo?: boolean` to the
   `Pairing` type in `lib/pairing.ts` plus a `setDemoPairing()` helper that writes a
   fake record (`labName: "Demo Lab"`, placeholder `u` / `relayUrl` / `devicePubkey`,
   `demo: true`). Optional + back-compatible, existing real pairings are unaffected.

2. **"Try the demo" button on the pairing screen** (`app/pair.tsx`). Taps
   `setDemoPairing()` then routes into the tabs. This is the literal button the
   drafted App Review notes already promise (see `MOBILE_STORE_LISTING.md` line 199).

3. **A fixtures module** (`lib/demo-fixtures.ts`) with believable, fake lab content:
   - a `TodaySnapshot` (a few `SnapshotTask`s, scheduled / overdue / coming up),
   - an inventory snapshot (a handful of sample reagents, one low-stock),
   - one or two sample captures already in the outbox so the Notebook tab is not empty.

4. **Guard the two seams.** When `pairing.demo` is true:
   - `fetchSnapshot()` returns the fixture snapshot and never touches the relay or
     `signWithDevice` (it would fail with placeholder keys).
   - `sendCapture()` (`lib/captures.ts`) fakes a successful send (mark sent, fire the
     success burst) instead of uploading.

5. **A visible "Demo mode" pill + easy exit.** A small persistent label so it is
   obvious this is sample data, and so the reviewer (and we) can tell. Exit is just
   the existing unpair, which clears the demo record.

## What the reviewer sees

Open app, tap "Try the demo", land on the Notebook tab with a sample Today list and
a sample capture, take a photo (works, local) and "send" it (fake success burst),
flip to Inventory and see sample reagents, open Timers and Calculators (already
real), browse the bundled Wiki. Every advertised feature is exercised, zero setup.

## Out of scope

- No real relay traffic, no real notification delivery in demo (a scheduled local
  sample notification is a possible add, see open decisions).
- No changes to the real pairing/capture/relay code paths beyond the `demo` guard.
- Screenshots (separate task, captured off a simulator once demo mode exists, which
  conveniently makes screenshotting trivial).

## Decisions (locked 2026-06-09)

1. Button label: **"Try the demo"** (keeps the drafted review notes accurate).
2. Demo **fires one sample local notification** so the reviewer sees the push feature.
3. Fixture tone: mirror the web `?wikiCapture=1` fixture lab (fake but realistic).

Status: scope approved, build ON HOLD per Grant (2026-06-09). Dispatch a focused
mobile sub-bot against this doc when greenlit.

## Effort

Small, roughly half a day to a day for one focused sub-bot. Single clean seam, no
backend, no new dependencies. After it lands, screenshots and the actual `eas build`
+ submit are the remaining `[YOU]` steps in `docs/ops/mobile-publish-runbook.md`.
