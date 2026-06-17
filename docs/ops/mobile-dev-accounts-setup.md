# Mobile dev accounts setup (operator checklist)

For the iOS + Android apps.

## CORRECTION (2026-06-17): Apple individual enrollment was NEVER completed

Grant checked on 2026-06-17: the Apple individual enrollment was never finished.
He had reached the final enrollment page but never paid or submitted, so there is
NO active Apple membership of any kind. The earlier "enrolled as Individual, paid
($99/yr)" status below (2026-06-07) was written ahead of the fact and is WRONG.

Decision (Grant, 2026-06-17): abandon the individual flow and enroll Apple as the
**ResearchOS LLC organization** directly (route B), using D-U-N-S 145038194. This
supersedes the 2026-06-10 route-A call. Because individual was never paid, there
is no second-membership overlap cost and no later App Transfer needed. Restart the
Apple enrollment, choose Company / Organization (not Individual), and enroll under
the LLC role Apple ID. See section 1 below for the org steps.

Cleanup owed: clear any premature `appleEnrollmentId` / enrollment date in the
`/admin/business` entity card and remove any phantom $99 Apple "Dev accounts"
ledger line, since no payment ever happened (keep the books honest).

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

## UPDATE (2026-06-10): D-U-N-S obtained, the LLC org path is now unblocked

The D-U-N-S number was ASSIGNED on 2026-06-10 (Dun & Bradstreet, 9 digits), only
days after applying, well inside the "up to 30 days" SLA. The number is NOT
printed in this open-source repo; it lives in the `/admin/business` entity card
(the `duns` field, private Neon) and the LLC vault (`~/Documents/ResearchOS_LLC/`).
This removes the only gate that was blocking org enrollment on both stores.

What it changes, per store:

- **Android (the planned org path, now do it).** Create the LLC ORGANIZATION Play
  account ($25 one-time), verify the entity with the D-U-N-S, and build the
  Android app FRESH there. Organization accounts are EXEMPT from the 12-tester /
  14-consecutive-day closed test (re-verified against Google's live help page
  2026-06-10), so this skips the bottleneck entirely. Do NOT ship Android on the
  personal account, and do NOT transfer a personal-account app into the org (the
  closed-test requirement can attach to the app, not just the account). Nothing
  has shipped on Android yet, so there is nothing to transfer.

- **iOS (a real decision, not forced).** The app is already enrolled on the
  Individual Apple account ($99/yr paid) and iOS is shipping first from there; the
  only iOS gate is reviewer demo mode (`docs/proposals/MOBILE_REVIEWER_DEMO.md`),
  not the account type. The D-U-N-S now lets the LLC become the seller of record
  if wanted. Apple does NOT convert an Individual membership to Organization, so
  the two routes are:
  - **A. Stay Individual for the first release, App-Transfer to the LLC org later.**
    Lowest friction to launch. App Transfer keeps reviews, ratings, and users, and
    runs while the app stays live. Criteria to meet before a transfer: the app must
    not be pending validation/modification on either side, TestFlight beta testing
    off for all versions, and (if it ever offers auto-renewable subscriptions) an
    app-specific shared secret generated first. The receiving org's Apple ID must
    exist. The transfer holds in "Pending App Transfer" until accepted (60-day
    window).
  - **B. Enroll the Apple org now and ship the first release under the LLC.** The
    listing shows ResearchOS LLC as seller from day one, no later transfer. Cost is
    a SECOND $99/yr membership during any overlap, plus an entity-verification step
    Apple may do by phone. Org enrollment uses Apple's D-U-N-S lookup; allow up to
    ~5 business days for the D&B record to propagate to Apple's tool.

  DECISION (Grant, 2026-06-10): route A. Ship iOS now on the Individual account
  (the reviewer-demo gate is the real blocker, not the account type), then
  App-Transfer the app to the LLC org after it is live. Meet the transfer criteria
  above before initiating. Add "App-Transfer iOS app to LLC org" as a tracked
  /admin/business task once the app is live so it does not get forgotten.

**Business phone line (bought 2026-06-10).** Both store signups require a real,
verifiable mobile number that is also shown on the public developer profile, and
VoIP / Google Voice numbers are rejected (Google runs live line-type checks). So
the LLC got a dedicated **Tello Pay As You Go eSIM** ($24.68 charged, no monthly
plan), installed as a second line on Grant's iPhone so his personal number stays
private. Keep it alive with a small top-up at least once every 3 months, or the
number lapses and the store listing contact goes dead. The $24.68 auto-logs to
`/admin/business` (ledger source `tello-esim-2026-06-10`). Reuse the same number
for Apple enrollment. The number is assigned at activation (pending the ZIP step
at purchase time).

Sources (verified 2026-06-10): Apple
[D-U-N-S help](https://developer.apple.com/help/account/membership/D-U-N-S/),
[App transfer overview](https://developer.apple.com/help/app-store-connect/transfer-an-app/overview-of-app-transfer/);
Google [org-account testing rules](https://support.google.com/googleplay/android-developer/answer/14151465).

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

## 0. Get a D-U-N-S number for ResearchOS LLC (DONE 2026-06-10)

DONE. The 9-digit D-U-N-S was assigned 2026-06-10 and is stored in the
`/admin/business` entity card + the LLC vault (not in this repo). Before
enrolling, confirm Apple's lookup tool finds it
(https://developer.apple.com/enroll/duns-lookup/, search "ResearchOS LLC"); allow
up to ~5 business days after assignment for the D&B record to reach Apple. The
legal entity name + address must match the LLC formation docs exactly across
Apple and Google enrollment.

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
