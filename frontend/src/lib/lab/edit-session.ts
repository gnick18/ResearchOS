// Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): edit-session
// state machine.
//
// Decision #4 (Grant 2026-05-23): session SURVIVES navigation. State is
// held at module scope (singleton), not React component state, so route
// changes don't clobber it. Closing the tab is the natural expiry — no
// persistence to disk or storage; the 5-minute window is short enough
// that a closed tab is an acceptable loss of state.
//
// The state machine has three states:
//   - "idle"     — no active session. Default.
//   - "unlocked" — session active. Writes allowed; timer counting down.
//   - "locked"   — most-recent session expired (countdown hit 0 OR user
//                  manually locked). Distinct from "idle" only so the
//                  UI can show "session ended, re-auth to continue"
//                  instead of pretending the user never unlocked. Both
//                  states are functionally identical for write-gating
//                  (only "unlocked" permits writes).
//
// Session id is a UUID-style string generated on each unlock. The audit
// log writer reads it via `getActiveSession()` so all field edits in one
// 5-minute window share a session_id.

const SESSION_DURATION_MS = 5 * 60 * 1000;

export type EditSessionState = "idle" | "unlocked" | "locked";

interface ActiveSession {
  id: string;
  /** Username of the lab head who owns the session. Read by the audit
   *  writer so it can stamp the actor on each entry. */
  username: string;
  /** ms epoch when the session started. */
  startedAt: number;
  /** ms epoch when the session will auto-expire. */
  expiresAt: number;
}

interface SessionData {
  state: EditSessionState;
  active: ActiveSession | null;
  /** Remaining ms until expiry — derived but cached for cheap subscriber reads. */
  remainingMs: number;
}

type Subscriber = (data: SessionData) => void;

let current: SessionData = {
  state: "idle",
  active: null,
  remainingMs: 0,
};

const subscribers = new Set<Subscriber>();
let tickInterval: ReturnType<typeof setInterval> | null = null;

function notify() {
  for (const sub of subscribers) {
    try {
      sub(snapshot());
    } catch (err) {
      console.warn("[edit-session] subscriber threw", err);
    }
  }
}

function snapshot(): SessionData {
  return {
    state: current.state,
    active: current.active ? { ...current.active } : null,
    remainingMs: current.remainingMs,
  };
}

/**
 * RFC4122-ish UUID v4 via crypto.randomUUID when available. Falls back to
 * Math.random for environments without crypto.randomUUID (older browser
 * test runners). The audit log only needs the id to group entries, not
 * to act as a security token, so the fallback is acceptable.
 */
function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback — only hit in test envs without crypto.randomUUID.
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureTimer() {
  if (tickInterval !== null) return;
  // 1s tick — the UI banner only shows whole-second precision. A slower
  // tick would let the displayed time drift behind the actual expiry.
  tickInterval = setInterval(() => {
    if (!current.active) {
      stopTimer();
      return;
    }
    const remaining = current.active.expiresAt - Date.now();
    if (remaining <= 0) {
      // Expire — auto-lock. Preserves the "locked" state distinct from
      // "idle" so the UI can show "session ended" until the user clicks
      // away or unlocks fresh.
      current = {
        state: "locked",
        active: null,
        remainingMs: 0,
      };
      stopTimer();
      notify();
      return;
    }
    current.remainingMs = remaining;
    notify();
  }, 1000);
}

function stopTimer() {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

/**
 * Subscribe to session updates. Returns an unsubscribe function. The
 * subscriber fires immediately with the current snapshot so a freshly-
 * mounted component can show the correct state without a tick wait.
 */
export function subscribeEditSession(sub: Subscriber): () => void {
  subscribers.add(sub);
  try {
    sub(snapshot());
  } catch (err) {
    console.warn("[edit-session] subscriber threw on initial fire", err);
  }
  return () => {
    subscribers.delete(sub);
  };
}

/** Read the current session snapshot synchronously. */
export function getEditSession(): SessionData {
  return snapshot();
}

/**
 * True iff there is an unlocked session for the given username (or any
 * session if username is omitted). Used by popup gating to decide
 * whether write inputs are enabled.
 */
export function isUnlockedFor(username: string | null | undefined): boolean {
  if (current.state !== "unlocked" || !current.active) return false;
  if (!username) return true;
  return current.active.username === username;
}

/**
 * Start an unlocked session for `username`. Caller is responsible for
 * having already verified the password (via `verifyLabHeadPassword`).
 * Returns the session metadata for the audit writer.
 */
export function startEditSession(username: string): ActiveSession {
  const now = Date.now();
  const active: ActiveSession = {
    id: newSessionId(),
    username,
    startedAt: now,
    expiresAt: now + SESSION_DURATION_MS,
  };
  current = {
    state: "unlocked",
    active,
    remainingMs: SESSION_DURATION_MS,
  };
  ensureTimer();
  notify();
  return { ...active };
}

/** Manually end the active session. Transitions to "locked". */
export function endEditSession(): void {
  if (current.state !== "unlocked") return;
  current = {
    state: "locked",
    active: null,
    remainingMs: 0,
  };
  stopTimer();
  notify();
}

/**
 * Extend the currently-unlocked session by another full
 * `SESSION_DURATION_MS` window (resets the countdown to 5:00). Returns
 * `true` if the extension was applied, `false` if there was no
 * unlocked session to extend.
 *
 * Lab head UX polish manager (2026-05-24, Bug 2): wired up so the
 * global top-nav chip can offer a one-click "Extend 5 min" affordance
 * without requiring the user to re-enter the password. This is a
 * convenience refresh of an already-authenticated session; it does NOT
 * mint a new session id (audit entries continue to share the original
 * id, which is the desired grouping behavior for a continuous PI work
 * block).
 */
export function extendEditSession(): boolean {
  if (current.state !== "unlocked" || !current.active) return false;
  const now = Date.now();
  const newExpiry = now + SESSION_DURATION_MS;
  current = {
    state: "unlocked",
    active: { ...current.active, expiresAt: newExpiry },
    remainingMs: SESSION_DURATION_MS,
  };
  ensureTimer();
  notify();
  return true;
}

/**
 * Reset to idle. Used on logout / user-switch so a stale "locked" state
 * doesn't bleed across users. Distinct from `endEditSession` only in
 * the resulting state token (so UI distinguishes "you just ended your
 * session" from "you signed out").
 */
export function resetEditSession(): void {
  current = {
    state: "idle",
    active: null,
    remainingMs: 0,
  };
  stopTimer();
  notify();
}

/** Pretty-print remaining time as "M:SS". */
export function formatRemaining(remainingMs: number): string {
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export { SESSION_DURATION_MS };
