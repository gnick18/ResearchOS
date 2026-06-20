// Deterministic full sign-out (sign-out-is-full-logout fix, 2026-06-20).
//
// Grant's model: "Sign out" ends the cloud account session AND lands on the
// welcome/login screen, never the folder picker. It is a FULL logout, not a
// folder disconnect.
//
// Why a helper instead of calling signOut directly. We run next-auth v5
// (Auth.js beta), whose client signOut({ callbackUrl }) clears the session
// cookie server-side but then leaves the redirect to its own
// `window.location.href = data.url`. In this app that navigation raced the
// folder disconnect (which re-renders the tree to a gate) and could no-op,
// so the cookie was cleared but the SPA never reloaded. The user was left on
// the folder-connect gate (the picker) with a still-"active" client session,
// which read as "sign out only forgot my folder". See providers.tsx: the
// module-scoped entry-action state only resets on a real document load, so a
// hard navigation is what guarantees the front door instead of the picker.
//
// The fix removes every race by controlling the order ourselves:
//   1. signOut({ redirect: false }) so next-auth clears the cookie and we AWAIT
//      it, with no internal navigation to race.
//   2. forget the connected folder (when one is connected) so the reload cannot
//      silently auto-reconnect from the remembered handle and re-enter the app.
//   3. a single hard window.location.assign("/") so a full document load resets
//      the entry state and, with the session cleared, routes to the welcome /
//      login landing in either NEXT_PUBLIC_REQUIRE_ACCOUNT state.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { signOut } from "next-auth/react";

export async function fullSignOut(opts?: {
  /** When provided (the in-app account menu and gate screens), forgets the
   *  active folder before the reload so "/" cannot auto-reconnect into the app.
   *  Pass useFileSystem().disconnect. Omit on surfaces with no folder. */
  disconnect?: () => Promise<void>;
}): Promise<void> {
  // 1. End the cloud session and wait for the cookie to clear. redirect:false
  //    keeps next-auth from doing its own (race-prone) client navigation.
  try {
    await signOut({ redirect: false });
  } catch {
    // Network or CSRF hiccup. Still force-forget the folder and hard-navigate
    // below so the button can never leave the user in a half-signed-out state.
  }

  // 2. Forget the connected folder so the hard reload cannot resurrect the app
  //    from the remembered handle. A no-op when nothing is connected.
  if (opts?.disconnect) {
    try {
      await opts.disconnect();
    } catch {
      // Never block the logout on a disconnect failure.
    }
  }

  // 3. Hard navigation to the front door. A full document load resets the
  //    module-scoped entry-action state in providers.tsx, so the app lands on
  //    the welcome/login landing rather than the folder picker.
  if (typeof window !== "undefined") {
    window.location.assign("/");
  }
}
