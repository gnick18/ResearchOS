# Phase 1 scope: decouple the account from the folder

Status: scoping plan for review (no code yet). 2026-06-13.
Parent: `docs/proposals/2026-06-13-cloud-accounts-local-data.md` (all 4 design decisions locked).

**Phase 1 goal.** Separate three things the app currently fuses into one gate: (a) using the app locally, (b) connecting a data folder, (c) having an identity. After Phase 1: a person can sign in to a cloud account (OAuth + @handle) with **no folder**, land on a real folderless home, and attach a data folder later as an optional step. Solo local-only use (no account at all) is fully preserved.

**Explicitly OUT of scope for Phase 1** (later phases): provisioning the local E2E data keypair against the cloud account, the user-held recovery-factor / cross-device data restore (Phase 2), the social graph + avatars + find-and-send (Phase 3), and the lab/sharing deferred-sealing reconciliation (Phase 4). Phase 1's "account" is the cloud identity (OAuth session + directory profile + @handle), with **no keypair required** until the user does E2E data or sharing.

---

## Current state (grounding)

- The whole app is hard-gated in `AppContent` (`src/lib/providers.tsx`): if there is no File System Access support it shows the unsupported page (`providers.tsx:612`), and otherwise it funnels through the start-screen / `FolderConnectGate` / `UserLoginScreen` before any app content. Routes that already BYPASS this gate and run folderless off the session: operator (`/admin`, `/business`), public marketing (`/pricing` etc.), wiki, and now the org portals (`/department`, `/institution`). That bypass pattern is the template.
- OAuth-first scaffolding already exists but fuses OAuth to the folder: `isOAuthFirstLoginEnabled()`, `OAuthFirstLanding`, `WelcomeBackSignIn`, `useSignInProvider` + the `?signIn=` intent, `ProviderSignInRedirect`, and the `sharingClaim` return that frames the folder gate as "Save your account on your disk." Today, after OAuth you still must pick a folder.
- The cloud directory already stores profiles (keyed by fingerprint), public keys, recovery blob, ORCID, trigram search, and a public `/researchers/<fingerprint>` page. Profile bind currently requires a client Ed25519 signature (so it needs a keypair today).

## The chunks

### Chunk A. Folderless account home (`/account`)
A new route that a signed-in NextAuth user reaches with no folder, bypassing the FSA/folder gate exactly like the org portals do. Built on the same `PortalShell` aesthetic. Contents:
- Profile card (@handle, name, affiliation, avatar placeholder), edit link.
- Account-level settings that need no folder (account/identity, billing + usage, notification routing, org-portal links).
- A received-shares inbox stub (metadata only; opening/decrypting needs a key, deferred to Phase 2, shown as "connect your data to open").
- A prominent **"Connect your data folder"** CTA that launches the existing folder-connect flow.
- Works in ANY browser (no FSA needed) since it touches no folder. A nice side effect: accounts become usable on Safari/Firefox/phones even though the data tool stays Chrome/Edge.
Files: new `src/app/account/page.tsx` + `src/components/account/AccountHome.tsx`; add `/account` to the gate-bypass set in `providers.tsx`.

### Chunk B. @handle + cloud profile off the OAuth session (no keypair)
Decouple the social identity from the data keys so an account can exist before any keypair:
- Add a globally-unique `@handle` to the directory (new column on `directory_profiles` or a `directory_handles` table, with a uniqueness constraint), auto-suggested from name/email, user-editable, claim + availability check.
- Add a server-side bind path that creates/updates the cloud profile + @handle **authenticated by the OAuth session alone** (server trusts the verified email), NOT requiring a client Ed25519 signature. The existing keypair-signed bind stays for when a keypair exists; this adds an OAuth-only path for the folderless account.
- Add the `/@handle` public profile route (alias/resolve to the existing fingerprint profile, or a thin lookup).
Files: `src/lib/sharing/directory/db.ts` (schema + handle uniqueness), new `src/app/api/account/profile/route.ts` (OAuth-session bind), `src/lib/sharing/profile.ts` (client helpers), new `src/app/@[handle]` or `src/app/u/[handle]` route, claim UI in `AccountHome`.

### Chunk C. Entry-flow restructure (the front door)
Rework `AppContent` so the front door offers two clearly separated doors and routes a signed-in-no-folder user to `/account` instead of the folder wall:
- A signed-in NextAuth session with no folder resolves to `/account` (folderless), not `FolderConnectGate`.
- The start screen reframes as: **"Sign in / create an account"** (cloud, optional, leads to `/account`) vs **"Open a folder"** (local, optional, no account needed). The existing `OAuthFirstLanding` / start-screen copy is reworked; the OAuth return no longer forces a folder pick.
- Folder-connect becomes reachable from `/account` (post-login attach) and still the entry for the no-account local path.
- Gated behind a flag (e.g. `NEXT_PUBLIC_ACCOUNT_FIRST`, or extend `OAUTH_FIRST_LOGIN`) so it ships dark and is dogfooded before the default flips. Target = default-on for the account flow per the locked decision; the no-account local path is untouched.
Files: `src/lib/providers.tsx` (the `AppContent` gate ordering + the new signed-in-no-folder branch), the start-screen / `EntrySnapSurface` copy, `OAuthFirstLanding`, `WelcomeBackSignIn`.
RISK: this is the highest-blast-radius chunk (it edits the shared entry that Grant runs on :3000 daily). Build it last, behind the flag, default-off until verified.

### Chunk D. Folderless feature gating + graceful "needs a folder" states
- Inventory which surfaces work folderless (account, billing/usage, org portals, profile, directory, account settings) vs which need a folder (workbench, methods, data hub, calendar, sequences, etc.).
- Folder-requiring nav entries / links from the account home show a clean "Connect a data folder to use this" prompt instead of a broken/empty state.
- Ensure the app shell + settings degrade gracefully when `currentUser`/folder is absent but a session exists.
Files: a small `useHasFolder()` / capability helper, light guards on the folder-requiring surfaces, the account-home links.

## Sequencing
1. **Chunk A** (account home) and **Chunk B** (@handle + OAuth-session profile) first: both are additive, low-risk, and give the signed-in-no-folder user somewhere real to land. No change to the existing gate yet.
2. **Chunk D** (graceful folderless gating) alongside A.
3. **Chunk C** (entry-flow restructure) last, behind the flag, since it touches the shared daily-driver entry. Flip the default only after dogfooding.

Each chunk lands on local main behind the flag as it completes, so the current folder-first flow keeps working untouched throughout.

## Open questions before building
1. Account-home route name: `/account` vs `/home` vs reuse the existing `/` router. (Lean `/account`.)
2. @handle URL shape: `/@handle` (needs route-group handling) vs `/u/handle`. (Lean `/u/handle` for routing simplicity, render it as `@handle`.)
3. Flag: new `NEXT_PUBLIC_ACCOUNT_FIRST` vs extend the existing `NEXT_PUBLIC_OAUTH_FIRST_LOGIN`. (Lean new flag so the two concerns stay separable.)
