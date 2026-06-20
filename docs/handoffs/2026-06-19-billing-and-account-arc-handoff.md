# Billing + account arc handoff (2026-06-19)

Owner: Billing/orchestrator lane. House voice: no em-dashes, no emojis, no
mid-sentence colons. Everything below is on `origin/main` and LIVE in prod
unless marked otherwise.

## Prod flag state

- `NEXT_PUBLIC_LAB_AS_FOLDER` = ON
- `NEXT_PUBLIC_LAB_TOKENS_V2` = ON
- `NEXT_PUBLIC_SINGLE_USER_FOLDERS` = ON
- `NEXT_PUBLIC_REQUIRE_ACCOUNT` = `0` (DARK, set this session by Grant in Vercel
  Prod + Preview). Local `.env.local` keeps it `=1` so Grant can test the claim
  gate on `:3000`. Default in code is ON, so the explicit `0` is what keeps prod
  dark. Flip to `1` to go live (see the go-live note below).
- `NEXT_PUBLIC_PRICING_LIVE` = NOT set (pricing stays hidden in maintenance).
- `BILLING_ENABLED` = `true` (billing is LIVE in prod).
- Local `.env.local` Stripe is now TEST mode by design (Grant: never put live
  keys local; prod Vercel has the live keys). `STRIPE_AI_PRICE_*` local are still
  LIVE ids, so the AI top-up would mismatch the test key locally, the Model-A
  lab/solo flow does not use price ids so it is unaffected.

## What shipped (all live on prod)

### Phase-out follow-up (create-another-user)
Guarded the real user-create call sites (`handleColorPickerAccept`,
`autoProvisionFromAccount`) with `canCreateAnotherUser`, not just the entry, so a
folder can never grow past one real user even via a future refactor. Audit
confirmed there is NO hidden add-another-account UI. Flag-off byte-identical.

### Account home cleanup
Removed the Department / Institution admin cards from `/account` (they advertised
the org tiers to every signed-in user). Researcher directory stays. At most the
org tiers belong on the welcome/login page, which is untouched.

### Gate thin bar
Unified the login + folder-connect gate bottom chrome into ONE thin bar via a
new `leadingSlot` on the compact `MarketingFooter` (actions threaded into the
same row as the legal links). Dropped the standalone "Your data is stored
locally" line. Browser-verified.

### Login dead-branch cleanup
Removed an unreachable duplicate `showQuickConfirm` branch (dark-mode leftover).

### require-account (account = identity = sharing) MERGED DARK
Reconciled the stale `feat/require-account-ironclad` branch (was 231 behind, the
big UserLoginScreen claim machinery was ALREADY on main, true delta was 6 files),
pushed dark. `RequireAccountGate` + `shouldGateForClaim` hold an unclaimed user
at a claim screen before the app opens. Behind `NEXT_PUBLIC_REQUIRE_ACCOUNT`.

### Auto-claim Phase 1 MERGED DARK (under the require-account flag)
Closes the signed-in dead zone (Share button was hidden because identity was
deferred). `shouldGateForClaim` now also fires for a signed-in user with
`identityStatus === "none"` (no-loop guard: fires only on "none", auto-claim mint
flips it to "ready" which releases). The wizard auto-skips OAuth when a session
exists, lands on the recovery-code step. Design doc (Grant approved D1-D7):
`docs/proposals/2026-06-19-account-auto-claim-on-folder-entry.html`. D4/D5
foreign-account "take ownership" is Phase 2, NOT built.

**Live partial-verify on Grant's :3000 (flag=1):** the gate FIRES with the right
copy and the "Use a different folder" no-soft-lock escape WORKS. The happy path
(auto-skip -> recovery code -> Share) could NOT be verified because local has no
real OAuth (only the dev mock, which is not a verifiable session). EDGE-CASE BUG
FOUND + FIX QUEUED (chip `task_d2490a12`): the gate fires on "has a session" but
the auto-skip needs "has a verified email", so a signed-in-but-unverifiable
session (the dev mock, or an expired session) loops. Real OAuth users do not hit
it, but it must fail clean before the flag flips live.

### Billing arc (BILLING_ENABLED=true, so all live)
- **90-day no-card lab trial.** Model-A lab is card-on-file + off-session PIs (NOT
  org-stripe, which is dept/institution). Trial is app-side: new
  `cloud_balance.trial_ends_at` column (additive idempotent ALTER, runs on prod
  Neon next ledger op), stamped by `POST /api/billing/model-a/start-trial` (no
  Stripe call, no card at signup), single-source `labTrialDecision` gates the ONE
  charge point + ONE accrual point (none / trialing -> charge NO / ended_with_card
  / ended_no_card -> pause). Fail-safe: bad timestamp reads as "none". `PRICING.md`
  "Card on file at signup" line AMENDED (Grant authorized no-card). Browser-
  verified the no-card copy + flow. `LAB_TRIAL_DAYS=90`.
- **setModelAPlan fix.** PRE-EXISTING bug: the Model-A card-setup webhook stored
  `plan_id="free"` for paid labs/solos (getPlan("lab") is null, no "lab" flat id),
  so a paid lab resolved as free. New `setModelAPlan` writes the Model-A id
  directly with status active. Shipped.
- **Charge engine VERIFIED live (test mode)** via `/api/dev/model-a-verify`
  (Bearer BILLING_SIM_SECRET, refuses sk_live_): a real $19.28 Model-A charge ran
  through test Stripe and zeroed the balance. `succeeded: 1`.
- **Dispute + refund + deflection.** `charge.refunded` -> `creditBalance`
  (partial-aware, idempotent on `refund:<chargeId>`, the inverse of recordCharge,
  sign VERIFIED). `charge.dispute.created` -> `setDisputed` + pause (new
  `cloud_balance.disputed_at` column, gated at the shared accrual decision point);
  `dispute.closed` won -> clear, lost -> stays. `getOwnerByCustomerId` maps Stripe
  customer -> owner. `statement_descriptor_suffix: "RESEARCHOS"`. Deflection copy
  on ModelABilling: "Questions about a charge? Email support@research-os.app with
  the charge id". 185 billing tests, tsc 0. Smoke: `stripe trigger charge.refunded`
  succeeded + webhook route healthy. NOT live-verified: a real owner-MAPPED
  refund/dispute crediting/pausing an actual row.

## NEXT (open)

1. **require-account go-live.** Land the auto-claim loop fix (`task_d2490a12`),
   then flip `NEXT_PUBLIC_REQUIRE_ACCOUNT=1` on prod and verify the happy path with
   real OAuth (recovery code -> Share), then finish the SHARING ROUND-TRIP (the
   original task, blocked on exactly this). Real OAuth is prod-only.
2. **Auto-claim loop fix** (`task_d2490a12`, queued): gate-condition vs auto-skip-
   condition mismatch.
3. **Owner-mapped refund/dispute live test** (follow-up): the engine is verified,
   but a real refund/dispute against an actual cloud_balance row was not fired.
4. **Stripe dashboard:** Grant sets the account-level statement-descriptor PREFIX
   (code sets the suffix).
5. **Phase 2 foreign-account "take ownership"** (D4/D5 of the auto-claim doc).
6. **Provider-rebind verdicts** (`docs/proposals/2026-06-19-account-provider-rebind.html`).
7. **welcome-mascot** pending merge (Grant's :3000 visual pass).
8. **PRICING flip** (`NEXT_PUBLIC_PRICING_LIVE=true`) when pricing signed off.

## Coordination / hazards

- Cross-lane: Icon Lib routed the 90-day-trial task here; their premise (org-stripe
  + immediate invoice) was corrected via shared memory (Model-A is card-on-file, no
  upfront charge).
- The shared `main` checkout moved many times this session (multiple lanes). All
  the landings here were done from isolated worktrees pushed via
  `git push origin HEAD:main` with a fetch-rebase-retry loop, never fighting the
  dirty/moving local checkout. Local `main` runs ahead of origin by other lanes'
  unpushed commits, that is normal churn.
- Prod env writes are blocked by the auto-mode classifier even with in-chat
  authorization, Grant set the Vercel flags himself.
