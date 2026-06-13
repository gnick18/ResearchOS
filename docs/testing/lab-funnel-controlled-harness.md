# Lab funnel controlled harness (localhost, fake emails, Stripe test mode)

A repeatable, agent-drivable walkthrough of the whole lab-account funnel on
localhost. Create a lab, give the PI an active subscription, invite a member,
let the member join, see the roster, and read the billing decision, all with
FAKE emails and no real OAuth, no passkeys, and (for the default path) no Stripe
checkout. Everything below is traced from the code, not assumed.

This doc is documentation only. No new source file was added. Every building
block already exists in the repo.

House style here, as everywhere I write: no em-dashes, no emojis, no
mid-sentence colons.

---

## 0. The two lab systems (read this first or the rest is confusing)

There are TWO parallel "lab" subsystems and the funnel touches both. Knowing
which is which is the whole game.

1. Billing lab (the roster + the money). Routes under `/api/billing/lab/*`. It
   is a pure email-hash model. A member is a row keyed by
   `ownerKeyForEmail(email)` (a peppered hash, no plaintext email stored). The
   PI "pays" by holding a subscription whose `status === "active"`. There is no
   crypto and no link here. This is what the billing-sim seeds and what the
   Settings billing/usage surfaces read.

2. Relay/crypto lab (the real-time collab tier). Code under `src/lib/lab/*`,
   UI in `LabMembershipPanel` and the `/lab/join` page. The PI mints a
   head-signed invite LINK (`mintInviteForHead`), the member opens it, accepts
   with a verified email, and the head finalizes (seals the lab key to them).
   This is the system the task's named UI funnel (AccountTierChooser ->
   LabCreateResume -> LabMembershipPanel -> minted link -> `/lab/join`) drives.

The funnel "create -> pay -> invite -> join -> roster -> billing" spans both.
Create/invite/join/roster (the link handshake) is the crypto lab. Pay/billing
(active subscription + the enforcement decision) is the billing lab. They are
linked only by the PI's identity, the OAuth email the head binds at create time
is the SAME email whose hash keys the billing subscription. That is why seeding
billing by that email works.

---

## 1. The `.env.local` setup

Work in `frontend/`. The dev server reads `frontend/.env.local`. The main
checkout already has the DB URLs, `AUTH_SECRET`, and
`NEXT_PUBLIC_SHARING_ENABLED`. Add (or confirm) the lines below. Exact variable
names, each confirmed against the file that reads it.

```dotenv
# --- Lab tier (already true locally via src/lib/lab/config.ts) ---
# LAB_TIER_ENABLED is a hardcoded `export const LAB_TIER_ENABLED = true` in
# src/lib/lab/config.ts on this local branch. It is NOT an env var. Nothing to
# set; just do not let it get reverted to false.

# --- Fake-email sign-in (the devmock NextAuth provider) ---
# Server gate: mounts the Credentials provider id "devmock" (src/lib/sharing/auth.ts).
AUTH_DEV_MOCK=1
# Client gate: makes the single amber "Dev mock sign-in" BUTTON render in the
# provider pickers (isDevMockAuth / isOAuthPublishAvailable in
# src/lib/sharing/oauth-availability.ts). Without this the button is hidden even
# though the server provider works.
NEXT_PUBLIC_AUTH_DEV_MOCK=1
# Default email the devmock provider hands back when none is passed
# (src/lib/sharing/auth.ts). Optional; the agent passes an explicit email per
# identity instead, so this is just a fallback.
AUTH_DEV_MOCK_EMAIL=pi@researchos.test
# Required to sign the JWT session. Already present in the main checkout's
# .env.local. Any non-empty secret works locally.
AUTH_SECRET=<already set>

# --- Sharing (needed for directory search + email delivery; OPTIONAL for the
#     core funnel, which works link-only without it) ---
# Already set in the main checkout. Leave it. Note: with NEXT_PUBLIC_AUTH_DEV_MOCK=1
# the provider pickers already light up even if this were unset, because
# isOAuthPublishAvailable() ORs the two.
NEXT_PUBLIC_SHARING_ENABLED=true

# --- Billing (the "pay" + "roster" + "billing decision" half) ---
# Turns on every /api/billing/* route. Without it they all 404.
BILLING_ENABLED=true
# The billing-sim backdoor. Setting this STRING activates /api/dev/billing-sim
# (returns 404 when unset). The agent (or a curl) sends it as the Bearer token to
# seed an active PI subscription with NO Stripe checkout. Pick any opaque value;
# the Bearer you send MUST match this exactly.
BILLING_SIM_SECRET=funnel-test-sim-secret
# REQUIRED for billing-sim AND the invite gate: the pepper that hashes an email
# into its owner key (ownerKeyForEmail). Without it billing-sim 500s with
# "DIRECTORY_HMAC_PEPPER is not set". NOT in the main checkout by default; add it.
# Any opaque value, but it must stay stable across a run (same email -> same key).
DIRECTORY_HMAC_PEPPER=funnel-test-hmac-pepper-0001

# --- Stripe (ONLY needed for the real hosted-checkout path in step 4b; the
#     default billing-sim path needs NONE of these) ---
# Use a TEST key (sk_test_...). The plan route hard-blocks live charges behind a
# Wisconsin sales-tax gate; sk_test_ bypasses that gate (src/app/api/billing/plan/route.ts).
# STRIPE_SECRET_KEY=sk_test_...
# Flat-price ids per plan (src/lib/billing/plans.ts -> stripePriceEnv). Only the
# lab plans matter for this funnel.
# STRIPE_PRICE_LAB_PLUS=price_...
# STRIPE_PRICE_LAB_PRO=price_...
# STRIPE_WEBHOOK_SECRET=whsec_...   (only if you run `stripe listen` to record the
#                                    sub active after checkout completes)
```

What needs Stripe vs what does not:

- create / invite / join / roster (the crypto handshake): NO Stripe, ever.
- pay (give the PI an active subscription): NO Stripe on the default path. The
  billing-sim `scenario` action calls `setPlan(piKey, "lab_plus")`, which writes
  `status = "active"` because a lab_plus plan has `priceCents > 0`
  (src/lib/billing/db.ts setPlan). That active row is exactly what the invite
  gate checks (see step 5), so the agent never has to touch Stripe.
- billing decision / enforcement readout: NO Stripe. The billing-sim `check`
  action runs the real owner-state functions by email.
- Stripe test checkout is ONLY required if you want to exercise the REAL
  `/api/billing/plan` -> hosted Checkout -> webhook path end to end (step 4b).
  That path is documented but not on the critical line.

Restart `next dev` after editing `.env.local`. `NEXT_PUBLIC_*` values are inlined
at build time, so a running dev server must be restarted to pick them up.

Per the project rule about not running a second dev server against the shared
main checkout, run this harness against the dev server Grant already has on
`:3000` (these are additive env reads), or against your own isolated worktree's
dev server on a different port. Do not start a second `next dev` pointed at
`frontend/` in the main checkout. (A second port needs an isolated worktree with
its own `node_modules` via `pnpm install` and a copied `.env.local`; COW-cloning
a pnpm `node_modules` leaves broken symlinks, so reinstall instead of `cp`.)

---

## 1b. Start the relay worker (the crypto-lab half needs it)

The create / invite-link / join handshake calls the lab Durable Object over
`ws://localhost:8787` (`openLabKey` in lab-session-effects.ts; default in
`src/lib/loro/config.ts`). If the relay is not running, every create/login step
fails with "Failed to fetch" and resets to the locked state. Start it locally
(miniflare, no Cloudflare account, binds `LabRecordDO` + the lab-data R2):

```bash
cd relay && npm run dev   # wrangler dev on :8787, "Ready on http://localhost:8787"
```

Leave it running for the whole walkthrough. A root GET returns 404 (it is a
route/WS worker, not a page); that 404 means it is up, not down.

Schema note (fixed 2026-06-12): the dev billing DB auto-migrates on first
billing-sim call (`ensureBillingSchema`). Two bugs that used to block this are
now fixed on main: billing-sim now ensures the billing schema (096bb9b6a), and
`ensureBillingSchema` inlines its DDL defaults via `sql.unsafe` so the Neon HTTP
driver no longer throws "bind message supplies 1 parameters" (74e9a4aa3). A fresh
or old Neon dev DB now migrates cleanly with no manual SQL.

---

## 2. The confirmed devmock trigger (how a browser actually fires it)

The devmock provider authorizes ANY email. A browser fires it three ways, all
confirmed in the code:

- UI button: when `NEXT_PUBLIC_AUTH_DEV_MOCK=1`, `SharingProviderButtons`
  renders a single amber button labelled "Dev mock sign-in (test the link
  flow)". It calls `onProvider("devmock")`, which routes to
  `signIn("devmock", ...)`. This button appears in the AccountTierChooser
  provider sub-steps (Free and Lab-create), in `SharingSetupWizard`, and on the
  OAuth-first welcome screen. This is the real funnel trigger.
- Programmatic, in-page: `signIn("devmock", { redirect: false })` from
  `next-auth/react`. The two existing dev pages use exactly this
  (src/app/dev-lab/page.tsx, src/app/dev-join/page.tsx). It establishes the
  session client-side with no redirect, then `getSession()` returns the email.
- Raw NextAuth callback: POST to `/api/auth/callback/devmock` with the CSRF
  token. Not needed; the two cleaner triggers above cover every step, so the
  agent never has to hand-roll the CSRF dance.

The agent path uses the programmatic form for the dev pages and the amber button
for the real-UI walkthrough.

---

## 3. The confirmed identity path (no passkeys, no real OAuth)

The lab-create head flow needs BOTH:

- an unlocked LOCAL identity (`getSessionIdentity()` returns a keypair), and
- a devmock OAuth session carrying an email (`getSession().user.email`).

Confirmed in `LabCreateResume` (self-gates on a connected `currentUser`, a live
OAuth email, AND an unlocked identity) and in `createLabForCurrentUser` (throws
unless an OAuth-verified email is passed; it seals that email into the head
membership).

A synthetic agent cannot do passkeys or real OAuth, so the identity comes from
the dev bypass, not the real ceremony:

- `DevPairBypassButton` (src/components/DevPairBypassButton.tsx, renders only
  when `NODE_ENV === "development"`) mints a LOCAL keypair with no passkey and no
  recovery code, then signs the folder-local user in. It is the floating dashed
  "Dev: skip setup + pair" button at the bottom-left once a data folder is
  connected. After clicking it, `getSessionIdentity()` is unlocked.

Exact order to establish a usable head identity:

1. Connect a data folder (OS picker, or use `/demo` / "Try the demo" to unlock
   the folder gate for a scratch session).
2. Click "Dev: skip setup + pair". Now there is a `currentUser` and an unlocked
   local identity.
3. Establish the devmock session for the PI email
   (`signIn("devmock", { redirect: false })` with that email, or the amber
   button). Now `getSession().user.email` is set.

Steps 2 and 3 are independent (identity is local, session is the JWT cookie), so
either order works, but both must be true before create/invite/join calls. The
dev pages do step 3 lazily inside each action (they call
`signIn("devmock", { redirect: false })` only if no session email is present),
which is why the agent flow can rely on them.

Note on the real OAuth-first UI flow (step 4a): when the amber button is clicked
from the tier chooser, `startOAuthFirstSignIn` fires `signIn("devmock", {
callbackUrl: "/?sharingClaim=1" })` immediately, and on return
`SharingClaimResume` mounts the setup wizard which mints the identity bound to
the devmock email, but ONLY once a folder-local user is connected. So even the
real UI path still requires a connected folder first. The dev-page path avoids
the multi-redirect wizard entirely and is the more reliable one for an agent.

---

## 4. The walkthrough (numbered, agent-drivable)

Two identities. The PI (head) and one member. The cleanest, least-flaky route
uses the existing dev pages for the crypto handshake and a single curl for the
billing seed. A fully-real-UI variant is given as 4a for the parts that matter.

Pick ONE scratch data folder for the PI and a SEPARATE scratch folder for the
member (a fresh local identity per folder). Capture any one-time recovery code if
the real wizard ever shows one; the dev bypass does not, which is the point.

### 4a. Real-UI create (optional, the prettier path)

1. Open `http://localhost:3000/`. If a landing page shows, append `?connect=1`
   or click "Try the demo" to reach the chooser.
2. In AccountTierChooser, click "Set up a lab" -> "Create a lab". Click the
   amber "Dev mock sign-in" button. (OAuth-first mode redirects through
   `/?sharingClaim=1`.)
3. When prompted, connect the PI's scratch data folder and let the setup wizard
   mint the identity (bound to `pi@researchos.test`, the devmock email). On
   return, `LabCreateResume` runs `createLabForCurrentUser`, writes
   `account_type: "lab_head"` + the new `lab_id`, and the lab is live.
4. Verify by opening `/settings?section=membership`. The "Lab membership" panel
   should be visible (it is gated on `account_type === "lab_head"` +
   `LAB_TIER_ENABLED`).

If the wizard round-trip stalls (synthetic agents sometimes lose the session
across the redirect), fall back to the dev-page create in 4c, then flip the
account type by hand at `/settings?section=accounttype` -> choose "Lab head" so
the membership panel appears.

### 4b. Pay, the real Stripe test path (optional)

Only if you set the Stripe envs. POST `/api/billing/plan` with
`{ "planId": "lab_plus" }` (the UI control lives in the consolidated billing
popup). With `sk_test_`, the route returns a hosted Checkout `url`. Open it, pay
with test card `4242 4242 4242 4242`, any future expiry, any CVC. The webhook
(run `stripe listen --forward-to localhost:3000/api/billing/stripe-webhook` and
set `STRIPE_WEBHOOK_SECRET`) records the subscription active. This is slow and
flaky for an agent; prefer 4d.

### 4c. Dev-page create (the reliable crypto-lab create)

1. Connect the PI scratch folder, click "Dev: skip setup + pair" (identity
   unlocked).
2. Open `http://localhost:3000/dev-lab`. Click "Create lab". It calls
   `signIn("devmock")` if needed and `createLabForCurrentUser` with a fixed test
   lab id, binding `pi@...`'s email. Output should read `LAB CREATED`.
3. Click "1. Login" to bring the lab session live (head holds the lab key).
4. Click "A. Create invite link". COPY the printed invite link (this is the
   minted link the member will open). It carries the lab id + head keys in the
   URL hash.

### 4d. Pay via billing-sim (the reliable "pay", no Stripe)

Seed the PI an ACTIVE lab subscription by email, plus optionally a member row and
some usage, in one call. Use the SAME PI email the devmock session uses, because
billing keys on `ownerKeyForEmail(email)`.

```bash
curl -s http://localhost:3000/api/dev/billing-sim \
  -H "authorization: Bearer dev-sim-secret-change-me" \
  -H "content-type: application/json" \
  -d '{
        "action": "scenario",
        "piEmail": "pi@researchos.test",
        "plan": "lab_plus",
        "piStorageMb": 1200,
        "piWritesK": 40,
        "members": [
          { "email": "member@researchos.test", "storageMb": 800, "writesK": 25 }
        ]
      }'
```

Expect `{ "ok": true, "piEmail": "pi@researchos.test", "members": ["member@researchos.test"] }`.
This sets the PI subscription `status = active` (because lab_plus priceCents > 0)
and enrolls the member as active in the billing roster.

### 4e. Member joins (the crypto handshake)

Open a SEPARATE browser profile (or the member's scratch folder) so the member
has their own local identity.

1. Connect the member scratch folder, click "Dev: skip setup + pair".
2. Open the invite link from 4c step 4. It lands on `/lab/join` with the payload
   in the hash. (Or open `/dev-join` and paste the link.)
3. Click "Accept invite". The page runs `signIn("devmock")` for
   `member@...`'s email if no session, then posts a signed accept to the lab
   queue. Output should read `ACCEPT` / request sent.
4. Back in the PI's `/dev-lab` (or `/settings?section=membership`), click
   "Check for requests" / "C. Finalize accepts". The member is verified and
   added to the crypto roster. The PI can then "D. Verify member login" to prove
   the email binding accepts the member's real email and rejects a wrong one.

One-tab shortcut: `/dev-lab` buttons A -> B -> C -> D simulate a synthetic
member accept with a throwaway keypair and a different email, no second browser
needed. Use that if a second profile is impractical.

### 4f. Roster + billing readout

1. Crypto roster: PI's `/settings?section=membership` -> "Check for requests"
   shows pending; after finalize the member is in the lab. `/dev-lab` "3. Read
   back (as PI)" reads the member's synced records back, proving the lab key
   pool works.
2. Billing roster + decision: GET `/api/billing/lab` as the PI (signed in via
   devmock) returns the roster, aggregate storage, aggregate writes, plan id,
   and pending invites. Or run the enforcement decision directly:

```bash
curl -s http://localhost:3000/api/dev/billing-sim \
  -H "authorization: Bearer dev-sim-secret-change-me" \
  -H "content-type: application/json" \
  -d '{ "action": "check", "email": "member@researchos.test" }'
```

It returns `billingOwnerIsLab` (true when the member resolves to the PI's pool),
storage used vs cap, writes vs allowance, and `wouldBlock`. The member should
resolve to the lab pool because 4d enrolled them active under the PI.

Cleanup between runs:

```bash
curl -s http://localhost:3000/api/dev/billing-sim \
  -H "authorization: Bearer dev-sim-secret-change-me" \
  -H "content-type: application/json" \
  -d '{ "action": "reset", "emails": ["pi@researchos.test", "member@researchos.test"] }'
```

---

## 5. Does billing-sim satisfy the invite gate?

Yes, for the BILLING side. `POST /api/billing/lab/members` (the PI-invites-a-
member-by-email endpoint) gates on
`getSubscription(ownerKey)?.status === "active"` and otherwise returns 409
`needsCheckout`. The billing-sim `scenario` action with `plan: "lab_plus"` calls
`setPlan(piKey, "lab_plus")`, which writes `status = "active"` (a lab_plus plan
has `priceCents > 0`). Both sides derive the key with `ownerKeyForEmail` on the
same PI email, so seeding satisfies the gate with NO Stripe checkout. Confirmed
by reading src/app/api/billing/lab/members/route.ts and
src/lib/billing/db.ts (setPlan + getSubscription).

Caveat worth stating plainly. The crypto-lab invite LINK
(`mintInviteForHead` / `/lab/join`) does NOT check the billing subscription at
all. So the link handshake (4c/4e) works even before any payment. The billing
gate only bites on the billing roster endpoint (`/api/billing/lab/members`). The
harness exercises both, so seed the active sub (4d) before testing that endpoint.

Stripe test mode is therefore optional. It is only needed if the goal is to
verify the real `/api/billing/plan` -> hosted Checkout -> webhook path itself
(4b). For everything else, billing-sim is the controlled, repeatable substitute.

---

## 6. Self-contained Claude-in-Chrome prompt

Paste this to an agent with the dev server already running and `.env.local` set
per section 1. It assumes a Chrome profile that can open two browser contexts (or
it uses the one-tab simulate shortcut).

```
You are testing the ResearchOS lab funnel on http://localhost:3000 with fake
emails and no Stripe. The dev server is already running and env flags are set
(AUTH_DEV_MOCK=1, NEXT_PUBLIC_AUTH_DEV_MOCK=1, BILLING_ENABLED=true,
BILLING_SIM_SECRET=dev-sim-secret-change-me). Do NOT use real OAuth or passkeys.

Run these steps in order. After EACH step, report PASS or FAIL and a one-line
note of what you actually saw on screen or in the response body. Do not skip a
failed step; report it and continue.

PI identity setup
1. Open http://localhost:3000/ . If a landing or demo gate shows, click "Try the
   demo" or append ?connect=1 to reach the app. Connect a scratch data folder.
2. Click the dashed "Dev: skip setup + pair" button (bottom-left). Confirm you
   are now signed in as a local user (no recovery code shown).

Create the lab (crypto handshake)
3. Open http://localhost:3000/dev-lab . Click "Create lab". PASS if the output
   contains "LAB CREATED".
4. Click "1. Login". PASS if the output contains "LOGIN" and "live".
5. Click "A. Create invite link". COPY the full invite link from the output and
   keep it. PASS if a link is printed.

Pay (seed an active subscription, no Stripe)
6. Make this HTTP request (use the browser's fetch from the devtools console or a
   request tool):
   POST http://localhost:3000/api/dev/billing-sim
   header authorization: Bearer dev-sim-secret-change-me
   header content-type: application/json
   body {"action":"scenario","piEmail":"pi@researchos.test","plan":"lab_plus",
        "piStorageMb":1200,"piWritesK":40,
        "members":[{"email":"member@researchos.test","storageMb":800,"writesK":25}]}
   PASS if the JSON response has "ok":true and lists member@researchos.test.

Invite gate (billing side)
7. Make this request as the signed-in PI (include cookies):
   POST http://localhost:3000/api/billing/lab/members
   header content-type: application/json
   body {"email":"member2@researchos.test"}
   PASS if the response is 200 with "ok":true (the active sub from step 6
   satisfied the gate). If it returns 409 needsCheckout, FAIL and note it.

Member joins (crypto handshake)
8. EITHER open a second browser context, connect a DIFFERENT scratch folder,
   click "Dev: skip setup + pair", open the invite link from step 5, and click
   "Accept invite" (PASS if it says request sent);
   OR if a second context is impractical, in the PI's /dev-lab tab click
   B (Simulate member accept). PASS if the output says simulated accept posted.
9. In the PI's /dev-lab tab click "C. Finalize accepts". PASS if the output lists
   the member as added.
10. Click "D. Verify member login". PASS if the correct email shows ACCEPT and
    the wrong email shows REJECT.

Roster + billing readout
11. GET http://localhost:3000/api/billing/lab as the PI (with cookies). PASS if
    the JSON shows a roster array and labPlanId "lab_plus".
12. Make this request:
    POST http://localhost:3000/api/dev/billing-sim
    header authorization: Bearer dev-sim-secret-change-me
    header content-type: application/json
    body {"action":"check","email":"member@researchos.test"}
    PASS if the response has "billingOwnerIsLab":true (the member resolves to the
    PI's pool) and reports storage/writes numbers.

Cleanup
13. POST the same billing-sim endpoint with
    {"action":"reset","emails":["pi@researchos.test","member@researchos.test"]}.
    PASS if it returns "ok":true.

Finish with a table: step number, PASS/FAIL, note. Then one sentence on whether
the full funnel (create -> pay -> invite -> join -> roster -> billing) held
together end to end.
```

---

## 7. What each step proves, and known gaps

What each step proves:

- Step 2 (Dev pair): the passkey-free local identity works; an agent gets an
  unlocked keypair with no recovery-code dead end.
- Step 3 (Create lab): the head identity + devmock email bind into a real lab
  genesis record on the relay. Proves the create half of the crypto lab.
- Step 5 (Invite link): the head can mint a shareable, head-signed join link.
- Step 6 (billing-sim scenario): a PI can be put on an ACTIVE paid lab plan with
  no Stripe, and a member can be enrolled in the billing pool.
- Step 7 (invite gate): the real billing invite endpoint accepts an invite ONLY
  because the seeded subscription is active. This is the load-bearing proof that
  seeding substitutes for checkout.
- Steps 8 to 10 (accept + finalize + verify): the member-join handshake and the
  email-binding security check (right email accepted, wrong email rejected).
- Step 11 (GET lab): the PI roster, aggregate usage, and plan render from real
  data.
- Step 12 (check): the real enforcement decision resolves the member to the lab
  pool and computes over/under storage and activity.

Known gaps and caveats:

- Two lab systems, one funnel. The crypto roster (steps 8 to 11 membership panel)
  and the billing roster (step 11 GET /api/billing/lab) are SEPARATE stores. A
  member added via the crypto finalize is NOT automatically a billing-pool member
  and vice versa. The harness seeds the billing side (step 6) and handshakes the
  crypto side (steps 8 to 10) independently. There is no single call that joins a
  member to both at once; that wiring is a product gap, not a harness bug. Note it
  in any report.
- The invite-link handshake ignores the subscription. The crypto `/lab/join`
  path works before any payment. Only `/api/billing/lab/members` enforces the
  active sub. So "invite" means two different things depending on which surface
  you test.
- OAuth-first wizard fragility. The real-UI create (4a) routes through a redirect
  and `SharingClaimResume`; synthetic agents sometimes lose the session across
  the redirect. The dev-page create (4c) is the reliable substitute. If you need
  the membership panel visible after a dev-page create, flip account type at
  /settings?section=accounttype -> "Lab head".
- Email delivery is off without real sharing infra. Inviting by email in
  `LabMembershipPanel` falls back to "link-only" (copyable link) when
  NEXT_PUBLIC_SHARING_ENABLED is not a real sharing build. The agent should
  expect a copyable link, not a sent email.
- billing-sim is inert without its secret and 404s in production. Setting
  BILLING_SIM_SECRET is what activates it; never set it in real prod.
- Stripe test path is documented (4b) but off the critical line. It needs
  sk_test_, the STRIPE_PRICE_LAB_* ids, and a `stripe listen` webhook to flip the
  sub active. Skip it unless the goal is the checkout path itself.

---

## 8. Thin convenience file

None added. The existing pieces drive the whole funnel reliably for a Chrome
agent. The identity is covered by DevPairBypassButton, the fake-email session by
the devmock button plus signIn("devmock"), the create/invite/join handshake by
the already-present /dev-lab and /dev-join pages, the "pay" by the billing-sim
endpoint, and the roster/billing readout by /api/billing/lab plus billing-sim
check. A one-action "become fake user" helper would only have saved the two
clicks in section 3, which the dev pages already fold into each action, so it was
not worth adding another dev-only surface.
