/**
 * First-time-visitor landing-page gate.
 *
 * The landing ("sell") page renders BEFORE the connect-folder screen, but
 * ONLY for a genuinely-new visitor: someone who has never linked a folder,
 * has no known users, and has no stored current user in IndexedDB. Returning
 * visitors trip at least one of those signals and skip the landing with zero
 * extra clicks (silent reconnect, a stored handle that needs a permission
 * re-grant, a stored currentUser, or discovered users all count as
 * "returning").
 *
 * `shouldShowLanding` is the single decision point, kept pure so the gate
 * logic is unit-testable without a DOM. The persistence helpers below wrap
 * the localStorage "seen" flag and the `?connect=1` capture / dev bypass.
 *
 * Note: the "seen" flag lives in localStorage (browser-local), NOT in the
 * user's research folder. It only suppresses re-nagging a truly-new visitor
 * who already engaged once; it never gates a returning user.
 */

/** localStorage key set once the visitor engages any landing CTA, so a
 *  reload mid-connect-flow does not re-show the sell. */
export const LANDING_SEEN_KEY = "researchos:seen-landing";

/** URL query param that bypasses the landing and drops straight onto the
 *  connect-folder screen. Used by the wiki-screenshot capture (the fresh
 *  `folder-connect.png` shot) and by the dev "Folder setup walkthrough"
 *  affordance so neither has to clear the localStorage flag. */
export const LANDING_CONNECT_BYPASS_PARAM = "connect";

export interface LandingGateState {
  /** Folder is connected (silent reconnect succeeded). */
  isConnected: boolean;
  /** A current user is stored / signed in. */
  currentUser: string | null;
  /** Name of the last connected folder. Non-null when a handle exists in
   *  IndexedDB even if the silent reconnect did not auto-grant permission
   *  (the "reconnect to X" case is a returning user). */
  lastConnectedFolder: string | null;
  /** Users discovered on the connected folder. */
  availableUsers: string[];
  /** The visitor has already seen / dismissed the landing this browser. */
  seen: boolean;
  /** The `?connect=1` bypass is present on the URL. */
  connectBypass: boolean;
}

/**
 * Pure gate decision. Returns true ONLY for a truly-new visitor who has not
 * dismissed the landing and is not using the connect bypass. Any returning
 * signal (connected, stored user, stored folder handle, discovered users)
 * short-circuits to false so returning users never see the landing.
 *
 * Callers are responsible for the surrounding context: this is only consulted
 * after loading has resolved and after the demo / wiki-capture / browser-
 * support branches have been ruled out (see AppContent in providers.tsx).
 */
export function shouldShowLanding(state: LandingGateState): boolean {
  if (state.connectBypass) return false;
  if (state.seen) return false;
  if (state.isConnected) return false;
  if (state.currentUser) return false;
  if (state.lastConnectedFolder) return false;
  if (state.availableUsers.length > 0) return false;
  return true;
}

/** True if the landing was already seen / dismissed in this browser.
 *  SSR-safe: returns false on the server. */
export function hasSeenLanding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LANDING_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark the landing as seen so a truly-new visitor who engaged once is not
 *  re-nagged on reload. Best-effort (private-mode browsers can throw). */
export function markLandingSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANDING_SEEN_KEY, "1");
  } catch {
    // best-effort
  }
}

/** Clear the seen flag so the landing shows again. Used by the dev
 *  "Landing page" re-show affordance. */
export function clearLandingSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LANDING_SEEN_KEY);
  } catch {
    // best-effort
  }
}

/** True when `?connect=1` is on the URL. SSR-safe: returns false on the
 *  server. */
export function hasConnectBypass(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(LANDING_CONNECT_BYPASS_PARAM) === "1";
  } catch {
    return false;
  }
}
