# Handoff — Account/Folder/Identity redesign, Phase C COMPLETE (2026-06-15)

**Lane:** Popup Unifier → Account/Folder/Identity redesign (recovery). Took over a throttled-subscription handoff and finished the whole recovery arc (Phase C). **Memory:** `[[project_account_folder_identity_redesign]]`. **Design:** `docs/proposals/2026-06-15-account-folder-identity-redesign.md` + `docs/proposals/2026-06-15-c3-server-escrow-crypto-design.md`.

Everything is behind `NEXT_PUBLIC_MULTI_FOLDER` (default OFF); flag-OFF is byte-identical. Grant has it `=1` locally.

## Phase C status

| Phase | What | Where | State |
|---|---|---|---|
| **C1** reset-keep-data | unlock-gate "Can't sign in? Reset and keep your data" → mints fresh identity, keeps plaintext data | `main` `708a901db` | ✅ built + **BROWSER-VERIFIED** (all steps PASS) |
| **C2** PI re-admit | `readmitMember` primitive (rotate+add, no signed-log schema change) + `readmitMemberRemote` orchestrator + LabRoster "Re-admit (reset key)" UI (resolves new identity via `searchResearchers`) | `main` `f0b30f722` + `07eb0f811` | ✅ built + unit-tested; **live verify in progress** |
| **C5** cross-device restore (strict) | replaces the Phase B `// Phase C:` stop-guard with a real restore gate: recovery code → `recoverDeviceKeyFromCloud` → reuse → performLogin | `main` `b940bd8b9` | ✅ built; **live verify in progress** |
| **C3** server escrow + reissue | crypto (`escrow.ts`, split property proven) + Neon escrow/audit/pending_reissue tables + fresh-reauth + enroll/reissue/claim/cancel routes + **Cloudflare SEK Worker** (byte-compat proven) + client enrollment + reissue door | branch `feat/identity-c3-escrow` `a42e746f9`+`b247674d6` | ✅ built + tested, **NOT on main, NOT deployed** |
| **C4** recovery-tier toggle | `RecoveryTierSection` strict-vs-recoverable choice + disclosure; default strict | branch `b247674d6` | ✅ built (ships with C3) |
| **C6** PI pre-provisioning | invite-token `preprovision`/`intendedName` fields + `issuePreprovisionInvite` + `resolvePreprovisionClaim` seam | branch `ae993efd3` | ✅ token layer built; UI + accept-wiring = documented follow-up |

tsc 0 throughout; 288 identity/invites/directory/lab tests green on the branch.

## C3 = the only thing left, and it is GRANT's (not autonomous-able)
C3's design is APPROVED (all §5 decisions locked: fresh re-auth, notify + 48h cancel-delay, beta default = strict, reissue locked to enrolled email; **SEK custody = asymmetric split, reissue Worker on Cloudflare** — separate trust domain from Vercel/Neon, free at our scale). **The deploy + security pass are gated on Grant** and fully documented in **the design doc §10 runbook**: mint+split the SEK, deploy the Worker (`cloudflare/escrow-sek-worker`, no CF account needed for local), set Vercel envs (`ESCROW_SEK_PUBLIC_KEY`/`NEXT_PUBLIC_ESCROW_SEK_PUBLIC_KEY`, `ESCROW_WORKER_URL`, `ESCROW_WORKER_AUTH_TOKEN`, `APP_ORIGIN`), rebase the branch onto main + run `pnpm -C frontend run prebuild` (wiki-coverage gate, NOT caught by tsc), security-pass checklist, staged flag-on. Build it on a branch — **never a shared-main commit** (a main commit publishes to origin, and C3 deploys live attack surface even flag-off).

## Live-verify infra I stood up (this session)
- **Lab relay running in background** for C2: `cd relay && npm run dev` → `workerd` on `127.0.0.1:8787` (the default `COLLAB_RELAY_URL`; no CF account needed). **It is a background process — kill it when done** (`lsof -nP -iTCP:8787 -sTCP:LISTEN`). Directory backend is already wired in Grant's `.env.local` (Neon), so C5 needs no relay.
- **Scratch folders:** `~/Desktop/ROS-verify-c5`, `~/Desktop/ROS-verify-c2-pi`, `~/Desktop/ROS-verify-c2-member` (empty; agent populates in-app — seeding is fragile because notes are Loro-binary + identities need valid crypto).
- **Verify prompts (NOT YET RUN — Grant deferred C2 + C5):** the full ready-to-paste C2 + C5 collaborative prompts + setup + gotchas live in **`docs/test-prompts/2026-06-15-phase-c-c2-c5-verify.md`**. Key gotcha learned from a partial C5 run: `my-backup` 401 = the account isn't OAuth-claimed yet (the local "Create your account" mint does NOT write the cloud backup); fix = Settings → Sharing identity → "Publish a profile" → dev-mock OAuth claim, which writes the binding + key_backup_blob → flips 401→200. Also: the `FolderSwitcher` dropdown doesn't expose its items to the Chrome agent (switch folders by hand; TODO a11y).
- C5 fresh-device step: clear IndexedDB DB `researchos-sharing-identity`, store `device-vault`.

## OPEN ITEM — C2 needs two DISTINCT accounts (blocker for its live verify)
Two browser contexts (normal + incognito) isolate folders/cookies/IndexedDB correctly — **two servers are NOT needed**. BUT the **dev-mock sign-in always logs in as one fixed email** (`AUTH_DEV_MOCK_EMAIL`/`dev@researchos.test`; the UI never passes a chosen email, though the provider in `auth.ts` accepts any). So two incognito windows on dev-mock = same account. Two options for C2:
- **A:** two real OAuth logins (Google for PI window, GitHub for member window — both enabled). Zero code.
- **B (not built):** add a dev-only email picker to the dev-mock sign-in so context A = `pi@…`, context B = `member@…`. Small, dev-gated. The `signIn("devmock", { email, callbackUrl })` already forwards `email` to the credentials `authorize`; the UI (`SharingSetupWizard.tsx:282`, `SharingProviderButtons`) just needs to pass a chosen email. **Awaiting Grant's pick (A vs build B).**

## Coordination state (all loops closed)
Siblings: MobileUI (hub), Phylo, BeakerAI, Figure Composer, Billing, INJEST. All confirmed no collision with Phase C. Key notes: my work does NOT touch `providers.tsx` (BeakerAI's TourHost + Phylo's boot-gate fix `bf2192b61` are clear) or `file-system-context.tsx` (Billing's mobile-exclusion fix `167094d53` is on main; my branch predates it → rebase picks it up clean). INJEST's future library-@handle binding WILL touch `identity/*` — they committed to read the C3 design + ping this lane first. The C3 backend is branch-only so nothing of it is on origin.

## Other this-session work on main
- FolderSwitcher legible on the colored header in BOTH themes (`85fa1ba47` + `66972569a`) — was bare `text-foreground-muted` washing out on the tinted header; now a white pill + `text-gray-900` like the neighboring nav pills.
- Human-in-the-loop collaborative-testing convention added to AGENTS.md.

## To resume
1. Finish C2/C5 live verify (pick A or build B for C2's two accounts). Mark verified in the proposal + memory.
2. Grant works the C3 §10 runbook to take escrow live (deploy Worker + provision SEK + security pass + staged flag-on).
3. Optional: C6 UI + accept-wiring; C2 follow-up (fingerprint→keys directory read, cleaner than `searchResearchers`).
4. Kill the background relay on :8787 when done testing.
