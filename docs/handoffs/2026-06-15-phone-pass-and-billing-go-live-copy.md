# Handoff: on-device phone pass + billing-go-live copy (2026-06-15)

Billing / phone-pages lane (took over the throttled "Billing" chat, second session). Everything below is on **local main**; some early commits already reached **origin** (a sibling push carries the whole shared main — MobileUI confirmed). All gate-safe (tsc 0, flag-gated where relevant). Predecessor handoff: `docs/handoffs/2026-06-15-phone-pages-citation-disclosure.md`.

## 1. Phone-compatible pages — DONE + on-device verified (Galaxy S22 / Chrome 149)
Welcome V1 + Phase 2 reflows (Pricing / AI / Transparency / Dept+Inst) all merged earlier this session. Then a **live phone pass** (real device over `adb reverse`) drove these changes:

- **Phone mirrors the desktop site now** (Grant's call): dropped the bespoke `PhoneTriCta` hero (companion / open-on-desktop / "Be first to know" cards) — the standard desktop hero renders on every device, just reflowed. Companion-app content stays in the shared section #7. Commit `a8c1fdfa8`.
- **"Be first to know" notify card removed** — it implied an email list/sender we DON'T have (it was a `mailto:` to researchos.llc@gmail.com; no ESP, no `/api/.../waitlist`). Gone with the tri-CTA.
- **"What we're building" roadmap chip removed** (both nav + final-CTA footer); `RoadmapModal.tsx` kept (still used by `UserLoginScreen`). Commit `dd9d146d3`.
- **Desktop-required yellow banner hidden on phones** — still shown for unsupported DESKTOP browsers (Safari/Firefox). Gated `unsupported && !isMobile`. Commit `942b409ab`.
- Brand-free companion "coming soon" pill (`2367767c6`) + open icon-library block (`0790ef93b`) from earlier in the session.

### BUG FIXED: Chrome 149 Android broke phone detection (`167094d53`)
`isFileSystemAccessSupported()` used `"showDirectoryPicker" in window`, but **Chrome 149 on Android now EXPOSES that API**, so every phone returned true → was routed PAST the read-only welcome path (providers.tsx:785) into the desktop folder-connect / account-first dead-end. Fixed by excluding mobile. Centralized as **`isMobileDevice()`** in `lib/file-system/file-system-context.tsx` (userAgentData.mobile + UA fallback); `isFileSystemAccessSupported()` now returns `!isMobileDevice()` when the API is present. Desktop (incl. touch laptops) unaffected. **Flagged to the Popup Unifier / identity lane** (it shifts what mobile sessions hit at the front door — they no longer reach OAuthFirstLanding).

### On-device test rig (reusable)
`adb -s <serial> reverse tcp:3000 tcp:3000` then open `http://localhost:3000` on the phone. For definitive DOM/flag reads: `adb forward tcp:9222 localabstract:chrome_devtools_remote`, `curl localhost:9222/json` for the tab ws URL, then a node global-`WebSocket` client → DevTools `Runtime.evaluate`. (Grant's S22 serial seen as `R3CTB09L7KA`.) NOTE: the `:3000` server is a **sibling lane's** dev server on the shared main checkout; its "Compiling…" indicator flashes under multi-lane HMR churn (that was the "card flickering in the corner" — NOT a layout bug).

### Still open on phone-pages
- **dept/institution NOT yet eyeballed on device** — they need the tier flags, and a second `next dev` can't start (Turbopack lock on the shared `:3000`). Spin a **production build** (`next build && next start`) in an isolated worktree with `NEXT_PUBLIC_DEPT_TIER_ENABLED=1 NEXT_PUBLIC_INSTITUTION_TIER_ENABLED=1` to cover them + get a flicker-free pass.
- Minor: on a phone the hero "Start your notebook" CTA just scrolls to top (banner it used to reveal is now hidden on mobile). Not a dead-end; adapt only if Grant wants.
- Grant still to eyeball /pricing, /ai, /transparency on the phone.

## 2. Billing GOES LIVE during beta — copy wired flag-driven (Grant decision)
Grant: turn real payments on during the beta (live testing is the bug harness). **Stripe Tax cleared the last hard blocker** (auto-computes + collects; legal deferred to the processor). All "free during the beta" customer copy is now **flag-driven** so it flips to live pricing the instant the flags flip:
- Server pages `/pricing`, `/terms`, `/wiki` read `isBillingEnabled()` / `isAiBillingEnabled()` from `lib/billing/config.ts` (added shared `isAiBillingEnabled()`). Commits `3d1af0953` (terms/wiki), `fa21c9e38` (pricing).
- Client Welcome reads `NEXT_PUBLIC_BILLING_LIVE` + a compact **tier summary** (Free 5GB / Plus-Pro / Labs / Dept+Inst SHAPE, who pays — **no provisional sticker prices**). Commit `224e9acb7`.
- Docs updated: `docs/proposals/2026-06-13-billing-go-live-checklist.md` (Stripe-Tax blocker #4 marked done; `NEXT_PUBLIC_BILLING_LIVE` added to the flip list) + `docs/reference/billing-copy-facts.md` (superseded the "free during beta / never imply billing live" guardrail; kept the no-provisional-prices rule). Commit `9044f13d2`.

### To actually go live (Grant, in Vercel + redeploy)
Set `BILLING_ENABLED=true`, `AI_BILLING_ENABLED=true`, `NEXT_PUBLIC_BILLING_LIVE=1` (+ `NEXT_PUBLIC_AI_ASSISTANT_ENABLED`, tier flags per the checklist). Recommended sequence: flip `AI_BILLING_ENABLED` first (AI packs, smallest blast radius), then storage/org. NEXT_PUBLIC bakes at build → needs a redeploy.

### DECISION PENDING (Grant)
The **Plus/Pro sticker prices** ($8/$32 individual, $15/$45 lab in `plans.ts`) are still marked **provisional / do-not-publish**. Grant said the modeling is "nailed down" — confirm whether they're final + OK to publish. If yes: unlock them and put real prices on the Welcome tier summary + pricing cards (edit `assumptions.ts`/`plans.ts` + `billing-copy-facts.md`, never hardcode). If no: current "at our cost" + calculator framing stays.

## 3. Coordination (all 6 sibling lanes deconflicted)
MobileUI (companion app + git-state relay), Phylo, BeakerAI, Figure Composer (asset-library), INJEST (icon-library/ingest), Popup Unifier (identity/front-door). Key shared facts:
- **R2 `welcome/` bucket**: both asset lanes (Figure Composer + INJEST) use `rclone copy` (never `sync`) and list `welcome/` as a protected foreign prefix; CSP allows `assets.research-os.com` (shared with the live icon library) so the welcome demo clips load in prod.
- **Companion launch hooks** are MobileUI's: at store launch, swap the brand-free pill for official Apple/Google badge artwork + flip `NEXT_PUBLIC_COMPANION_APP_LIVE`. `PLAY_STORE_URL` package `app.researchos.companion` confirmed; Apple listing blocked on enrollment.
- **Front-door mobile change** (the FSA fix) flagged to Popup Unifier — phones no longer reach the account-first landing.
- **Wiki-coverage prebuild gate**: adding a route to `NAV_ITEMS` without a wiki page fast-fails every Vercel build (tsc does NOT catch it). Run `node scripts/check-wiki-coverage.mjs --ci` (from `frontend/`, script is at repo-root `scripts/`) before merging any new public route.

## Carried over (Grant actions, from the prior handoff)
Enter `PJ000007271` in the operator console (`/admin#finances`); send the Petra email (drafted); push local main when ready.
