# Handoff — Popup Unifier lane → Account/Folder/Identity Redesign (2026-06-15)

This session started as the **Popup Unifier** lane (handoff takeover after a throttled subscription) and grew into a large **account / folder / identity redesign**. Everything below is **committed on local `main`** (the shared multi-lane checkout). The redesign work is **dark behind `NEXT_PUBLIC_MULTI_FOLDER` (default OFF)** — prod behavior is unchanged until that flag is flipped.

Grant has `NEXT_PUBLIC_MULTI_FOLDER=1` set in his local `.env.local` for testing.

---

## 1. Popup Unifier lane (done, on main)

- **ProjectDetailPopup → CalmPopupShell** migration (`318dec9d8`) — the throttled session's worktree output was lost, so it was re-done. Lives at `frontend/src/components/project-surface/ProjectDetailPopup.tsx` (NOT `components/`). tsc 0 + its 2 tests pass.
- **Focus shortcut hint** (`dd55600dd`) — `focusShortcut` prop on `CalmPopupShell`, wired by `NoteDetailPopup` + the experiment `TaskDetailPopup` shell only (checklist shell omits it).
- **Reusable depth vocabulary** in `globals.css` (REUSE these, don't hand-roll shadows): `.ros-kbd` (keycap chips), `.ros-helper-rail` + `-topglow`/`-botglow` (editor Shortcuts rail as a boxed panel; `42ac238ac`/`4b63bef13`), `.ros-topbar-shadow` (`67f329906`), `.ros-page-shadow` (focus-mode writing column as a page, gated on `InlineMarkdownEditor`'s new `expanded` prop; `c4dfa244b`).
- **Verify status:** Grant ran a Chrome verify early (keycaps + Focus tooltips + ProjectDetailPopup all PASS; two non-regression flags resolved). The four later depth tweaks (rail glows, top-bar shadow, page shadow) are **awaiting his consolidated visual sign-off** — flip into a note popup + focus mode to check.

## 2. Login cleanup (done, on main — `25b6fd6ed`)

`UserLoginScreen.tsx`: (a) added a **"Use a different folder"** escape (calls `disconnect()`, non-destructive) fixing a soft-lock; (b) **removed the "Create New User" path once a folder already has a user** (the product no longer supports multiple users in one folder — each person uses their own cloud-synced folder + invites). Empty folder still shows the prominent first-user CTA. Removed the now-dead 1→2 "shared folder" warning. This aligns with the redesign direction.

## 3. Account / Folder / Identity Redesign (the big one)

**Full design + locked decisions + per-phase status:** `docs/proposals/2026-06-15-account-folder-identity-redesign.md`. **Memory:** `[[project_account_folder_identity_redesign]]`. **AGENTS.md** §5 has a summary section.

**Root problem:** identity was owned by a folder (each folder minted its own keypair; directory holds one-email-one-keypair, so a 2nd folder overwrote the 1st). **Key reframe:** notebook data is **plaintext on disk** (at-rest encryption is behind `DEVICE_KEY_V2`, OFF) → a lockout loses your IDENTITY, not your research. (Flips to real data-loss the day `DEVICE_KEY_V2` ships, so recovery must land first.)

**Target:** the cloud account IS the identity; folders are workspaces it opens; recovery protects the one identity.

**Decisions LOCKED 2026-06-15 (Grant):**
1. Identity = **reuse-don't-mint** (one keypair per account, re-wrapped into each folder; sidecar becomes a reference).
2. Recovery = **hybrid (Apple iCloud model)**: server-assisted recoverable-via-OAuth = DEFAULT, opt-in strict E2E ("Advanced Protection") = the escape hatch. Plaintext-data floor + reset-keep-data + PI re-admit underneath both. PI is NEVER needed to recover a member's own data, only to rejoin lab SHARING.
3. Migration = **clean reset** for the <10 beta users.
4. Phase-B reuse verification = **directory fingerprint match** (`fetchMyProfile()` vs the device key's fingerprint).

**Phase status (all dark, tsc 0, identity suite green throughout):**
- **Phase A — folder switcher ✅** (`921f56256`). Multi-folder IndexedDB store (additive; lazy idempotent legacy migration that never deletes the old `DIRECTORY_HANDLE_KEY`) + `listFolders`/`switchFolder`/`forgetFolder` in `file-system-context.tsx` + header `FolderSwitcher.tsx` + connect-screen panel. New file `multi-folder-config.ts` (the flag). Flag-OFF byte-identical. Open follow-ups (minor, pre-flag-on): switcher "Active" badge matches by folder NAME not id (cosmetic; thread the active id through); `disconnect()` currently forgets the active folder only (a deliberate choice — confirm with Grant).
- **Phase B — identity reuse ✅** (`906308c63` primitive, `98eb5eec7` autoProvision branch, `81297a715` follow-ons). `writeIdentityReferenceSidecar` (public-only reference sidecar, NO recoveryBlob) + `reuseAccountIdentityIfVerified` helper used in `autoProvisionFromAccount` + both manual create paths + a reference-sidecar login branch in `handleLogin`. Guard = directory fingerprint match; every uncertain case falls back to old mint/force-profile. Cross-device "new laptop" case safely STOPS rather than minting a divergent key (full restore is Phase C, marked `// Phase C:` in `autoProvisionFromAccount`).
- **Phase C — recovery STARTED** (`988b1192c`). `resetIdentityKeepData(username)` primitive (drops stale identity, re-mints, keeps plaintext data). 2 unit tests.

## 4. Phase C plan (proposal §6c) — where to resume

- **C1** reset-keep-data — primitive ✅; **NEXT = the unlock-gate UI affordance** ("can't sign in? reset and keep your data", with a clear warning: data stays, old signatures + previously-shared-to-you data are lost, shared lab needs PI re-admit). Client-side, self-contained.
- **C2** PI re-admit (a reset member's new key rejoins the roster) — `components/lab-head/LabRoster.tsx` + `lib/lab/*`. No escrow.
- **C3** ⚠️ **hybrid server escrow + OAuth-gated reissue — the heavy new backend surface. GATED on a crypto-design sign-off + security review (co-design with the identity lane). DO NOT build C3 before that.**
- **C4** strict-tier toggle, **C5** cross-device restore (closes the Phase B gap), **C6** PI pre-provisioning.

## 5. Invariants for anyone continuing the redesign

- Keep everything behind `NEXT_PUBLIC_MULTI_FOLDER` until the whole arc + recovery is verified; **flag-OFF must stay byte-identical**.
- **Never reuse a keypair without the directory-fingerprint verification** (a previous user's vault key on a shared machine must never be sealed into a new person's folder).
- The per-folder sidecar's `recoveryBlob` is **optional** (a reference sidecar omits it; `handleLogin` and recovery code must tolerate its absence).
- Build in worktrees + merge when green (the shared `main` has 5 other lanes committing concurrently). The identity files (`UserLoginScreen.tsx`, `lib/sharing/identity/*`, `lib/file-system/*`) are load-bearing — review diffs before merge.

## 6. Cross-lane coordination state (this session's cohort)

Sibling lanes (via CDD DMs): **Billing** (onboarding-wizard go-live — P1+P2+P3 merged behind `NEXT_PUBLIC_ONBOARDING_WIZARD`, idle, awaiting Grant's P2 browser-verify), **Figure Composer** (ZoomPanCanvas unification merged; switched to worktree isolation after a transient shared-tree parse error), **Mobile UI** / **BeakerAI** / **Phylo**. CDD coordination learning: the TaskList is **session-local** (not shared) — DMs are the source of truth for lane claims. The cloud-accounts/identity lane (owner of the C3 escrow review) had no active sibling this session; flag it to whoever owns identity before opening C3.

## 7. Quick resume

Read `docs/proposals/2026-06-15-account-folder-identity-redesign.md` (§6a/6b/6c are the live build plans). To continue recovery: build the C1 unlock-gate UI (uses the committed `resetIdentityKeepData`), then C2. Hold C3 for the security review. To verify A+B: set `NEXT_PUBLIC_MULTI_FOLDER=1`, connect two folders, confirm the switcher + that opening a 2nd folder as a published account reuses the same identity.
