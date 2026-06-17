# Mobile store listing (App Store + Google Play)

Status: copy + submission prep, ready for a guided submission. Drafted by the brand
manager. The mobile app build, the icons, and the data-safety specifics are owned
by the mobile workstream, see the flags below.
Date: 2026-06-07.
Related: `MOBILE_COMPANION.md` (what the app is), `mobile-dev-accounts-setup.md`
(Apple/Google account setup), `mobile/app.json` (the Expo config).

## What this app is (so the copy stays honest)

A free mobile companion to the desktop ResearchOS app, and a capable bench tool in
its own right. The laptop stays the main workspace, but the phone has seven working
tabs: Notebook (photo capture + markup + quick notes to an experiment), Methods
(protocol library, run step by step, offline download), Timers (step timers), Calc
(bench calculators + custom calculators), Inventory (barcode scan + room map +
reorder queue), Home (today's tasks + lab calendar + active-experiment suggestions),
and Wiki (read protocols/reference). Plus push notifications and offline use. Sell
ALL of these. The honest boundaries to keep: it is NOT a port of the desktop EDITORS
(writing up experiments, chemistry, sequence design, statistics stay on desktop),
the local folder is the single source of truth, and the app is free (no IAP, no ads).

## App identity

- **Display name:** ResearchOS
- **Headline (feature graphic / hero):** Snap it at the bench, file it from your desk.
- **Subtitle / tagline:** Bench photos to your notebook
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
- **Subtitle (30 char max):** `Bench photos to your notebook`
- **Promotional text (170 char max):**
  ```
  Photograph a gel or plate at the bench and it lands in your ResearchOS inbox to file later. See today's tasks and lab calendar. Get a push when a labmate shares or mentions you.
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
  Your lab bench companion: capture results, run timed protocols, track inventory.
  ```
- **Full description (4000 char max):** see "Full description" below.

## Full description (shared, App Store + Play)

Updated 2026-06-17: the earlier draft under-sold the app as a thin photo-capture
companion. The app actually has seven working tabs (Notebook capture, Methods with
step timers, Timers, Calc + custom calculators, Inventory with barcode scan + room
map + reorder, Home today/calendar, Wiki). Description below covers all of them.
Still honest: the deep editors (writing up experiments, chemistry, sequence design,
statistics) remain desktop-only, and the local folder is the single source of truth.

```
ResearchOS is the free, local-first lab notebook, and this is its mobile companion: the bench in your pocket. Capture results, run your protocols step by step, do the quick math, and keep the lab stocked, all from your phone, all synced to the workspace you own.

Your data stays yours. Everything lives in a folder on your own computer, not on a vendor's server. The phone works offline and pairs to your desktop, so nothing is trapped in someone else's cloud.

At the bench:
- Capture results. Photograph a gel, plate, or whiteboard, mark it up, and send it straight to the right experiment. Add a quick typed note in seconds.
- Run protocols. Pull up any method from your library and run it step by step, with timers wired to each step so a long incubation keeps time for you. Download your methods for offline use.
- Lab calculators. Run the everyday bench math without leaving the app, and build your own custom calculators.
- Track inventory. Scan a package barcode, glance at the room map, and drop low stock into a reorder queue while you stand at the shelf.
- Stay on top of the day. See today's tasks and your lab calendar at a glance, with suggestions for your active experiment.
- Read and reference. Open your lab wiki and protocols anywhere.
- Get notified. Push alerts when a labmate shares or mentions you, or a task comes due.

Why ResearchOS:
- Free. No subscription, no per-seat fees, no in-app purchases, no ads.
- Local-first. Your research is plain files in a folder you own. Leaving is just closing a folder.
- Open source. Anyone can read exactly how it works.
- Built for real labs by researchers, not a vendor renting you your own data.

The desktop app stays your main workspace for the deep work, writing up experiments, chemistry, sequence design, and statistics. The phone handles everything the bench needs.

Own your science. Learn more at research-os.app.
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

### Play feature graphic (DONE)

1024x500. Generated at `brand/png/researchos-play-feature.png` from the generator
`brand/src/play-feature-graphic.html` (BeakerBot mark + Geist wordmark + the rainbow
rail and glow, matching og.html). Headline "Snap it at the bench, file it from your
desk." Re-render with the same Playwright pattern as the other brand assets if the
copy changes.

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

## Reviewer access (the biggest rejection risk for a companion app)

Both Apple and Google have a human (or automated) reviewer who must actually run
the app. This app pairs to a desktop the reviewer does not have, so without a way
to see it work, it gets rejected ("we were unable to use the core features"). Solve
this before submitting. Two options, decide with the mobile workstream:

- **Preferred: a demo / review mode.** A button or a hardcoded test pairing code
  that drops the reviewer into a seeded fixture state (a sample inbox, sample
  today's tasks, a sample push), no real desktop needed. Same fixture-data spirit
  as the web wiki-capture mode. This is the most reliable path and is the mobile
  workstream's to build.
- **Fallback: a standing test pairing.** Keep one desktop instance paired to a
  test account and hand the reviewer a code, riskier (the pairing can expire or the
  desktop can be offline during review).

Draft **App Review notes** (App Store Connect "App Review Information" / Play
"App access" + review notes):
```
ResearchOS is a free companion to the ResearchOS desktop research app. The phone
captures a bench photo into your desktop inbox, delivers push notifications, and
shows today's tasks and calendar. To review without a paired desktop, open the app
and tap "Try the demo" on the pairing screen (or enter pairing code <CODE>), which
loads sample data so you can see the capture flow, the today view, and a sample
notification. No account or desktop is required for the demo.
```
FLAG: the "Try the demo" path / pairing code above must actually exist in the build.
If the mobile workstream cannot add a demo mode for v1, switch to the standing-test
fallback and update these notes.

## Export compliance / encryption

Add to `mobile/app.json` so App Store builds stop prompting on every upload:
```json
"ios": { "infoPlist": { "ITSAppUsesNonExemptEncryption": false } }
```
NUANCE, confirm before declaring `false`: an app qualifies for the exemption (and
declares `false`) when it only uses standard encryption (HTTPS/TLS, the OS keychain,
standard auth crypto). This app ALSO does end-to-end sealing of captured content
through the relay. Standard, well-known E2E using platform/standard crypto is
usually still exempt, but end-to-end content encryption can in some cases require a
one-time self-classification (an ERN/CCATS) and an annual report to US BIS. Have the
person who knows the exact crypto (the relay's `sealToRecipient` path) confirm the
app uses only standard algorithms, then declare `false`. If unsure, this is a quick
question for a lawyer or the App Store encryption questionnaire, do not guess.

## Content rating questionnaire answers (draft)

Same answers drive both Apple's age rating and Play's IARC. The app has no
objectionable content; the only user content is the user's own bench photos going
to their own inbox (not shared publicly).

- Violence, sexual content, profanity, drugs, gambling, horror: None / No.
- User-generated content shared with others publicly: No (photos go to the user's
  own private inbox, not a public feed).
- Unrestricted web access: No.
- Data sharing / location: see the Data safety section.
- Expected result: App Store 4+, Play "Everyone".

## Release notes / What's New (v1.0.0)

```
First release. Snap a photo at the bench into your ResearchOS inbox, get push
notifications, and check today's tasks and calendar from your phone. The desktop
app stays your main workspace.
```

## Pre-submission QA checklist

- Install a release build on a real iPhone and a real Android device (not just the
  simulator) and walk the capture-to-inbox flow, a push, and the today view.
- Confirm the app launches cleanly with no account and shows the pairing/demo entry
  (reviewers start cold).
- Verify deep links / the `researchos://` scheme open the app.
- Test on a small screen and a large screen; confirm portrait-only is intended.
- Confirm no placeholder assets ship (the react-logo files are removed, the icon is
  the final BeakerBot).
- Confirm the privacy policy URL loads and matches the data-safety answers.
- Screenshots use fixture data only, never real research data.

## What is Grant's (do not automate)

Account creation, developer-program payments, accepting any store agreement, tax
and banking forms, and the final "Submit for review" / "Publish" click are all
Grant's. The Chrome agent fills fields and uploads staged files only, and stops at
any payment or agreement.
