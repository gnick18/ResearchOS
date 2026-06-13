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
