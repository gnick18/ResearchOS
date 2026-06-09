# Mobile Settings screen, scope and roadmap

Status: planning. The Settings screen now exists (built from the `modal.tsx`
placeholder, reached from the Notebook header gear) with one control, the
floating mascot toggle. This doc plans it out as a real home, grounded in the
surfaces the mobile app already has, and lays out Grant's account-usage idea
with its honest dependencies.

Owner note: the buildable-now sections are cosmetics-session sized. The Account
and usage section depends on identity and metered-storage systems the
orchestrator owns, so it is flagged, not promised here.

## What the app already has (so settings map to real surfaces)

- Pairing, `lib/pairing.ts` (getPairing / setPairing / clearPairing / usePairing). The phone pairs with a laptop to send captures and notes to the lab. This is the current "account" concept on mobile.
- Device identity, `lib/device-identity.ts` (device keypair, sign, seal). A cryptographic device key, not a user login.
- Notifications, `lib/notifications.ts` (permission + timer alerts).
- Captures outbox, `lib/captures.ts` (queue, send, status, useCaptures).
- Alarm prefs, `lib/alarm-prefs.ts` (sound + vibration), already shown as a card on the Timers tab.
- Appearance, `lib/mascot-prefs.ts` (the new mascot toggle). The app is deliberately light-mode only today (`use-color-scheme` always returns light).

Notably there is NO direct OAuth or user account on mobile yet. Identity is device-pairing to a laptop, and there is no usage or quota endpoint.

## Proposed section structure

A single scrollable Settings screen, grouped with `SectionHeader` cards (the
pattern already in use). Order roughly by how often a user touches it.

1. Account and usage (future, dependency-gated, see below)
2. Device and pairing
3. Notifications
4. Capture and sync
5. Appearance
6. About and support
7. Diagnostics (hidden behind a tap-to-reveal)

## Candidate items by section

### Appearance (buildable now)

- Floating mascot. Done.
- Haptics. Global on/off for the tap feedback the app fires (mascot tap, actions). QOL for quiet environments.
- Reduce motion override. The app already honors the OS reduce-motion flag; an explicit in-app "reduce animations" gives users control without changing OS settings.
- Dark mode. Currently intentionally light-only, dark tokens exist but are never selected. List as future, off the table until the app commits to dark on mobile.

### Notifications (buildable now)

- Timer alerts on/off, with the live OS-permission status surfaced and a one-tap deep link to the OS settings when permission is denied (ties to `ensureNotificationPermission`).
- Alarm sound and vibration. Migrate the existing `AlarmSettingsCard` here from the Timers tab (or surface it in both), so all alert prefs live in one place. Consolidation QOL.

### Capture and sync (buildable now)

- Default photo quality. A resolution or compression choice for bench captures, trades upload size against detail.
- Auto-send vs manual. Whether a capture sends immediately or waits in the outbox for a manual send.
- Wi-Fi only sending. A data-saver guard for the outbox.
- Outbox management. View pending and failed captures, retry all, clear failed (reads from `useCaptures`). Useful when a send fails at the bench.

### Device and pairing (buildable now)

- Paired laptop and lab status (from `usePairing`), shown as a clear connected or not-connected state.
- This device. A short device fingerprint from `getDevicePubHex`, which helps the laptop-side approve-device flow and lets a user confirm they paired the right phone.
- Unpair this phone (`clearPairing`). Today this lives on the Notebook connection card; mirror it here so Settings is the obvious home.
- Pair or re-pair. A path to pair a new laptop.

### Account and usage (FUTURE, depends on orchestrator systems)

This is Grant's idea, sign in with a third-party account and show usage toward
limits. It is real and worth doing, but it depends on two things the cosmetics
session does not own:

- A way for the phone to know the account. Today the phone pairs to a laptop, it does not sign in.
- A usage or quota signal. The metered-storage numbers, lab tier, and the cost circuit breaker live in the web and backend systems (Neon metered storage, the business tracker, lab-tier billing).

Decision (locked, Grant 2026-06-09): Route A. Surface usage through the paired
laptop over the existing relay. No new auth surface on mobile, reuses pairing.
Route B (full OAuth or ORCID or Google directly on the phone plus a
mobile-reachable usage endpoint) is heavier and is deferred, it only matters if
the phone ever needs usage with no paired laptop.

### Route A contract, usage summary over the relay

Grounded in how the relay already works. The relay is store-and-forward and
E2E-blind, the laptop polls it rather than serving requests, and the phone
already downloads sealed snapshots from it (`lib/relay-fetch.ts`,
`unsealSnapshot`). So usage is not a direct phone-to-laptop GET. It is a small
sealed blob the laptop publishes and the phone pulls, mirroring the snapshot
path.

Flow:

- Laptop side (orchestrator owns). On a cadence and on usage change, the
  signed-in laptop publishes a small usage summary to the relay under the paired
  user, sealed to the phone's device X25519 key (the same `sealToUser` path
  captures already use), so the relay stays blind to account data.
- Phone side (mobile, when unblocked). Download the latest sealed usage summary
  from the relay and unseal it with the device key (mirrors snapshot download +
  `unsealSnapshot`), then render it read-only in this section. Cache the last
  value so the section shows the last-known usage offline, stamped with its
  `asOf` time.

Proposed summary shape (small, read-only, sealed):

```json
{
  "asOf": "2026-06-09T18:00:00Z",
  "identity": { "displayName": "...", "orcid": "0000-...", "tier": "lab" },
  "storage": { "usedBytes": 0, "includedBytes": 0, "overageBytes": 0 },
  "status": { "circuitBreaker": "ok", "reason": "" },
  "manageBillingUrl": "https://..."
}
```

What the section renders once the data is present:

- Signed-in identity (name, ORCID, or email) as reported by the laptop, or a
  "pair a laptop to see usage" prompt when unpaired.
- Plan or tier.
- Storage used vs the included allowance, as a simple meter bar with a number.
- Cost circuit-breaker status when tripped (cloud writes paused, local-first
  still working), so a bench user understands why a sync is held.
- A link out to manage billing on the web. Mobile shows usage only, it never
  takes a billing action.

Dependency split:

- Orchestrator, the laptop publisher plus the metered-storage to summary
  mapping, and confirming the relay has a slot for this blob (the snapshot
  mechanism may already cover it).
- Mobile (cosmetics or a later session), the download, unseal, cache, and the
  read-only render in this section.

### About and support (buildable now)

- App version and build number.
- Help, a link into the in-app Wiki tab or the relevant page.
- Open source credits, matching the web "Built on open source" acknowledgements.
- Privacy and data handling, a short, plain note on what is local-first and what syncs to the lab.
- Send feedback or report a bug.

### Diagnostics (buildable now, hidden)

Revealed by tapping the version row a few times, the usual pattern, so it does
not clutter normal use.

- Relay endpoint and reachability check.
- Device public key (full), for support.
- Capture queue inspector.
- Reset local app data or caches.

## Phasing

- Phase 1, the home plus low-risk prefs. Consolidate what already exists (mascot, haptics, reduce-motion, the alarm prefs migration) and add About and version. Pure cosmetics-session work.
- Phase 2, device and capture controls. Pairing status and unpair, device fingerprint, outbox management, capture quality and auto-send. Reads existing libs, light additive state.
- Phase 3, account and usage. Coordinated with the orchestrator, Route A (usage summary over the relay) first. Gated on the identity and metered-storage systems.

## Open decisions for Grant and the orchestrator

- Settings reachability. Today the gear is only on the Notebook header. If Settings should open from every tab, the clean fix is a shared title-header component (each tab currently renders its own inline title). Worth doing before adding many items.
- Alarm prefs. Move them into Settings, keep them on the Timers tab, or show in both.
- Account and usage route. LOCKED to Route A (sealed usage summary over the relay). Remaining open piece is the laptop-side publish cadence and the exact metered-storage to summary mapping, which the orchestrator owns.
- How much of Diagnostics to expose, and whether it ships at all in the beta.
