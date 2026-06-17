# Require an account, keep data local-first

Decision by Dr. Grant Nickles, 2026-06-16. Status: decided, not yet built.

## The decision

ResearchOS will require an account (OAuth sign-in) to use the app. The no-account,
local-only mode is retired. Data does NOT move to the cloud. It stays local-first,
end-to-end encrypted, in the user's own folder, and the app keeps working offline
after the first sign-in.

This finishes a turn the product was already making (OAuth-first landing,
account-first auto-provision). It collapses the local-only-vs-account duality that
is the single largest source of accidental complexity and bugs in the codebase.

## The hard invariant (do not break this)

Sign in once, then fully local and offline. Requiring an account must never become
requiring connectivity or requiring the cloud. The data promise is unchanged. The
account is identity, not storage. If a rollout step would make the everyday app
need the network to open a folder or read notes, that step is wrong.

## What changes (scoped)

All entry changes go behind a new flag, `NEXT_PUBLIC_REQUIRE_ACCOUNT`, default off,
so the pivot ships dark and flips in one move once verified.

1. Close the two no-account escapes.
   - The "Local" tile in `components/onboarding/AccountTierChooser.tsx` (hidden when
     the flag is on). Local tier picks `onLocal()` which opens the OS folder picker
     with no identity.
   - The "Open a folder, no account" path off `WelcomeBackSignIn`
     (`lib/providers.tsx` around line 880).
   - With both closed, every entry goes through OAuth sign-in first, then folder.

2. Order becomes sign-in, then folder. The folder-connect surface
   (`FolderConnectGate`) moves AFTER OAuth rather than being reachable before it.

3. The token gift seeds eagerly. `STARTER_GRANT_TOKENS` (about 1.63M, sized at $0.25
   of measured cost, `lib/billing/ai-config.ts`) is already owner-keyed and minted on
   first call to `getOrGrantBalance` (`lib/billing/ai-ledger.ts`). Seed it at account
   provision so the balance is visible in Settings (AiUsageSection) and the BeakerBot
   chat header before the first AI turn, not lazily after it.

4. Onboarding simplifies. Identity always exists, so the greeting-by-name interweave
   and the role seed are always live. No "do you want an account" fork.

5. Marketing and terms copy. Replace "account optional / no account needed" with
   "free account, your data stays on your machine." This is Billing's and marketing's
   lane to write. Most of it is already flag-gated on the billing flags and switches
   automatically. The account-optional framing is separate and needs a human edit.

## Migration of existing local-only users

A local-only user (identity sidecar with no `email` or `claimedAt`) upgrades to an
account via `SharingSetupWizard`, which writes `email` plus `claimedAt` and leaves the
local data untouched. This path exists today and is one-way (upgrade only). When the
flag flips, any existing local-only user is guided into that same claim, not locked
out. No data is deleted, ever. A local folder stays valid, it just links to an identity.

## Rollout order

1. Land `NEXT_PUBLIC_REQUIRE_ACCOUNT` (default off) plus the gate changes in step 1
   and 2, flag-gated and inert.
2. Eager gift seeding (step 3), independent of the flag, ships first since it is a
   strict improvement either way.
3. Verify the offline invariant under the flag (sign in, go offline, open a folder,
   read and write, reconnect).
4. Verify the existing-local-only-user claim path under the flag.
5. Billing and marketing rewrite the account-optional copy.
6. Flip the flag.

## Open question to Billing

Confirmed separately: the sign-up gift survives billing-on and is the paid funnel's
on-ramp, not a "free during beta" claim. Eager seeding above assumes that.

## Decision note, reconciling with the P-local keypair model (2026-06-16, identity lane)

Surfaced during the require-account language audit. The older P-local identity
model (IDENTITY_OAUTH_ONLY.md, revised 2026-06-06) frames the account as a LOCAL
keypair minted fully offline with NO OAuth, and frames publishing a findable
profile as a SEPARATE OPTIONAL step. On its face that contradicts this pivot,
which requires OAuth to use the app.

The two reconcile cleanly once you separate the keypair from the sign-in.

1. The keypair is NOT removed. It is the end-to-end identity mechanism. It is
   what encrypts the data and proves who you are, and it is exactly why the data
   can stay local and E2E after sign-in. Removing it would break the hard
   invariant above (data stays local-first and encrypted). It is never escrowed
   by default, the private key stays on the device.

2. What changes under require-account is HOW the keypair is minted, not whether.
   The OAuth-first entry already mints it through the claim flow, signing in with
   a provider returns to `?sharingClaim=1`, the global `SharingClaimResume` mounts
   `SharingSetupWizard`, and the wizard generates the keypair, keeps the private
   key local, and publishes only the public keys to the directory. So under the
   flag the keypair is born as a PUBLISHED identity, not a bare offline one.

3. The standalone "create an offline keypair now, publishing is optional later"
   entry is the only genuine contradiction, and it is gated off under the flag.
   That entry lives in `ProfileSettingsContent`'s `caps.mode === "solo"` branch
   (it opens `CreateLocalIdentityStep`, which calls `createLocalIdentity` and
   writes a sidecar with no email and no claimedAt). New users never reach it,
   they sign in with OAuth at the front door and become `caps.mode === "account"`,
   so it self-gates today. The path still exists for a PRE-PIVOT local-only user.

Resolution, all behind `NEXT_PUBLIC_REQUIRE_ACCOUNT`:

- A new one-place seam, `isStandaloneLocalKeypairCreateVisible({ requireAccount,
  oauthPublishAvailable })` in `lib/account/require-account.ts`, mirrors
  `isLocalPathVisible`. It returns false (gate the standalone entry) only when the
  flag is on AND an OAuth claim path actually exists in the build.
- `ProfileSettingsContent`'s solo branch reads that seam. When the standalone
  entry is gated, a transitional pre-pivot solo user sees a "Finish setting up
  your account" card that routes into the OAuth claim/publish migration
  (`SharingSetupWizard`, the same path the migration section above names), which
  mints the keypair as a published identity. Their data is untouched, the private
  key still never leaves the device.
- No soft-lock. When OAuth publish is NOT available (dev with no AUTH_ env, or a
  deployment with sharing off), the standalone offline-keypair create stays, since
  it is then the only way to mint an identity at all. With the flag off, behavior
  is unchanged.

Deliberately out of scope. The `UserLoginScreen` force-create gate (shared or lab
folders) also mints a keypair via `CreateLocalIdentityStep`, but that is a REQUIRED
account on a shared folder, not the "optional publish later" framing, so it is not
the contradiction this note addresses. Under require-account a member reaching that
gate has usually already signed in at the front door (so `reuseAccountIdentityIfVerified`
reuses the published key); forcing OAuth a second time there belongs to the entry-flow
lane that owns `AccountTierChooser` / `WelcomeBackSignIn` / `providers.tsx`, not here.
