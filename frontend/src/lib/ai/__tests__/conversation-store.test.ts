// @vitest-environment jsdom
//
// conversation-store unit tests (ai convo-store bot, 2026-06-11).
//
// Pins the persistent BeakerBot conversation store introduced in Phase 1 of
// the BeakerSearch v2 redesign. All model calls are injected via vi.mock so no
// real network and no real model are involved.
//
// Properties pinned:
//   1. send() appends a user message and an empty assistant placeholder, then
//      fills in the assistant content via the typewriter reveal.
//   2. The approval bridge resolves correctly: requestApproval pauses, the UI
//      calls resolveApproval("allow"), and the loop resumes with the answer.
//   3. resolveChoice resolves with the choice decision (kind "choice").
//   4. The double-resolve guard: resolving a second time on the same pending
//      object is a no-op (the first resolve already cleared the ref).
//   5. An empty model reply clears the placeholder and sets the error string.
//   6. The sending flag is true during the loop and false after.
//   7. clearConversation() resets messages, history, and counter.
//   8. Concurrent send() calls are blocked by the sending flag (only one loop
//      runs at a time).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  useConversationStore,
  resetConversationModule,
  getConversationHistory,
  clampPartialEmbed,
} from "../conversation-store";
import type { LoopMessage } from "../agent-loop";

// ---- module mocks -----------------------------------------------------------

// Type alias for the agent loop opts the mock receives.
type AgentLoopOpts = {
  messages: unknown[];
  callModel: (m: unknown[], t: unknown[]) => Promise<unknown>;
  tools: unknown[];
  requestApproval?: (r: unknown) => Promise<unknown>;
  onStatus?: (s: unknown) => void;
  getReviewMode?: () => string;
};

// Mock the agent loop. The default implementation calls opts.callModel and
// returns its choices[0].message.content as the answer, exactly like a real
// one-turn loop. Tests that need custom behavior override this with
// mockImplementationOnce().
vi.mock("../agent-loop", () => ({
  runAgentLoop: vi.fn(async (opts: AgentLoopOpts) => {
    const response = await opts.callModel(opts.messages, opts.tools);
    const r = response as { choices: [{ message: { content: string | null } }] };
    const answer = r.choices[0]?.message?.content ?? "";
    return {
      answer,
      messages: [...(opts.messages as LoopMessage[]), { role: "assistant", content: answer }],
      iterations: 1,
      stoppedOnGuard: false,
    };
  }),
}));

// Mock the proxy client. Tests override the mock implementation per-case.
vi.mock("../proxy-client", () => {
  const ProxyError = class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "ProxyError";
    }
  };
  return {
    callModelViaProxy: vi.fn(async () => ({
      choices: [{ message: { content: "default answer" } }],
    })),
    ProxyError,
  };
});

// Stub context-bridge so per-turn context is always empty (deterministic output).
vi.mock("@/components/ai/context-bridge", () => ({
  getBeakerContext: vi.fn(() => null),
  describeBeakerContext: vi.fn(() => null),
}));

// Stub spotlight (DOM side-effects not needed in unit tests).
vi.mock("@/components/ai/spotlight-controller", () => ({
  showSpotlight: vi.fn(),
  dismissSpotlight: vi.fn(),
}));

// Stub page-perception's resolveRef (no real DOM).
vi.mock("../page-perception", () => ({
  resolveRef: vi.fn(() => null),
}));

// Stub the chat persistence layer. The thread-aware send path calls createChat
// / saveChat, which would otherwise reach the FSA file service. We return a
// fake id so the create-on-first-send binding works without touching disk.
vi.mock("../beaker-chats-store", () => ({
  createChat: vi.fn(async (input: { title: string }) => ({
    id: 1,
    title: input.title,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
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

// Import mocked modules for use in tests.
import { callModelViaProxy } from "../proxy-client";
import { runAgentLoop } from "../agent-loop";

// ---- helpers ----------------------------------------------------------------

function jsonChoices(content: string | null) {
  return { choices: [{ message: { content } }] };
}

// Wait for async work and the typewriter setTimeout chain to complete.
async function flushAll(ms = 300) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---- setup ------------------------------------------------------------------

beforeEach(() => {
  resetConversationModule();
  vi.clearAllMocks();
});

afterEach(() => {
  resetConversationModule();
  vi.restoreAllMocks();
});

// ---- tests ------------------------------------------------------------------

describe("send: basic round-trip", () => {
  it("appends a user message and an empty assistant placeholder before the loop resolves", async () => {
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("Here is the answer.") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    const promise = useConversationStore.getState().send("what is a Tm?");

    // Messages seeded synchronously before await.
    const afterSeed = useConversationStore.getState().messages;
    expect(afterSeed).toHaveLength(2);
    expect(afterSeed[0].role).toBe("user");
    expect(afterSeed[0].content).toBe("what is a Tm?");
    expect(afterSeed[1].role).toBe("assistant");
    expect(afterSeed[1].content).toBe("");

    await promise;
    await flushAll();

    const final = useConversationStore.getState().messages;
    expect(final).toHaveLength(2);
    expect(final[1].content).toBe("Here is the answer.");
  });

  it("clears a prior error at the start of each send", async () => {
    useConversationStore.setState({ error: "prior error" });
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("ok") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("hello");
    await flushAll();

    expect(useConversationStore.getState().error).toBeNull();
  });

  it("sets sending=true during the loop and false after", async () => {
    let sendingDuringLoop = false;
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      sendingDuringLoop = useConversationStore.getState().sending;
      const response = await vi.mocked(callModelViaProxy)([], []);
      const r = response as { choices: [{ message: { content: string } }] };
      const answer = r.choices[0]?.message?.content ?? "";
      return {
        answer,
        messages: [...(opts.messages as LoopMessage[]), { role: "assistant", content: answer }],
        iterations: 1,
        stoppedOnGuard: false,
      };
    });
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("hi") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("hi");
    await flushAll();

    expect(sendingDuringLoop).toBe(true);
    expect(useConversationStore.getState().sending).toBe(false);
  });
});

describe("send: empty input is ignored", () => {
  it("does nothing for a blank string", async () => {
    await useConversationStore.getState().send("   ");
    expect(useConversationStore.getState().messages).toHaveLength(0);
    expect(runAgentLoop).not.toHaveBeenCalled();
  });
});

describe("send: concurrent guard", () => {
  it("blocks a second send while the first is in flight", async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstPromise = new Promise<unknown>((r) => { resolveFirst = r; });

    vi.mocked(runAgentLoop).mockImplementationOnce(async () => {
      await firstPromise;
      return { answer: "first", messages: [], iterations: 1, stoppedOnGuard: false };
    });

    const firstSend = useConversationStore.getState().send("first message");

    // While the first loop hangs, send a second — should be blocked.
    await useConversationStore.getState().send("second message");

    // Only the first message pair was added.
    expect(useConversationStore.getState().messages).toHaveLength(2);

    resolveFirst(null);
    await firstSend;
    await flushAll();
  });
});

describe("send: empty answer from model", () => {
  it("removes the placeholder and sets an error", async () => {
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("empty test");
    await flushAll();

    const state = useConversationStore.getState();
    // The empty placeholder was removed (no message with empty content).
    expect(state.messages.every((m) => m.content !== "")).toBe(true);
    // An error was set.
    expect(state.error).toMatch(/empty reply/i);
  });
});

describe("approval bridge: resolveApproval", () => {
  it("allows the loop to continue after the user clicks Allow", async () => {
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      if (opts.requestApproval) {
        const decisionPromise = opts.requestApproval({
          kind: "action",
          toolName: "do_thing",
          summary: "do the thing",
          ref: undefined,
          destructive: false,
        });
        // Simulate the user clicking Allow.
        useConversationStore.getState().resolveApproval("allow");
        const decision = await decisionPromise;
        expect(decision).toBe("allow");
      }
      return {
        answer: "done",
        messages: [...(opts.messages as LoopMessage[]), { role: "assistant", content: "done" }],
        iterations: 1,
        stoppedOnGuard: false,
      };
    });

    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("done") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("do the thing");
    await flushAll();

    const state = useConversationStore.getState();
    expect(state.pendingApproval).toBeNull();
    expect(state.messages.some((m) => m.content === "done")).toBe(true);
  });
});

describe("approval bridge: resolveChoice", () => {
  it("resolves the in-flight promise with a ChoiceDecision", async () => {
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      if (opts.requestApproval) {
        const decisionPromise = opts.requestApproval({
          kind: "choice",
          toolName: "ask_user",
          question: "Which group?",
          options: ["A", "B"],
          select: "one",
        });
        // Simulate the user tapping option A.
        useConversationStore.getState().resolveChoice(["A"], false);
        const decision = await decisionPromise;
        const d = decision as { kind: string; selected: string[]; cancelled: boolean };
        expect(d.kind).toBe("choice");
        expect(d.selected).toEqual(["A"]);
        expect(d.cancelled).toBe(false);
      }
      return {
        answer: "chose A",
        messages: [...(opts.messages as LoopMessage[]), { role: "assistant", content: "chose A" }],
        iterations: 1,
        stoppedOnGuard: false,
      };
    });

    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("chose A") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("pick for me");
    await flushAll();

    expect(useConversationStore.getState().pendingApproval).toBeNull();
  });
});

describe("approval bridge: double-resolve guard", () => {
  it("a second resolveApproval on the same pending is silently ignored", async () => {
    let resolveCount = 0;
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      if (opts.requestApproval) {
        const decisionPromise = opts.requestApproval({
          kind: "action",
          toolName: "do_thing",
          summary: "do it",
          ref: undefined,
          destructive: false,
        });
        useConversationStore.getState().resolveApproval("allow");
        resolveCount++;
        // Second call: the ref was already cleared, so this is a no-op.
        useConversationStore.getState().resolveApproval("skip");
        resolveCount++;
        await decisionPromise;
      }
      return {
        answer: "ok",
        messages: [...(opts.messages as LoopMessage[]), { role: "assistant", content: "ok" }],
        iterations: 1,
        stoppedOnGuard: false,
      };
    });

    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("ok") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("test double resolve");
    await flushAll();

    // Both calls ran without throwing; the guard was silent.
    expect(resolveCount).toBe(2);
    expect(useConversationStore.getState().pendingApproval).toBeNull();
  });
});

describe("clearConversation", () => {
  it("resets messages, history, and error", async () => {
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("hi there") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );
    await useConversationStore.getState().send("hello");
    await flushAll();

    expect(useConversationStore.getState().messages).toHaveLength(2);
    expect(getConversationHistory().length).toBeGreaterThan(0);

    useConversationStore.getState().clearConversation();

    expect(useConversationStore.getState().messages).toHaveLength(0);
    expect(getConversationHistory()).toHaveLength(0);
    expect(useConversationStore.getState().error).toBeNull();
    expect(useConversationStore.getState().pendingApproval).toBeNull();
  });
});

describe("clampPartialEmbed (typewriter does not flash a half-formed link)", () => {
  it("hides a link whose url is still being typed", () => {
    expect(clampPartialEmbed("See the plot [Bar chart](/datahub?doc=1#ros=plot&plo")).toBe(
      "See the plot ",
    );
  });

  it("hides a link whose label bracket is still open", () => {
    expect(clampPartialEmbed("Here it is [Bar char")).toBe("Here it is ");
  });

  it("shows a complete link untouched", () => {
    const full = "Done [Bar chart](/datahub?doc=1#ros=plot)";
    expect(clampPartialEmbed(full)).toBe(full);
  });

  it("leaves prose that merely contains a closed bracket", () => {
    expect(clampPartialEmbed("As shown in ref [1] above")).toBe(
      "As shown in ref [1] above",
    );
  });

  it("returns text with no bracket unchanged", () => {
    expect(clampPartialEmbed("just some prose")).toBe("just some prose");
  });
});
