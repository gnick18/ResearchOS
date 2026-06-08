// Tests for lib/lab/lab-session.ts
//
// Covers:
//   Reducer:
//     - Each valid transition produces the expected next state.
//     - Invalid transitions (wrong source state) are no-ops.
//   Controller happy path:
//     - start("lab") moves to "locked".
//     - start("solo") moves to "solo".
//     - signIn("google") walks locked -> authenticating -> unlocking -> live.
//     - Subscribers are notified on each transition.
//     - getState() returns the injected labId/labKey/member on "live".
//   Controller failure paths:
//     - authenticate rejects -> state returns to "locked", error surfaced via getError().
//     - unlockKeypair rejects -> state returns to "locked", error surfaced.
//     - openLabKey rejects -> state returns to "locked", error surfaced.
//   Grace-then-lock with injected clock:
//     - signalExpiry() sets graceUntil (state remains "live").
//     - tickExpiry() before grace elapses: state still "live".
//     - tickExpiry() after now() advances past graceUntil: state moves to "expired"
//       AND the labKey Uint8Array bytes are all zero (key-zeroing verified).
//   logout from "live":
//     - State moves to "locked".
//     - labKey bytes are all zero after logout.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  labSessionReducer,
  createLabSessionController,
  DEFAULT_GRACE_MS,
  type LabSessionState,
  type LabSessionAction,
  type LabSigningKeyPair,
  type LabSessionMember,
} from "../lab-session";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeSigningKeyPair(): LabSigningKeyPair {
  return {
    ed25519Priv: new Uint8Array(64).fill(0x01),
    ed25519Pub: new Uint8Array(32).fill(0x02),
  };
}

function makeMember(labId = "lab-123"): LabSessionMember {
  return { username: "alice", labId };
}

function makeLiveState(overrides: Partial<Extract<LabSessionState, { kind: "live" }>> = {}): Extract<LabSessionState, { kind: "live" }> {
  return {
    kind: "live",
    labId: "lab-123",
    labKey: new Uint8Array(32).fill(0xab),
    signingKeyPair: makeSigningKeyPair(),
    member: makeMember(),
    graceUntil: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reducer tests
// ---------------------------------------------------------------------------

describe("labSessionReducer: valid transitions", () => {
  it("START(lab) from any state -> locked", () => {
    const next = labSessionReducer({ kind: "locked" }, { type: "START", accountType: "lab" });
    expect(next.kind).toBe("locked");
  });

  it("START(solo) -> solo", () => {
    const next = labSessionReducer({ kind: "locked" }, { type: "START", accountType: "solo" });
    expect(next.kind).toBe("solo");
  });

  it("AUTH_BEGIN from locked -> authenticating", () => {
    const next = labSessionReducer({ kind: "locked" }, { type: "AUTH_BEGIN" });
    expect(next.kind).toBe("authenticating");
  });

  it("AUTH_DONE from authenticating -> unlocking", () => {
    const next = labSessionReducer({ kind: "authenticating" }, { type: "AUTH_DONE" });
    expect(next.kind).toBe("unlocking");
  });

  it("UNLOCK_DONE from unlocking -> live with correct payload", () => {
    const labKey = new Uint8Array(32).fill(0x55);
    const signingKeyPair = makeSigningKeyPair();
    const member = makeMember();
    const next = labSessionReducer(
      { kind: "unlocking" },
      { type: "UNLOCK_DONE", labId: "lab-42", labKey, signingKeyPair, member },
    );
    expect(next.kind).toBe("live");
    if (next.kind === "live") {
      expect(next.labId).toBe("lab-42");
      expect(next.labKey).toBe(labKey);
      expect(next.graceUntil).toBeNull();
    }
  });

  it("EXPIRE_SIGNAL from live -> live with graceUntil set", () => {
    const live = makeLiveState();
    const now = 1_000_000;
    const graceMs = 5_000;
    const next = labSessionReducer(live, { type: "EXPIRE_SIGNAL", now, graceMs });
    expect(next.kind).toBe("live");
    if (next.kind === "live") {
      expect(next.graceUntil).toBe(now + graceMs);
    }
  });

  it("GRACE_ELAPSED from live -> expired", () => {
    const live = makeLiveState({ graceUntil: 500 });
    const next = labSessionReducer(live, { type: "GRACE_ELAPSED" });
    expect(next.kind).toBe("expired");
  });

  it("LOGOUT from live -> locked", () => {
    const live = makeLiveState();
    const next = labSessionReducer(live, { type: "LOGOUT" });
    expect(next.kind).toBe("locked");
  });

  it("RESET from locked -> locked", () => {
    const next = labSessionReducer({ kind: "locked" }, { type: "RESET" });
    expect(next.kind).toBe("locked");
  });

  it("RESET from authenticating -> locked", () => {
    const next = labSessionReducer({ kind: "authenticating" }, { type: "RESET" });
    expect(next.kind).toBe("locked");
  });

  it("RESET from live -> locked", () => {
    const next = labSessionReducer(makeLiveState(), { type: "RESET" });
    expect(next.kind).toBe("locked");
  });

  it("RESET from solo -> solo (no-op: solo is terminal)", () => {
    const next = labSessionReducer({ kind: "solo" }, { type: "RESET" });
    expect(next.kind).toBe("solo");
  });
});

describe("labSessionReducer: invalid transitions are no-ops", () => {
  it("AUTH_BEGIN from solo is no-op", () => {
    const state: LabSessionState = { kind: "solo" };
    expect(labSessionReducer(state, { type: "AUTH_BEGIN" })).toBe(state);
  });

  it("AUTH_BEGIN from authenticating is no-op", () => {
    const state: LabSessionState = { kind: "authenticating" };
    expect(labSessionReducer(state, { type: "AUTH_BEGIN" })).toBe(state);
  });

  it("AUTH_DONE from locked is no-op", () => {
    const state: LabSessionState = { kind: "locked" };
    expect(labSessionReducer(state, { type: "AUTH_DONE" })).toBe(state);
  });

  it("UNLOCK_DONE from locked is no-op", () => {
    const state: LabSessionState = { kind: "locked" };
    expect(labSessionReducer(state, { type: "UNLOCK_DONE", labId: "x", labKey: new Uint8Array(32), signingKeyPair: makeSigningKeyPair(), member: makeMember() })).toBe(state);
  });

  it("GRACE_ELAPSED from locked is no-op", () => {
    const state: LabSessionState = { kind: "locked" };
    expect(labSessionReducer(state, { type: "GRACE_ELAPSED" })).toBe(state);
  });

  it("LOGOUT from locked is no-op", () => {
    const state: LabSessionState = { kind: "locked" };
    expect(labSessionReducer(state, { type: "LOGOUT" })).toBe(state);
  });

  it("LOGOUT from solo is no-op", () => {
    const state: LabSessionState = { kind: "solo" };
    expect(labSessionReducer(state, { type: "LOGOUT" })).toBe(state);
  });

  it("EXPIRE_SIGNAL from locked is no-op", () => {
    const state: LabSessionState = { kind: "locked" };
    expect(labSessionReducer(state, { type: "EXPIRE_SIGNAL", now: 1000, graceMs: 5000 })).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Controller: happy path
// ---------------------------------------------------------------------------

describe("createLabSessionController: happy path", () => {
  const fakeLabKey = new Uint8Array(32).fill(0xcc);
  const fakeSigning = makeSigningKeyPair();
  const fakeMember = makeMember("lab-happy");

  function makeEffects() {
    return {
      authenticate: vi.fn(async (_provider: string) => ({ email: "alice@example.com" })),
      unlockKeypair: vi.fn(async () => {}),
      openLabKey: vi.fn(async () => ({
        labId: "lab-happy",
        labKey: fakeLabKey,
        signingKeyPair: fakeSigning,
        member: fakeMember,
      })),
      now: vi.fn(() => 0),
    };
  }

  it("start('lab') moves to locked", () => {
    const ctrl = createLabSessionController(makeEffects());
    ctrl.start("lab");
    expect(ctrl.getState().kind).toBe("locked");
  });

  it("start('solo') moves to solo", () => {
    const ctrl = createLabSessionController(makeEffects());
    ctrl.start("solo");
    expect(ctrl.getState().kind).toBe("solo");
  });

  it("signIn walks locked -> authenticating -> unlocking -> live", async () => {
    const effects = makeEffects();
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");

    const states: string[] = [];
    ctrl.subscribe(() => states.push(ctrl.getState().kind));

    await ctrl.signIn("google");

    expect(states).toEqual(["authenticating", "unlocking", "live"]);
    expect(ctrl.getState().kind).toBe("live");
    expect(ctrl.getError()).toBeNull();
  });

  it("resume() with a live session goes straight to live WITHOUT authenticate", async () => {
    const effects = {
      ...makeEffects(),
      peekSession: vi.fn(async () => ({ email: "alice@example.com" })),
    };
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");

    const states: string[] = [];
    ctrl.subscribe(() => states.push(ctrl.getState().kind));

    await ctrl.resume();

    expect(states).toEqual(["authenticating", "unlocking", "live"]);
    expect(ctrl.getState().kind).toBe("live");
    expect(effects.peekSession).toHaveBeenCalledOnce();
    // The silent path must NOT call authenticate (no redirect / no prompt).
    expect(effects.authenticate).not.toHaveBeenCalled();
    expect(effects.unlockKeypair).toHaveBeenCalledOnce();
    expect(effects.openLabKey).toHaveBeenCalledOnce();
  });

  it("resume() with NO live session stays locked (shows the buttons)", async () => {
    const effects = {
      ...makeEffects(),
      peekSession: vi.fn(async () => null),
    };
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");
    await ctrl.resume();
    expect(ctrl.getState().kind).toBe("locked");
    expect(effects.unlockKeypair).not.toHaveBeenCalled();
    expect(effects.openLabKey).not.toHaveBeenCalled();
  });

  it("resume() is a no-op when peekSession is absent", async () => {
    const ctrl = createLabSessionController(makeEffects());
    ctrl.start("lab");
    await ctrl.resume();
    expect(ctrl.getState().kind).toBe("locked");
  });

  it("resume() with a live session but a failing openLabKey falls back to locked", async () => {
    const effects = {
      ...makeEffects(),
      peekSession: vi.fn(async () => ({ email: "alice@example.com" })),
      openLabKey: vi.fn(async () => {
        throw new Error("not a member yet");
      }),
    };
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");
    await ctrl.resume();
    expect(ctrl.getState().kind).toBe("locked");
    expect(ctrl.getError()?.message).toContain("not a member yet");
  });

  it("live state carries the injected labKey and member", async () => {
    const ctrl = createLabSessionController(makeEffects());
    ctrl.start("lab");
    await ctrl.signIn("google");
    const s = ctrl.getState();
    expect(s.kind).toBe("live");
    if (s.kind === "live") {
      expect(s.labId).toBe("lab-happy");
      expect(s.labKey).toBe(fakeLabKey);
      expect(s.member).toEqual(fakeMember);
    }
  });

  it("subscribers are notified on each transition", async () => {
    const effects = makeEffects();
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");

    let notifyCount = 0;
    ctrl.subscribe(() => notifyCount++);

    await ctrl.signIn("google");
    // locked -> authenticating -> unlocking -> live = 3 notifications
    expect(notifyCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Controller: failure paths
// ---------------------------------------------------------------------------

describe("createLabSessionController: failure paths", () => {
  function makeEffects(overrides: Partial<{
    authenticate: () => Promise<{ email: string }>;
    unlockKeypair: () => Promise<void>;
    openLabKey: () => Promise<{ labId: string; labKey: Uint8Array; signingKeyPair: LabSigningKeyPair; member: LabSessionMember }>;
  }> = {}) {
    return {
      authenticate: vi.fn(async () => ({ email: "alice@example.com" })),
      unlockKeypair: vi.fn(async () => {}),
      openLabKey: vi.fn(async () => ({
        labId: "lab-fail",
        labKey: new Uint8Array(32),
        signingKeyPair: makeSigningKeyPair(),
        member: makeMember("lab-fail"),
      })),
      now: vi.fn(() => 0),
      ...overrides,
    };
  }

  it("authenticate rejects -> state returns to locked, error surfaced", async () => {
    const effects = makeEffects({
      authenticate: vi.fn(async () => { throw new Error("OAuth cancelled"); }),
    });
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");
    await ctrl.signIn("google");
    expect(ctrl.getState().kind).toBe("locked");
    expect(ctrl.getError()?.message).toBe("OAuth cancelled");
  });

  it("unlockKeypair rejects -> state returns to locked, error surfaced", async () => {
    const effects = makeEffects({
      unlockKeypair: vi.fn(async () => { throw new Error("passkey rejected"); }),
    });
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");
    await ctrl.signIn("google");
    expect(ctrl.getState().kind).toBe("locked");
    expect(ctrl.getError()?.message).toBe("passkey rejected");
  });

  it("openLabKey rejects -> state returns to locked, error surfaced", async () => {
    const effects = makeEffects({
      openLabKey: vi.fn(async () => { throw new Error("no envelope for member"); }),
    });
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");
    await ctrl.signIn("google");
    expect(ctrl.getState().kind).toBe("locked");
    expect(ctrl.getError()?.message).toBe("no envelope for member");
  });
});

// ---------------------------------------------------------------------------
// Controller: grace-then-lock + key zeroing
// ---------------------------------------------------------------------------

describe("createLabSessionController: grace-then-lock + key zeroing", () => {
  function makeEffectsWithClock(clockFn: () => number) {
    const labKey = new Uint8Array(32).fill(0xde);
    const signingKeyPair = makeSigningKeyPair();
    const member = makeMember("lab-grace");
    return {
      effects: {
        authenticate: vi.fn(async () => ({ email: "alice@example.com" })),
        unlockKeypair: vi.fn(async () => {}),
        openLabKey: vi.fn(async () => ({
          labId: "lab-grace",
          labKey,
          signingKeyPair,
          member,
        })),
        now: clockFn,
        graceMs: 1000,
      },
      labKey,
      signingKeyPair,
    };
  }

  it("signalExpiry sets graceUntil, state stays live before grace elapses", async () => {
    let fakeNow = 10_000;
    const { effects } = makeEffectsWithClock(() => fakeNow);
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");
    await ctrl.signIn("google");

    ctrl.signalExpiry();
    const s = ctrl.getState();
    expect(s.kind).toBe("live");
    if (s.kind === "live") {
      expect(s.graceUntil).toBe(10_000 + 1000);
    }

    // tickExpiry before grace elapses: still live.
    fakeNow = 10_500; // 500ms into the 1000ms grace window
    ctrl.tickExpiry();
    expect(ctrl.getState().kind).toBe("live");
  });

  it("tickExpiry after grace elapses moves to expired AND zeroes the labKey bytes", async () => {
    let fakeNow = 10_000;
    const { effects, labKey, signingKeyPair } = makeEffectsWithClock(() => fakeNow);
    const ctrl = createLabSessionController(effects);
    ctrl.start("lab");
    await ctrl.signIn("google");

    // Capture the Uint8Array reference BEFORE the controller zeroes it.
    const trackedLabKey = labKey;
    const trackedPriv = signingKeyPair.ed25519Priv;
    const trackedPub = signingKeyPair.ed25519Pub;

    // Signal expiry (graceUntil = 10_000 + 1000 = 11_000).
    ctrl.signalExpiry();

    // Advance past the grace window.
    fakeNow = 12_000;
    ctrl.tickExpiry();

    // State should be expired.
    expect(ctrl.getState().kind).toBe("expired");

    // Key bytes must be zeroed.
    expect(Array.from(trackedLabKey)).toEqual(new Array(32).fill(0));
    expect(Array.from(trackedPriv)).toEqual(new Array(64).fill(0));
    expect(Array.from(trackedPub)).toEqual(new Array(32).fill(0));
  });
});

// ---------------------------------------------------------------------------
// Controller: logout zeroes the keys
// ---------------------------------------------------------------------------

describe("createLabSessionController: logout zeroes the keys", () => {
  it("logout from live moves to locked and zeroes labKey + signing key bytes", async () => {
    const labKey = new Uint8Array(32).fill(0xaa);
    const signingKeyPair = makeSigningKeyPair();

    const ctrl = createLabSessionController({
      authenticate: vi.fn(async () => ({ email: "alice@example.com" })),
      unlockKeypair: vi.fn(async () => {}),
      openLabKey: vi.fn(async () => ({
        labId: "lab-logout",
        labKey,
        signingKeyPair,
        member: makeMember("lab-logout"),
      })),
      now: vi.fn(() => 0),
    });
    ctrl.start("lab");
    await ctrl.signIn("google");

    // Capture refs before zeroing.
    const trackedLabKey = labKey;
    const trackedPriv = signingKeyPair.ed25519Priv;
    const trackedPub = signingKeyPair.ed25519Pub;

    ctrl.logout();

    expect(ctrl.getState().kind).toBe("locked");
    expect(Array.from(trackedLabKey)).toEqual(new Array(32).fill(0));
    expect(Array.from(trackedPriv)).toEqual(new Array(64).fill(0));
    expect(Array.from(trackedPub)).toEqual(new Array(32).fill(0));
  });
});
