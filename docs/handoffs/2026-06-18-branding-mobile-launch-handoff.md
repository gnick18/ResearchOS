# Handoff: branding + mobile-store launch (2026-06-18, Branding lane)

A long session covering the public brand launch surfaces (LinkedIn, social banners,
merch pack), a real security fix, email routing, and the Android/iOS store
submissions. Everything below is committed to `main` and on origin (the shared main
churned hard mid-session from concurrent lanes, but the work reconciled in;
confirmed `786201b7b` is an ancestor of main and all deliverable files are in HEAD).

House voice throughout: no em-dashes, no mid-sentence colons, no emojis, state the why.

## LinkedIn company page (LIVE)
- Page `linkedin.com/company/researchos-eln`. Filled: tagline ("The free, open-source
  lab notebook your research lives in, not someone else's cloud."), the Option-D
  About (welcome-page voice, covers all features), 20 specialties, location (Madison
  WI), industry (Biotechnology Research), founded year, and the centered dark banner.
- Copy source: `docs/branding/MESSAGING.md` (live tagline canonicalized there).

## Social banners (Option D, BUILT; posting ON HOLD)
- `brand/png/researchos-banner-{linkedin,bluesky,youtube}-dark.png` (+ light LinkedIn),
  vector in `brand/researchos-banner-linkedin-{dark,light}.svg`, generator
  `brand/src/social-banner-d.html`. Real Geist 800 + rainbow OS (luminous on dark,
  vivid on light). LinkedIn is CENTERED so the page avatar does not overlap the wordmark.
- POSTING IS ON HOLD until billing ships (target ~week of 2026-06-22). Three launch
  posts drafted in `docs/marketing/launch-posts-backlog.md`. Memory `[[project_social_launch]]`.

## Two founders (copy now plural)
- ResearchOS has TWO founders: Dr. Grant Nickles + Dr. Emile Gluck-Thaler. "Built by"
  copy is now plural across Terms, Privacy, MESSAGING, the deck, and design docs.
  Memory `[[user_grant_identity]]`. NOT yet confirmed: Emile's institution, byline
  form, and whether he is an LLC member (do NOT assert co-ownership or change
  LLC/registered-agent/copyright facts without Grant).

## /admin security fix (SHIPPED + PUSHED to prod)
- The operator console leaked the price-modeling tool (provider cost, Stripe fee,
  margins) to ANY visitor, because those figures are client-computed, not API-gated.
- Fixed: `frontend/src/app/admin/page.tsx` is `force-dynamic` + `isOperator()` and
  renders `<OperatorAccessRequired/>` (a sign-in screen) for non-operators, never the
  shell. Verified logged-out `/admin` shows the sign-in screen with no cost-model
  content. Memory `[[reference_admin_route_gating]]`. RULE: any internal page that
  renders client-computed figures must page-gate, not trust API-gating alone.

## Support email routed to the LLC
- ALL mail to `@research-os.app` (catch-all) now forwards to `researchos.llc@gmail.com`
  (was `gnickles@wisc.edu`). ForwardEmail TXT on Vercel DNS, swapped via the Vercel
  CLI, verified at the authoritative nameserver. Doc `docs/SUPPORT_EMAIL_SETUP.md`.

## researchos.app (hyphen-less) domain watch
- Held by an abandoned "Aiona" prototype (dead Railway backend), Namecheap, expires
  2026-11-22, real drop ~early Feb 2027. Cannot buy now. Plan: drop-catch backorder
  before the drop (target queue ~2026-10-15). Tracked as the `researchos-app-drop-watch`
  deadline in the operator console + a scheduled reminder fires Oct 5 2026. Proposal
  `docs/proposals/researchos-app-domain-watch.md`, memory `[[project_researchos_app_domain_watch]]`.
  Canonical domain is `research-os.app` (hyphenated); never print the hyphen-less form.

## Designer / merch brand pack (SENT to designers)
- `brand/designer-brand-pack.html` (casual one-pager: BeakerBot, palette+hex, Geist,
  logo dark/light, usable phrases). Bundled with the asset SVGs into
  `~/Desktop/ResearchOS-Brand-Pack` (+ zip). Sent to two designer friends (Hannah
  Gasper + one) to design merch by reinterpreting BeakerBot in cool art styles. The
  one rule given: keep him a friendly beaker with a face + pastel rainbow goo.

## Apple App Store (org enrollment IN PROGRESS)
- The individual enrollment was NEVER completed. Submitted the ResearchOS LLC ORG
  enrollment 2026-06-17, enrollment ID `263RG7VFWB`, now in Apple entity/authority
  verification (days to ~2 weeks). Walkthrough `docs/ops/apple-org-enrollment-chrome-claude.md`
  (includes step 0 = create LLC Apple ID). Once active: `eas build --platform ios`,
  App Store Connect app, paste the listing copy, capture iOS screenshots, submit.
  Reviewer demo mode is already built. Doc corrections in `docs/ops/mobile-dev-accounts-setup.md`.

## Google Play (Android v1.0.0 SUBMITTED, IN REVIEW)
- LLC ORG Play account. App `app.researchos.companion`. v1.0.0 (version code 2)
  submitted and IN REVIEW on the OPEN TESTING track (not Production yet), 3 countries
  (Canada, South Africa, United States), managed publishing ON (auto-publishes on
  approval). First-app review ~a few days to ~2 weeks; may bounce on data-safety /
  content-rating / privacy.
- Store listing COMPLETE: app name, rewritten fuller short + full description (sells
  all seven tabs, not just photo capture; in `docs/proposals/MOBILE_STORE_LISTING.md`),
  512 icon, feature graphic, and screenshots. Assets staged in `~/Desktop/ResearchOS-Play-Upload`.
- SCREENSHOTS captured via emulator demo mode: 18 shots (phone 1080x2400, 7-inch
  1200x1920, 10-inch 1600x2560), 6 each (home, method-read, notebook, methods,
  inventory, calc), in `~/Desktop/ResearchOS-Play-Upload/screenshots/{phone,tablet-7in,tablet-10in}`.
- POLICY (important, in the runbook): the app must NEVER take payment in-app. Users buy
  on the web and the app only signs into their account, so Stripe is clear. An in-app
  upgrade that charges would trigger Google Play Billing. Launch status + protection
  settings + this policy are recorded in `docs/ops/mobile-publish-runbook.md`.

## Demo videos (NOT done; approach pivoted)
- Tried scripted emulator screen recordings (adb taps + screenrecord). They came out
  janky (fixed-coord taps, keyboard-layout shifts, screenrecord went unstable after
  many captures). NOT good enough for marketing.
- PIVOT: record on Grant's real Samsung. Sideload the preview APK (installable;
  production AAB cannot be sideloaded) via a QR (on Desktop `researchos-apk-qr.png`),
  open Try the demo, turn on Developer options > Show taps + screen recorder No sound,
  and capture the interaction flows (type a note, step through a protocol, snap+annotate
  a photo, run a timer, live calc, inventory reorder). A fresh production-matching
  preview APK (version code 2) was building at pause for an exact-match QR.
- Integration target: the welcome page already has a "Companion app spotlight" section
  using `DemoLoop` with videos hosted on R2 (`welcome/<name>.mp4` + poster) behind a
  flag. So "add to welcome" = optimize the real clips (ffmpeg) -> upload to R2 ->
  reference in `DemoLoop`. The welcome page is a LOCKED designed surface; wire the
  chosen clips into the companion section only.

## What's left / next
- Grant: finish Android (it is in review; nothing to do but wait, watch for a
  data-safety/content-rating bounce). Record the demo clips on the Samsung and send
  them over; I edit + wire into the welcome companion section + cut social versions.
- iOS: wait for Apple enrollment to go active, then build + list + screenshot + submit.
- Social posting: starts ~week of 2026-06-22 once billing is live; draft the 3 posts.
- Optional: refresh the Play feature graphic (still the old "snap a photo" headline,
  undersells like the old description did).
- Confirm Emile's institution + LLC-membership before any copy asserts co-ownership.
- researchos.app: queue a drop-catch backorder ~Oct 2026 (reminder is set).

Sign-off: Branding lane.
