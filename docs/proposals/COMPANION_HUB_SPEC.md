# Companion hub, home-tab button + popup (web)

Status: spec for the orchestrator to incorporate into the in-flight Settings,
Devices "ResearchOS Companion" redesign (mockups `2026-06-07-mobile-pairing-mockup.html`,
`2026-06-08-mobile-settings.html`, `2026-06-08-settings-devices-redesign.html`).
The cosmetics session is NOT building this; it overlaps the relay + pairing
handshake and your active devices redesign. This is an addition to your design,
not a competing one. Grant's request (2026-06-09).

## Goal

Make the mobile companion reachable in one tap from the home tab, not only buried
in Settings. A permanent "Companion" button on the home tab opens a companion hub
popup with three areas, Info, Settings, and Connect. A Settings toggle hides the
home-tab button for people who do not want it.

## The home-tab button

- A permanent button on the web home tab.
- Labeled "Companion" with the BeakerBot or phone mark (BeakerBot is the only
  mascot; use the shared Icon component, no new inline svg).
- Always visible on home unless turned off (see the toggle).
- Opens the Companion hub popup.
- Open question, whether it shows a small live pairing-status dot (paired vs not)
  or stays static. A status dot makes it a glanceable connection indicator.
- Placement is yours, suggest the home header (top-right) so it reads as global
  chrome rather than page content.

## The Companion hub popup

One popup hosting three areas (tabs or stacked sections, your call):

1. Connect (the core). Reuse your existing "ResearchOS Companion" devices
   redesign verbatim, pair a phone (the QR grant), Get the app, the paired-device
   list, Unpair, Pair another phone, Check for new captures now, Re-publish today
   snapshot. This is your relay + handshake content already mocked in
   `settings-devices-redesign.html`. This spec does NOT redefine it; the popup
   just gives it a second, more reachable home.
2. Info. What the companion app does (capture from the bench, send to your lab),
   plus get-the-app links (store link / install / a QR to the app).
3. Settings. Companion-related preferences. At minimum the home-button toggle is
   surfaced and explained here; plus any companion prefs you want (for example
   auto-publish snapshot, capture notifications). Open, which prefs live here.

The same hub content is reachable from both the home-tab button and the existing
Settings, Devices entry, one component, two entry points.

## The Settings toggle, hide the home-tab button

- In the web Settings (the same Companion / Devices area you are redesigning), add
  a toggle "Show Companion button on Home" (default on).
- Off hides the home-tab button; the hub stays reachable from Settings.
- Persisted as a user or app preference, mirroring how other web UI prefs persist.

## Labor split (so it folds into your work cleanly)

- Yours (relay / handshake, already your redesign), the Connect area's pair-QR
  grant generation, the paired-device registry, check-captures, re-publish. The
  popup wraps this; it is not re-specced here.
- Presentational shell (hand to the cosmetics session if useful, otherwise
  yours), the home-tab button, the popup chrome + the Info area, and the Settings
  toggle UI + its pref. These are isolated from the relay; if you want any built
  as separate cherry-pickable diffs, flag the cosmetics session with the file
  list and it will build just those after you confirm they are not mid-flight.

## Open questions for the orchestrator

- Home button placement (home header vs a floating affordance) and whether it
  carries a live pairing-status dot.
- Popup layout, tabs vs stacked sections.
- Which companion preferences live in the hub's Settings area.
- Whether "Get the app" shows a store badge, an install link, or a QR to the app.
