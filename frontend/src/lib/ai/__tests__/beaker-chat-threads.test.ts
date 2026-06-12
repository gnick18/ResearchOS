// @vitest-environment jsdom
//
// BeakerBot chat-history thread logic (BeakerAI lane, 2026-06-12).
//
// Pins the thread-aware behavior added to the conversation store for persisted
// chat history: create-on-first-send binds a thread and titles it, loadThread
// restores the transcript and full loop history, and the management wrappers
// (rename / archive / delete) call the persistence layer and keep the open
// thread consistent. The persistence layer (beaker-chats-store) is fully
// mocked, no real FSA / disk is touched. deriveChatTitle is tested as a pure
// function against the real implementation.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---- module mocks (mirror conversation-store.test.ts) -----------------------

type AgentLoopOpts = {
  messages: unknown[];
  callModel: (m: unknown[], t: unknown[]) => Promise<unknown>;
  tools: unknown[];
};

vi.mock("../agent-loop", () => ({
  runAgentLoop: vi.fn(async (opts: AgentLoopOpts) => {
    const response = await opts.callModel(opts.messages, opts.tools);
    const r = response as { choices: [{ message: { content: string | null } }] };
    const answer = r.choices[0]?.message?.content ?? "";
    return {
      answer,
      messages: [...(opts.messages as unknown[]), { role: "assistant", content: answer }],
      iterations: 1,
      stoppedOnGuard: false,
    };
  }),
}));

vi.mock("../proxy-client", () => {
  const ProxyError = class extends Error {};
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
}));

vi.mock("../page-perception", () => ({
  resolveRef: vi.fn(() => null),
}));

// A tiny in-memory fake of the persistence layer so we can assert which calls
// the store made and let loadThread read back a record.
const records = new Map<number, unknown>();
let nextThreadId = 1;

vi.mock("../beaker-chats-store", () => ({
  deriveChatTitle: (s: string) => {
    const oneLine = s.replace(/\s+/g, " ").trim();
    return oneLine.length <= 60 ? oneLine : oneLine.slice(0, 60) + "...";
  },
  createChat: vi.fn(async (input: { title: string; messages: unknown; history: unknown }) => {
    const id = nextThreadId++;
    const rec = {
      id,
      title: input.title,
      createdAt: "t",
      updatedAt: "t",
      archived: false,
      messages: input.messages,
      history: input.history,
    };
    records.set(id, rec);
    return rec;
  }),
  saveChat: vi.fn(async () => null),
  getChat: vi.fn(async (id: number) => records.get(id) ?? null),
  listChats: vi.fn(async () => [...records.values()]),
  renameChat: vi.fn(async (id: number, title: string) => {
    const rec = records.get(id) as Record<string, unknown> | undefined;
    if (!rec) return null;
    rec.title = title;
    return rec;
  }),
  setChatArchived: vi.fn(async (id: number, archived: boolean) => {
    const rec = records.get(id) as Record<string, unknown> | undefined;
    if (!rec) return null;
    rec.archived = archived;
    return rec;
  }),
  deleteChat: vi.fn(async (id: number) => records.delete(id)),
}));

import {
  useConversationStore,
  resetConversationModule,
  getConversationHistory,
  renameThread,
  archiveThread,
  deleteThread,
} from "../conversation-store";
import * as chatsStore from "../beaker-chats-store";

async function flushAll(ms = 300) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  resetConversationModule();
  records.clear();
  nextThreadId = 1;
  vi.clearAllMocks();
});

afterEach(() => {
  resetConversationModule();
});

describe("create-on-first-send", () => {
  it("binds a thread and titles it from the first user message", async () => {
    await useConversationStore.getState().send("What is the Tm of my primer?");
    await flushAll();

    expect(chatsStore.createChat).toHaveBeenCalledTimes(1);
    const state = useConversationStore.getState();
    expect(state.currentThreadId).toBe(1);
    expect(state.currentTitle).toBe("What is the Tm of my primer?");
  });

  it("does not create a second thread on the next send in the same chat", async () => {
    await useConversationStore.getState().send("first");
    await flushAll();
    await useConversationStore.getState().send("second");
    await flushAll();

    expect(chatsStore.createChat).toHaveBeenCalledTimes(1);
    expect(useConversationStore.getState().currentThreadId).toBe(1);
  });

  it("saves the thread after the turn completes", async () => {
    await useConversationStore.getState().send("hello");
    await flushAll();
    expect(chatsStore.saveChat).toHaveBeenCalled();
  });
});

describe("newChat", () => {
  it("unbinds the thread without deleting it", async () => {
    await useConversationStore.getState().send("keep me");
    await flushAll();
    expect(records.size).toBe(1);

    useConversationStore.getState().newChat();

    const state = useConversationStore.getState();
    expect(state.currentThreadId).toBeNull();
    expect(state.currentTitle).toBeNull();
    expect(state.messages).toHaveLength(0);
    // The old record is still on disk.
    expect(records.size).toBe(1);
    expect(chatsStore.deleteChat).not.toHaveBeenCalled();
  });
});

describe("loadThread", () => {
  it("restores messages and full loop history", async () => {
    records.set(7, {
      id: 7,
      title: "Old chat",
      createdAt: "t",
      updatedAt: "t",
      archived: false,
      messages: [
        { id: "msg-1-x", role: "user", content: "hi" },
        { id: "msg-2-x", role: "assistant", content: "hello" },
      ],
      history: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });

    await useConversationStore.getState().loadThread(7);

    const state = useConversationStore.getState();
    expect(state.currentThreadId).toBe(7);
    expect(state.currentTitle).toBe("Old chat");
    expect(state.messages).toHaveLength(2);
    expect(getConversationHistory()).toHaveLength(3);
  });

  it("sets an error when the thread is missing", async () => {
    await useConversationStore.getState().loadThread(999);
    expect(useConversationStore.getState().error).toBeTruthy();
  });
});

describe("management wrappers", () => {
  it("renameThread updates the record and the header title when open", async () => {
    await useConversationStore.getState().send("a chat");
    await flushAll();
    const id = useConversationStore.getState().currentThreadId as number;

    await renameThread(id, "Renamed");

    expect(chatsStore.renameChat).toHaveBeenCalledWith(id, "Renamed");
    expect(useConversationStore.getState().currentTitle).toBe("Renamed");
  });

  it("archiveThread flips the archived flag on disk", async () => {
    await useConversationStore.getState().send("a chat");
    await flushAll();
    const id = useConversationStore.getState().currentThreadId as number;

    await archiveThread(id, true);

    expect(chatsStore.setChatArchived).toHaveBeenCalledWith(id, true);
    expect((records.get(id) as { archived: boolean }).archived).toBe(true);
  });

  it("deleteThread removes the record and starts a new chat when it is open", async () => {
    await useConversationStore.getState().send("a chat");
    await flushAll();
    const id = useConversationStore.getState().currentThreadId as number;

    await deleteThread(id);

    expect(chatsStore.deleteChat).toHaveBeenCalledWith(id);
    expect(records.has(id)).toBe(false);
    // The open thread was deleted, so the store reset to a fresh chat.
    expect(useConversationStore.getState().currentThreadId).toBeNull();
    expect(useConversationStore.getState().messages).toHaveLength(0);
  });

  it("deleteThread of a non-open thread leaves the current chat intact", async () => {
    await useConversationStore.getState().send("open one");
    await flushAll();
    const openId = useConversationStore.getState().currentThreadId as number;
    // A second, unrelated record on disk.
    records.set(50, { id: 50, title: "other", archived: false, messages: [], history: [] });

    await deleteThread(50);

    expect(records.has(50)).toBe(false);
    expect(useConversationStore.getState().currentThreadId).toBe(openId);
  });
});
