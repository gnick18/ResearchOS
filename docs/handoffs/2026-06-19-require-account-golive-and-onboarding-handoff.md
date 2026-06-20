# Require-account go-live + auto-claim + onboarding handoff (2026-06-19)

Owner: Billing/account lane. House voice: no em-dashes, no emojis, no
mid-sentence colons. Everything below is on `origin/main` and deployed unless
marked otherwise. This doc is uncommitted in the working tree, commit it if you
want it preserved in git.

## TL;DR of this session

1. Landed the auto-claim loop fix the prior handoff queued, plus a second
   StrictMode bug found during live verify, plus a dev-only recovery-code skip.
   All three on `origin/main`, deployed.
2. Grant flipped `NEXT_PUBLIC_REQUIRE_ACCOUNT=1` on prod and redeployed, so
   require-account is now LIVE on prod (no longer dark).
3. Shipped a small onboarding feature, the "Industry" role chip now opens a
   contact form instead of selecting a nonexistent industry mode.
4. Attempted the sharing round-trip, blocked locally by R2 (deployment-only) and
   the paid-send billing gate. Needs a prod run.
5. Investigated a "cannot leave demo" loop, could not faithfully reproduce, Grant
   set it aside ("consider it fixed").

## Prod flag state (changed this session)

- `NEXT_PUBLIC_REQUIRE_ACCOUNT` = `1` on prod (Grant set it + redeployed). The
  require-account gate is now LIVE. The prior handoff had it dark at `0`.
- `BILLING_ENABLED` = `true` (live). Note this gates the paid-send relay (see
  the sharing section).
- Local `.env.local` keeps `NEXT_PUBLIC_REQUIRE_ACCOUNT=1` and
  `NEXT_PUBLIC_AUTH_DEV_MOCK=1`. The dev-mock provider ALWAYS returns an email
  (auth.ts devMockProvider falls back to AUTH_DEV_MOCK_EMAIL then a hardcoded
  dev@researchos.test), so a no-email session cannot be made locally.

## What shipped (all on origin/main)

### Auto-claim loop fix + StrictMode fix + dev recovery-skip
Three commits, all confirmed ancestors of `origin/main`:
- `5f54fd8a9` fix(account): auto-claim degrades cleanly on an unverifiable
  session. New pure tested helper `canAutoClaimWithSession({sessionEmail})` in
  `lib/account/require-account.ts` is the single agreement point. The
  SharingSetupWizard auto-claim effect proceeds to keygen only on a verifiable
  email, else calls the new optional `onAutoClaimUnavailable` prop, and
  RequireAccountGate drops the autoClaim presentation (`effectiveAutoClaim`) and
  shows the manual sign-in card. Flag-off byte-identical.
- `1af4bbecc` fix(account): auto-claim auto-skip survives StrictMode + stable
  callback. The auto-skip never landed in dev because RequireAccountGate passed
  `onAutoClaimUnavailable` as an inline arrow (new identity every render), which
  churned the wizard effect, and its `autoClaimRan` once-guard + React Strict
  Mode mount/cleanup cancelled the in-flight session read before
  `setStep("generate")`. Fix mirrors the sibling `?sharingClaim` resume effect,
  drop the ref guard (the `cancelled` flag dedupes, work is idempotent) and
  `useCallback` the gate callback.
- `0f5040488` feat(account): skip recovery-code step for dev-mock auto-claim. A
  dev-only effect (gated `isDevMockAuth() && autoClaim`) auto-publishes once the
  keys mint, so throwaway dev identities do not have to click through the
  recovery-code screen. Real OAuth and manual dev runs still confirm the code.

LIVE-VERIFIED locally on a worktree dev server (now torn down): signed-in
dev-mock session + a fresh folder fired the gate in autoClaim mode, the wizard
auto-skipped to the recovery code (or straight to the Workbench with the
dev-skip), Publish bound with the existing session, the gate released. Logic
covered by 139 vitest in `src/lib/account` (incl. `canAutoClaimWithSession`).

## NEXT (open)

1. **Sharing round-trip, prod-only.** The original blocked task. Verified locally
   UP TO storage, the recipient directory lookup succeeds and the envelope
   encrypts, but two things block a full local run, both env not bugs:
   - The relay `POST /api/relay/send` returns 402 when `BILLING_ENABLED` is on,
     because SENDING is the paid Model-A produce side (free sender blocked,
     `isProduceEntitled` gate working as designed). The sender must be on a
     trial or paid plan.
   - `POST /api/relay/send` then 500s with "R2_BUCKET is not set". The relay
     stores each encrypted envelope in Cloudflare R2 (needs
     R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET, see
     `src/lib/sharing/relay/storage.ts`). R2 is NOT in local `.env.local`
     (worktree or main), so the cross-folder send is deployment-only.
   TO DO on prod (has R2 + real OAuth): as an entitled sender (trial/paid),
   create a note, Share, Outside your lab, recipient email, then as a second
   identity confirm it arrives in the inbox and decrypts. This is a 2-identity,
   2-browser test.

2. **Auto-claim fallback on prod.** The no-email-session fallback (gate fires but
   the wizard cannot bind, drops to the manual card) cannot be forced locally
   (dev-mock always has an email) and is hard to force with real OAuth (always
   returns a bindable email). Lowest priority, the logic is unit-tested. The real
   triggers are ORCID-with-no-email or a lapsed session, prod-only.

3. **Industry contact form, optional live screenshot.** `5ae3cac14` is deployed,
   clicking "Industry" in the onboarding interest picker opens
   `IndustryContactModal` (mirrors `/departments/contact`, mailto to
   gnickles@wisc.edu, NOT a research-os.app address because inbound there is on a
   new-domain hold until late August). It never selects a role, so the tour
   cannot start on it. Covered by 3 RTL tests in
   `src/components/onboarding/tutor/InterestPicker.test.tsx`. A live screenshot on
   prod was not captured (the demo state kept bouncing the browser, see below).
   Reach it via onboarding, or just click Industry on the live wizard.

4. **Demo-leave loop, SET ASIDE by Grant.** Reported as "Leave demo bounces back
   into demo". Could not faithfully reproduce. Findings for if it recurs: both
   leave triggers (the floating pill and the avatar menu) use the same
   `LeaveDemoModal.goHome`, which clears the sticky flags and restores the real
   folder. The boot has a correct guard at `file-system-context.tsx:954`, a
   leftover `wiki-capture-fixture` handle on a non-/demo route is caught and the
   real folder restored or the connect screen shown, it does not re-enter demo.
   When I left via the actual modal it WORKED (restored ROS-tutor-test). My
   earlier "it re-entered demo" was a repro artifact, I cleared the flag with
   injected JS and called `location.replace('/')`, which the SPA soft-navigated
   so the live demo re-asserted itself, not a real boot. A real fix needs a
   faithful repro (the true no-real-folder public-visitor exit, or watching Grant
   reproduce). Do NOT ship a blind change to the demo/boot machinery, the
   traceable paths look correct and a wrong guard breaks legit in-demo browsing.

5. **Owner-mapped refund/dispute live test** (carried from prior handoff). The
   engine + webhook handlers are shipped + tested (185 billing tests, smoke OK)
   but a real refund/dispute against an actual `cloud_balance` row has not been
   fired. Still a follow-up.

6. **Stripe dashboard** (carried). Grant sets the account-level
   statement-descriptor PREFIX (code sets the suffix "RESEARCHOS").

7. **Trial countdown banner** DONE (built by Icon Lib lane, `9bfbe8272` on
   origin/main, deploying). Consumes the model-a/status `trialPhase` +
   `trialEndsAt` the billing lane exposed, self-gates to a genuinely-trialing lab
   head, reassures early (no card needed) and escalates to "add a card" as it
   ends, per-urgency-tier dismiss, mounted in the root layout next to
   UpgradeNudge, pure `trialCountdown` helper with 7 tests. The no-card 90-day
   lab trial itself is live (LAB_TRIAL_DAYS=90, labTrialDecision gates both the
   charge point and accrual, setModelAPlan fix shipped). Remaining trial
   follow-ups are only items 5 (owner-mapped refund/dispute live test), 6 (Stripe
   descriptor prefix), and a visual pass on the no-card copy on /labs +
   onboarding LabStep + AccountTierChooser.

## Coordination / hazards

- Local `main` has DIVERGED from `origin/main` (multi-lane churn). Do NOT push
  local main wholesale, it would carry other lanes' commits. Build in an isolated
  worktree off `origin/main` and push `HEAD:main` (or hand the branch to Grant).
- Direct pushes to `origin/main` are blocked for the agent by the auto-mode
  classifier (it is a prod deploy). Grant pushes, or it flows via another lane's
  main push. This session's commits reached origin both ways.
- Worktree node_modules from `git worktree add` is a SYMLINK, which Turbopack
  rejects for `next dev` ("points out of filesystem root"). COW-clone it for a
  dev server (`cp -c -R <main>/frontend/node_modules ./frontend/node_modules`),
  or symlink is fine for tsc/vitest only.
- Cross-lane tsc error in `api/admin/grants/__tests__/route.test.ts` was already
  fixed on origin (`2289664a7`), peer (Buisness Boi) confirmed clean. Closed.
- Browser tool (Claude-in-Chrome, "Browser 1") was left on prod research-os.app
  in the demo workspace. Grant's browser holds a real folder ROS-tutor-test in
  IndexedDB (no real auth cookie, the "signed in" was the demo fixture identity).

## Quick orientation for the next agent

- Auto-claim policy + tests, `frontend/src/lib/account/require-account.ts` and
  `require-account.test.ts`.
- The gate, `frontend/src/components/account/RequireAccountGate.tsx`, mounted as
  an early return in `AppShell.tsx`.
- The wizard, `frontend/src/components/sharing/SharingSetupWizard.tsx`.
- Onboarding role picker, `frontend/src/components/onboarding/tutor/InterestPicker.tsx`
  and the new `IndustryContactModal.tsx`.
- Relay send + R2, `frontend/src/app/api/relay/send/route.ts` and
  `frontend/src/lib/sharing/relay/storage.ts`.
- Demo machinery, `frontend/src/lib/file-system/wiki-capture-mock.ts`,
  `frontend/src/components/LeaveDemoModal.tsx`, and the boot effect in
  `frontend/src/lib/file-system/file-system-context.tsx` (the stale-handle guard
  is around line 954).
