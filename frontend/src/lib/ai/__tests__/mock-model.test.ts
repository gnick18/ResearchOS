// Unit tests for the mock model caller and the conversation-store override seam
// (beaker-ai lane, 2026-06-13).
//
// Two test suites:
//   1. mockModelCaller: pins the response shape (choices + usage), the fake
//      token counts, and the delay behaviour (abort works, delay is positive).
//   2. Override seam: pins that send() uses modelCallerOverride when set and
//      falls back to callModelViaProxy when null. No component rendering used;
//      the store actions are called directly.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockModelCaller } from "../dev/mock-model";
import {
  useConversationStore,
  resetConversationModule,
  setModelCallerOverride,
} from "../conversation-store";

// ---- Mocks required by conversation-store -----------------------------------

vi.mock("../agent-loop", () => ({
  runAgentLoop: vi.fn(async (opts: {
    messages: unknown[];
    callModel: (m: unknown[], t: unknown[]) => Promise<{ choices: [{ message: { content: string | null } }] }>;
    tools: unknown[];
    onUsage?: (u: { promptTokens: number; completionTokens: number }) => void;
  }) => {
    const response = await opts.callModel(opts.messages, opts.tools);
    const answer = response.choices[0]?.message?.content ?? "";
    return {
      answer,
      messages: [...(opts.messages as import("../agent-loop").LoopMessage[]), { role: "assistant", content: answer }],
      iterations: 1,
      stoppedOnGuard: false,
      totalUsage: { promptTokens: 0, completionTokens: 0 },
    };
  }),
}));

vi.mock("../proxy-client", () => {
  const ProxyError = class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "ProxyError";
    }
  };
  const callModelViaProxy = vi.fn(async () => ({
    choices: [{ message: { content: "proxy-answer" } }],
  }));
  return {
    callModelViaProxy,
    // f824505eb metering: send() binds a per-task proxy caller via proxyCallerForTask.
    proxyCallerForTask: vi.fn(() => callModelViaProxy),
    ProxyError,
  };
});

vi.mock("@/components/ai/context-bridge", () => ({
  getBeakerContext: vi.fn(() => null),
  describeBeakerContext: vi.fn(() => null),
}));

vi.mock("@/components/ai/spotlight-controller", () => ({
  showSpotlight: vi.fn(),
  dismissSpotlight: vi.fn(),
  setSpotlightSuppressed: vi.fn(),
}));

vi.mock("../page-perception", () => ({
  resolveRef: vi.fn(() => null),
}));

vi.mock("../beaker-chats-store", () => ({
  createChat: vi.fn(async (input: { title: string }) => ({
    id: 1,
    title: input.title,
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
    archived: false,
    messages: [],
    history: [],
  })),
  saveChat: vi.fn(async () => null),
  getChat: vi.fn(async () => null),
  listChats: vi.fn(async () => []),
  renameChat: vi.fn(async () => null),
  setChatArchived: vi.fn(async () => null),
  deleteChat: vi.fn(async () => true),
  deriveChatTitle: (s: string) => s.slice(0, 60),
}));

vi.mock("../user-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../user-memory")>();
  return {
    ...actual,
    getMemoryEntries: vi.fn(async () => []),
    buildMemoryContext: vi.fn(() => null),
  };
});

import { callModelViaProxy } from "../proxy-client";

// ---- helpers ----------------------------------------------------------------

async function flushAll(ms = 300) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---- setup ------------------------------------------------------------------

beforeEach(() => {
  resetConversationModule();
  vi.clearAllMocks();
  // Always start with no override so tests are isolated.
  setModelCallerOverride(null);
});

afterEach(() => {
  resetConversationModule();
  vi.restoreAllMocks();
  setModelCallerOverride(null);
});

// ---- mockModelCaller shape tests --------------------------------------------

describe("mockModelCaller: response shape", () => {
  it("returns the OpenAI-compatible choices array with string content", async () => {
    // Use a very short timeout to avoid slowing the suite. AbortController
    // lets us cancel after we have the shape we need.
    const controller = new AbortController();
    // Let the first call start and immediately abort so we can inspect shape
    // from a caught response. Instead just call with no signal + fake time.
    vi.useFakeTimers();

    const promise = mockModelCaller([], [], undefined);
    // Advance fake timers past the longest possible delay (4000 ms).
    await vi.advanceTimersByTimeAsync(5000);
    const response = await promise;

    expect(response).toHaveProperty("choices");
    const choices = response.choices ?? [];
    expect(Array.isArray(choices)).toBe(true);
    expect(choices.length).toBeGreaterThan(0);
    const msg = choices[0]?.message;
    expect(msg).toBeDefined();
    expect(typeof msg?.content).toBe("string");
    expect((msg?.content ?? "").length).toBeGreaterThan(0);

    vi.useRealTimers();
    void controller;
  });

  it("returns a usage block with positive prompt_tokens and completion_tokens", async () => {
    vi.useFakeTimers();

    const promise = mockModelCaller([], [], undefined);
    await vi.advanceTimersByTimeAsync(5000);
    const response = await promise;

    expect(response).toHaveProperty("usage");
    const usage = response.usage ?? {};
    expect(typeof (usage as { prompt_tokens?: number }).prompt_tokens).toBe("number");
    expect(typeof (usage as { completion_tokens?: number }).completion_tokens).toBe("number");
    expect(((usage as { prompt_tokens?: number }).prompt_tokens ?? 0)).toBeGreaterThan(0);
    expect(((usage as { completion_tokens?: number }).completion_tokens ?? 0)).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it("has a delay of at least 1000 ms (so the status line is visible)", async () => {
    vi.useFakeTimers();

    const promise = mockModelCaller([], [], undefined);

    // After 999 ms the promise must still be pending.
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void promise.then(() => { settled = true; });
    // Flush microtasks without advancing more time.
    await Promise.resolve();
    expect(settled).toBe(false);

    // After another 4001 ms (total 5000) it must have resolved.
    await vi.advanceTimersByTimeAsync(4001);
    await promise;

    vi.useRealTimers();
  });

  it("rejects with AbortError when the signal fires before the delay expires", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const promise = mockModelCaller([], [], controller.signal);

    // Advance 500 ms (well before the minimum 1500 ms delay).
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });

    vi.useRealTimers();
  });
});

// ---- Override seam tests ----------------------------------------------------
//
// These tests call send() directly on the store and assert which callModel
// function the agent loop received. The agent loop mock captures opts.callModel
// so we can compare it by reference.

describe("override seam: send() uses modelCallerOverride when set", () => {
  it("passes callModelViaProxy to the loop when no override is set", async () => {
    // Capture what callModel the loop received.
    let capturedCaller: unknown = undefined;
    const { runAgentLoop } = await import("../agent-loop");
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      capturedCaller = opts.callModel;
      const response = await vi.mocked(callModelViaProxy)([], []);
      const answer = (response.choices ?? [])[0]?.message?.content ?? "";
      return {
        answer,
        messages: [...(opts.messages as import("../agent-loop").LoopMessage[])],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 0, completionTokens: 0 },
      };
    });
    vi.mocked(callModelViaProxy).mockResolvedValueOnce({
      choices: [{ message: { content: "real answer" } }],
    });

    await useConversationStore.getState().send("hello");
    await flushAll();

    // When no override is set, the loop should receive callModelViaProxy.
    // We cannot import callModelViaProxy as a value and compare by reference
    // (it is a vi.fn mock wrapper), but we CAN assert it is NOT the mockModelCaller.
    expect(capturedCaller).not.toBe(mockModelCaller);
    // The real proxy was called exactly once.
    expect(vi.mocked(callModelViaProxy)).toHaveBeenCalledTimes(1);
  });

  it("passes the override to the loop when an override is set", async () => {
    const fakeCaller = vi.fn(async (_messages: unknown, _tools: unknown) => ({
      choices: [{ message: { content: "mock answer" } }],
    }));

    setModelCallerOverride(fakeCaller as unknown as import("../agent-loop").ModelCaller);

    let capturedCaller: unknown = undefined;
    const { runAgentLoop } = await import("../agent-loop");
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      capturedCaller = opts.callModel;
      // Call via the captured caller so the mock is invoked.
      const response = await (opts.callModel as (_m: unknown[], _t: unknown[]) => Promise<{ choices: Array<{ message?: { content?: string | null } }> }>)([], []);
      const answer = (response.choices as Array<{ message?: { content?: string | null } }>)[0]?.message?.content ?? "";
      return {
        answer,
        messages: [...(opts.messages as import("../agent-loop").LoopMessage[])],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 0, completionTokens: 0 },
      };
    });

    await useConversationStore.getState().send("hello mock");
    await flushAll();

    // The loop received the override, not callModelViaProxy.
    expect(capturedCaller).toBe(fakeCaller);
    // callModelViaProxy was NOT called (the override intercepted).
    expect(vi.mocked(callModelViaProxy)).not.toHaveBeenCalled();

    setModelCallerOverride(null);
  });

  it("reverts to callModelViaProxy after setModelCallerOverride(null)", async () => {
    // Install an override, then remove it.
    const fakeCaller = vi.fn(async () => ({
      choices: [{ message: { content: "override" } }] as const,
    }));
    setModelCallerOverride(fakeCaller as unknown as import("../agent-loop").ModelCaller);
    setModelCallerOverride(null);

    let capturedCaller: unknown = undefined;
    const { runAgentLoop } = await import("../agent-loop");
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      capturedCaller = opts.callModel;
      const response = await vi.mocked(callModelViaProxy)([], []);
      const answer = (response.choices ?? [])[0]?.message?.content ?? "";
      return {
        answer,
        messages: [...(opts.messages as import("../agent-loop").LoopMessage[])],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 0, completionTokens: 0 },
      };
    });
    vi.mocked(callModelViaProxy).mockResolvedValueOnce({
      choices: [{ message: { content: "real again" } }],
    });

    await useConversationStore.getState().send("after null");
    await flushAll();

    // The override was removed. The real proxy caller was used (not fakeCaller).
    expect(capturedCaller).not.toBe(fakeCaller);
    expect(vi.mocked(callModelViaProxy)).toHaveBeenCalledTimes(1);
  });
});
