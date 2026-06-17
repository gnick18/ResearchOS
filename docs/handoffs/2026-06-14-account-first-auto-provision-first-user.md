# Account-first: auto-provision the first workspace user from the account profile

**Date:** 2026-06-14
**Status:** BUILT on local `main` (unpushed). tsc clean, unit tests pass. Browser E2E pending (Grant — needs OS folder picker + OAuth).

## Problem (found during the 2026-06-14 lab-tier smoke)

A fresh ACCOUNT-FIRST user who signs in, claims a handle, and connects a
brand-new empty folder lands on `UserLoginScreen` showing **"No users yet.
Create one to continue"** + a "Create New User" button. Redundant friction: the
cloud account already has everything the first workspace user needs — the OAuth
email (e.g. `pi@wisc.edu`), the claimed `@handle`, and the display name entered
during onboarding (e.g. "Fake PI").

## Change

When an account-first, signed-in visitor lands on a connected folder that has
**zero** local users, `UserLoginScreen` now **auto-provisions** the first
workspace user from the account profile instead of showing the empty
create-a-user screen:

1. Fetch `/api/account/profile` (display name + `@handle`); the email comes from
   the already-fetched `/api/auth/session`.
2. Derive a path-safe, human-readable workspace username
   (`deriveWorkspaceUsername`): **display name > session name > @handle > email
   local-part**. Spaces and capitalization are preserved so greetings read
   naturally ("Welcome back, Fake PI"), not the email local-part ("gnick").
3. Create the user record (`usersApi.create`), assign a stable palette color,
   and **mint the E2E identity keypair silently** via `createLocalIdentity`
   (writes the `_sharing_identity.json` sidecar AND parks the unlocked key in the
   session). This is the SAME provisioning the manual create-user gate performs
   and exactly what `LabCreateResume` -> `getSessionIdentity()` relies on, so a
   PI who lands here can immediately create a lab.
4. `performLogin` -> land directly in the app. A brief "Setting up your
   workspace" spinner shows while it runs.

The recovery code is NOT surfaced here (this is the silent path); the user can
save/rotate it later from Settings -> Sharing, where the unconfirmed-recovery
state is already surfaced. Consistent with `DEVICE_KEY_V2` being OFF (the
device-local keypair is the canonical identity for this folder).

### Guards (only fires on the intended case)

Auto-provision runs **exactly once** and ONLY when:
- account-first enabled (`isAccountFirstEnabled()`, default-on)
- a cloud session is authenticated (`sessionStatus === "authenticated"`)
- the folder has **0** local users (the fresh-folder case)
- not demo/wiki fixtures, not a switch-user (`contextCurrentUser` null), and the
  user-list read did not error (a failed read must not look like an empty folder)

Every other case falls through to the normal picker untouched:
- **Offline / not signed in** ("works offline" case): session is unauthenticated
  -> manual screen, unchanged.
- **A folder that already has users** (returning / multi-user): skipped.

## Files

- `frontend/src/lib/account/workspace-username.ts` (new) — pure
  `deriveWorkspaceUsername` helper.
- `frontend/src/lib/account/workspace-username.test.ts` (new) — 10 unit tests,
  all passing.
- `frontend/src/components/UserLoginScreen.tsx` — imports + auto-provision state,
  `autoProvisionFromAccount()`, a run-once effect, and a "Setting up your
  workspace" render branch.

## Verification status

- `npx tsc --noEmit` — clean.
- `npx vitest run src/lib/account/workspace-username.test.ts` — 10/10 pass.
- eslint — adds one `react-hooks/set-state-in-effect` line of the SAME idiomatic
  kind this file already ships (7 pre-existing on `main`); no new class of issue.
- **Browser E2E (PENDING, Grant):** the path is reachable only through the OS
  folder picker + OAuth dev-mock sign-in, which synthetic preview/Playwright
  tooling cannot drive. Chrome script below.

## Chrome verification script (AUTH_DEV_MOCK=1)

Dev server is on `:3000` with `AUTH_DEV_MOCK=1` already in `.env.local`.

1. Open `http://localhost:3000` in a clean profile (or sign out first).
2. Sign in via the dev-mock provider (lands you as `pi@researchos.test` or your
   configured `AUTH_DEV_MOCK_EMAIL`).
3. On the `/account` home, claim a handle AND enter a full **display name** (e.g.
   "Fake PI"). Save.
4. Connect a **brand-new, EMPTY** folder (OS picker -> a fresh directory).
   Initialize it if prompted.
5. EXPECT: a brief "Setting up your workspace" spinner, then you land **directly
   in the app** — NO "No users yet / Create New User" screen.
6. EXPECT: the home greeting reads **"Welcome back, Fake PI"** (the full display
   name, not "gnick"/email local-part).
7. Open Settings -> Sharing: an identity/keypair exists for this user (recovery
   code unconfirmed is fine — it's the silent path).
8. (PI path) Creating a lab from here should work without a "set up your
   workspace first" detour, since the keypair was already minted.

Regression checks:
- Reconnect a folder that ALREADY has a user -> normal picker / quick-confirm
  shows (no auto-provision).
- Open a folder WITHOUT signing in (offline/no account) -> normal create-a-user
  screen still shows.
