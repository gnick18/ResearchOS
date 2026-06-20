// Require-account entry flag (require-account-local-first pivot, 2026-06-16;
// made the default and enforced app-wide 2026-06-18).
//
// The model is one thing: your account IS your identity IS your sharing setup.
// You sign in once, at the first screen, and that mints the keypair and binds
// your verified email together. There is no separate "set up sharing" step
// afterward. Data still stays local-first and E2E after the sign-in (the account
// is identity, not storage, and the app keeps working offline once a folder is
// connected).
//
// DEFAULT ON. The no-account local-only entry paths are closed and an unclaimed
// account is gated into the claim flow before the app opens (RequireAccountGate
// in AppShell). An explicit NEXT_PUBLIC_REQUIRE_ACCOUNT of "0" or "false" is the
// only way to turn it off (a deliberate kill switch for a no-auth self-host).
//
// A defensive fallback in the entry surfaces AND in the app-wide gate keeps a
// local path open whenever no account tier / no OAuth is actually available (for
// example a build with OAuth turned off), so requiring an account can never
// hard-trap a visitor with no way forward. See the no-soft-locks rule.
//
// NEXT_PUBLIC so the client-side entry state machine can read it.
//
// No emojis, no em-dashes, no mid-sentence colons.

export function isRequireAccountEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT;
  // Default ON. Only an explicit disable value turns it off, so an unset or
  // blank env keeps the require-account model in force.
  return v !== "0" && v !== "false";
}

/**
 * Whether a no-account local path should still be offered in an entry surface.
 *
 * The require-account flag retires the local path, EXCEPT as a fallback when no
 * account tier is actually available in this build (hasAccountTier false), since
 * hiding the only remaining way forward would hard-trap the visitor. This single
 * helper encodes the no-soft-locks invariant for every entry surface (the tier
 * chooser's Local tile and the welcome-back screen's "Open a folder" escape), so
 * the rule lives and is tested in exactly one place.
 */
export function isLocalPathVisible(opts: {
  requireAccount: boolean;
  hasAccountTier: boolean;
}): boolean {
  return !opts.requireAccount || !opts.hasAccountTier;
}

/**
 * Whether the standalone "create a local keypair with no sign-in, publish a
 * findable profile later" account-creation entry should be offered.
 *
 * The keypair itself is NEVER retired. It is the end-to-end identity that
 * encrypts the data and proves who you are, and it is exactly why the data can
 * stay local and E2E. Under require-account what changes is HOW it is minted:
 * the keypair is created as part of the OAuth claim flow (SharingClaimResume ->
 * SharingSetupWizard), so it is a published identity from the start. The
 * standalone offline-keypair-first entry, framed as "no sign-in, publishing is
 * optional later", contradicts require-account, so it is gated off when the flag
 * is on and a claim path actually exists.
 *
 * The carve-out mirrors isLocalPathVisible: when OAuth publish is NOT available
 * in this build (dev with no AUTH_ env, or a deployment with sharing off), the
 * standalone local-keypair create is the only way to mint an identity at all, so
 * it stays available rather than soft-locking a transitional local-only user
 * with no way to set up their account. See the no-soft-locks rule.
 */
export function isStandaloneLocalKeypairCreateVisible(opts: {
  requireAccount: boolean;
  oauthPublishAvailable: boolean;
}): boolean {
  return !opts.requireAccount || !opts.oauthPublishAvailable;
}

/**
 * Whether a connected user must be held at the account-claim gate before the app
 * renders (RequireAccountGate in AppShell). The whole no-soft-lock invariant for
 * the app-wide gate lives here, in one tested place.
 *
 * Blocks ONLY when every condition holds:
 *   - require-account is on, AND
 *   - an OAuth claim path actually exists (so the gate is escapable by signing
 *     in; a no-auth build never blocks and stays local-only), AND
 *   - a user is connected, AND
 *   - this is not a demo / wiki-capture session (those preview the app), AND
 *   - the identity has fully resolved to "ready" (a "loading" or stalled read
 *     falls back to a non-ready status, so the gate never fires prematurely), AND
 *   - the account is NOT yet published (no verified-email binding in the sidecar),
 *     AND
 *   - the user is NOT signed in (no OAuth session). This is the key release
 *     signal: "logged in" is the requirement, NOT a successful directory publish.
 *     Publishing can fail (no directory backend in dev, a transient error in
 *     prod) and writes the sidecar email only on success, so gating on `published`
 *     alone would loop a signed-in user forever. Once a session exists the gate
 *     releases and the keypair publish completes or retries in the background.
 *     `hasCloudSession` is null while the check is in flight; we gate only on a
 *     definite `false` so an unresolved or hung session read never soft-locks.
 *
 * `identityStatus` mirrors useSharingIdentity's SharingIdentityStatus; it is a
 * plain string union here so this policy module stays dependency-light.
 *
 * AUTO-CLAIM PHASE 1 (2026-06-19, D1/D3/D7): the gate now also fires for an
 * ALREADY SIGNED-IN user who entered a fresh folder with no usable identity (the
 * "dead zone"). Under the multi-folder deferred-mint path a signed-in user enters
 * with NO keypair on purpose (status "none"), but every Share button is gated on
 * identity-ready, so Share is hidden AND the old gate (which required
 * `hasCloudSession === false`) never fired for them. They could neither share nor
 * reach setup except via a buried Settings card. So we add a second branch that
 * holds a signed-in user (`hasCloudSession === true`) at the gate when their
 * identity is not yet established (status "none"), letting the wizard mint the
 * keypair, show the recovery code, and publish using the existing session.
 *
 * NO-LOOP GUARD: the new signed-in branch fires ONLY on status "none", NEVER on
 * "ready". This is the crucial difference from the loop the signed-out branch
 * guards against. Publishing can lag a signed-in user (the directory write is
 * async and writes the sidecar email only on success), so gating a signed-in
 * "ready" user on `!published` would loop forever. Instead, the moment auto-claim
 * mints the keypair the status flips "none" -> "ready", this branch stops firing,
 * and the gate releases even before the publish lands (publish then completes or
 * retries in the background, same as the signed-out branch). "needs-restore" (the
 * key lives on another device) is left OUT of the signed-in branch on purpose:
 * that is the cross-device restore case (S3), out of Phase 1 scope, so its
 * behavior is unchanged here.
 */
export function shouldGateForClaim(opts: {
  requireAccount: boolean;
  oauthPublishAvailable: boolean;
  hasConnectedUser: boolean;
  isDemoOrCapture: boolean;
  identityStatus: "loading" | "none" | "needs-restore" | "ready";
  published: boolean;
  hasCloudSession: boolean | null;
}): boolean {
  // Shared preconditions for either branch. These encode the no-soft-lock
  // invariant: require-account on, a real OAuth claim path exists, a user is
  // connected, and this is not a demo / wiki-capture preview.
  const baseGate =
    opts.requireAccount &&
    opts.oauthPublishAvailable &&
    opts.hasConnectedUser &&
    !opts.isDemoOrCapture;
  if (!baseGate) return false;

  // Branch 1 (existing): a signed-OUT local-only account (ready keypair, no
  // email binding) is held until they sign in to claim. `hasCloudSession === false`
  // is a definite no-session read; null (in flight) never gates so a hung read
  // cannot soft-lock.
  const signedOutLocalOnly =
    opts.identityStatus === "ready" &&
    !opts.published &&
    opts.hasCloudSession === false;

  // Branch 2 (auto-claim, new): a signed-IN user with no usable identity yet
  // (the deferred-mint dead zone). Fires only on status "none", never "ready",
  // so it cannot loop on a lagging publish (see the NO-LOOP GUARD note above).
  const signedInNoIdentity =
    opts.hasCloudSession === true && opts.identityStatus === "none";

  return signedOutLocalOnly || signedInNoIdentity;
}

/**
 * Whether the autoClaim wizard can reuse the live OAuth session to claim the
 * account WITHOUT another sign-in (auto-claim Phase 1 edge-case fix, 2026-06-19).
 *
 * shouldGateForClaim opens the gate, and the wizard in autoClaim mode, whenever a
 * cloud session EXISTS. But auto-claim can only jump straight to keygen when that
 * session actually carries a verifiable email to bind. A session with no usable
 * email (the dev mock sign-in, or a lapsed / partial session that resolves with
 * no email) cannot be auto-claimed. This is the single agreement point between the
 * two reads that used to disagree: the gate fires on "a session exists", this
 * fires on "the session has an email to bind". When they disagree the wizard hands
 * back to the gate, which drops the "using your existing sign-in" presentation and
 * shows the manual sign-in card (matching copy, no loop) instead of bouncing the
 * user back into the provider chooser. The "Use a different folder" escape stays
 * on every state, so this can never soft-lock.
 *
 * Returns true ONLY for a non-empty (after trimming) session email.
 */
export function canAutoClaimWithSession(opts: {
  sessionEmail: string | null | undefined;
}): boolean {
  return (
    typeof opts.sessionEmail === "string" && opts.sessionEmail.trim().length > 0
  );
}
