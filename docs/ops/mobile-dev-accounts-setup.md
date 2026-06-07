# Mobile dev accounts setup (operator checklist)

For the iOS + Android apps. Start NOW even though the apps are still being built,
because enrollment has real lead time (the D-U-N-S number below can take 1-2
weeks, and store identity review takes days). The apps build + run in simulators
without these; the accounts gate REAL-DEVICE testing, TestFlight, and store
submission.

Costs: Apple Developer Program $99/year (recurring). Google Play Console $25 one
time. Pay both from the LLC card (Mercury), not a personal card.

Enroll as the ORGANIZATION (ResearchOS LLC), not an individual. The LLC becomes
the seller of record (more professional, easier to transfer/manage), but Apple
org enrollment REQUIRES a D-U-N-S number, which is why step 0 comes first.

Use a ROLE email you control for the LLC (not a throwaway), and store every
credential in the LLC vault (~/Documents/ResearchOS_LLC), not a personal store.

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
