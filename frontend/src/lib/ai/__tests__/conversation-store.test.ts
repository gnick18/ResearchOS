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
  getPendingQueuedText,
  clampPartialEmbed,
  extractFollowups,
  reviewModeDirective,
  todayContext,
} from "../conversation-store";
import type { LoopMessage, LoopStatus } from "../agent-loop";

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
      totalUsage: { promptTokens: 0, completionTokens: 0 },
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

// Stub user-memory so tests are not file-system-dependent. Default: no entries
// (the memory message is absent, deterministic). Individual tests can override
// getMemoryEntries via mockResolvedValueOnce to exercise the injection path.
vi.mock("../user-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../user-memory")>();
  return {
    ...actual,
    getMemoryEntries: vi.fn(async () => []),
    buildMemoryContext: vi.fn(
      (entries: { text: string }[]) =>
        entries.length > 0
          ? `USER PREFERENCES (apply these by default, do not repeat them back unless asked):\n${entries.map((e) => `- ${e.text}`).join("\n")}`
          : null,
    ),
  };
});

// Import mocked modules for use in tests.
import { callModelViaProxy } from "../proxy-client";
import { runAgentLoop } from "../agent-loop";
import { getMemoryEntries } from "../user-memory";

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
        totalUsage: { promptTokens: 0, completionTokens: 0 },
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

describe("send: concurrent guard now queues instead of dropping", () => {
  it("queues a second send while the first is in flight", async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstPromise = new Promise<unknown>((r) => { resolveFirst = r; });

    vi.mocked(runAgentLoop).mockImplementationOnce(async () => {
      await firstPromise;
      return { answer: "first", messages: [], iterations: 1, stoppedOnGuard: false, totalUsage: { promptTokens: 0, completionTokens: 0 } };
    });

    const firstSend = useConversationStore.getState().send("first message");

    // While the first loop hangs, send a second -- it should be queued, not dropped.
    await useConversationStore.getState().send("second message");

    // Only the first message pair is in the visible transcript right now.
    expect(useConversationStore.getState().messages).toHaveLength(2);
    // The second message is queued.
    expect(getPendingQueuedText()).toBe("second message");
    expect(useConversationStore.getState().queuedText).toBe("second message");

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
        totalUsage: { promptTokens: 0, completionTokens: 0 },
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
        totalUsage: { promptTokens: 0, completionTokens: 0 },
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
        totalUsage: { promptTokens: 0, completionTokens: 0 },
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

describe("extractFollowups (followup chips parser/stripper)", () => {
  it("parses up to 3 pipe-delimited suggestions and strips the comment", () => {
    const text = "Here is the answer.\n<!-- followups: Summarize notes | Run t-test | Make a chart -->";
    const { stripped, followups } = extractFollowups(text);
    expect(stripped).toBe("Here is the answer.");
    expect(followups).toEqual(["Summarize notes", "Run t-test", "Make a chart"]);
  });

  it("strips the comment even when malformed (no suggestions)", () => {
    const text = "Answer.<!-- followups: -->";
    const { stripped, followups } = extractFollowups(text);
    expect(stripped).toBe("Answer.");
    expect(followups).toHaveLength(0);
  });

  it("caps suggestions at 3 even when more are given", () => {
    const text = "Answer.<!-- followups: A | B | C | D | E -->";
    const { followups } = extractFollowups(text);
    expect(followups).toHaveLength(3);
    expect(followups).toEqual(["A", "B", "C"]);
  });

  it("uses the last directive when there are duplicates", () => {
    const text = "<!-- followups: Old --> prose <!-- followups: New -->";
    const { followups } = extractFollowups(text);
    expect(followups).toEqual(["New"]);
  });

  it("trims whitespace from each suggestion", () => {
    const text = "Answer.<!-- followups:  Summarize  |  Run test  -->";
    const { followups } = extractFollowups(text);
    expect(followups).toEqual(["Summarize", "Run test"]);
  });

  it("returns unchanged text and no followups when no directive is present", () => {
    const text = "Just a plain answer.";
    const { stripped, followups } = extractFollowups(text);
    expect(stripped).toBe(text);
    expect(followups).toHaveLength(0);
  });
});

describe("reviewModeDirective (the model is told the active review mode)", () => {
  it("tells whole-plan mode to propose one plan up front", () => {
    const d = reviewModeDirective("plan");
    expect(d).toContain("whole-plan");
    expect(d).toContain("propose_plan ONCE");
    expect(d).toContain("overrides");
  });

  it("tells step-by-step mode not to propose_plan for self-gating tools", () => {
    const d = reviewModeDirective("step");
    expect(d).toContain("step-by-step");
    expect(d).toContain("Do not call propose_plan");
  });
});

describe("todayContext (the model is told today's date + weekday)", () => {
  it("formats the date and weekday so relative dates resolve", () => {
    // Friday 2026-06-12. "next Monday" must resolve to 2026-06-15, not Sunday.
    const c = todayContext(new Date(2026, 5, 12));
    expect(c).toContain("2026-06-12");
    expect(c).toContain("Friday");
    expect(c).toContain("relative date");
  });

  it("zero-pads month and day", () => {
    const c = todayContext(new Date(2026, 0, 5));
    expect(c).toContain("2026-01-05");
  });
});

// ---- Bug 2 regression: queue-while-streaming --------------------------------
//
// send() while sending=true must queue the text and auto-fire it once the
// running turn finishes. stop() must discard the queue so an explicit cancel
// does not trigger the queued send.

// Helper: make a loop mock that hangs until a barrier promise resolves, then
// returns a fixed answer string. Does NOT use callModelViaProxy so results are
// independent of that mock's queue state.
type LoopMsg = import("../agent-loop").LoopMessage;
function makeBarrierLoop(barrier: Promise<void>, answer: string) {
  return vi.fn(async (opts: Parameters<typeof import("../agent-loop").runAgentLoop>[0]) => {
    await barrier;
    return {
      answer,
      messages: [...(opts.messages as LoopMsg[]), { role: "assistant" as const, content: answer }],
      iterations: 1,
      stoppedOnGuard: false,
      totalUsage: { promptTokens: 0, completionTokens: 0 },
    };
  });
}

function makeInstantLoop(answer: string) {
  return vi.fn(async (opts: Parameters<typeof import("../agent-loop").runAgentLoop>[0]) => ({
    answer,
    messages: [...(opts.messages as LoopMsg[]), { role: "assistant" as const, content: answer }],
    iterations: 1,
    stoppedOnGuard: false,
    totalUsage: { promptTokens: 0, completionTokens: 0 },
  }));
}

describe("Bug 2 regression: message queue while streaming", () => {
  it("queues a message sent during an in-flight turn and fires it after", async () => {
    let resolveFirst!: () => void;
    const firstLoopBarrier = new Promise<void>((r) => { resolveFirst = r; });

    // First loop hangs until we release it, second fires immediately.
    vi.mocked(runAgentLoop)
      .mockImplementationOnce(makeBarrierLoop(firstLoopBarrier, "first reply"))
      .mockImplementationOnce(makeInstantLoop("second reply"));

    // Start the first send (will hang at the loop barrier).
    const firstSend = useConversationStore.getState().send("first question");

    // Queue a second message while the first is in flight.
    await useConversationStore.getState().send("queued question");

    // The second message should be in the queue, not yet in the transcript.
    expect(getPendingQueuedText()).toBe("queued question");
    expect(useConversationStore.getState().queuedText).toBe("queued question");
    // Only the first user message and its empty assistant bubble are visible.
    expect(useConversationStore.getState().messages).toHaveLength(2);

    // Release the first loop.
    resolveFirst();
    await firstSend;
    // Wait for the queued send to auto-fire and complete.
    await flushAll(600);

    // Both turns should now be in the transcript.
    const finalMessages = useConversationStore.getState().messages;
    expect(finalMessages.length).toBe(4);
    expect(finalMessages[0].content).toBe("first question");
    expect(finalMessages[1].content).toBe("first reply");
    expect(finalMessages[2].content).toBe("queued question");
    expect(finalMessages[3].content).toBe("second reply");

    // Queue must be clear after the auto-fire.
    expect(getPendingQueuedText()).toBeNull();
    expect(useConversationStore.getState().queuedText).toBeNull();
  });

  it("stop() discards the queue so the queued send does not auto-fire", async () => {
    let resolveFirst!: () => void;
    const firstLoopBarrier = new Promise<void>((r) => { resolveFirst = r; });

    // The first loop hangs; when released it sees the abort signal and will
    // return an empty answer (simulating how runAgentLoop handles abort).
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      await firstLoopBarrier;
      // Simulate the loop detecting the abort: return empty answer.
      return {
        answer: "",
        messages: [...(opts.messages as LoopMsg[])],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 0, completionTokens: 0 },
      };
    });

    const firstSend = useConversationStore.getState().send("first question");

    // Queue a message while the first is in flight.
    await useConversationStore.getState().send("queued question");
    expect(getPendingQueuedText()).toBe("queued question");

    // User clicks Stop -- this must discard the queue.
    const emptyAssistantId = useConversationStore
      .getState()
      .messages.find((m) => m.role === "assistant" && m.content === "")?.id;
    useConversationStore.getState().stop(emptyAssistantId);
    expect(getPendingQueuedText()).toBeNull();
    expect(useConversationStore.getState().queuedText).toBeNull();

    // Release the first loop.
    resolveFirst();
    await firstSend;
    await flushAll(400);

    // The queued send must NOT have fired.
    const finalMessages = useConversationStore.getState().messages;
    const queuedFired = finalMessages.some((m) => m.content === "queued question");
    expect(queuedFired).toBe(false);
    // runAgentLoop should only have been called once.
    expect(vi.mocked(runAgentLoop)).toHaveBeenCalledTimes(1);
  });

  it("latest queued text replaces earlier queued text (single-slot)", async () => {
    let resolveFirst!: () => void;
    const barrier = new Promise<void>((r) => { resolveFirst = r; });

    vi.mocked(runAgentLoop)
      .mockImplementationOnce(makeBarrierLoop(barrier, "ok"))
      .mockImplementationOnce(makeInstantLoop("ok2"));

    const firstSend = useConversationStore.getState().send("first");
    // Queue two messages in succession -- second replaces first.
    await useConversationStore.getState().send("early queued");
    await useConversationStore.getState().send("later queued");

    expect(getPendingQueuedText()).toBe("later queued");

    resolveFirst();
    await firstSend;
    await flushAll(600);

    // Only "later queued" should have fired, not "early queued".
    const texts = useConversationStore.getState().messages.map((m) => m.content);
    expect(texts.includes("later queued")).toBe(true);
    expect(texts.includes("early queued")).toBe(false);
  });

  it("a new chat drops a queued message so it never fires into the fresh chat", async () => {
    let resolveFirst!: () => void;
    const barrier = new Promise<void>((r) => { resolveFirst = r; });

    vi.mocked(runAgentLoop)
      .mockImplementationOnce(makeBarrierLoop(barrier, "ok"))
      .mockImplementationOnce(makeInstantLoop("ok2"));

    const firstSend = useConversationStore.getState().send("first");
    // Queue a message while the first turn is in flight.
    await useConversationStore.getState().send("stale queued");
    expect(getPendingQueuedText()).toBe("stale queued");

    // The user starts a fresh chat before the in-flight turn settles.
    useConversationStore.getState().newChat();
    expect(getPendingQueuedText()).toBeNull();

    // Release the first loop; its finally must not fire the stale queued send
    // into the new conversation (the bug: a queued "remember ..." re-triggering
    // on a new chat).
    resolveFirst();
    await firstSend;
    await flushAll(400);

    const texts = useConversationStore.getState().messages.map((m) => m.content);
    expect(texts.includes("stale queued")).toBe(false);
    expect(vi.mocked(runAgentLoop)).toHaveBeenCalledTimes(1);
  });
});

// ---- Memory injection: no accumulation across sends -------------------------
//
// The memory system message is a per-turn inject that must be stripped from
// historyStore before persist, exactly like contextMessage. This section pins
// that guarantee: after N sends, historyStore must contain at most one memory
// system message (the base prompt) and zero extra memory lines.

describe("memory injection: memory system line does not accumulate in history", () => {
  it("history has no leftover memory system line after two sends with memory", async () => {
    // Make getMemoryEntries return one entry, so a memoryMessage IS injected.
    vi.mocked(getMemoryEntries).mockResolvedValue([
      { id: "m1", text: "I default to Phusion polymerase", createdAt: "2026-01-01" },
    ]);

    vi.mocked(callModelViaProxy)
      .mockResolvedValueOnce(jsonChoices("first answer") as Awaited<ReturnType<typeof callModelViaProxy>>)
      .mockResolvedValueOnce(jsonChoices("second answer") as Awaited<ReturnType<typeof callModelViaProxy>>);

    await useConversationStore.getState().send("first question");
    await flushAll();
    await useConversationStore.getState().send("second question");
    await flushAll();

    // Skip index 0 (the base system prompt). The base prompt itself mentions the
    // phrase USER PREFERENCES when it tells the model how the injected note looks,
    // so only a leaked INJECTED line would be a system message after the base.
    const history = getConversationHistory();
    const memoryLines = history
      .slice(1)
      .filter(
        (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("USER PREFERENCES"),
      );
    // The memory message must have been stripped before persist. Zero copies.
    expect(memoryLines).toHaveLength(0);
  });

  it("history has no leftover context system line after two sends with context", async () => {
    // Memory stays empty for this test; we check the context line does not pile up.
    vi.mocked(getMemoryEntries).mockResolvedValue([]);

    vi.mocked(callModelViaProxy)
      .mockResolvedValueOnce(jsonChoices("a1") as Awaited<ReturnType<typeof callModelViaProxy>>)
      .mockResolvedValueOnce(jsonChoices("a2") as Awaited<ReturnType<typeof callModelViaProxy>>);

    await useConversationStore.getState().send("q1");
    await flushAll();
    await useConversationStore.getState().send("q2");
    await flushAll();

    const history = getConversationHistory();
    // There should be exactly one system message: the base prompt (index 0).
    const systemMessages = history.filter((m) => m.role === "system");
    expect(systemMessages).toHaveLength(1);
  });
});

// ---- Status-line state (STAGE 1, 2026-06-13) ---------------------------------
//
// Pins the live status-line fields introduced for the Claude-Code-style turn
// indicator: turnStartedAt, turnElapsedMs, turnTokens, runningToolCount,
// settledTurns, and turnToolSteps. All model/loop calls are mocked.

describe("status-line: turnStartedAt is set on send and cleared after settle", () => {
  it("is non-null while sending and null after", async () => {
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("hello") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    const p = useConversationStore.getState().send("hi");
    // Synchronously seeded: turnStartedAt should be set.
    const duringTurn = useConversationStore.getState().turnStartedAt;
    expect(duringTurn).not.toBeNull();
    expect(typeof duringTurn).toBe("number");

    await p;
    await flushAll();

    // After settle: turnStartedAt is cleared (set to null in finally).
    expect(useConversationStore.getState().turnStartedAt).toBeNull();
  });
});

describe("status-line: runningToolCount tracks tool-phase onStatus events", () => {
  it("is 1 when a tool phase fires and 0 at settle", async () => {
    let capturedOnStatus: ((status: LoopStatus) => void) | undefined;

    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      capturedOnStatus = opts.onStatus;
      const response = await vi.mocked(callModelViaProxy)([], []);
      const r = response as { choices: [{ message: { content: string } }] };
      const answer = r.choices[0]?.message?.content ?? "";
      return {
        answer,
        messages: [{ role: "assistant", content: answer }],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 0, completionTokens: 0 },
      };
    });

    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("answer") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    const p = useConversationStore.getState().send("run a tool");
    await flushAll(50);

    // Simulate the loop firing a tool-phase event.
    capturedOnStatus?.({ phase: "tool", toolName: "read_note" });
    expect(useConversationStore.getState().runningToolCount).toBe(1);

    // Simulate the loop firing a thinking-phase event (tool finished).
    capturedOnStatus?.({ phase: "thinking" });
    expect(useConversationStore.getState().runningToolCount).toBe(0);

    await p;
    await flushAll();

    expect(useConversationStore.getState().runningToolCount).toBe(0);
  });
});

describe("status-line: turnTokens accumulates from onUsage", () => {
  it("is null initially and updated when onUsage fires", async () => {
    let capturedOnUsage: ((u: { promptTokens: number; completionTokens: number }) => void) | undefined;

    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      capturedOnUsage = opts.onUsage;
      const response = await vi.mocked(callModelViaProxy)([], []);
      const r = response as { choices: [{ message: { content: string } }] };
      const answer = r.choices[0]?.message?.content ?? "";
      // Simulate: fire onUsage with some non-zero usage.
      opts.onUsage?.({ promptTokens: 10000, completionTokens: 2400 });
      return {
        answer,
        messages: [{ role: "assistant", content: answer }],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 10000, completionTokens: 2400 },
      };
    });

    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("tokens test") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("test tokens");
    await flushAll();

    // After settle: turnTokens should be the sum from the result's totalUsage.
    expect(useConversationStore.getState().turnTokens).toBe(12400);
    void capturedOnUsage; // referenced to avoid unused-variable lint noise
  });
});

describe("status-line: settledTurns is populated after a completed turn", () => {
  it("appends one TurnSummary per completed turn", async () => {
    vi.mocked(callModelViaProxy)
      .mockResolvedValueOnce(jsonChoices("first") as Awaited<ReturnType<typeof callModelViaProxy>>)
      .mockResolvedValueOnce(jsonChoices("second") as Awaited<ReturnType<typeof callModelViaProxy>>);

    expect(useConversationStore.getState().settledTurns).toHaveLength(0);

    await useConversationStore.getState().send("turn 1");
    await flushAll();

    expect(useConversationStore.getState().settledTurns).toHaveLength(1);
    const s1 = useConversationStore.getState().settledTurns[0];
    expect(s1.elapsedMs).toBeGreaterThanOrEqual(0);

    await useConversationStore.getState().send("turn 2");
    await flushAll();

    expect(useConversationStore.getState().settledTurns).toHaveLength(2);
  });

  it("resets settledTurns on clearConversation", async () => {
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("bye") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );
    await useConversationStore.getState().send("hello");
    await flushAll();

    expect(useConversationStore.getState().settledTurns.length).toBeGreaterThan(0);
    useConversationStore.getState().clearConversation();
    expect(useConversationStore.getState().settledTurns).toHaveLength(0);
  });
});

describe("status-line: graceful when provider returns no usage", () => {
  it("settles with tokens null (not crash) when totalUsage is zero", async () => {
    // The default mock returns totalUsage: { promptTokens: 0, completionTokens: 0 }.
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("ok") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("no usage");
    await flushAll();

    // turnTokens should stay null (zero total = no usage reported).
    expect(useConversationStore.getState().turnTokens).toBeNull();
  });
});

// ---- regenerate() (STAGE 2, 2026-06-13) --------------------------------------
//
// regenerate() drops the last assistant turn from both messages and historyStore,
// then re-sends the last user message through the normal send() path.

describe("regenerate: re-runs the last user turn with a fresh reply", () => {
  it("removes the last assistant message from messages and historyStore, then re-sends", async () => {
    // Use explicit loop mocks (not callModelViaProxy) so the test is immune to
    // any unconsumed mockImplementationOnce values from earlier tests.
    vi.mocked(runAgentLoop)
      .mockImplementationOnce(makeInstantLoop("first reply"))
      .mockImplementationOnce(makeInstantLoop("regenerated reply"));

    await useConversationStore.getState().send("my question");
    await flushAll();

    const afterFirst = useConversationStore.getState().messages;
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst[1].content).toBe("first reply");

    // historyStore must include the assistant turn.
    const histAfterFirst = getConversationHistory();
    const hadAssistant = histAfterFirst.some(
      (m) => m.role === "assistant" && m.content === "first reply",
    );
    expect(hadAssistant).toBe(true);

    // regenerate() drops the last user+assistant pair and re-sends.
    await useConversationStore.getState().regenerate();
    await flushAll();

    const afterRegen = useConversationStore.getState().messages;
    // Still two messages (user + fresh assistant reply).
    expect(afterRegen).toHaveLength(2);
    expect(afterRegen[0].content).toBe("my question");
    expect(afterRegen[1].content).toBe("regenerated reply");

    // historyStore must no longer contain "first reply".
    const histAfterRegen = getConversationHistory();
    const oldAssistantStillPresent = histAfterRegen.some(
      (m) => m.role === "assistant" && m.content === "first reply",
    );
    expect(oldAssistantStillPresent).toBe(false);
  });

  it("is a no-op when sending is true", async () => {
    // Set sending to true to simulate an in-flight turn.
    useConversationStore.setState({ sending: true });
    // Should not throw and should not call runAgentLoop.
    await useConversationStore.getState().regenerate();
    expect(vi.mocked(runAgentLoop)).not.toHaveBeenCalled();
    useConversationStore.setState({ sending: false });
  });

  it("is a no-op when there is no settled assistant reply", async () => {
    // Empty conversation: no messages at all.
    await useConversationStore.getState().regenerate();
    expect(vi.mocked(runAgentLoop)).not.toHaveBeenCalled();
  });
});

// ---- revertToHere() (STAGE 2, 2026-06-13) ------------------------------------
//
// revertToHere(messageId) keeps messages up to and including the target user
// message and discards everything after it (the assistant reply plus any later
// turns). historyStore is trimmed to the same point.

describe("revertToHere: truncates messages and historyStore to the right point", () => {
  it("removes the assistant reply and all later turns from messages and historyStore", async () => {
    // Two-turn conversation. Use loop mocks so tests are immune to callModelViaProxy queue leakage.
    vi.mocked(runAgentLoop)
      .mockImplementationOnce(makeInstantLoop("reply to turn 1"))
      .mockImplementationOnce(makeInstantLoop("reply to turn 2"));

    await useConversationStore.getState().send("turn 1 question");
    await flushAll();
    await useConversationStore.getState().send("turn 2 question");
    await flushAll();

    const afterTwo = useConversationStore.getState().messages;
    expect(afterTwo).toHaveLength(4);
    // [user1, assistant1, user2, assistant2]
    const user1Id = afterTwo[0].id;

    // Revert to the first user message: keeps user1, discards assistant1, user2, assistant2.
    useConversationStore.getState().revertToHere(user1Id);

    const afterRevert = useConversationStore.getState().messages;
    expect(afterRevert).toHaveLength(1);
    expect(afterRevert[0].role).toBe("user");
    expect(afterRevert[0].content).toBe("turn 1 question");

    // historyStore must not contain either assistant reply or turn-2 content.
    const hist = getConversationHistory();
    expect(hist.some((m) => m.role === "assistant")).toBe(false);
    expect(hist.some((m) => m.content === "turn 2 question")).toBe(false);
  });

  it("keeps messages and historyStore in sync after revert", async () => {
    vi.mocked(runAgentLoop).mockImplementationOnce(makeInstantLoop("the answer"));

    await useConversationStore.getState().send("the question");
    await flushAll();

    const msgs = useConversationStore.getState().messages;
    expect(msgs).toHaveLength(2);
    const userId = msgs[0].id;

    useConversationStore.getState().revertToHere(userId);

    // messages: one user message kept.
    expect(useConversationStore.getState().messages).toHaveLength(1);

    // historyStore: the assistant entry is gone; only the user entry remains
    // (plus the system prompt at index 0).
    const hist = getConversationHistory();
    const assistantEntries = hist.filter((m) => m.role === "assistant");
    expect(assistantEntries).toHaveLength(0);
    const userEntries = hist.filter((m) => m.role === "user");
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0].content).toBe("the question");
  });

  it("is a no-op when the messageId does not exist", async () => {
    vi.mocked(runAgentLoop).mockImplementationOnce(makeInstantLoop("answer"));
    await useConversationStore.getState().send("question");
    await flushAll();

    const before = useConversationStore.getState().messages.length;
    useConversationStore.getState().revertToHere("nonexistent-id");
    expect(useConversationStore.getState().messages).toHaveLength(before);
  });

  it("is a no-op when sending is true", async () => {
    useConversationStore.setState({ sending: true });
    useConversationStore.getState().revertToHere("some-id");
    // messages still empty (sending was forced to true on a blank state).
    expect(useConversationStore.getState().messages).toHaveLength(0);
    useConversationStore.setState({ sending: false });
  });

  it("the removed-count matches the number of messages removed", async () => {
    // The confirm dialog shows how many messages will be removed. This test pins
    // the arithmetic the component uses: messages after the target index.
    vi.mocked(runAgentLoop)
      .mockImplementationOnce(makeInstantLoop("a1"))
      .mockImplementationOnce(makeInstantLoop("a2"))
      .mockImplementationOnce(makeInstantLoop("a3"));

    await useConversationStore.getState().send("q1");
    await flushAll();
    await useConversationStore.getState().send("q2");
    await flushAll();
    await useConversationStore.getState().send("q3");
    await flushAll();

    // 6 messages: u1 a1 u2 a2 u3 a3. Reverting to u2 (index 2) removes 3 messages.
    const msgs = useConversationStore.getState().messages;
    expect(msgs).toHaveLength(6);
    const u2Id = msgs[2].id;
    // The UI computes removedCount as: messages.length - (targetIndex + 1)
    // = 6 - (2 + 1) = 3. revertToHere keeps u2, so it removes msgs at
    // indices 3, 4, 5 = 3 messages.
    const targetIndex = 2;
    const removedCount = msgs.length - (targetIndex + 1);
    expect(removedCount).toBe(3);

    useConversationStore.getState().revertToHere(u2Id);

    // After revert: u1 a1 u2 = 3 messages kept, 3 removed.
    expect(useConversationStore.getState().messages).toHaveLength(3);
  });
});

// ---- Vision: pending image state management ----------------------------------
//
// Tests that addPendingImage / removePendingImage / clearPendingImages work
// correctly and that the images are cleared on newChat / clearConversation.
// The flag (NEXT_PUBLIC_BEAKERBOT_VISION) gates the UI only; the store itself
// is always available for direct testing.

describe("vision: pending image state management", () => {
  const FAKE_URL_A = "data:image/png;base64,AAAA";
  const FAKE_URL_B = "data:image/png;base64,BBBB";

  it("addPendingImage appends a data URL to pendingImages", () => {
    useConversationStore.getState().addPendingImage(FAKE_URL_A);
    expect(useConversationStore.getState().pendingImages).toEqual([FAKE_URL_A]);
    useConversationStore.getState().addPendingImage(FAKE_URL_B);
    expect(useConversationStore.getState().pendingImages).toEqual([FAKE_URL_A, FAKE_URL_B]);
  });

  it("removePendingImage removes the matching URL", () => {
    useConversationStore.getState().addPendingImage(FAKE_URL_A);
    useConversationStore.getState().addPendingImage(FAKE_URL_B);
    useConversationStore.getState().removePendingImage(FAKE_URL_A);
    expect(useConversationStore.getState().pendingImages).toEqual([FAKE_URL_B]);
  });

  it("clearPendingImages empties the array", () => {
    useConversationStore.getState().addPendingImage(FAKE_URL_A);
    useConversationStore.getState().addPendingImage(FAKE_URL_B);
    useConversationStore.getState().clearPendingImages();
    expect(useConversationStore.getState().pendingImages).toEqual([]);
  });

  it("pendingImages is cleared by clearConversation", () => {
    useConversationStore.getState().addPendingImage(FAKE_URL_A);
    useConversationStore.getState().clearConversation();
    expect(useConversationStore.getState().pendingImages).toEqual([]);
  });

  it("pendingImages is cleared by newChat", () => {
    useConversationStore.getState().addPendingImage(FAKE_URL_A);
    useConversationStore.getState().newChat();
    expect(useConversationStore.getState().pendingImages).toEqual([]);
  });
});

// ---- Vision: send() with images (multimodal content + cost-collapse) ---------
//
// Tests that:
//   1. send() with pendingImages builds multimodal LoopMessage content (text
//      block + image_url blocks) and clears pendingImages.
//   2. ChatMessage.images is set on the display message.
//   3. The historyStore cost-collapse: the persisted user message replaces
//      image_url blocks with "[image attached]" so images are NOT re-sent on
//      subsequent turns.
//   4. After the collapse, a second send does NOT receive image blocks in its
//      loop input.

describe("vision: send() with images", () => {
  const FAKE_URL = "data:image/png;base64,iVBORw0KGgo=";

  it("send() with a staged image builds multimodal loop content and sets ChatMessage.images", async () => {
    // Capture the messages array passed to runAgentLoop.
    let capturedMessages: LoopMessage[] = [];
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      capturedMessages = opts.messages as LoopMessage[];
      return {
        answer: "I see an image.",
        messages: [...capturedMessages, { role: "assistant", content: "I see an image." }],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 10, completionTokens: 5 },
      };
    });
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("I see an image.") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    // Stage an image and send.
    useConversationStore.getState().addPendingImage(FAKE_URL);
    expect(useConversationStore.getState().pendingImages).toHaveLength(1);

    await useConversationStore.getState().send("what is this?");
    await flushAll();

    // The pending image should be cleared after send.
    expect(useConversationStore.getState().pendingImages).toHaveLength(0);

    // The last message passed to the loop should be multimodal.
    const userLoopMessage = capturedMessages[capturedMessages.length - 1];
    expect(userLoopMessage.role).toBe("user");
    expect(Array.isArray(userLoopMessage.content)).toBe(true);
    const blocks = userLoopMessage.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(blocks.some((b) => b.type === "text" && b.text === "what is this?")).toBe(true);
    expect(blocks.some((b) => b.type === "image_url" && b.image_url?.url === FAKE_URL)).toBe(true);

    // The display ChatMessage should have .images set.
    const msgs = useConversationStore.getState().messages;
    const userMsg = msgs.find((m) => m.role === "user");
    expect(userMsg?.images).toEqual([FAKE_URL]);
  });

  it("send() without images keeps content as a plain string", async () => {
    let capturedMessages: LoopMessage[] = [];
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      capturedMessages = opts.messages as LoopMessage[];
      return {
        answer: "plain answer",
        messages: [...capturedMessages, { role: "assistant", content: "plain answer" }],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 5, completionTokens: 2 },
      };
    });
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("plain answer") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("hello");
    await flushAll();

    // Last message in loop input should be a plain string.
    const userLoopMessage = capturedMessages[capturedMessages.length - 1];
    expect(typeof userLoopMessage.content).toBe("string");
    expect(userLoopMessage.content).toBe("hello");

    // No .images on the display message.
    const msgs = useConversationStore.getState().messages;
    const userMsg = msgs.find((m) => m.role === "user");
    expect(userMsg?.images).toBeUndefined();
  });

  it("cost-collapse: historyStore persists [image attached] marker, not the image_url block", async () => {
    let firstCallMessages: LoopMessage[] = [];
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      firstCallMessages = opts.messages as LoopMessage[];
      return {
        answer: "replied",
        messages: [...firstCallMessages, { role: "assistant", content: "replied" }],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 10, completionTokens: 3 },
      };
    });
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("replied") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    // First send with an image.
    useConversationStore.getState().addPendingImage(FAKE_URL);
    await useConversationStore.getState().send("look at this");
    await flushAll();

    // Now send a follow-up WITHOUT any image. Capture what historyStore sent.
    let secondCallMessages: LoopMessage[] = [];
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      secondCallMessages = opts.messages as LoopMessage[];
      return {
        answer: "follow-up",
        messages: [...secondCallMessages, { role: "assistant", content: "follow-up" }],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 10, completionTokens: 3 },
      };
    });
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("follow-up") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    await useConversationStore.getState().send("what was in that image?");
    await flushAll();

    // The second call's messages should include the COLLAPSED user message from
    // the first turn (the text + "[image attached]" marker, NOT the image_url block).
    const collapsedUserMsg = secondCallMessages.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        (m.content as string).includes("[image attached]"),
    );
    expect(collapsedUserMsg).toBeDefined();
    expect(collapsedUserMsg?.content).toBe("look at this [image attached]");

    // And there should be NO image_url blocks anywhere in the second call's messages.
    const hasImageBlock = secondCallMessages.some(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === "image_url"),
    );
    expect(hasImageBlock).toBe(false);

    // The display ChatMessage from the first turn still shows the image URL.
    const msgs = useConversationStore.getState().messages;
    const firstUserMsg = msgs.find((m) => m.role === "user" && m.content === "look at this");
    expect(firstUserMsg?.images).toEqual([FAKE_URL]);
  });

  it("pendingImages is empty after send", async () => {
    vi.mocked(runAgentLoop).mockImplementationOnce(async (opts) => {
      return {
        answer: "ok",
        messages: [...(opts.messages as LoopMessage[]), { role: "assistant", content: "ok" }],
        iterations: 1,
        stoppedOnGuard: false,
        totalUsage: { promptTokens: 0, completionTokens: 0 },
      };
    });
    vi.mocked(callModelViaProxy).mockResolvedValueOnce(
      jsonChoices("ok") as Awaited<ReturnType<typeof callModelViaProxy>>,
    );

    useConversationStore.getState().addPendingImage(FAKE_URL);
    await useConversationStore.getState().send("test");
    await flushAll();

    expect(useConversationStore.getState().pendingImages).toHaveLength(0);
  });
});
