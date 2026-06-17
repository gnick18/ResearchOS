# Mobile publishing runbook (App Store + Google Play)

How to build and publish the ResearchOS companion app once it is ready. Pairs with
`docs/proposals/MOBILE_STORE_LISTING.md` (the copy + assets + data-safety answers).
The app is Expo, so the build/submit tool is EAS (Expo Application Services).

Every step is tagged with who does it:
- **[YOU]** you run it in the terminal, or it needs your account login / a payment /
  an agreement / a final publish click.
- **[AGENT]** the Chrome agent can do it (fill fields, upload staged files) and must
  stop at anything tagged [YOU].

## Account decision (read first)

UPDATE (2026-06-17): launching under the **ResearchOS LLC organization** accounts on
both stores, not personal. The earlier personal-first plan below is superseded.
- **Apple:** the individual enrollment was never completed; the LLC org enrollment
  was submitted 2026-06-17 (enrollment ID on file, in entity verification, allow a
  few days to ~2 weeks). Org from day one, so no later App Transfer.
- **Google Play:** the ResearchOS LLC organization account is created and verified.
  Build Android FRESH on it (org accounts skip the 12-tester / 14-day closed test).
So the store seller name is ResearchOS LLC on both from launch, and the demo-mode
gate is already built (`docs/proposals/MOBILE_REVIEWER_DEMO.md`).

(Superseded) Earlier plan: launch under personal accounts for speed, transfer to the
LLC later. No longer the path now that the D-U-N-S and both org accounts exist.

### Launch sequencing (decided 2026-06-09): Apple first, Android on the org account

- **Ship iOS first.** The individual Apple account works now (no D-U-N-S needed). The
  only remaining gate is the reviewer demo mode (scope:
  `docs/proposals/MOBILE_REVIEWER_DEMO.md`). Once that lands, iOS is submittable.
- **Do Android after the D-U-N-S + LLC org Play account.** New *personal* Play accounts
  must run a 12-tester / 14-day closed test before production (see
  `mobile-dev-accounts-setup.md`). *Organization* accounts are exempt. So rather than
  burn the 14-day clock on the personal account, wait for the D-U-N-S, stand up (or
  transfer to) the ResearchOS LLC org Play account, and skip the closed-test entirely.
- **Verified 2026-06-09** (against support.google.com/googleplay/android-developer/answer/14151465):
  the closed test (at least 12 opted-in testers, 14 CONSECUTIVE days) applies to
  *personal accounts created after Nov 13, 2023* only; organization accounts are not
  subject to it. So a fresh LLC org Play account skips it. Transfer caveat: the account
  type cannot be converted (create a NEW org account, US$25, refundable on closing the
  personal one), and community reports say an app that STARTED on a personal account may
  still be held to the test after a transfer, so build Android FRESH on the org account
  rather than transferring the personal-account app. Nothing has shipped on Android yet,
  so there is nothing to transfer. RE-VERIFY against the live pages at submission time,
  store policies shift.

## Prerequisites

- **[YOU]** Apple Developer Program active ($99/yr) and Google Play Console active
  ($25 one time). See `mobile-dev-accounts-setup.md`. Record both in
  `/admin/business` as money out, category "Dev accounts".
- **[YOU]** An Expo account (free) for EAS.
- The app build is feature-complete and the icons exist (the BeakerBot set is done).
- `MOBILE_STORE_LISTING.md` copy + the feature graphic
  (`brand/png/researchos-play-feature.png`) are ready.
- Screenshots captured from a device or simulator on FIXTURE data, never real
  research data (see the listing doc's asset checklist).
- The reviewer demo path exists in the build (the companion pairs to a desktop, so
  reviewers need a demo mode or a test pairing code, see the listing doc).

## One-time EAS setup (in `mobile/`) — DONE 2026-06-07

Already complete; recorded for reference. State on disk:
- `eas-cli` installed; logged in to Expo as `gnickles`.
- EAS project linked: `@gnickles/researchos-companion` (projectId in `app.json`
  under `extra.eas.projectId`, plus `owner: gnickles`).
- `eas.json` exists with development / preview / production build profiles.
- `app.json` has `ios.bundleIdentifier` and `android.package` =
  `app.researchos.companion`, and `ITSAppUsesNonExemptEncryption=false`.

The only one-time step left, and it happens on the FIRST build:
- **[YOU]** Signing. EAS auto-manages it:
   - iOS: on the first build it logs into your personal Apple account and creates a
     distribution certificate + provisioning profile. Note your Apple Team ID.
   - Android: EAS generates an upload keystore. BACK IT UP (it signs every future
     update; losing it means you cannot ship updates under the same listing).

## iOS, App Store

1. **[YOU]** In the Apple Developer portal, register the bundle id under
   Certificates, IDs & Profiles -> Identifiers (EAS can also do this on first build).
2. **[AGENT]** In App Store Connect, create the app record (name, primary language,
   bundle id, SKU).
3. **[YOU]** Build: `eas build --platform ios --profile production`. This
   cloud-builds a signed `.ipa`.
4. **[YOU]** Submit the build to App Store Connect / TestFlight:
   `eas submit --platform ios --latest` (it asks for your Apple credentials or an
   App Store Connect API key on first run).
5. **[YOU]** Install via TestFlight on your own iPhone and walk the flows
   (capture-to-inbox, today view, a push, the demo path). Fix anything, rebuild.
6. **[AGENT]** In App Store Connect, fill the listing from `MOBILE_STORE_LISTING.md`:
   name, subtitle, promo text, keywords, description, support/marketing/privacy URLs,
   copyright. Upload the 1024 icon and the screenshots. Set category Productivity,
   price Free. Paste the App Review notes (and the demo instructions).
7. **[AGENT]** Complete the App Privacy questionnaire from the verified data-safety
   section. Confirm the encryption declaration
   (`ITSAppUsesNonExemptEncryption=false` is already in `app.json`; verify the E2E
   caveat in the listing doc before relying on it).
8. **[YOU]** Attach the build, then click **Submit for Review**. Review is usually
   1-3 days.

## Android, Google Play

1. **[AGENT]** In Play Console, create the app (default language, app name), set it
   Free and category Productivity.
2. **[YOU]** Build: `eas build --platform android --profile production`. This
   cloud-builds a signed `.aab`.
3. **[YOU]** First upload is manual. Download the `.aab` from EAS and upload it to an
   **Internal testing** track in Play Console. (Google requires the first bundle by
   hand; after that, `eas submit --platform android` works with a Google Play
   service-account JSON key you create in the Google Cloud console and add to EAS.)
4. **[YOU]** Add yourself as an internal tester, install from the Play link, and walk
   the flows on a real Android device.
5. **[AGENT]** Fill the store listing from `MOBILE_STORE_LISTING.md`: title, short
   description, full description. Upload the 512 icon, the feature graphic
   (`brand/png/researchos-play-feature.png`), and the screenshots.
6. **[AGENT]** Complete the required Play forms: Data safety (from the verified
   section), content rating (IARC questionnaire), target audience, the privacy
   policy URL, ads declaration (no ads), and the app-access note (how a reviewer
   reaches the demo without a desktop).
7. **[YOU]** Promote from Internal testing to Production (or Closed/Open testing
   first if you want a wider beta), then click **Roll out**. Review is usually hours
   to a couple of days.

## After launch

- **[YOU]** Add the Apple $99/year renewal to the `/admin/business` deadline strip so
  the membership does not lapse (a lapse pulls the app from sale).
- **[YOU]** Shipping an update: bump `version` (and the native build number) in
  `app.json`, `eas build`, `eas submit`, then submit the new build for review. The
  store listing text persists; you only add "What's New" notes.
- **[YOU]** When the LLC org accounts are ready, do the App Transfer (Apple) and Play
  Console transfer to move the listing under ResearchOS LLC.
- Consider EAS Update (over-the-air JS updates) for small fixes without a full store
  review, optional, the mobile workstream's call.

## Quick reference: the command sequence

```
# one time
npm i -g eas-cli
eas login
eas build:configure

# each release
eas build --platform ios --profile production
eas submit --platform ios --latest
eas build --platform android --profile production
# first android release: upload the .aab manually in Play Console
# later android releases: eas submit --platform android
```

Everything else (the listing fields, screenshots, privacy forms, the Submit/Publish
clicks) happens in the two web consoles, per the [YOU]/[AGENT] tags above.
