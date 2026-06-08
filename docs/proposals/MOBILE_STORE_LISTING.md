# Mobile store listing (App Store + Google Play)

Status: copy + submission prep, ready for a guided submission. Drafted by the brand
manager. The mobile app build, the icons, and the data-safety specifics are owned
by the mobile workstream, see the flags below.
Date: 2026-06-07.
Related: `MOBILE_COMPANION.md` (what the app is), `mobile-dev-accounts-setup.md`
(Apple/Google account setup), `mobile/app.json` (the Expo config).

## What this app is (so the copy stays honest)

A free, thin mobile companion to the desktop ResearchOS app. The laptop stays the
main workspace. The phone does the few things a phone is better at, snap a photo at
the bench so it lands in your inbox, get a push when something needs you, glance at
today's tasks and calendar. It is NOT a port of the desktop, NOT a second source of
truth, NOT paid. Keep all copy inside that scope. Do not claim desktop features
(editors, planning, sequence tools) are on mobile.

## App identity

- **Display name:** ResearchOS
- **Subtitle / tagline:** Your lab bench companion
- **Bundle identifier (iOS):** `app.researchos.companion` (NOT yet set in app.json,
  add `ios.bundleIdentifier`). Use the same string for Android `android.package`
  so they match. Android package rules forbid hyphens, so do not use
  `research-os`; `researchos` is the safe segment.
- **Category:** App Store primary Productivity, secondary Medical or Education.
  Play primary Productivity.
- **Age rating:** 4+ (App Store) / Everyone (Play). No objectionable content.
- **Price:** Free. No in-app purchases, no ads.
- **Support URL:** https://research-os.app
- **Support email:** support@research-os.app
- **Marketing URL:** https://research-os.app
- **Privacy policy URL:** https://research-os.app/privacy (live, verified)
- **Copyright:** 2026 ResearchOS LLC

## App Store copy (App Store Connect)

- **Name (30 char max):** `ResearchOS`
- **Subtitle (30 char max):** `Your lab bench companion`
- **Promotional text (170 char max):**
  ```
  Snap a photo at the bench and it lands in your ResearchOS inbox. Get a push when something needs you. Glance at today's tasks and calendar. The desktop does the deep work.
  ```
- **Keywords (100 char max, comma-separated, no spaces):**
  ```
  electronic lab notebook,ELN,lab notes,research,science,experiments,scientist,bench,protocols,methods
  ```
- **Description (4000 char max):** see "Full description" below.

## Google Play copy (Play Console)

- **App name (30 char max):** `ResearchOS`
- **Short description (80 char max):**
  ```
  Snap bench photos into ResearchOS, get pushes, and see today at a glance.
  ```
- **Full description (4000 char max):** see "Full description" below.

## Full description (shared, App Store + Play)

```
ResearchOS is a free, open, local-first research workspace. Your experiments, lab notes, methods, and schedule live in a folder you own on your own computer, not on someone else's server.

This is the mobile companion. The laptop stays your main workspace. The phone does the few things a phone is genuinely better at.

What the app does:
- Snap a photo at the bench and it lands in your ResearchOS inbox, ready to file from your computer later.
- Get a push when something needs you.
- Glance at today's tasks and your calendar without opening the laptop.

What it is not:
- It is not a port of the desktop app. The deep work, the editors, the planning, the sequence tools, stays on the desktop.
- It is not a second copy of your data. The folder on your own computer stays the single source of truth.
- It is free. No subscription, no in-app purchases, no ads.

Your data stays yours. ResearchOS is built so scientists keep full control of their research instead of renting it from a vendor.

Learn more at research-os.app.
```

Voice check: no em-dashes, no emojis, no mid-sentence colons (the colons are
line-start labels, which are fine). If you edit it, keep it that way.

## Assets

### Icons (FLAG, owned by the mobile workstream)

The current `mobile/assets/images/icon.png` is NOT store-ready. It has visible
construction/alignment guidelines baked in (dashed circles and a crosshair center
mark) and reads as an abstract blue mark, not the BeakerBot mascot. Per the brand
rule (the mascot IS BeakerBot), the store icon should be the BeakerBot mascot on a
sky background, clean, no guides. To do, owned by the mobile session:

- iOS app icon: 1024x1024 PNG, no alpha, no rounded corners (Apple rounds it). Build
  from the BeakerBot favicon/avatar (`brand/beakerbot-favicon.svg`,
  `brand/png/beakerbot-avatar-sky-1600.png`), sky background `#E6F4FE` or the sky
  disc treatment.
- Android: adaptive icon foreground (BeakerBot in the safe zone) + background
  `#E6F4FE` + a monochrome layer. Plus a 512x512 Play store icon.
- Splash already uses `#1AA0E6`, fine.
- Remove the leftover Expo template placeholders: `react-logo.png`,
  `react-logo@2x.png`, `react-logo@3x.png`, `partial-react-logo.png`.

### Screenshots (capture from a device or simulator; cannot be pre-generated)

Use the wiki-capture / fixture data conventions, never real research data.
- iOS: 6.7-inch and 6.5-inch (and 5.5-inch if still required); iPad shots if
  `supportsTablet` stays true.
- Play: at least 2 phone screenshots, plus 7-inch and 10-inch tablet if you list
  tablet support.
- Suggested shots: the capture-a-bench-photo flow, the today/tasks glance, a push
  notification example, the pairing-to-desktop screen.

### Play feature graphic

1024x500 PNG, BeakerBot + the "Your lab bench companion" line on a sky/rainbow
treatment. Build from `brand/src/` like the other banners. To do.

## Data safety / App privacy (DRAFT, verify against the final relay + push code)

These answers depend on exactly how the capture relay and push tokens are
implemented; confirm with the mobile workstream before submitting. The app is
local-first, so most categories are "not collected." The honest exceptions:

- **Photos / user content:** collected when the user captures a bench photo, used
  for app functionality (capture-to-inbox), linked to the account. It travels
  through an end-to-end-blind, ephemeral relay (verify retention and whether it
  counts as "collected" vs "transmitted only" under each store's definitions).
- **Push token (device identifier):** collected to deliver notifications.
- **No location, no contacts, no advertising identifiers, no third-party analytics
  SDK in the mobile app** (verify there is no analytics SDK shipped in the Expo
  build; the web Vercel Analytics does not apply to the native app).
- Data is NOT sold and NOT used for tracking across apps.

Fill both the App Store "App Privacy" nutrition label and the Play "Data safety"
form from the verified version of the above.

## Submission checklist (for the guided Chrome-agent walkthrough)

Prerequisite: the Apple Developer Program ($99/yr) and Google Play registration
($25 once) accounts exist, see `mobile-dev-accounts-setup.md`. Account creation,
payments, and any agreement acceptance are Grant's to do himself.

### Before either store

1. Set `ios.bundleIdentifier` and `android.package` to `app.researchos.companion`
   in `mobile/app.json`.
2. Finish the BeakerBot icons (above) and remove the placeholders.
3. Capture screenshots from a device/simulator on fixture data.
4. Verify the data-safety answers against the final code.

### App Store Connect (iOS)

1. Create the app record (the bundle id must already exist in the Apple Developer
   portal under Identifiers).
2. Paste Name, Subtitle, Promotional text, Keywords, Description, URLs, Copyright
   from this doc.
3. Upload the 1024 icon and the screenshots.
4. Complete the App Privacy questionnaire from the verified data-safety section.
5. Set category Productivity, age rating 4+, price Free.
6. Upload a build via EAS / Xcode, attach it, submit for review.

### Google Play Console

1. Create the app, set it Free, pick Productivity.
2. Paste Title, Short description, Full description.
3. Upload the 512 icon, the feature graphic, and the screenshots.
4. Complete the Data safety form and the content rating questionnaire.
5. Set the privacy policy URL.
6. Upload an AAB via EAS, roll out to a testing track first, then production.

## What is Grant's (do not automate)

Account creation, developer-program payments, accepting any store agreement, and
the final "Submit for review" / "Publish" click are all Grant's. The Chrome agent
fills fields and uploads staged files only, and stops at any payment or agreement.
