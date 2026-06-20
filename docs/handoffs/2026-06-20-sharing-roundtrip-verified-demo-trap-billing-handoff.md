# Sharing round-trip verified on prod + demo-trap fix + billing-trial fix (2026-06-20)

Owner: Billing/account lane. House voice: no em-dashes, no emojis, no mid-sentence
colons. Everything below is on `origin/main` (deployed) unless marked LOCAL MAIN
(landed on Grant's tree, not pushed) or BRANCH.

## TL;DR

1. The cross-folder sharing round-trip is VERIFIED end-to-end on prod (the prior
   handoff's #1 open item, which was blocked locally by R2 + the paid-send gate).
2. Found, root-caused, and fixed a real prod DEMO TRAP (signed-in user with a
   connected folder kept auto-warping into the demo). Merged to prod.
3. A test-comp system is in place so billing never blocks a prod test again
   (/admin gift, no Stripe).
4. Found and fixed a real BILLING bug (Settings "Start Lab" sent Free users to
   live Stripe instead of the no-card 90-day trial). LANDED LOCAL MAIN, needs a
   browser-verify before Grant pushes to prod.
5. Removed the dead warp machinery the demo-trap fix orphaned. LANDED LOCAL MAIN.
6. Start-of-session: shipped the no-card-trial visual pass (dark-safe chips +
   /labs reassurance chip).

## 1. Sharing round-trip VERIFIED on prod (the headline)

Done as a live 2-identity, 2-browser test on research-os.app, driven via the
Chrome extension. Full chain proven: note encrypted to recipient pubkey -> relay
`POST /api/relay/send` -> stored in R2 -> fetched into recipient inbox -> decrypted
with recipient key -> signature + integrity verified -> plaintext readable.

Both predicted local blockers are CONFIRMED ABSENT on prod: no 402 (entitlement
passed), no R2 500 ("R2_BUCKET not set" does not happen, R2 is configured on prod).

Test setup (reusable):
- SENDER: account `gnick317@gmail.com` (display "Dr. Grant Nickles", identity
  fingerprint `bd27 bff0 fb4f 0365`), folder `~/Desktop/ros-share-sender`, in the
  normal Chrome profile (Browser 1). Recovery code captured:
  `5EW4-F9WP-HYHP-WA26-EYXV-V652-1C`. Comped to Solo (see section 3) to clear the
  send gate.
- RECIPIENT B: account `researchos.llc@gmail.com` (display "ResearchOS"), folder
  `~/Desktop/ros-share-recipient`, in an INCOGNITO window (Grant captured B's
  recovery code). B published keys first so the directory lookup resolved.
- Test note: "Sharing round-trip test note" with body marker `ROUNDTRIP-7Q42-KIWI`.

The recipient "Review shared item" dialog showed From `gnick317@gmail.com`,
fingerprint match, the green "sealed to your key, signed by the sender, passed its
integrity check", and the readable marker. That is the decrypt proof.

Tooling caveat: the Chrome extension cannot drive an INCOGNITO window. It registers
as the same "Browser 1" device and the incognito tab is not exposed to the
automation tab group, even with "allow in incognito" on. The final Review click was
Grant's by hand. For a fully agent-driven recipient verification, put B in a normal
second Chrome profile (not incognito) and connect the extension there.

## 2. Demo trap (found + fixed + on prod)

Symptom: a signed-in user with a real connected folder auto-redirected into the
demo sample lab on every boot, and Leave demo -> Reconnect bounced right back into
demo (a trap out of the real folder). Hit organically during the test.

Root cause (the prior handoff's theory was WRONG): not the v4 tour retirement (that
is a separate, dead system). The NEW LLM tutor's no-warp redesign updated
`OnboardingTutor.tsx` to play inline, but `TourHost.tsx` kept the pre-redesign
resume effect: any persisted `phase:"playing"` progress
(`ros.onboardingTutor.progress.v1`), when not already in demo, called
`beginTourDemoSession` -> hard-reload into /demo. Fired every boot.
`file-system-context.tsx` enters demo only via `getDemoMode()`/route, so TourHost
was the sole re-entry path. See `[[project_demo_trap_stuck_tour]]`.

Manual recovery (if seen again before the deploy lands): delete 7 storage keys, the
1 localStorage `ros.onboardingTutor.progress.v1` plus the 6 sessionStorage demo/tour
keys (`researchos:demo-mode`, `-current-user`, `-main-user`, `-handle`,
`pre-demo-route`, `onboarding-tour-resume`). The real folder then loads clean.

Fix: TourHost resume now stays inline (no demo warp), kept a one-way demo EXIT in
`handleComplete` to rescue anyone already stuck, defensive `clearTourProgress()` /
`clearTourResume()` in `LeaveDemoModal.goHome`, plus a TourHost regression test.
Merged: Grant pushed `a5ed7db59..335595cd1` to origin/main, Vercel deploy in flight.

## 3. Test-comp system (so billing stops blocking prod tests)

To make a test account produce-entitled with NO Stripe, as operator: `/admin` ->
Accounts -> the star (Gift premium) on the row -> pick tier (Solo/Lab/Dept) + Months
(required, permanent not allowed per decision 3) + optional Storage GB / Writes ->
Issue gift. Used Solo / 12mo / 5GB / 1 writes on the sender; after an app reload it
was immediately able to send "Outside your lab". This is THE billing-free path for
prod tests. See `[[reference_test_comp_and_entitlement]]`.

Note on the entitlement gate (works as designed): a Free account cannot send outside
its folder, the share panel shows a Solo upsell instead of an email field
(`isProduceEntitled`). The "Solo" tag in the folder list is the FOLDER TYPE, not a
paid plan, the word is overloaded.

## 4. Billing bug: Settings "Start Lab" bypassed the no-card trial (FIXED, LOCAL MAIN)

Settings -> Plan & storage "Start Lab" was calling `/api/billing/model-a/card-setup`
(live Stripe Checkout, save a card) for BOTH Solo and Lab, so a Free user upgrading
to Lab was sent to Stripe and the no-card 90-day trial never started.
`docs/branding/PRICING.md` is canonical and unambiguous: Solo keeps save-a-card,
only Lab gets the no-card trial. The onboarding path already did it right
(`AccountTierChooser` -> `LabCreateResume` -> `/api/billing/model-a/start-trial`).
The Settings upgrade was just never updated when LabCreateResume was (2026-06-19).
An omission, not an intended fork.

Fix (`frontend/src/components/billing/ModelABilling.tsx`, FreePanel): split into
`startSolo()` (card-setup -> Stripe, unchanged) and `startLabTrial()` (`start-trial`,
no Stripe, reloads status into PaidPanel with the trial countdown) + per-plan copy.
No pricing numbers or Stripe IDs touched. `start-trial` is billing-state-only and
assumes the lab is already provisioned by the lab-create path, so no provisioning
regression. Cherry-picked to LOCAL MAIN as `408282178`. Merged-tree tsc 0.

BEFORE PUSHING TO PROD: browser-verify the full Settings "Start Lab" -> working
trialing-lab flow once (it changes live billing behavior). Pre-existing open
question, unchanged by this fix, is whether a Free -> Lab upgrade from Settings
provisions a real lab workspace or only the billing tier. Tiny cosmetic leftover, a
stale comment in `frontend/src/lib/sharing/oauth-first-signin.ts` ~L51-57 still
describes the old card-setup behavior.

## 5. Dead warp-machinery cleanup (LANDED LOCAL MAIN)

Removed the inert machinery the demo-trap fix orphaned: `LiveCursorLayer.tsx`
(deleted), `beginTourDemoSession` + its interface and test block, the `live` /
`onBeginShow` props on `OnboardingTutor`. Kept the live demo-EXIT rescue
(`endTourDemoSession` via `TourHost.handleComplete`) and the resume markers
(`hasTourResume`/`clearTourResume`, used by AppShell + LeaveDemoModal). tsc 0, 327
onboarding tests pass. Cherry-picked to LOCAL MAIN as `baf4f5374`.

## 6. No-card-trial visual pass (start of session, ON PROD)

- Dark-mode-safe green reassurance chips on the no-card trial copy
  (AccountTierChooser tier badges + join-a-lab box, LabStep note). They were
  light-only Tailwind greens rendering as light-mode islands in dark mode; now use
  the app's `dark:bg-green-500/15` pattern. On origin/main (`3f18a18e2`).
- `/labs` hero: replaced the bold no-card sentence with a green reassurance pill
  (mirrors the page's existing sky kicker pill) + muted why-copy, reusing the
  verified `check` glyph. On origin/main (`9832eb77c`).

## NEXT / open

1. Billing fix browser-verify + push to prod (section 4). Owner decision.
2. Auto-claim no-email fallback on prod (carried from prior handoff, still
   untested, lowest priority, prod-only trigger is ORCID-no-email or a lapsed
   session).
3. Owner-mapped refund/dispute live test + Stripe statement-descriptor PREFIX
   (carried billing items).
4. Optional: cosmetic comment cleanup in oauth-first-signin.ts; the pre-existing
   Free -> Lab Settings provisioning question.

## Hazards / coordination

- Local `main` has DIVERGED from origin (multi-lane churn). The two LOCAL-MAIN
  commits (`408282178`, `baf4f5374`) are cherry-picks, so they also exist as
  branches `worktree-agent-aa6b040ad440002e9` (billing) and
  `worktree-agent-a0c47f4f4a1f50e83` (cleanup) if a clean ff to origin is wanted.
- Direct pushes to origin/main are classifier-blocked for the agent (prod deploy).
  Grant pushes.
- A stuck live Stripe Checkout tab (`cs_live_...`) is open in Browser 1. The
  extension cannot close a financial-site tab. Close it manually.
