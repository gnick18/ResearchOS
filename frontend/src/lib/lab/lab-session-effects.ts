// Lab tier Phase 5: real effect implementations for the lab session controller.
//
// createLabSessionEffects wires the four LabSessionEffects slots against the
// actual app systems: NextAuth OAuth for authenticate, the existing identity
// session holder for unlockKeypair, and the DO relay + lab-key crypto for
// openLabKey. The controller itself stays pure (lab-session.ts); this module
// is the "last mile" that plugs production I/O in.
//
// AUTHENTICATE flow (two paths):
//   1. If a session already exists (getSession() returns a user email) the
//      function returns immediately with no signIn call, no redirect, and no
//      side-effect. This is the common case after a page reload or when the
//      OAuth session is still alive.
//   2. For a "devmock" provider (the Credentials provider in lib/sharing/auth.ts,
//      used in development) signIn is called with { redirect: false } so no page
//      navigation happens. The session is re-read right afterwards and the email
//      is returned.
//   3. For real OAuth providers (Google, ORCID, ...) signIn redirects the page
//      away to the provider. This function does not return (no await after the
//      call) in the redirect case. After the callback the user lands back at
//      callbackUrl = window.location.href, and the login gate resumes by reading
//      getSession() on mount (see SharingClaimResume.tsx for the same pattern).
//      The throw below the signIn call is defensive and is only reached if the
//      provider somehow resolves without a redirect.
//
// UNLOCK KEYPAIR:
//   The app already unlocks the keypair on every boot via the passkey-PRF path
//   (IdentitySessionRestorer) or the recovery-code flow (UserLoginScreen). Both
//   park the result in lib/sharing/identity/session-key.ts. This module does NOT
//   re-implement passkey or recovery; it simply asserts the session is already
//   unlocked. If it is not, the caller must surface the unlock UI first.
//
// OPEN LAB KEY:
//   Reads the unlocked X25519 private key from the session, fetches the lab
//   record + all generation envelopes from the DO relay, picks the highest-
//   generation envelope (the current key), and opens this member's sealed copy.
//   Returns the complete live-session payload that the controller stores in the
//   "live" state.
//
// FLAG: callers must check LAB_TIER_ENABLED from "./config" before constructing
// effects or calling any controller method. The factory itself is flag-free so
// the module stays unit-testable without needing to flip the flag.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { getSession, signIn } from "next-auth/react";
import {
  isSessionUnlocked,
  getSessionIdentity,
} from "@/lib/sharing/identity/session-key";
import { restoreSessionFromStore } from "@/lib/sharing/identity/storage";
import { getLabRemote, resyncLabRemote } from "./lab-do-client";
import { openLabKeyCopy } from "./lab-key";
import { verifyMemberEmailBinding } from "./lab-binding";
import { autoBindLabProfile } from "./lab-profile-auto-bind";
import type {
  LabSessionEffects,
  LabSigningKeyPair,
  LabSessionMember,
} from "./lab-session";

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Builds a LabSessionEffects object backed by the real app systems.
 *
 * @param params.labId   The stable lab id passed to getLabRemote and threaded
 *                       through the returned live-session payload.
 * @param params.username The current user's username, used to pick the right
 *                       sealed copy from the envelope and populate the member
 *                       record.
 * @param params.provider The default OAuth provider string. You can also pass
 *                       the provider at signIn time via the controller's
 *                       signIn(provider) argument; that value is forwarded here
 *                       as the authenticate() argument.
 * @param params.graceMs Optional grace window override (milliseconds). Passed
 *                       through to the controller verbatim; undefined lets the
 *                       controller use DEFAULT_GRACE_MS (15 min).
 */
export function createLabSessionEffects(params: {
  labId: string;
  username: string;
  provider?: string;
  graceMs?: number;
}): LabSessionEffects {
  const { labId, username } = params;

  return {
    // Wall-clock timestamp. Inject a fake in tests.
    now: () => Date.now(),

    // Grace window pass-through. undefined means use the controller default.
    graceMs: params.graceMs,

    // -----------------------------------------------------------------
    // authenticate(provider)
    //
    // Three-branch logic described in the module header above.
    // -----------------------------------------------------------------
    // -----------------------------------------------------------------
    // peekSession()
    //
    // Silent resume probe used by controller.resume() on boot. Reads the
    // existing NextAuth session (a persisted cookie survives refresh) WITHOUT
    // ever calling signIn or redirecting. Returns the email if a session is
    // live, or null so the gate falls back to showing the sign-in buttons.
    // -----------------------------------------------------------------
    async peekSession(): Promise<{ email: string } | null> {
      // A silent boot probe must never throw. getSession hits /api/auth/session,
      // which can 500 when the auth backend is misconfigured or unreachable (no
      // OAuth creds in dev, a transient network error). Treat any failure as "no
      // session" so the lab gate falls back to the sign-in buttons instead of
      // crashing the whole app on boot.
      try {
        const existing = await getSession();
        return existing?.user?.email ? { email: existing.user.email } : null;
      } catch {
        return null;
      }
    },

    async authenticate(provider: string): Promise<{ email: string }> {
      // Branch 1: already signed in, no-op.
      const existing = await getSession();
      if (existing?.user?.email) {
        return { email: existing.user.email };
      }

      // Branch 2: credentials-style provider (devmock and any future
      // Credentials providers). signIn({ redirect: false }) does NOT redirect;
      // it resolves with a result object we can ignore here (the session is
      // what matters, not the result).
      if (provider === "devmock") {
        await signIn("devmock", { redirect: false });
        const s2 = await getSession();
        if (s2?.user?.email) {
          return { email: s2.user.email };
        }
        throw new Error(
          "lab session: dev-mock sign-in did not establish a session",
        );
      }

      // Branch 3: real OAuth provider. signIn redirects the page to the
      // provider. The function does not return after this call under a real
      // redirect. The page resumes at callbackUrl after the OAuth round-trip,
      // and the login gate re-reads getSession() on mount (same pattern as
      // SharingClaimResume.tsx). The throw below is defensive and is only
      // reached if somehow the redirect does not happen.
      await signIn(provider, { callbackUrl: window.location.href });
      throw new Error("lab session: OAuth redirect did not complete");
    },

    // -----------------------------------------------------------------
    // unlockKeypair()
    //
    // The app already unlocks the identity on boot. This effect simply checks
    // that the session is unlocked and throws if it is not, directing the
    // caller to surface the existing login UI (IdentitySessionRestorer or
    // UserLoginScreen) rather than re-implementing the passkey/recovery flow.
    // -----------------------------------------------------------------
    async unlockKeypair(): Promise<void> {
      if (isSessionUnlocked()) return;
      // The keypair persists in IndexedDB and auto-restores on boot, but that
      // restore is async (IdentitySessionRestorer). On a refresh the gate can
      // reach here before it finishes, so drive the restore ourselves rather
      // than failing the race. restoreSessionFromStore is idempotent and reads
      // the same persisted record. Only after that do we treat a still-locked
      // identity as a real "needs the login UI" failure.
      await restoreSessionFromStore();
      if (isSessionUnlocked()) return;
      throw new Error(
        "lab session: identity is locked; unlock via the existing login " +
          "(IdentitySessionRestorer/UserLoginScreen) first",
      );
    },

    // -----------------------------------------------------------------
    // openLabKey()
    //
    // Steps:
    //   1. Get the unlocked X25519 private key from the in-memory session.
    //   2. Fetch the lab record + all generation envelopes from the DO relay.
    //   3. Pick the highest-generation envelope (the current key generation).
    //   4. Open this member's sealed copy with their X25519 private key.
    //   5. Return { labId, labKey, signingKeyPair, member }.
    // -----------------------------------------------------------------
    async openLabKey(): Promise<{
      labId: string;
      labKey: Uint8Array;
      signingKeyPair: LabSigningKeyPair;
      member: LabSessionMember;
    }> {
      // Step 1: identity must be unlocked.
      const id = getSessionIdentity();
      if (!id) {
        throw new Error("lab session: identity not unlocked");
      }
      const x25519Priv = id.keys.encryption.privateKey;

      // Step 2: fetch the lab record from the relay.
      const result = await getLabRemote(labId);
      if (!result) {
        throw new Error("lab session: lab not found on relay");
      }

      // Step 3: pick the highest-generation envelope.
      if (!result.envelopes.length) {
        throw new Error("lab session: lab has no key envelopes");
      }
      const current = result.envelopes.reduce((a, b) =>
        b.generation > a.generation ? b : a,
      );

      // Step 4: open this member's sealed copy.
      const labKey = openLabKeyCopy(current, username, x25519Priv);

      // Step 4.5: OAuth-email to membership binding (Phase 8a). Opening the
      // sealed copy above already proves this keypair is a recipient. This
      // additionally proves the THIRD-PARTY-OAuth identity behind the keypair is
      // the one bound to this membership, so a different OAuth account that
      // somehow held the keypair cannot quietly take the seat. Strict: a missing
      // roster entry, a missing binding, a missing OAuth email, or a hash
      // mismatch all reject the login (the effect throws, the controller lands in
      // its error state). The OAuth email is read from getSession() here as the
      // authoritative source rather than threaded from authenticate().
      const rosterMember =
        result.record.head.username === username
          ? result.record.head
          : result.record.members.find((m) => m.username === username);
      if (!rosterMember) {
        throw new Error(
          "lab session: no roster entry for this user (not a member of this lab)",
        );
      }
      const session = await getSession();
      const oauthEmail = session?.user?.email ?? "";
      const binding = verifyMemberEmailBinding({
        member: rosterMember,
        oauthEmail,
        labKey,
      });
      if (!binding.ok) {
        throw new Error(
          `lab session: OAuth email does not match this lab membership (${binding.reason})`,
        );
      }

      // Step 5: auto-bind the directory profile on the first login (P3a).
      // Best-effort: a failure here must never block the lab login.
      try {
        await autoBindLabProfile({
          oauthEmail,
          oauthName: session?.user?.name ?? null,
          username,
          identity: id,
        });
      } catch {
        // best-effort profile bind, swallow all errors
      }

      // Step 5b: ask the relay to re-report this lab's roster to the billing
      // reconcile endpoint. This closes a timing race where the head added this
      // member to the log (firing reconcile) BEFORE the member's auto-bind above
      // had ever landed, so that first reconcile could not resolve their pubkey
      // and skipped them. Triggering on every login is idempotent and cheap, so
      // it also self-heals any member whose earlier resync did not land. Fully
      // best-effort: a relay error must never block the login.
      void resyncLabRemote(labId);

      // Step 6: assemble and return the live-session payload.
      const signingKeyPair: LabSigningKeyPair = {
        ed25519Priv: id.keys.signing.privateKey,
        ed25519Pub: id.keys.signing.publicKey,
      };
      const member: LabSessionMember = {
        username,
        labId,
      };

      return { labId, labKey, signingKeyPair, member };
    },
  };
}
