# Handoff: lab-tier GA smoke + onboarding/pricing/social work (2026-06-14)

Session ran long (Billing lane). This captures everything in flight so the next agent + Grant can resume. Nothing here is pushed unless stated; several pieces are mid-verification.

## 1. Lab tier going GA (the active thread) — SMOKE IN PROGRESS, BLOCKED then FIXED

DECISION (Grant): turn the lab tier ON for FREE PI lab accounts. Flag posture (in `frontend/.env.local`, and Grant must set `NEXT_PUBLIC_LAB_TIER_ENABLED` in Vercel + redeploy for prod):
- `NEXT_PUBLIC_LAB_TIER_ENABLED=1` (live)
- `NEXT_PUBLIC_LAB_TOKENS_V2=0` — launch on the VERIFIED V1 head-signed invite/accept path; V2 (folderless token join + keyless account-first admit) is the NEXT verification gate, not launch
- `NEXT_PUBLIC_DEVICE_KEY_V2` off — cross-device E2E data-key restore is the gate AFTER the smoke
- `lab/config.ts` is ENV-DRIVEN (defaults false), SAFE to push (the old "committed =true landmine" was already refactored away)
- It is independent of `BILLING_ENABLED`, so lab accounts are free while billing stays off.

FULL HYBRID AUDIT done (4 parallel auditors): all four tiers (solo/lab/dept/inst) are MIGRATED in code to the unified folderless `invite-tokens.ts` (layer=lab|dept|institution) + `ownerKeyForEmail` identity; dept/inst pioneered it, lab adopted Phase 4. NO reachable legacy folder/device-bound LOGIN path. migration-to-solo trigger IS built (old "unbuilt" note was stale). The lab create→invite→accept→finalize→enter flow is fully wired on V1.

### The smoke setup (running, needs teardown when done)
Two ISOLATED dev servers off detached worktrees at commit `67d313c75` (so Grant's `:3000` and other lanes' `:3001/:3002` are untouched), sharing the same Neon directory + relay so the two accounts interact:
- `/Users/gnickles/Desktop/ROS-lab-smoke-pi/frontend` → **:3003**, dev-mock `pi@wisc.edu` (PI)
- `/Users/gnickles/Desktop/ROS-lab-smoke-member/frontend` → **:3004**, dev-mock `grad@wisc.edu` (member)
Logs: `/tmp/ros-smoke-{pi,member}.log`. Auth is `AUTH_DEV_MOCK=1` (type any email, no real Google needed; real Google OAuth is NOT configured locally and is a Vercel-only concern). Same-domain emails on purpose, to also exercise the verified-institution badge + same-institution signal.
TEARDOWN when finished: stop both `next dev`, `git worktree remove ROS-lab-smoke-pi ROS-lab-smoke-member` (+ prune).

### Where the smoke is stuck → now fixed, awaiting retry
Both accounts signed in (dev-mock) and CLAIMED HANDLES fine (Fake PI @piresearcher, fake grad @grad). Then BLOCKED: connecting a data folder bounced both back to `/account` in a loop. This is a REAL launch-relevant bug (fresh first-folder connect), found by the smoke. Two-part root cause + fix (chip task `task_b720bfd7`):
1. `AccountHome.onConnect` did `window.location.assign("/")` (hard reload). A freshly-granted File System Access permission reverts to "prompt" after a full reload and cannot silently re-attach without a gesture, so the connection dropped → account-first guard bounced to `/account`. FIX: client-side `router.push("/")`.
2. The bigger half: a BRAND-NEW EMPTY folder makes `connect()` resolve `false` (folder needs init: `validateResearchFolder` fails, flips `needsInitialization`, `isConnected` stays false). The unconditional push still bounced. FIX: `onConnect` now branches — success → push; `false`+handle (new folder) → `await initializeFolder()` then push; cancel → just stop spinner. Also converted the connected-state "Open ResearchOS" `<a href>` to `router.push`. And added `!needsInitialization` to the account-first redirect guard in `providers.tsx` (defense-in-depth).
- STATE: these edits are in the MAIN working tree (`frontend/src/components/account/AccountHome.tsx` + `frontend/src/lib/providers.tsx`), tsc CLEAN, FolderConnectGate tests 19/19. NOT committed yet. NOT browser-verified (native `showDirectoryPicker` can't be driven synthetically). The smoke worktrees got the partial (router.push) copy; re-propagate the full fix or just verify on `:3000`.
- RESUME THE SMOKE: dev-mock fresh user → claim handle → connect a BRAND-NEW EMPTY folder → expect the "Initialize New Folder" prompt then landing in-app (UserLoginScreen), NO bounce. Then: PI creates lab → Lab settings → invite member → copy `/lab/join#...` link → member pastes/opens → member sets up workspace+unlock FIRST (V1 needs the keypair before accepting) → Accept → PI approves the pending accept → member Enters lab → both see the shared workspace. WATCH: the PI may next hit a keypair/identity step for lab CREATION (account-first + DEVICE_KEY_V2 off) — that is the next thing to find/verify.

## 2. Other bug found in the smoke
- `providers.tsx` `useInsertionEffect must not schedule updates` warning (dev-only) — the `history.pushState` patch dispatched `researchos:locationchange` synchronously during React's commit phase. FIXED on chip `task_27ae59cd` (wrap dispatch in `queueMicrotask`), on its own branch, not merged. Harmless dev noise; merge whenever.
- Flagged but not chased: `LabSignInGate.test.tsx` has 7 PRE-EXISTING failures (fail identically on untouched main). Worth a look since we're launching the lab sign-in gate, but the live smoke is the stronger signal.

## 3. Price-modeling + unified operator console — DONE, local main (pushed earlier by Grant)
- Price-modeling popup wired into the business page + Actuals/Simulation toggle (`0441e759b`): reads LIVE `assumptions.ts`/`plans.ts`; Actuals seeds the scale model's free-user count from `/api/admin/metrics` `directory.totalIdentities`, paid tiers 0 pre-launch.
- Unified operator console (`4fe3f4a0e`): `/admin` is now ONE Settings-style shell (`OperatorShell.tsx`, rail + scroll-spy + search) merging metrics + finances; `/business` + `/admin/business` redirect to `/admin#finances`; price modeling is a full Modeling SECTION; Broadcast under Comms; manual Refresh re-pulls BOTH metrics + ledger (`807a04caf`).
- Pricing decisions LOCKED in docs + memory (`39d68bd13`): `assumptions.ts`/`plans.ts`/AI-meter rates are deliberate research, do NOT override without Grant. See AGENTS.md pricing block + `BILLING_FACTS.md` "Where the numbers live" + `[[feedback_pricing_decisions_locked]]`.

## 4. Researcher profiles + social layer — SPEC'D (not built)
Spec `docs/proposals/2026-06-14-researcher-profiles-and-social-layer.md`; mockup `docs/mockups/2026-06-14-researcher-profiles-social.html`; memory `[[project_researcher_social_layer]]`. Unify the two thin profiles into one enriched researcher profile (bio, typed links, ResearchGate, ORCID-as-field + auto-pulled works with PINNED pubs + self-author HIGHLIGHT, verified badge) + a discovery/social layer. LOCKED decisions: listed-by-default+opt-out; mutual-connect + institution clusters; institution page shows the FULL listed-member directory (LinkedIn-style); a CONNECTIONS LIST on the profile; a TIERED share picker (lab mates → connections → search/email, reusing find-and-share's account-vs-invite-email). Institution pages PRE-SEEDED from ROR (not US News), lazily revealed, on-the-fly fallback. DEPT pages: user-entered multi-value dept (no clean registry), self-building per-institution typeahead + a mostly-NON-LLM dedup (entry guidance + abbreviation map + trigram + monthly sweep, thin human-approved LLM tail). Community wiki-style curation (verified-domain members curate facts, reversible). Page CLAIMING: free = factual curation (no auth check), PAID sponsor = official voice + branding + auto "Sponsors ResearchOS" affiliate badge (payment IS the check). Member-vouching DECIDED out. GTM: land-and-expand, researcher-sent "ask your library to sponsor" nudge, operator warm-lead dashboard by adoption density; dept-level triggers are the faster close.

## 5. Onboarding revamp — popups built (branch), wizard spec'd (background)
- Tile CTA "Set up a lab" → "Create or join a lab" DONE on main (`6e505ae7b`).
- Onboarding POPUP revamp BUILT on branch `onboarding-popup-revamp` (commit `c37380752`), NOT merged: reusable sign-in popup (Google/GitHub/Microsoft + weighted ORCID + email-OTP fallback) + folder-picker popup (drag/click) + lab create/join 50/50 split; Local→folder popup, Free→sign-in→folder popup, Lab→split page recycling both. tsc clean, 9+106 tests pass (7 LabSignInGate failures are pre-existing). NOT browser-verified. Mockup `docs/mockups/2026-06-14-onboarding-free-and-lab-revamp.html`. WARNING: its `FolderPopup` must use client nav + handle `needsInitialization` or it reintroduces the §1 bounce loop.
- Onboarding WIZARD spec+mock generating in BACKGROUND (agent `a995eda29c7804188`): 3 independent tracks sharing one stepper shell — solo (handle→profile→folder), PI/lab (+lab setup), ORG ADMIN dept/inst (STANDALONE, folderless, any-device: sign in → org name → link to parent → roster → billing, NO folder/research-profile). KEY correction (Grant): org admin is NOT "a layer on a personal research account" — for ~99% of admins it is a standalone account; the backend already supports this (`/department` + `/institution` are standalone sign-in-gated folderless portals), the GAP is the ENTRY (today routes through the research `/account` surface; needs a first-class top-level "set up a department/institution" entry). This is a SETUP wizard, NOT the retired V4 onboarding TOUR. After it lands + Grant approves, build it in the background on its own branch (merge later, not mission-critical). Memory: `[[project_account_setup_revamp]]`, `[[project_dept_institution_tier]]`.

## 6. Open chips / background work
- `task_b720bfd7` folder-connect bounce — fixed (see §1), verify + commit.
- `task_27ae59cd` providers useInsertionEffect warning — fixed on a branch.
- bg agent `a995eda29c7804188` — wizard spec+mock (in flight).
- branch `onboarding-popup-revamp` — review + (later) merge.

## 7. Relay note (informational)
Live-editor lane landed an app-wide Geist font fix (`7404905a7`) on main — after sync, operator console / price-modeling / dashboard text switches Arial→Geist (positive). Acknowledged via CCD.

## Immediate next step
Verify the folder-connect fix (§1) on `:3000` or the smoke servers, commit it, then run the lab 2-account smoke to completion (invite→accept→approve→enter), watching for the PI keypair-on-lab-create step. Then teardown the smoke worktrees.

## 8. Connect-a-folder onboarding branches (Grant 2026-06-14, refines chip task_a3344a5c)
When an account-first user (signed in, handle claimed) connects a data folder, two cases:
- FRESH / empty folder -> AUTO-PROVISION the first workspace user (+ keypair) from the account profile (display name + @handle), skip the empty UserLoginScreen, land in-app. Greetings use the real full name. (chip `task_a3344a5c`)
- Folder ALREADY HAS local user(s) (legacy multi-user folder being migrated) -> let them PICK which existing user they are, choose a NEW extraction location, then EXTRACT + rename that user and BIND it to their new account-first cloud identity (so they land IN the new system, not as a bare solo). REUSE the existing migration-to-solo machinery (`MigrationGate` providers.tsx:971 + `MigrateToSoloModal`, `[[project_migration_to_solo_ironclad]]`) — the new piece is the account-binding on extraction. Keep UserLoginScreen for the already-on-new-system multi-user case.

## 9. UPDATE — account-first first-run COMMITTED (3340c81f8)
The §1 folder-connect fix AND the §8 auto-provision-first-user (chip task_a3344a5c) are now BUILT + COMMITTED together on local main as `3340c81f8` (tsc clean, vitest 10/10 on the new helper + FolderConnectGate 19/19). Files: `frontend/src/lib/account/workspace-username.ts` (+test, `deriveWorkspaceUsername`), `UserLoginScreen.tsx` (silent auto-provision: reads /api/account/profile, derives a path-safe human username display-name->session->@handle->email-local, mints the keypair via createLocalIdentity, runs once only when account-first + signed in + 0 local users; offline/multi-user folders fall through untouched), `AccountHome.tsx` + `providers.tsx` (the fresh-folder connect fix). So §1 is no longer "uncommitted" — it's `3340c81f8`. NOT pushed; NOT browser-verified end-to-end (native folder picker + OAuth dev-mock can't be driven synthetically). The chip wrote its own detailed verify script: `docs/handoffs/2026-06-14-account-first-auto-provision-first-user.md` (sign in dev-mock -> claim handle w/ full display name -> connect a BRAND-NEW EMPTY folder -> expect a brief spinner, NO create-user step, greeting "Welcome back, <full name>"). OPEN DECISION (Grant): the recovery code is NOT surfaced on the silent auto-provision path (user can save/rotate it later from Settings -> Sharing where the unconfirmed-recovery state already shows); flip to show-once-before-entering if preferred. Still pending overall: browser-verify this on :3000, then finish the lab 2-account smoke (create lab -> invite -> accept -> approve -> enter), then teardown the smoke worktrees + commit nothing else.
