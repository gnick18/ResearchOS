# Mobile dev accounts setup (operator checklist)

For the iOS + Android apps.

## STATUS (2026-06-07): both accounts enrolled, PERSONAL

Decision was made to launch under PERSONAL accounts, not the LLC org, to skip the
D-U-N-S wait. Both are done:
- **Apple Developer Program: enrolled as Individual, paid ($99/yr).** Seller name
  shows as Grant personally.
- **Google Play Console: registered as a personal account.**

Transfer to the ResearchOS LLC org later (Apple App Transfer; Google account
transfer, which Google charges a fee for). The D-U-N-S (still being obtained) is
what an org transfer will need; it is no longer blocking launch.

## UPDATE (2026-06-09): Android moves to the LLC org Play account, iOS stays individual-now

Sequencing decided 2026-06-09 (supersedes the "launch under personal" call above for ANDROID):
- iOS ships FIRST on the individual Apple account (works now, no D-U-N-S). The only
  gate is reviewer demo mode (`docs/proposals/MOBILE_REVIEWER_DEMO.md`).
- Android does NOT launch on the personal Play account. Wait for the D-U-N-S plus an
  LLC ORG Play account and build Android there, which skips the closed test entirely.
  Burning the 14-day clock on the personal account is exactly what we are avoiding.

Policy verified against the live Google page on 2026-06-09
(support.google.com/googleplay/android-developer/answer/14151465): the closed test is
"at least 12 opted-in testers for 14" CONSECUTIVE days, and it applies to "personal
accounts created after November 13, 2023" only. Organization accounts are not subject
to it. RE-VERIFY at submission time, store policies shift (there is an April 15, 2026
Google policy-announcement page worth re-reading then).

Transfer caveat (verify before relying on it): the account type cannot be converted
personal to org. You create a NEW org account (US$25, refundable once you close the
personal one) and transfer apps into it. Community reports indicate an app that STARTED
on a personal account can still be held to the closed-test requirement after a transfer
(the requirement attaches to the app, not only the account), so the clean exempt path is
to build and submit the Android app FRESH on the org account, NOT to transfer a
personal-account app. Nothing has shipped on Android yet, so there is nothing to
transfer, just build on the org account once it exists.

### GOOGLE: the personal-account closed-testing requirement (the real bottleneck)

New Google Play PERSONAL developer accounts (created after Nov 2023) must run a
closed test with at least 12 testers opted in for 14 continuous days BEFORE they
can apply for production access. Org accounts are exempt; personal accounts are not.

Implication: the 14-day clock, not the build, is the gate to a public Android
launch. Start it as EARLY as there is an installable build:
1. Build an `.aab` (even a near-final one) and upload it to a Closed testing track.
2. Recruit at least 12 testers (labmates, friends) and have them OPT IN via the
   testing link and keep the app installed.
3. Let it run 14 continuous days, then apply for production access.
4. Keep iterating builds during the 14 days; the clock keeps running.

Recording the costs: log both in `/admin/business` as money OUT, category "Dev
accounts" (Apple $99 recurring yearly, Google $25 one time). Add the Apple renewal
date to the deadline strip so the membership does not lapse.

The original org-enrollment plan and the D-U-N-S step below are kept for the future
LLC transfer, they are no longer the launch path.

---

(Original org-enrollment guidance, retained for the eventual LLC transfer.)

Enroll-as-ORG notes: the LLC becomes the seller of record (more professional,
easier to transfer/manage), but Apple org enrollment REQUIRES a D-U-N-S number,
which is why the D-U-N-S step comes first. Use a ROLE email you control for the
LLC, and store every credential in the LLC vault (~/Documents/ResearchOS_LLC).

---

## 0. Get a D-U-N-S number for ResearchOS LLC (do this first, it gates Apple)

Free from Dun & Bradstreet, but can take 1-2 weeks, so request it immediately.

1. Go to https://developer.apple.com/enroll/duns-lookup/ and search for
   ResearchOS LLC. If it already has a D-U-N-S, note the number and skip ahead.
2. If not found, request one (free) via the same lookup flow or
   https://www.dnb.com/duns-number/lookup.html.
3. The legal entity name + address you give MUST match exactly what you will use
   in Apple/Google enrollment and what is on the LLC formation docs.

Verify: you have a 9-digit D-U-N-S number for ResearchOS LLC.

---

## 1. Apple Developer Program (org, $99/year)

1. Sign in at https://developer.apple.com/enroll with the LLC role Apple ID
   (enable two-factor; this Apple ID becomes the account holder).
2. Choose enrollment type ORGANIZATION (Company / Organization).
3. Enter the legal entity name + D-U-N-S number from step 0. They must match.
4. Apple may call to verify the entity (you must have authority to bind the LLC).
5. Pay the $99/year with the LLC card. Submit.

Verify: enrollment shows "pending" then "active"; you can see App Store Connect.
Note the Team ID (the other agent will need it for signing + bundle IDs).

Lead time: review can take a few days to a couple weeks after D-U-N-S verifies.

---

## 2. Google Play Console (org, $25 one time)

1. Go to https://play.google.com/console/signup with the LLC role Google account.
2. Choose account type ORGANIZATION (not personal).
3. Complete identity verification (Google may ask for the D-U-N-S / entity docs
   for org accounts; have step 0 ready).
4. Pay the $25 one-time registration fee with the LLC card.

Verify: the Play Console account is active and shows ResearchOS LLC as the org.

---

## After the accounts exist (hand to the app agent)

- Apple: Team ID, the bundle identifier(s) you reserve, and signing certificates
  / provisioning profiles (the agent can generate these once enrolled).
- Google: the Play Console app entry + the package name.
- TestFlight (Apple) and internal testing track (Google) for getting builds onto
  your own devices before any public release.

The app agent can keep scaffolding now; none of this blocks development, only
device testing + distribution.

---

## What gets recorded on the business pages

- When paid, record both in the /admin/business ledger as money OUT, category
  "Dev accounts": Apple $99 (recurring yearly) and Google $25 (one time).
- The Apple $99/year is a recurring obligation; once enrolled, add its renewal
  date to the deadline strip so it does not lapse.
- The monthly money-flow "out" bar shows the amortized Apple cost (~$8.25/mo) as
  a "Dev accounts" line so the cost picture includes it.
