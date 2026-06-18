// Lab tier Phase 5: the lab session state machine.
//
// Pure TypeScript, zero React/DOM imports. All external effects (OAuth,
// keypair unlock, lab key fetch) are injected via the LabSessionEffects
// interface so the logic is fully unit-testable with fakes.
//
// STATE MACHINE OVERVIEW
// ----------------------
// The six states and their meanings:
//
//   solo          - this is not a lab account, the lab gate never triggers.
//   locked        - lab account, session not yet started (or after logout/expiry).
//   authenticating - OAuth round-trip in progress.
//   unlocking     - OAuth done, keypair unlock (passkey-PRF or recovery code) in progress.
//   live          - session fully open: lab key + signing key pair in memory.
//   expired       - the OAuth session lapsed and a re-login is required.
//
// Allowed transitions (reducer):
//   START(solo)       -> solo
//   START(lab)        -> locked
//   AUTH_BEGIN        -> authenticating  (from locked only)
//   AUTH_DONE         -> unlocking       (from authenticating only)
//   UNLOCK_DONE       -> live            (from unlocking only)
//   EXPIRE_SIGNAL     -> live (graceUntil set, state still usable)
//   GRACE_ELAPSED     -> expired         (from live only)
//   LOGOUT            -> locked          (from live, locked is the re-enter state)
//   RESET             -> locked          (from any non-solo state)
//
// All other (state, action) combinations are no-ops; invalid transitions return
// the state unchanged. This keeps the reducer total and safe to call from the
// controller at any time.
//
// KEY-ZEROING SECURITY CONTRACT
// ------------------------------
// The lab key (labKey: Uint8Array) and the signing key bytes live in memory
// only. They MUST be zeroed before leaving the "live" state to limit the window
// in which a memory-disclosure attack could extract them. The reducer is pure
// and never holds references, so zeroing is the CONTROLLER's responsibility:
// whenever the controller dispatches GRACE_ELAPSED, LOGOUT, or RESET while in
// "live" state it:
//   1. Captures the outgoing labKey, signingKeyPair.ed25519Priv, and
//      signingKeyPair.ed25519Pub references from the current state.
//   2. Calls dispatch() to install the new state (dropping those references
//      from the state tree).
//   3. Calls .fill(0) on each captured Uint8Array.
// This order is important: we overwrite BEFORE dropping the reference so the
// garbage collector cannot reclaim the buffer and zero it lazily.
//
// FLAG NOTE: production callers must check LAB_TIER_ENABLED from "./config"
// before calling controller methods. The controller itself is flag-free for
// unit testability.
//
// GRACE PERIOD BEHAVIOR
// ---------------------
// The "grace period then lock" decision (locked in LAB_SESSION_PHASE5.md)
// means that when the OAuth session lapses the user is NOT kicked out
// immediately. signalExpiry() sets graceUntil on the "live" state (the session
// remains usable). tickExpiry() checks whether graceUntil has elapsed and, if
// so, dispatches GRACE_ELAPSED to move to "expired". The grace window default
// is 15 minutes (DEFAULT_GRACE_MS). The sync engine (2b-bind) can keep
// flushing during grace; on GRACE_ELAPSED the controller zeroes the keys.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { LabAccountType } from "./lab-account-type";

// ---------------------------------------------------------------------------
// Supporting types (kept minimal; only what the state machine needs).
// ---------------------------------------------------------------------------

/** An Ed25519 signing key pair, held in memory for the duration of the session. */
export interface LabSigningKeyPair {
  ed25519Priv: Uint8Array;
  ed25519Pub: Uint8Array;
}

/** Light member record carried in the live session. */
export interface LabSessionMember {
  username: string;
  labId: string;
}

// ---------------------------------------------------------------------------
// State union
// ---------------------------------------------------------------------------

export type LabSessionState =
  | { kind: "solo" }
  | { kind: "locked" }
  | { kind: "authenticating" }
  | { kind: "unlocking" }
  | {
      kind: "live";
      labId: string;
      labKey: Uint8Array;
      signingKeyPair: LabSigningKeyPair;
      member: LabSessionMember;
      /**
       * Epoch-ms timestamp after which the session is considered expired and
       * tickExpiry() will move to "expired" (keys zeroed). Null means no expiry
       * signal has been received yet; the session stays live indefinitely until
       * one arrives.
       */
      graceUntil: number | null;
    }
  | { kind: "expired" };

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type LabSessionAction =
  | { type: "START"; accountType: LabAccountType }
  | { type: "AUTH_BEGIN" }
  | { type: "AUTH_DONE" }
  | {
      type: "UNLOCK_DONE";
      labId: string;
      labKey: Uint8Array;
      signingKeyPair: LabSigningKeyPair;
      member: LabSessionMember;
    }
  | { type: "EXPIRE_SIGNAL"; now: number; graceMs: number }
  | { type: "GRACE_ELAPSED" }
  | { type: "LOGOUT" }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

/**
 * Pure state reducer. Takes the current state and an action and returns the
 * next state. Invalid (state, action) combinations return the state unchanged.
 * The reducer NEVER zeros keys; that is the controller's responsibility (see
 * key-zeroing contract above).
 */
export function labSessionReducer(
  state: LabSessionState,
  action: LabSessionAction,
): LabSessionState {
  switch (action.type) {
    case "START":
      return action.accountType === "lab"
        ? { kind: "locked" }
        : { kind: "solo" };

    case "AUTH_BEGIN":
      if (state.kind !== "locked") return state;
      return { kind: "authenticating" };

    case "AUTH_DONE":
      if (state.kind !== "authenticating") return state;
      return { kind: "unlocking" };

    case "UNLOCK_DONE":
      if (state.kind !== "unlocking") return state;
      return {
        kind: "live",
        labId: action.labId,
        labKey: action.labKey,
        signingKeyPair: action.signingKeyPair,
        member: action.member,
        graceUntil: null,
      };

    case "EXPIRE_SIGNAL":
      if (state.kind !== "live") return state;
      return {
        ...state,
        graceUntil: action.now + action.graceMs,
      };

    case "GRACE_ELAPSED":
      if (state.kind !== "live") return state;
      // NOTE: the controller must zero the keys before dispatching this action
      // (or immediately after, capturing refs first). See module doc.
      return { kind: "expired" };

    case "LOGOUT":
      if (state.kind !== "live") return state;
      // NOTE: controller must zero keys (same contract as GRACE_ELAPSED).
      return { kind: "locked" };

    case "RESET":
      if (state.kind === "solo") return state;
      // NOTE: controller must zero keys if current state is "live".
      return { kind: "locked" };

    default: {
      // Exhaustiveness check: TypeScript will error if a case is missing.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/** Default grace window: 15 minutes. */
export const DEFAULT_GRACE_MS = 15 * 60 * 1000;

/**
 * Effects injected into the controller. All external I/O is behind this
 * interface so the controller is unit-testable with fakes.
 *
 * LIVE SLICE WIRING (what later slices must implement):
 *
 *   authenticate(provider):
 *     Call NextAuth signIn(provider) and await the verified email from the
 *     OAuth callback. Implemented in the NextAuth/UI slice.
 *     Real: `import { signIn } from "next-auth/react"` then poll or await the
 *     session for a verified email via `getSession()`.
 *
 *   unlockKeypair():
 *     Invoke the passkey-PRF unlock (primary) or recovery-code fallback.
 *     Implemented in the passkey unlock slice.
 *     Real: calls `lib/sharing/identity/passkey.ts` -> `webAuthnUnlock()`, or
 *     the recovery-code path in `recovery-code.ts`, and parks the result via
 *     `setSessionIdentity()` in `lib/sharing/identity/session-key.ts`.
 *
 *   openLabKey():
 *     Fetch the lab record from the DO, resolve the member identity from the
 *     session, open the sealed lab-key envelope, and return the live session
 *     payload. Implemented in the DO/key slice.
 *     Real:
 *       1. `getSessionIdentity()` from `lib/sharing/identity/session-key.ts`
 *          to get the X25519 private key and username.
 *       2. `getLabRemote(labId)` from `lib/lab/lab-do-client.ts` to fetch the
 *          Lab Record + key envelopes.
 *       3. `openLabKeyCopy(envelope, username, x25519Priv)` from
 *          `lib/lab/lab-key.ts` to unwrap the lab key.
 *       4. Return `{ labId, labKey, signingKeyPair, member }`.
 *
 *   now():
 *     Returns the current epoch-ms timestamp. Use `() => Date.now()` in
 *     production; inject a controllable clock in tests.
 */
export interface LabSessionEffects {
  /**
   * Perform the OAuth round-trip for the given provider and return the
   * verified email address. Rejects on failure or user cancellation.
   */
  authenticate: (provider: string) => Promise<{ email: string }>;

  /**
   * SILENT resume probe: return the verified email IF an OAuth session already
   * exists (cookie still valid), or null otherwise. Unlike authenticate, this
   * NEVER triggers a sign-in or a redirect. resume() uses it on boot so a
   * returning user with a live cookie goes straight to "live" without re-doing
   * the sign-in every refresh. Optional so existing fakes/tests stay valid;
   * resume() no-ops (stays locked) when it is absent.
   */
  peekSession?: () => Promise<{ email: string } | null>;

  /**
   * Unlock the member's keypair private key for this session (passkey-PRF or
   * recovery-code fallback). Resolves when the identity is parked in
   * session-key.ts; rejects on failure or user cancellation.
   */
  unlockKeypair: () => Promise<void>;

  /**
   * Fetch the lab record from the DO, identify this member's envelope, and
   * open the sealed lab key. Returns the complete live-session payload.
   * Rejects if the member has no envelope or the fetch fails.
   */
  openLabKey: () => Promise<{
    labId: string;
    labKey: Uint8Array;
    signingKeyPair: LabSigningKeyPair;
    member: LabSessionMember;
  }>;

  /**
   * Drop any locally-cached lab key envelope for this user (reload-reconnect).
   * Called on logout so a signed-out session leaves no offline-resume artifact
   * behind. Optional so existing fakes/tests stay valid; logout() no-ops when it
   * is absent, and the production impl is itself a no-op unless
   * NEXT_PUBLIC_LAB_RELOAD_RECONNECT is on. Best-effort: a failure must never
   * block sign-out.
   */
  clearEnvelopeCache?: () => void | Promise<void>;

  /**
   * Current epoch-ms timestamp. Use `() => Date.now()` in production.
   * Inject a controllable clock in tests.
   */
  now: () => number;

  /**
   * Grace window in milliseconds. Defaults to DEFAULT_GRACE_MS (15 min).
   * Inject a smaller value in tests for fast clock-advance scenarios.
   */
  graceMs?: number;
}

/** Public surface of the controller. */
export interface LabSessionController {
  /** Current state snapshot. */
  getState(): LabSessionState;

  /**
   * Subscribe to state changes. The callback fires on every transition.
   * Returns an unsubscribe function.
   */
  subscribe(fn: () => void): () => void;

  /**
   * Last error from a failed signIn() attempt, or null if none.
   * Cleared on the next successful transition out of "locked".
   */
  getError(): Error | null;

  /**
   * Boot the controller for this account type. Dispatches START.
   * Call once on app load after account type is resolved.
   */
  start(accountType: LabAccountType): void;

  /**
   * Begin the OAuth + keypair-unlock + lab-key-open flow for the given
   * provider. Walks: locked -> authenticating -> unlocking -> live.
   * On any rejection, the state falls back to "locked" and the error is
   * surfaced via getError(). Safe to call from a sign-in button.
   */
  signIn(provider: string): Promise<void>;

  /**
   * SILENT resume on boot. If an OAuth session already exists (peekSession
   * returns an email) AND the keypair restores, walks locked -> live with NO
   * sign-in prompt or redirect, so a refresh keeps the user logged in. If there
   * is no session (or peekSession is absent), it leaves the state at "locked" so
   * the gate shows the sign-in buttons. Safe to call once on gate mount.
   */
  resume(): Promise<void>;

  /**
   * Signal that the OAuth session has lapsed. Sets graceUntil on the "live"
   * state (the session remains usable for graceMs). A timer or NextAuth
   * session-watch should call this. Has no effect in non-live states.
   */
  signalExpiry(): void;

  /**
   * Check whether the grace window has elapsed and, if so, move to "expired"
   * (zeroing the keys). Safe to call on an interval or on-focus event.
   * Has no effect if not in "live" state or if graceUntil has not been set.
   */
  tickExpiry(): void;

  /** Sign out. Zeroes the lab key and moves to "locked". */
  logout(): void;
}

// ---------------------------------------------------------------------------
// Helper: zero one or more Uint8Arrays.
// ---------------------------------------------------------------------------
function zeroBytes(...arrays: Uint8Array[]): void {
  for (const arr of arrays) {
    arr.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Controller factory
// ---------------------------------------------------------------------------

/**
 * Creates a LabSessionController with all external effects injected.
 *
 * Usage:
 *   const controller = createLabSessionController({
 *     authenticate: realNextAuthSignIn,
 *     unlockKeypair: realPasskeyUnlock,
 *     openLabKey: realOpenLabKey,
 *     now: () => Date.now(),
 *   });
 *   controller.start(accountType);
 *
 * @param effects injected I/O, described on LabSessionEffects.
 */
export function createLabSessionController(
  effects: LabSessionEffects,
): LabSessionController {
  const { authenticate, peekSession, unlockKeypair, openLabKey, now } = effects;
  const graceMs = effects.graceMs ?? DEFAULT_GRACE_MS;

  let state: LabSessionState = { kind: "locked" };
  let lastError: Error | null = null;
  const subscribers = new Set<() => void>();

  function dispatch(action: LabSessionAction): void {
    // KEY-ZEROING CONTRACT: before installing a new state that leaves "live",
    // capture the outgoing key references, install the next state, then zero
    // the captured buffers. This order (install first, zero after) ensures the
    // GC cannot reclaim the buffers before we zero them, and the new state
    // holds no reference to the still-live bytes while we zero them.
    if (state.kind === "live") {
      const outgoingKey = state.labKey;
      const outgoingPriv = state.signingKeyPair.ed25519Priv;
      const outgoingPub = state.signingKeyPair.ed25519Pub;
      const next = labSessionReducer(state, action);
      if (next.kind !== "live") {
        // We are leaving "live": zero the outgoing keys.
        state = next;
        notify();
        zeroBytes(outgoingKey, outgoingPriv, outgoingPub);
        return;
      }
      // Staying in "live" (e.g. EXPIRE_SIGNAL): no zeroing.
      state = next;
      notify();
      return;
    }

    state = labSessionReducer(state, action);
    notify();
  }

  function notify(): void {
    for (const fn of subscribers) {
      try {
        fn();
      } catch {
        // a misbehaving subscriber must not break state transitions
      }
    }
  }

  /**
   * Shared tail of signIn() and resume(): from "authenticating" (AUTH_BEGIN
   * already dispatched, auth confirmed), unlock the keypair then open the lab
   * key, landing in "live". Any rejection resets to "locked" with the error.
   */
  async function unlockAndOpen(): Promise<void> {
    dispatch({ type: "AUTH_DONE" });

    try {
      await unlockKeypair();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      dispatch({ type: "RESET" });
      return;
    }

    let payload: {
      labId: string;
      labKey: Uint8Array;
      signingKeyPair: LabSigningKeyPair;
      member: LabSessionMember;
    };
    try {
      payload = await openLabKey();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      dispatch({ type: "RESET" });
      return;
    }

    dispatch({
      type: "UNLOCK_DONE",
      labId: payload.labId,
      labKey: payload.labKey,
      signingKeyPair: payload.signingKeyPair,
      member: payload.member,
    });
  }

  return {
    getState() {
      return state;
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    getError() {
      return lastError;
    },

    start(accountType) {
      lastError = null;
      dispatch({ type: "START", accountType });
    },

    async signIn(provider) {
      // Can only sign in from "locked".
      if (state.kind !== "locked") return;
      lastError = null;

      dispatch({ type: "AUTH_BEGIN" });
      try {
        await authenticate(provider);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        dispatch({ type: "RESET" });
        return;
      }
      await unlockAndOpen();
    },

    async resume() {
      // Silent boot resume: only from "locked", only if a session already
      // exists. Never prompts or redirects.
      if (state.kind !== "locked") return;
      if (!peekSession) return;
      let session: { email: string } | null;
      try {
        session = await peekSession();
      } catch {
        session = null;
      }
      if (!session) return; // no live cookie: stay locked, gate shows buttons
      lastError = null;
      dispatch({ type: "AUTH_BEGIN" });
      await unlockAndOpen();
    },

    signalExpiry() {
      if (state.kind !== "live") return;
      dispatch({ type: "EXPIRE_SIGNAL", now: now(), graceMs });
    },

    tickExpiry() {
      if (state.kind !== "live") return;
      if (state.graceUntil === null) return;
      if (now() >= state.graceUntil) {
        dispatch({ type: "GRACE_ELAPSED" });
      }
    },

    logout() {
      if (state.kind !== "live") return;
      dispatch({ type: "LOGOUT" });
      // Best-effort: drop the offline-resume envelope cache for this user so a
      // signed-out session leaves nothing behind. Never block sign-out on it.
      try {
        void Promise.resolve(effects.clearEnvelopeCache?.()).catch(() => {});
      } catch {
        // a throwing (non-async) impl must not break logout
      }
    },
  };
}
