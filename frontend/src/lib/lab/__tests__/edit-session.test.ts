import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  endEditSession,
  formatRemaining,
  getEditSession,
  isUnlockedFor,
  resetEditSession,
  SESSION_DURATION_MS,
  startEditSession,
  subscribeEditSession,
} from "../edit-session";

describe("edit-session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetEditSession();
  });

  afterEach(() => {
    resetEditSession();
    vi.useRealTimers();
  });

  it("starts idle", () => {
    expect(getEditSession().state).toBe("idle");
    expect(getEditSession().active).toBeNull();
  });

  it("transitions idle → unlocked on startEditSession with a fresh session id", () => {
    const meta = startEditSession("mira");
    const snap = getEditSession();
    expect(snap.state).toBe("unlocked");
    expect(snap.active?.username).toBe("mira");
    expect(snap.active?.id).toBe(meta.id);
    expect(snap.remainingMs).toBeGreaterThan(0);
    expect(snap.remainingMs).toBeLessThanOrEqual(SESSION_DURATION_MS);
  });

  it("isUnlockedFor matches the active user only", () => {
    startEditSession("mira");
    expect(isUnlockedFor("mira")).toBe(true);
    expect(isUnlockedFor("alex")).toBe(false);
    expect(isUnlockedFor(null)).toBe(true); // any-session check
  });

  it("manual endEditSession transitions to locked", () => {
    startEditSession("mira");
    endEditSession();
    const snap = getEditSession();
    expect(snap.state).toBe("locked");
    expect(snap.active).toBeNull();
  });

  it("auto-expires after SESSION_DURATION_MS", () => {
    startEditSession("mira");
    expect(getEditSession().state).toBe("unlocked");
    vi.advanceTimersByTime(SESSION_DURATION_MS + 1000);
    const snap = getEditSession();
    expect(snap.state).toBe("locked");
    expect(snap.active).toBeNull();
    expect(snap.remainingMs).toBe(0);
  });

  it("ticks the remaining time each second", () => {
    startEditSession("mira");
    const initial = getEditSession().remainingMs;
    vi.advanceTimersByTime(1000);
    expect(getEditSession().remainingMs).toBeLessThan(initial);
  });

  it("notifies subscribers on each tick and on transitions", () => {
    const events: string[] = [];
    const unsub = subscribeEditSession((s) => events.push(s.state));
    // initial fire
    expect(events).toEqual(["idle"]);
    startEditSession("mira");
    expect(events.at(-1)).toBe("unlocked");
    vi.advanceTimersByTime(1000);
    expect(events.filter((e) => e === "unlocked").length).toBeGreaterThan(1);
    endEditSession();
    expect(events.at(-1)).toBe("locked");
    unsub();
  });

  it("resetEditSession returns to idle (distinct from locked)", () => {
    startEditSession("mira");
    endEditSession();
    expect(getEditSession().state).toBe("locked");
    resetEditSession();
    expect(getEditSession().state).toBe("idle");
  });

  it("generates a distinct session id per unlock", () => {
    const a = startEditSession("mira");
    endEditSession();
    const b = startEditSession("mira");
    expect(b.id).not.toBe(a.id);
  });

  it("resetEditSession clears an UNLOCKED session on user switch (P0 #1 bleed)", () => {
    // Mira-Distracted P0 #1 regression guard (2026-05-23): without the
    // hook into setCurrentUser / disconnect in FileSystemProvider, the
    // module singleton stays state: "unlocked" while the AppShell
    // re-renders with a new actor. Verify reset drops the session
    // synchronously so the next read returns locked + no active user.
    startEditSession("mira");
    expect(getEditSession().state).toBe("unlocked");
    expect(isUnlockedFor("mira")).toBe(true);

    // Simulate the user-switch hook calling resetEditSession() before
    // committing the new user.
    resetEditSession();

    const snap = getEditSession();
    expect(snap.state).toBe("idle");
    expect(snap.active).toBeNull();
    expect(snap.remainingMs).toBe(0);
    // Critical: isUnlockedFor MUST return false for the prior user so
    // popup write-gating closes immediately and audit attribution can't
    // pin a write on the user who walked away.
    expect(isUnlockedFor("mira")).toBe(false);
    expect(isUnlockedFor("alex")).toBe(false);
  });

  it("formats remaining time as M:SS", () => {
    expect(formatRemaining(300_000)).toBe("5:00");
    expect(formatRemaining(65_000)).toBe("1:05");
    expect(formatRemaining(9_000)).toBe("0:09");
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-1)).toBe("0:00");
  });
});
