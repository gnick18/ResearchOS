// @vitest-environment jsdom
//
// BeakerBot escalation single-thread guard (ai dup-thread bot, 2026-06-13).
//
// Pins the property behind the "duplicate chat on a single send" report: ONE
// escalation from the BeakerSearch palette must create exactly ONE persisted
// chat thread, even when React double-invokes mount effects under StrictMode
// (the dev-only behavior Next enables by default, off in production builds).
//
// The report came from a dev server (reactStrictMode defaults to true in dev,
// next.config.ts sets no override). StrictMode double-mounts the bridge that
// registers the store's send. This test wires the REAL message bridge to the
// REAL conversation store (createChat mocked to count threads) and fires a
// single escalation under:
//   1. a normal mount (the prod-equivalent path, StrictMode off),
//   2. a StrictMode double-mount (the dev path),
//   3. a COLD escalation (queued before the bridge mounts) under StrictMode,
//      the most double-prone path because the queue is flushed on registration
//      and StrictMode registers twice.
// In all three, createChat must fire exactly once. The guard is that flushQueue
// clears the queued message before delivering, and the send() sending-flag guard
// plus the create-on-first-message binding are idempotent. If a future change
// reintroduces a double-delivery, this test fails.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import React, { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

// ---- module mocks (mirror conversation-store.test.ts) -----------------------

type AgentLoopOpts = {
  messages: unknown[];
  callModel: (m: unknown[], t: unknown[]) => Promise<unknown>;
  tools: unknown[];
};

vi.mock("@/lib/ai/agent-loop", () => ({
  runAgentLoop: vi.fn(async (opts: AgentLoopOpts) => {
    const response = await opts.callModel(opts.messages, opts.tools);
    const r = response as { choices: [{ message: { content: string | null } }] };
    const answer = r.choices[0]?.message?.content ?? "";
    return {
      answer,
      messages: [...opts.messages, { role: "assistant", content: answer }],
      iterations: 1,
      stoppedOnGuard: false,
      totalUsage: { promptTokens: 0, completionTokens: 0 },
    };
  }),
}));

vi.mock("@/lib/ai/proxy-client", () => {
  const ProxyError = class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "ProxyError";
    }
  };
  return {
    callModelViaProxy: vi.fn(async () => ({
      choices: [{ message: { content: "ok" } }],
    })),
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

vi.mock("@/lib/ai/page-perception", () => ({
  resolveRef: vi.fn(() => null),
}));

vi.mock("@/lib/ai/user-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/user-memory")>();
  return {
    ...actual,
    getMemoryEntries: vi.fn(async () => []),
    buildMemoryContext: vi.fn(() => null),
  };
});

// The thread-persistence layer. createChat is the deterministic "one thread was
// created" signal: send() calls it once on the first user message of a fresh
// conversation, regardless of whether the model responds.
vi.mock("@/lib/ai/beaker-chats-store", () => ({
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

// ---- real modules under test ------------------------------------------------

import { useConversationStore, resetConversationModule } from "@/lib/ai/conversation-store";
import {
  sendToBeakerBot,
  setBeakerBotSend,
  useBeakerBotMessageBridge,
  pendingBeakerBotMessage,
  isBeakerBotReady,
} from "@/components/ai/message-bridge";
import { createChat } from "@/lib/ai/beaker-chats-store";

// Mirrors BeakerBotBridges: registers the store's stable send action into the
// bridge. Mounting this under StrictMode reproduces the dev double-mount.
function BridgeHarness() {
  useBeakerBotMessageBridge(useConversationStore.getState().send);
  return null;
}

// Wait for the async send() and its typewriter setTimeout chain to settle.
async function flushAll(ms = 300): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function resetBridge(): void {
  setBeakerBotSend(null);
  // Drain any leftover queued message so a prior test cannot bleed into this one.
  if (pendingBeakerBotMessage() !== null) {
    setBeakerBotSend(vi.fn());
    setBeakerBotSend(null);
  }
}

beforeEach(() => {
  resetConversationModule();
  resetBridge();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  resetConversationModule();
  resetBridge();
  vi.restoreAllMocks();
});

describe("BeakerBot escalation: one submit creates one thread", () => {
  it("normal mount (prod-equivalent, StrictMode off): a single escalation creates exactly one thread", async () => {
    render(<BridgeHarness />);
    expect(isBeakerBotReady()).toBe(true);

    await act(async () => {
      await sendToBeakerBot("count my experiments");
      await flushAll();
    });

    expect(vi.mocked(createChat)).toHaveBeenCalledTimes(1);
    expect(useConversationStore.getState().currentThreadId).toBe(1);
  });

  it("StrictMode double-mount (dev path): a single escalation still creates exactly one thread", async () => {
    render(
      <StrictMode>
        <BridgeHarness />
      </StrictMode>,
    );
    expect(isBeakerBotReady()).toBe(true);

    await act(async () => {
      await sendToBeakerBot("count my notes");
      await flushAll();
    });

    // The double-mount registers the send twice but delivers once: this is the
    // assertion that the reported dev duplicate is not a real double-create.
    expect(vi.mocked(createChat)).toHaveBeenCalledTimes(1);
    expect(useConversationStore.getState().currentThreadId).toBe(1);
  });

  it("cold escalation queued before a StrictMode mount flushes exactly once", async () => {
    // Escalate while no handler is registered: the message is queued.
    let pending: Promise<void>;
    act(() => {
      pending = sendToBeakerBot("summarize my purchases");
    });
    expect(pendingBeakerBotMessage()).toBe("summarize my purchases");

    // Mount the bridge under StrictMode. Registration flushes the queue, and the
    // double-mount must NOT flush it twice (flushQueue clears the slot first).
    render(
      <StrictMode>
        <BridgeHarness />
      </StrictMode>,
    );

    await act(async () => {
      await pending;
      await flushAll();
    });

    expect(vi.mocked(createChat)).toHaveBeenCalledTimes(1);
    expect(useConversationStore.getState().currentThreadId).toBe(1);
  });
});
