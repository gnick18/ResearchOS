# Account setup revamp (start screen + 3-tier chooser + splash)

Status: BUILD PLAN, mockups treated as final (Grant 2026-06-09). Ready to build.
Author: HR (orchestrator)
Date: 2026-06-09

Mockups (the visual + copy spec, treated as final):
- `docs/mockups/account-setup-revamp.html` (the flow: splash, 3-tier chooser, OAuth, lab create/join, folder, success)
- `docs/mockups/account-splash.html` (the liquid-fill splash, APPROVED)
- `docs/mockups/beakerbot-tier-icons.html` (the 3 tier illustrations + the feature comparison table + the "which tier is for you" guide)

Design context: docs/proposals/{IDENTITY_LAB_LOGIN, IDENTITY_OAUTH_ONLY, LAB_TIER_REDESIGN, METERED_STORAGE_PRICING, PRICING_COST_MODEL}.md and [[project_account_setup_revamp]] [[project_cross_boundary_sharing]] [[project_identity_model_simplification]].

House style: no em-dashes, no emojis, no mid-sentence colons.

## Why

Today the app silently defaults a fresh user to a solo account and drops them at Workbench. There is no choice of how to use ResearchOS and no place to opt into an account, so the only way to a lab or a sharing account is buried in Settings or the /dev-lab harness. The fix is a real start screen with a 3-tier chooser that gates each tier behind the right login, and a branded splash so opening the app feels intentional.

## The locked model (from the mockups)

Three tiers, all local-first (data always lives on the user's disk, the cloud is only a sync/sharing intermediary):

- **Local-only** (account_type solo, no identity published). No login, no cloud. The current solo path.
- **Free account** (account_type solo, identity published to the directory). OAuth login, data stays on disk, unlocks cross-boundary send/receive + directory presence. Free, with the existing fixed relay budgets (1 GB mailbox, 30-day TTL, blocks at cap, never billed today).
- **Lab** (account_type lab_head to create, member to join). OAuth login, cloud DO intermediary for team sync + collab + PI oversight. Cost-recovery metered above a 1 GB-per-member free pool, cap-blocks (pauses, never surprise-bills), PI can pay one consolidated invoice.

Pricing is cost-recovery pass-through, the free allowance is on us, hitting a cap pauses rather than bills. Lab create-or-join: create = Lab Head, join = invite link OR a searchable lab directory with request-to-join and PI approval (reuses Phase 8e); labs carry a listed/unlisted visibility flag so private labs stay invite-link-only.

## account_type mapping

`settings.json account_type` already exists (values seen: solo legacy default, member, lab, lab_head). The chooser sets it:

- Local-only -> `solo`, local identity only (CreateLocalIdentityStep), no OAuth, no directory publish.
- Free account -> `solo` + an OAuth-published directory identity (SharingSetupWizard binds the EXISTING keypair, the two-keypair-bug fix). The Free-vs-Local distinction is "has a published directory identity", not a different account_type.
- Lab Head -> `lab_head` + createLabForCurrentUser (binds OAuth email to the lab head).
- Lab Member -> `member` + lab_id, set only after PI approval (invite accept or directory request approve), never before (Phase 8e invariant).

## Current state (what exists, what we build on)

- `frontend/src/lib/landing/landing-gate.ts` decides whether the landing shows. The landing already has provider sign-in buttons.
- `frontend/src/lib/providers.tsx` orchestrates the entry gate: landing -> `ResearchFolderSetupNew` -> `UserLoginScreen` -> the app shell.
- `frontend/src/components/ResearchFolderSetupNew.tsx` is the folder-connect + create-user screen (display name, lab name, color). It ALREADY threads an OAuth `signIn` query-param intent through folder setup and triggers the redirect after onComplete (the seed of OAuth-at-creation we extend).
- `frontend/src/components/UserLoginScreen.tsx` is the picker + unlock gate (recovery-code only after P3b).
- `frontend/src/components/sharing/CreateLocalIdentityStep.tsx` mints the local keypair + recovery code (has the `required` prop).
- `frontend/src/components/sharing/SharingSetupWizard.tsx` does OAuth publish (cross-boundary / Free tier), binding the existing keypair.
- Lab: `useLabSession.ts` + `LabSessionMount.tsx` + `LabSignInGate` (OAuth gate in front of the app for lab accounts), `lib/lab/lab-create.ts` createLabForCurrentUser, the invite handshake (8b-8e) + `LabInviteResume.tsx`.
- Flags: `LAB_TIER_ENABLED` (lab tier, off in prod), `SHARING_ENABLED` (cross-boundary, off in prod). Both true in Grant's local tree for dev.

What is MISSING is only the front-door chooser that routes a fresh user into the right one of these existing paths, plus the splash and the success transition, plus the 3 BeakerBot illustrations as real assets.

## Flag strategy (decouples shipping from the lab launch gate)

The chooser shows tiles conditionally so the revamp can ship BEFORE the lab cost-enforcement gate clears:

- Local-only tile: ALWAYS shown.
- Free account tile: shown when `SHARING_ENABLED`. Otherwise hidden (or "coming soon" non-clickable).
- Lab tile: shown when `LAB_TIER_ENABLED`. Otherwise hidden (or "coming soon").

So in prod today (both flags off) the chooser ships showing only Local-only, which is a strictly better start screen than the silent default, and the splash + transitions land for everyone. Free and Lab light up when their flags flip. The Lab flag stays gated behind the cost-enforcement carry-over launch gate in COLLAB_STORAGE_D1_DO_MIGRATION.md. This means PHASES A and C can ship to prod immediately, while B's lab branch is dev-only until the gate clears.

## Phased build plan

### Phase A: the chooser screen

The new front door. A `<AccountTierChooser>` component rendered by `providers.tsx` as the first beat for a fresh connect (no currentUser, fresh folder), before `ResearchFolderSetupNew`.

- New `frontend/src/components/onboarding/AccountTierChooser.tsx` faithful to the mockup: 3 tiles (Local / Free / Lab) gated by the flags above, the solo escape hatch line, and "you can upgrade later" messaging.
- A "Compare the tiers" expandable + the "which tier is for you" guide, lifted from `beakerbot-tier-icons.html` (the comparison table + guidance copy + the verified pricing rows).
- Chooser sets the intended tier in flow state (sessionStorage handoff, same pattern ResearchFolderSetupNew already uses for the OAuth `signIn` intent) and advances to folder-connect.
- Wire into `providers.tsx` entry sequence: chooser -> (folder if Local) or (sign-in then folder if Free/Lab). Reuse landing-gate state; do not break the existing landing/connect/picker logic or the demo / wiki-capture bypass.
- Out of scope here: actually creating the account (Phase B). Phase A just captures the choice and routes.

Ships to prod with only the Local tile live (flags off).

### Phase B: branch wiring to the existing machinery

Each tile drives an existing path; this phase is mostly wiring + setting account_type, not new backend.

- **Local-only**: connect folder -> create user (account_type `solo`) -> CreateLocalIdentityStep (recovery code) -> app. Essentially today's path with account_type set explicitly to solo.
- **Free account**: OAuth sign-in (extend ResearchFolderSetupNew's existing `signIn` intent so it runs for the Free tier) -> create user (account_type `solo`) -> SharingSetupWizard binds the existing keypair to the verified email + publishes the directory profile -> app. Reuses the auto-bind logic proven in lab-profile-auto-bind for the publish step where it fits.
- **Lab Head**: OAuth sign-in -> create user (account_type `lab_head`) -> createLabForCurrentUser (binds the head email, mints the lab) -> LabSessionMount/LabSignInGate takes over -> app. This is the real, non-harness version of what /dev-lab does today, so it ALSO closes the P3a live-verify (the auto-bind directory profile fires on this real path).
- **Lab Join**: the chooser's "Join a lab" sub-screen, with two inputs, paste an invite link (reuses LabInviteResume / the 8b-8e accept handshake), or search the lab directory and Request to join (new: a directory lab-search endpoint + a request that lands in the PI's Phase 8e approval queue; honor the listed/unlisted flag). account_type `member`, lab_id set only on PI approval.
- Lab branches are dev-only (LAB_TIER_ENABLED) until the launch gate clears. Free branch is behind SHARING_ENABLED.
- FLAG to master before building the directory lab-search + request-to-join (new endpoint + a listed/unlisted field on the lab record = data-shape touch, pre-flag per the data-shape rule).

### Phase C: splash + success transition

- New `frontend/src/components/onboarding/Splash.tsx` from `account-splash.html`: full-screen branded `#E6F4FE` canvas, BeakerBot outline draws on, rainbow pastel liquid fills with the percentage, wordmark rises, rainbow flood reveal. Plays ~2.5s on app open, then fades to the chooser (or straight to the app for a returning signed-in user). Reduced-motion shows a static logo. Built as CSS/SVG (no new deps), reusing the BeakerBot geometry.
- Success transition: the celebratory checkmark + BeakerBot + confetti hand-off into Workbench, fired on first folder-connect AND on each daily sign-in. Reuse the mobile SuccessBurst motion language where it maps.
- Respect the existing one-time landing-seen / connect-bypass logic so the splash does not nag returning users.

Ships to prod (flag-independent).

### Phase D: promote the BeakerBot illustrations to brand/

The 3 tier illustrations become real, reusable assets (currently inline JS in the mockup).

- Export from `beakerbot-tier-icons.html` to `brand/beakerbot-solo.svg`, `brand/beakerbot-computer.svg` (the girl beaker sharing to the on-screen girl beaker), `brand/beakerbot-lab.svg` (the PI leading a team, one teammate with glasses), all from the real BeakerBot geometry, both light and dark friendly.
- Add a React `<BeakerBotScene name="solo|computer|lab">` (or 3 small components) under `frontend/src/components/`, sourced from the brand SVGs, used by the chooser tiles + the comparison header.
- Register in `brand/BRAND_MANAGER.md`. These are VERIFIED brand assets, so they need Grant's explicit sign-off before shipping (the mockup review IS that sign-off, confirm at promote time).
- Note: these are mascot illustrations, not icon-registry glyphs, so the icon-guard does not apply, but keep them out of inline `<svg>` in app code by sourcing from the brand files.

## What NOT to break

- The landing / connect-bypass / user-picker logic and the demo + wiki-capture bypass in providers.tsx.
- Returning-user flow: an existing user with a folder + identity should NOT see the chooser; they go picker -> unlock -> app (with the splash only as the brief open beat).
- Solo stays ceremony-free where it already is; the chooser must not add friction to the Local path beyond the one choice.
- account_type writes are a settings.json shape touch, lazy-normalize legacy/missing values to solo on read.
- Do not flip LAB_TIER_ENABLED or SHARING_ENABLED in committed config; they stay off in prod until their gates clear.

## Verification

- Mockups are the spec; build to them.
- Phase A/C: orchestrator-verifiable in the browser (chooser renders, tiles gate on flags, splash plays, transition fires).
- Phase B lab + Free branches: NOT fully headless-verifiable (OAuth + 2-identity). Grant live-tests the real lab-create path (which also verifies P3a) and the Free publish path, the same posture as the lab-tier arc.
- Per-arc verifier loop on the chooser + splash (mechanics + spec-compliance + fresh-eyes against the mockups).

## Sequencing

A (chooser, ship with Local live) -> C (splash + transition, ship) can go first and reach prod. B (branch wiring) lands behind flags, Free when SHARING_ENABLED is ready, Lab gated on the cost-enforcement carry-over. D (brand assets) lands with A since the tiles need the illustrations. Practical order: D-assets + A together, then C, then B.
