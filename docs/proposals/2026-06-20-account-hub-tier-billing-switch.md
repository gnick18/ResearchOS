# Account hub: tier, billing, and the self-serve lab-head switch

Status: DESIGN PROPOSAL (2026-06-20). Design only. No production React, no billing
rate changes, no on-disk folder-format changes. Companion deliverable is the
clickable before/after mockup at
`docs/2026-06-20-account-hub-before-after.html`.

Author lane: account-hub design. Coordinate with any active billing/trial lane on
Settings -> Plan & storage (see Section 9, Coordination). This proposal reuses the
existing billing components and the lab-genesis + migration machinery rather than
inventing new paths.

House voice in all customer copy: no em-dashes, no emojis, no mid-sentence colons.
Never call the free shared-folder capability "collab" (that word is reserved for
the paid live relay feature). Prices follow `docs/branding/PRICING.md` (canonical):
Free $0, Solo $3/mo + usage at 5x, Lab $25/mo founding lock-in + usage at 7x,
Department contact-led.

---

## 1. Why

Today `research-os.app/account` (rendered by
`frontend/src/components/account/AccountHome.tsx` inside `PortalShell`) is bare. A
signed-in user sees three things:

1. A profile card (avatar, @handle, display name, affiliation, Edit).
2. A "point us to your folder" / "welcome back" data-connect card.
3. A one-item "Your account" grid that links only to the researcher directory.

It never tells the user what plan they are on, whether they are on a trial, comped,
or paying, when anything renews, or how to manage payment. All of that lives one
surface away in Settings -> Plan & storage (`ModelABilling` +
`CloudStorageUsageSection`). And there is no self-serve way to become a lab head.
The only routes to lab-head today are operator staged provisioning
(`LabProvisionResume`) and a fresh-OAuth new-lab signup (`LabCreateResume`). A
solo user who decides to run a lab has no in-app door.

Grant (2026-06-20) wants `/account` to become the account hub. It should:

1. Show the current plan/tier and key entitlement state (trial / comped / paid,
   renewal or expiry) at a glance.
2. Let the user manage billing without hunting through Settings.
3. Let a Free or Solo user convert to a lab-head account, self-serve.
4. On that switch, guide folder handling so the user knows which folder becomes the
   lab and that they can spin up a fresh lab folder instead of converting one in
   place.

---

## 2. What exists today (reuse map)

Nothing here is built new without cause. The hub composes pieces that already ship.

### Billing read + controls

- `ModelABilling` (`frontend/src/components/billing/ModelABilling.tsx`) is the
  canonical plan panel. It fetches `GET /api/billing/model-a/status` and renders a
  Free panel (Start Solo / Start Lab trial) or a Paid panel (plan name + base fee,
  `TrialBanner`, this-period accrual, card-on-file row, monthly-cap row,
  `CoverageBanner` when a lab covers the member).
- `ModelAStatus` shape (the entitlement object the hub needs):
  `planId: "free" | "solo" | "lab" | "dept"`, `accruedCents`, `capCents`,
  `hasCard`, `trialEndsAt`, `trialPhase: "none" | "trialing" | "ended_with_card" |
  "ended_no_card"`, `trialPaused`, `sponsoringLab: { name } | null`.
- `CloudStorageUsageSection`
  (`frontend/src/components/settings/sections/CloudStorageUsageSection.tsx`) renders
  the pooled lab storage + monthly activity bars off `fetchLabStatus()`
  (`GET /api/billing/lab`).
- Comped tier is read with `getActiveCompedTier(ownerKey)` from
  `frontend/src/lib/billing/grants.ts`, returning `"solo" | "lab" | "dept" | null`
  (highest active gift tier). This is how the hub knows "comped" vs "paid".
- Displayed prices come only from `frontend/src/lib/billing/catalog.ts`
  (`PLAN_PRICES`, `usd()`), which derives from `model-a/pricing.ts`. The hub must
  never hardcode a dollar figure; it reads `catalog.ts`.
- Card management today launches Stripe Checkout in setup mode via
  `POST /api/billing/model-a/card-setup` (the "Add a card" / "Update card" buttons
  inside `ModelABilling`). There is no Stripe customer-portal route yet (see
  Section 4, open fork B).
- There is NO shared `usePlan()` / `useEntitlement()` hook. Components fetch
  directly in a `useEffect`. The hub introduces one thin read wrapper (Section 8).

### Lab genesis (the switch target)

- `createLabLocal(params)` (`frontend/src/lib/lab/lab-create.ts`) is the pure,
  network-free lab maker. It mints the lab key, builds the head `LabMember`, and
  produces the genesis record + sealed envelope in memory. It throws without an
  OAuth email (the head cannot be bound otherwise).
- `publishLabRemote(labId, created)` retryably posts genesis to the relay and
  upserts the public directory row. A user is a lab head locally the instant
  `createLabLocal` returns; publish is async and resumable.
- `LabProvisionResume` and `LabCreateResume` both, on success, persist
  `account_type: "lab_head"` + `lab_id` into the user's settings via
  `patchUserSettings`. `AccountType` is `"member" | "lab_head"` in
  `frontend/src/lib/settings/user-settings.ts`; it normalizes unknown values back to
  `"member"` on read and never auto-elevates.
- The self-serve switch the hub adds is the missing third door. It calls the same
  `createLabLocal` + persist `lab_head` + `publishLabRemote` sequence from a button
  on `/account`, with no operator staging and no forced fresh-OAuth detour.

### Folder mode + migration

- Folder mode is DERIVED, not stored in a sidecar. `isLabModeFolder({ userCount,
  anyLabHead })` (`frontend/src/lib/lab/lab-mode.ts`) returns lab-mode when
  `userCount >= 2` OR any user in the folder holds `account_type: "lab_head"`.
  Writing the current user to `lab_head` therefore flips the currently connected
  folder into lab mode with no format change. This is the key constraint that makes
  in-place conversion safe.
- The migrate-to-solo machinery is the "iron-clad" data layer:
  `planMigrationToSolo` (pure planner), `executeMigrationToSolo` (bundles each
  non-primary user to `_migration_bundles/`, trashes originals to `_trash/`, strips
  cross-owner share pointers per `migration-ref-policy.ts`), wired live by
  `migrate-to-solo-live.ts` and surfaced by `MigrateToSoloModal`. The hub reuses the
  MigrateToSoloModal preview/confirm pattern for the folder-handling step, and reuses
  `initializeFolder()` / `connect()` from the file-system context for the
  create-a-new-lab-folder path.
- The 3-tier chooser is `AccountTierChooser`
  (`frontend/src/components/onboarding/AccountTierChooser.tsx`): Local / Free / Start
  a lab / Join a lab tiles, gated by `LAB_TIER_ENABLED` and friends. The hub reuses
  its tile language and the lab-create routing rather than a new chooser.

---

## 3. Proposed layout

`/account` stays inside `PortalShell` (sign-in gated, folderless-safe). It becomes a
single scrolling column of cards in this order. Every card is independently present
or absent based on state, so the page is honest about what applies to this user.

```
+--------------------------------------------------------------+
|  Account                                                     |
|                                                              |
|  [ 1. Identity card ]                                        |
|     avatar | @handle / display name / affiliation | Edit    |
|     small role chip: Free / Solo / Lab head / Member        |
|                                                              |
|  [ 2. Plan & billing summary ]   <- NEW, the headline       |
|     Tier name + state pill (Trial 12 days / Comped / Paid)  |
|     base price (from catalog.ts) + "usage billed at Nx"     |
|     this period accrued + card-on-file status               |
|     renewal or expiry line                                   |
|     [ Manage billing ]  [ Upgrade ]  (deep-link + inline)   |
|     CoverageBanner when a lab covers this member            |
|                                                              |
|  [ 3. Your data folder ]                                     |
|     the existing connect / welcome-back / open card         |
|                                                              |
|  [ 4. Run a lab ]   <- NEW, only for Free/Solo non-heads    |
|     "Convert to a lab-head account" pitch + Start button    |
|     -> opens the switch + folder-handling flow (Section 5)  |
|                                                              |
|  [ 5. Key restore / provision ]  (unchanged, flag-gated)    |
|                                                              |
|  [ 6. Your account links ]  researcher directory, etc.      |
+--------------------------------------------------------------+
```

Card 2 is the new headline and the answer to requirement 1 and 2. Card 4 is the new
door for requirement 3, opening the flow that satisfies requirement 4. Cards 1, 3,
5, 6 are the existing AccountHome content, reordered so billing sits directly under
identity.

---

## 4. The tier + billing surface (own vs deep-link)

The hub must show entitlement state without duplicating billing logic. The proposal:

**Card 2 reads the same source as Settings and shows a compact summary, with the
heavy controls deep-linked.** Concretely:

- The card reads `ModelAStatus` (and, for lab heads, `LabStatus`) through one thin
  shared hook (Section 8) so the number on `/account` and the number in Settings can
  never drift. No new endpoint, no recomputation.
- It renders, read-only: the tier name, a single state pill, the base price from
  `catalog.ts`, the usage-markup phrasing, this-period accrued, card-on-file yes/no,
  and a renewal-or-expiry line. The state pill is computed from `ModelAStatus`:
  - `trialPhase === "trialing"` -> "Trial, N days left" (from `trialEndsAt`).
  - `getActiveCompedTier` non-null -> "Comped by ResearchOS" (with expiry if the
    grant has one).
  - `sponsoringLab` set -> "Covered by <lab name>" (reuse `CoverageBanner`).
  - paid + `hasCard` -> "Active".
  - `trialPhase === "ended_no_card"` / `trialPaused` -> "Action needed, add a card".
- Primary actions:
  - "Manage billing" deep-links to `/settings?section=plan-storage` (the existing
    `ModelABilling` + `CloudStorageUsageSection`). One source of truth for the deep
    controls (cap editing, card setup, lab roster, storage a-la-carte).
  - "Add a card" / "Update card" is the one inline control we surface directly,
    because it is a single call (`POST /api/billing/model-a/card-setup`) that
    `ModelABilling` already exposes; reusing that handler avoids a Settings detour
    for the most common action. This is reuse, not duplication: same endpoint, same
    component-level handler lifted into a shared hook.
  - "Upgrade" routes by current tier: Free -> Solo card-setup, Solo -> the Run a lab
    flow (Card 4), lab head -> Settings.

Why summary-plus-deep-link rather than hosting everything: `ModelABilling` and
`CloudStorageUsageSection` are non-trivial stateful panels (cap editing, roster,
storage bars, trial banners). Re-hosting them whole on `/account` would either
duplicate them or force a large refactor to make them embeddable in two places. A
compact read-only summary plus a deep link keeps one home for the controls while
making `/account` answer "what am I on and is anything wrong" instantly.

**Open fork A (Grant decision):** Should "Manage billing" deep-link to Settings, or
should we instead make `ModelABilling` embeddable and render it inline in an
expandable section on `/account`? Deep-link is less code and keeps one home;
inline-embed is one fewer click but needs `ModelABilling` refactored to accept an
"embedded" prop. Recommendation: deep-link now, revisit inline-embed only if Grant
finds the extra click costly.

**Open fork B (Grant decision):** "Manage billing" today can only launch Stripe
Checkout setup mode (add/update card). A true self-serve "cancel / change plan /
download invoices" needs a Stripe customer-portal route
(`POST /api/billing/model-a/portal` calling `billingPortal.sessions.create`), which
does not exist yet. Do we scope that portal route into this work, or leave "Manage
billing" pointing at Settings until a billing lane adds the portal? Recommendation:
leave the portal out of this design-only pass, flag it as a follow-up for the
billing lane, and have the hub link to Settings for now.

---

## 5. The Solo/Free -> lab-head switch flow

This is the new door. It is distinct from `LabProvisionResume` (operator one-tap for
pre-staged PIs) and from `LabCreateResume` (fresh-OAuth new-signup new lab). It is a
self-serve, in-session conversion for an already-signed-in Free or Solo user.

Card 4 ("Run a lab") shows only when the user is signed in, has an OAuth email, and
is NOT already a lab head (`account_type !== "lab_head"`, no `lab_id`). Tapping
"Start" opens a guided modal with these steps.

### Step 1: What changes (plain-language preface)

A short explainer card. "A lab-head account lets you invite researchers, pool
storage and budget, run the lab dashboard, and host your lab's web home. Your
personal notes stay yours. You can do this now and invite people later." Includes the
lab price line from `catalog.ts` ($25/mo founding lock-in + usage at 7x) and the
billing note that billing is off during beta. No surprise charges.

### Step 2: Lab details

Collects `labName`, `institution`, optional `piTitle` and `piDisplay`. These feed
`createLabLocal`. Prefill `institution` from the profile `affiliation` and
`piDisplay` from the profile display name so the common case is one confirm. Validate
that an OAuth email is present (ORCID-only sessions get the same email-OTP gate that
`LabCreateResume` uses, surfaced inline here rather than as a separate wizard).

### Step 3: Folder handling (Section 6 details the UX)

The decision about which folder becomes the lab. This is the crux and is described in
its own section.

### Step 4: Confirm and create

On confirm, the flow runs the existing sequence, no new lab-genesis logic:

1. `createLabLocal({ username, identity, oauthEmail, labName, institution, piTitle,
   piDisplay })` on-device. Instant. The user is a lab head locally.
2. `patchUserSettings(currentUser, { account_type: "lab_head", lab_id })` so the
   identity card chip and folder-mode derivation flip. This is the same write
   `LabProvisionResume` does at line 210.
3. `publishLabRemote(labId, created)` retryably. If the relay or directory call
   fails, the pending genesis persists and resumes later, exactly as the existing
   resume components handle it. The UI shows "Lab created, finishing publish" rather
   than blocking.
4. The folder action chosen in Step 3 runs (create new folder, or convert in place;
   see Section 6).

### Reversibility and soft-locks

Per house policy (no soft-locks), the modal can be dismissed at every step with no
side effects until Step 4 confirm. After conversion, "undo" is not free because a lab
exists in the directory, so the confirm step states clearly what is permanent (a lab
is created and published) and what is not (you can leave the lab folder solo, you can
create more folders). We do not offer a one-click lab delete here; that is an existing
lab-lifecycle concern out of scope for this proposal.

---

## 6. Folder-handling decision UX

This is requirement 4 and the part most constrained by reality. The constraint to
respect up front: **the app can only see folders it has a File System Access handle
for.** It cannot enumerate arbitrary on-disk folders. At any moment it knows about the
currently connected folder (if any) and the remembered last-connected folder
(`lastConnectedFolder`). So the UX cannot present "here are all your folders, pick
which migrate"; it presents the folders it can actually act on and a clear path to
point at others.

The folder step offers three honest choices, framed by what the app can see.

### Choice A: Create a fresh folder for the lab (recommended default)

"Start the lab in its own new folder. Your current solo folder stays exactly as it
is, personal and untouched." This reuses `connect()` -> `initializeFolder()` from the
file-system context (the same path the connect card uses) to create and seal a brand
new ResearchOS folder, which becomes the lab folder. Because the current user is now
`lab_head`, the new folder is derived as lab mode automatically (no format change).
This is the cleanest path and the recommended default because it never touches
existing solo data.

### Choice B: Convert the currently connected folder in place

"Make this connected folder your lab folder." Shown only when a folder is currently
connected. Because folder mode is derived from `account_type: lab_head`, writing the
current user to lab head already turns this folder into a lab folder with no data
move. The UX must be explicit that the folder's existing notes become the lab head's
notes inside a lab-mode folder. No migration runs in this direction (solo -> lab is a
derivation flip, not a data move). We surface a one-line preview of what is in the
folder (user count, record counts) using the same `countRecords` read the migration
planner uses, so the user sees what they are converting.

### Choice C: Keep solo here, point me at a different folder for the lab

"I want my lab somewhere else." Opens the OS folder picker (`connect()`); if the
chosen folder is empty it is initialized as the lab folder, if it already has
ResearchOS data the user is told and can pick Choice B semantics for that folder
instead. This covers the user who already has a separate folder they want to use.

### When the connected folder is multi-user

If the currently connected folder already has multiple users (it is already lab-ish),
the in-place choice is not a solo -> lab conversion and the migrate-to-solo machinery
is the relevant tool only if the user wants to SPLIT their personal data out first.
In that case the flow links to the existing `MigrateToSoloModal` ("take my data into
my own folder first, then start the lab there") rather than reimplementing it. This
keeps the iron-clad migration path as the one and only data-mover.

### What we explicitly do NOT do

- We do not move or copy notes between folders as part of the switch (except via the
  existing `MigrateToSoloModal`, user-initiated). The default (Choice A) sidesteps
  data movement entirely.
- We do not change the on-disk folder format. Lab-ness is derived from
  `account_type` + user count, both already persisted today.
- We do not auto-enumerate the disk. We act on handles we have and let the picker
  reach the rest.

**Open fork C (Grant decision):** Should Choice A (fresh lab folder) or Choice B
(convert connected folder in place) be the default selection? Recommendation: Choice
A, because it is non-destructive and matches the mental model "my personal stuff
stays mine, the lab is a new shared space." Grant may prefer B for the solo
researcher who simply IS the lab and wants their existing notes to be the lab's
starting content.

**Open fork D (Grant decision):** For Choice B in-place conversion, do we want a
visible "this is reversible by leaving the lab" affordance, or is the lab-lifecycle
(leave/delete) genuinely out of scope and we only state permanence? Recommendation:
state permanence here, treat lab-leave as a separate lab-settings concern.

---

## 7. Entitlement states the hub must render

The state pill and renewal/expiry line in Card 2 are computed from `ModelAStatus` +
`getActiveCompedTier`. The full set the design covers:

| State | Source | Pill copy | Secondary line |
| --- | --- | --- | --- |
| Free | `planId === "free"`, no comp | "Free" | "Upgrade to unlock send, co-edit, the companion app." |
| Solo trial | `planId === "solo"`, `trialPhase === "trialing"` | "Trial, N days left" | renewal date from `trialEndsAt` |
| Solo paid | `planId === "solo"`, `hasCard`, active | "Active" | "$3/mo + usage. $X.XX accrued this period." |
| Lab head paid | `planId === "lab"`, head | "Active" | "$25/mo founding rate + usage. Lab dashboard in Settings." |
| Comped | `getActiveCompedTier` non-null | "Comped by ResearchOS" | expiry date if the grant has one |
| Covered member | `sponsoringLab` set | "Covered by <lab>" | "Your lab covers your cloud usage." |
| Trial ended, no card | `trialPhase === "ended_no_card"` or `trialPaused` | "Action needed" | "Add a card to keep your paid features." |

Beta note: billing is OFF during beta, so in the current build most users read as
Free or as a comped/trial state and the price lines are informational. The hub copy
must not imply a live charge while billing is off (reuse the existing
"Everything is free during the beta" calm message from `CloudStorageUsageSection`).

---

## 8. The one new piece of shared code (when this is built)

To keep `/account` and Settings reading identical numbers, introduce a single thin
client hook, not new business logic:

- `useModelAStatus()` wrapping `GET /api/billing/model-a/status` (the fetch
  `ModelABilling` does inline today), returning `{ status, loading, error, refresh }`.
- Optionally `useLabStatus()` wrapping `fetchLabStatus()` for the lab-head card.

`ModelABilling` and Card 2 both consume the hook so there is exactly one fetch
contract. This is the only net-new code the design implies on the billing side;
everything else is composition of existing components and endpoints. (This proposal
does not write it; it is the implementation note for the build lane.)

No changes to `assumptions.ts` / `plans.ts` / `catalog.ts` rates. No new endpoint.
No on-disk format change.

---

## 9. Coordination, risks, constraints

- **Billing/trial lane overlap.** A billing or trial lane may be active on Settings
  -> Plan & storage (`ModelABilling`, `TrialBanner`). This proposal is design-only and
  touches no billing files, so it should not collide. The one shared touchpoint is the
  proposed `useModelAStatus` hook in Section 8; whoever builds it should land it as a
  pure read wrapper around the existing `/api/billing/model-a/status` call so the two
  lanes share one contract. Flagging this explicitly so the build lanes serialize on
  that hook.
- **FSA enumeration limit.** The app cannot list disk folders; the folder-handling UX
  is built around handles it holds plus the picker. Called out so reviewers do not
  expect a folder browser.
- **ORCID-only sessions.** No email means `createLabLocal` throws; the flow reuses the
  email-OTP gate already in `LabCreateResume` rather than failing silently.
- **Publish failure is non-blocking.** `publishLabRemote` is retryable and the pending
  genesis resumes, so a flaky relay does not strand a half-made lab head.
- **No soft-locks.** Every step of the switch flow is dismissable until the final
  confirm; the confirm states plainly what becomes permanent.

---

## 10. Open design forks for Grant (summary)

- **Fork A:** "Manage billing" deep-links to Settings (recommended) vs render
  `ModelABilling` inline on `/account` (needs an embeddable refactor).
- **Fork B:** Scope a Stripe customer-portal route now vs leave portal-grade controls
  in Settings and link there (recommended: leave it, flag for billing lane).
- **Fork C:** Default folder choice on conversion is a fresh lab folder (recommended,
  non-destructive) vs convert the connected folder in place.
- **Fork D:** For in-place conversion, surface a "reversible by leaving the lab"
  affordance vs only state permanence (recommended: state permanence, lab-leave is a
  separate concern).
- **Fork E:** Should the "Run a lab" card also appear for Free users, or only Solo?
  Free can technically become a lab head, but the pitch may want them on Solo first.
  Recommendation: show for both Free and Solo, since lab is its own paid unit and we
  should not force a Solo detour.

---

## 11. Deliverables

- This proposal: `docs/proposals/2026-06-20-account-hub-tier-billing-switch.md`.
- Clickable before/after mockup: `docs/2026-06-20-account-hub-before-after.html`
  (self-contained, light theme default with a dark toggle, real token hexes from
  `globals.css`, per-item Agree / Keep / Discuss controls that export to clipboard).

No production React in this pass. When the build lane picks this up, the only net-new
code is the `useModelAStatus` read hook (Section 8) plus the Card 2 summary, Card 4
switch modal, and the folder-handling step that composes `createLabLocal`,
`patchUserSettings`, `publishLabRemote`, `connect`/`initializeFolder`, and (only when
the user opts to split) `MigrateToSoloModal`.
