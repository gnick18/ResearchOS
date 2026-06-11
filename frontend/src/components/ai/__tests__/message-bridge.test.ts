// @vitest-environment jsdom
//
// Message bridge unit tests (ai beakersearch-v1 bot, 2026-06-11).
//
// Guards three properties the escalation flow depends on:
//   1. Register/unregister: registering makes isBeakerBotReady true; the
//      unregister guard prevents a stale cleanup from wiping a newer handler.
//   2. Direct delivery: sendToBeakerBot calls the registered function immediately
//      when one is registered.
//   3. Queue/flush: a message sent while no handler is registered is queued and
//      flushed as soon as one registers (the common cold-escalation path where
//      open() and sendToBeakerBot race the panel's first mount effect).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  setBeakerBotSend,
  sendToBeakerBot,
  isBeakerBotReady,
  registerBeakerBotSend,
  pendingBeakerBotMessage,
} from "../message-bridge";

// Reset module-level state before each test so they do not interfere.
function resetBridge(): void {
  setBeakerBotSend(null);
  // Drain any leftover queued message by registering, flushing, then clearing.
  if (pendingBeakerBotMessage() !== null) {
    const drain = vi.fn();
    setBeakerBotSend(drain);
    setBeakerBotSend(null);
  }
}

describe("message-bridge: register and ready flag", () => {
  beforeEach(resetBridge);

  it("isBeakerBotReady is false with no handler", () => {
    expect(isBeakerBotReady()).toBe(false);
  });

  it("registering a handler makes isBeakerBotReady true", () => {
    const off = registerBeakerBotSend(vi.fn());
    expect(isBeakerBotReady()).toBe(true);
    off();
    expect(isBeakerBotReady()).toBe(false);
  });

  it("unregister guard: late cleanup of an older handler does not clear a newer one", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerBeakerBotSend(a);
    // B registers (simulating a remount) before A's cleanup runs.
    const offB = registerBeakerBotSend(b);
    // A's cleanup must NOT wipe B.
    offA();
    expect(isBeakerBotReady()).toBe(true);
    offB();
    expect(isBeakerBotReady()).toBe(false);
  });
});

describe("message-bridge: direct delivery when handler is present", () => {
  beforeEach(resetBridge);

  it("delivers the message immediately to the registered send function", async () => {
    const fn = vi.fn();
    const off = registerBeakerBotSend(fn);
    await sendToBeakerBot("how many tasks do I have");
    expect(fn).toHaveBeenCalledWith("how many tasks do I have");
    expect(pendingBeakerBotMessage()).toBeNull();
    off();
  });

  it("uses the latest registered handler, not a stale one", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerBeakerBotSend(a);
    offA();
    const offB = registerBeakerBotSend(b);
    await sendToBeakerBot("open my notes");
    expect(b).toHaveBeenCalledWith("open my notes");
    expect(a).not.toHaveBeenCalled();
    offB();
  });
});

describe("message-bridge: queue and flush for cold escalation", () => {
  beforeEach(() => {
    resetBridge();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("queues the message when no handler is registered", () => {
    void sendToBeakerBot("summarize my lab notes");
    expect(pendingBeakerBotMessage()).toBe("summarize my lab notes");
    expect(isBeakerBotReady()).toBe(false);
  });

  it("flushes the queued message as soon as a handler registers", () => {
    void sendToBeakerBot("summarize my lab notes");
    expect(pendingBeakerBotMessage()).toBe("summarize my lab notes");

    const fn = vi.fn();
    const off = registerBeakerBotSend(fn);

    // The registration flushed the queue immediately through the handler.
    expect(fn).toHaveBeenCalledWith("summarize my lab notes");
    expect(pendingBeakerBotMessage()).toBeNull();
    off();
  });

  it("drops the queued message silently after the fallback window with no handler", () => {
    void sendToBeakerBot("search everything");
    expect(pendingBeakerBotMessage()).toBe("search everything");

    // No handler ever registers. The fallback timer fires and drops the message
    // without throwing or trying to hard-assign anything.
    vi.advanceTimersByTime(2500);
    expect(pendingBeakerBotMessage()).toBeNull();
  });

  it("setBeakerBotSend(fn) also flushes the queue on assignment", () => {
    void sendToBeakerBot("what is on my gantt");
    expect(pendingBeakerBotMessage()).toBe("what is on my gantt");

    const fn = vi.fn();
    setBeakerBotSend(fn);

    expect(fn).toHaveBeenCalledWith("what is on my gantt");
    expect(pendingBeakerBotMessage()).toBeNull();
    setBeakerBotSend(null);
  });
});
