# Handoff — Wiki overhaul (DONE) + dev-mock sign-in bug (IN PROGRESS)

**Date:** 2026-06-15
**Session:** took over the throttled "Phylo" lane, then ran a full wiki content+screenshot overhaul, then started a dev-mock-sign-in regression.
**Posture:** everything LOCAL main, **NOT pushed** (shared-main hold). Dev server may still be running on :3000.

---

## PART A — Phylo Phase 4 close (DONE, start of session)
Smart Data Binding joint check CLOSED on Grant's :3000 (MIC->Bars re-run passed). Bridge `projectIds` shipped (`e81e1f882`, both lanes). BeakerAI's Fireworks enum-of-objects 400 fix (`a3682f3fd`) + the bridge are **both on origin/main now** — prod BeakerBot recovered. See `[[reference_ai_enum_objects_400]]`, `docs/handoffs/2026-06-14-phylo-phase4-smart-data-binding.md`.

## PART B — Full wiki overhaul (DONE + committed, local main)
A 10-agent audit of all 91 wiki pages, then a 10-agent fix pass, then a full screenshot regeneration. Audit report: **`docs/wiki-audit-2026-06-15.md`** (Parts 1 accuracy / 2 content gaps / 3 screenshot manifest / 4 nav).

**Content (commit `a8e738404`, tsc-clean):** all 91 pages fixed + a NEW `frontend/src/app/wiki/features/beakerbot/page.tsx`. Headline fixes: settings (SettingsShell rail, not the retired scroll-stack), the lab-management pages (PI password/edit-session, "Lab Inbox"/"PI Actions" popups, lab-overview sections were all documenting REMOVED UI), purchases "LabPurchases Tool" (didn't exist), demo "Read the docs" pill (didn't exist), security PBKDF2->Argon2id + `/api/ai/chat`, projects (popup not route), one-on-ones ("Check-ins" always), getting-started/onboarding staleness, stats nonparametric tests + iterative-Grubbs, etc. nav.ts: +`/lab-inbox` & `/people` in APP_ROUTE_TO_WIKI, BeakerBot nav entry, fixed welcome-wizard + lab-overview blurbs.

**Tooling:** new `scripts/wiki-screenshots.mjs` (check/--fill placeholders/--prune/manifest); FIXED a latent bug in `scripts/build-wiki-content.mjs` (import-strip regex matched indented prose like "imported from PubChem" and truncated the mobile bundle — chem went 22->49 blocks); extended `scripts/capture-wiki-screenshots.mjs` (the **`?fixtureUser=mira`** recipe signs in as the fixture's lab_head for PI shots; a reproducible `phylo-studio-msa` entry that synthesizes a tip-matched FASTA via `buildPhyloMsaFasta()` and uploads it); new `scripts/capture-beakerbot-live.mjs` (one-off live-AI capture, `node ../scripts/capture-beakerbot-live.mjs both`).

**Screenshots: 154/155 real, current-chrome, 0 broken refs.** Commits: `5284f2fc9` (106 refreshed) / `7227c017f` (29 new incl 7 phylo) / `babd96ae4` (fixture seed) / `1814729a4` (11 PI/lab via fixtureUser=mira) / `05fe013e5` (phylo MSA + live BeakerBot crud-confirm + plan-card, + banked 5 mobile companion 1080x2400 from the emulator task) / `f6cd7ca0c` (companion-scan = a visible "GET PHOTO" reminder placeholder). The ONLY non-real shot is `companion-scan.png` (native phone scanner) — needs a real device, tracked on chip `task_1b3da8ae` (mobile emulator task; 5/6 captured). The capture harness has a known PRE-EXISTING intermittent gantt->phylo fixture race (empty "0 trees" state when shots run back-to-back) — not introduced this session; capture phylo shots alone if it bites.

**Side fix (separate worktree, chip `task_c44dddd3`):** `/trash` hid deleted molecules + storage nodes (SECTION_ORDER + ALL_ENTITY_TYPES missing them); fixed with a test. Grant ran the chip; lives in its own worktree.

## PART C — dev-mock sign-in BUG (IN PROGRESS, unresolved — START HERE)
**Symptom (Grant):** clicking the **dev mock sign-in** does nothing "anymore" — it closes and refreshes the page, no sign-in. A regression (worked before).

**Investigation so far:**
- Env is FINE: `.env.local` has `AUTH_DEV_MOCK=1`, `NEXT_PUBLIC_AUTH_DEV_MOCK=1`, `AUTH_DEV_MOCK_EMAIL=pi@re...`, `AUTH_SECRET` set. The `devmock` provider IS registered (`src/lib/sharing/auth.ts:62,159`).
- The click handler is `startOAuthFirstSignIn("devmock", ...)` in `src/lib/sharing/oauth-first-signin.ts:83` → calls next-auth `signIn("devmock", { callbackUrl: "/?sharingClaim=1" })`. So it redirects, returns to `/?sharingClaim=1`, and the boot gate + `SharingClaimResume` are supposed to complete the claim (mint keypair, create account).
- The dev mock button is NOT on the landing page — reach it by clicking **"Sign in"** (hero button) which opens the provider surface (likely `WelcomeBackSignIn` / `SharingProviderButtons`). My repro could not auto-find the button after one "Sign in" click — it may open a modal that "closes" on the failed sign-in (matches Grant's wording).
- **PRIME SUSPECTS** (recent local-main commits that land on the `/?sharingClaim=1` return path): `921f56256` feat(folders): multi-folder Phase A + folder switcher; `906308c63` feat(identity): Phase B reuse-keypair sidecar; `bfc3fcd35` feat(onboarding): P2 post-OAuth callback rewire (boot gate new branch in `providers.tsx`). One of these likely bounces/refreshes on return without establishing the session.

**Repro harness:** `/tmp/repro-signin.mjs` — Playwright script that goes to `/`, clicks the hero "Sign in", dumps visible buttons, clicks dev mock, and traces auth network + NAV + final URL + whether a session cookie / `/api/auth/session` got set. It was mid-iteration when throttling + the safety-classifier outage interrupted the last Write. NEXT STEP: finish that repro (the dev mock button is behind "Sign in" → likely a modal; dump the modal's buttons to get the exact label), run it, and read the trace — the key signals are (a) does `/api/auth/callback/devmock` return 200 and set a session cookie, and (b) where does the boot gate redirect on return to `/?sharingClaim=1`. Then bisect the 3 suspect commits (or read `providers.tsx` boot gate + `SharingClaimResume` for a guard that now fails when no folder/keypair exists).

## Environment / cleanup
- **Dev server may still be running on :3000** (`npm run dev`, pid was 35317). Kill with `lsof -ti:3000 | xargs kill -9` if not needed.
- **Shared working tree has OTHER LANES' uncommitted changes** — do NOT sweep them into a commit: `src/app/library/`, `src/components/library/`, `scripts/reimburse-amex-2026-06.mjs`, and the trash-fix files (`trash/*`, `trash-sections.ts`). Stage explicit paths only.
- All my work is committed; nothing pushed. Before any `git push origin main`, run `git log origin/main..main` (other lanes may be holding commits).
