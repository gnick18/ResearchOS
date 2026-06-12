// Persistent conversation store for BeakerBot (ai convo-store bot, 2026-06-11).
//
// Lifts the conversation state that used to live inside the component-scoped
// useAiChat hook into a module-level Zustand store. The motivation is Phase 2 of
// the BeakerSearch v2 redesign, where the SAME conversation must render inside
// the BeakerSearch palette (a modal that mounts and unmounts) without losing
// state. A module store survives any component unmount.
//
// What is stored here vs on the module level:
//   - Zustand reactive state (triggers re-renders): messages, sending, status,
//     error, pendingApproval. These are the fields BeakerBotPanel and
//     BeakerBotConversation need to render correctly.
//   - Module-level (non-reactive, must not trigger re-renders): historyStore
//     (the full loop history with system + tool turns), counterStore (message ID
//     counter), pendingApprovalRef (the resolver for the in-flight promise).
//     These are mutable references the send logic updates without needing to
//     schedule a React render. Using Zustand setState for them would cause
//     needless re-renders and would not help the consumer.
//
// The approval bridge pattern. requestApproval builds a Promise and stores its
// resolver in the module-level pendingApprovalRef. When the user clicks Allow /
// Skip / Approve / Cancel, resolveApproval forwards the decision to that
// resolver. This is identical to the old pendingApprovalRef.current pattern,
// just module-scoped instead of component-scoped, so it survives remounts.
//
// The send function and all logic (loop launch, context injection, history
// management, typewriter reveal) live here as store actions, accessible via the
// hook or directly from tests.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { create } from "zustand";
import {
  runAgentLoop,
  type LoopMessage,
} from "@/lib/ai/agent-loop";
import { callModelViaProxy, ProxyError } from "@/lib/ai/proxy-client";
import { DEFAULT_TOOLS } from "@/lib/ai/tools/registry";
import { BEAKERBOT_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { getReviewMode } from "@/lib/ai/review-mode-store";
import {
  getBeakerContext,
  describeBeakerContext,
} from "@/components/ai/context-bridge";
import { resolveRef } from "@/lib/ai/page-perception";
import {
  showSpotlight,
  dismissSpotlight,
} from "@/components/ai/spotlight-controller";
import type {
  ApprovalRequest,
  ApprovalDecision,
  ChoiceDecision,
} from "@/lib/ai/tools/types";
import { statusLabel } from "@/components/ai/thinking-status";
import {
  createChat,
  saveChat,
  getChat,
  deriveChatTitle,
} from "@/lib/ai/beaker-chats-store";

// Re-export ChatMessage and ChatRole so consumers need not import from the old
// hook location (the hook re-exports them for back-compat).
export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

// The pending approval the UI renders while the loop is paused on the user.
// Carries the human summary plus a resolver. Clicking Allow / Skip in the UI
// calls the resolver, which unblocks the loop's requestApproval promise.
export type PendingApproval = {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
};

// The map from loop status to a friendly grey status line now lives in the
// shared, unit-tested helper components/ai/thinking-status.ts (imported as
// statusLabel above), so the conversation store and the BeakerBotThinking
// indicator agree on the wording.

// Typewriter reveal constants.
const REVEAL_STEP_CHARS = 3;
const REVEAL_INTERVAL_MS = 16;

// ---- Module-level mutable state (not reactive, never causes re-renders) ------

// The full loop history (system prompt + all turns, including tool turns). Kept
// off React state because the UI only needs user + assistant text turns.
let historyStore: LoopMessage[] = [];

// Message ID counter. Monotonically increasing per session; a full page reload
// resets it, which is acceptable.
let counterStore = 0;

// The resolver for the currently in-flight approval promise. Set in
// requestApproval, cleared (to null) by the resolve wrapper when the user
// answers. This is the exact pattern the old pendingApprovalRef played, now at
// module scope so it persists across remounts.
let pendingApprovalRef: PendingApproval | null = null;

// ---- Zustand store (reactive state + actions) ---------------------------------

interface ConversationState {
  messages: ChatMessage[];
  sending: boolean;
  status: string | null;
  error: string | null;
  pendingApproval: PendingApproval | null;
  // The persisted thread this conversation is bound to. Null means a fresh,
  // not-yet-saved conversation, the first user message creates the thread.
  currentThreadId: number | null;
  // The title of the bound thread, mirrored into reactive state so the header
  // can show which chat the user is in.
  currentTitle: string | null;
}

interface ConversationActions {
  send: (text: string) => Promise<void>;
  resolveApproval: (decision: ApprovalDecision) => void;
  resolveChoice: (selected: string[], cancelled: boolean) => void;
  /** Reset the conversation to an empty state (clear messages + history). */
  clearConversation: () => void;
  /**
   * Start a brand-new chat. Clears the in-memory conversation AND unbinds the
   * current thread so the next message creates a fresh persisted chat. The old
   * thread is already saved on disk, it is not deleted.
   */
  newChat: () => void;
  /** Reopen a persisted chat, restoring its transcript and full loop history. */
  loadThread: (id: number) => Promise<void>;
}

type ConversationStore = ConversationState & ConversationActions;

// The internal requestApproval function. Lives outside the Zustand slice so it
// can be called from send() without going through getState().
function requestApproval(
  request: ApprovalRequest,
): Promise<ApprovalDecision> {
  // For single-action approvals, spotlight the target element so the user sees
  // exactly what BeakerBot wants to do before allowing it.
  if (request.kind === "action" && request.ref) {
    const el = resolveRef(request.ref);
    if (el) {
      showSpotlight(el, `BeakerBot wants to ${request.summary}.`);
    }
  }

  return new Promise<ApprovalDecision>((resolve) => {
    const pending: PendingApproval = {
      request,
      resolve: (decision) => {
        // Guard against a double-resolve. If pendingApprovalRef no longer
        // points at this pending, another answer already won.
        if (pendingApprovalRef !== pending) return;
        pendingApprovalRef = null;
        dismissSpotlight();
        useConversationStore.setState({ pendingApproval: null });
        resolve(decision);
      },
    };
    pendingApprovalRef = pending;
    useConversationStore.setState({ pendingApproval: pending });
  });
}

// While the typewriter reveals an answer char by char, a partially-typed
// markdown link or object embed (for example "[Bar chart](/datahub?doc=1#ros=plot&plo")
// would render as raw, broken markdown until its closing ")" arrives, then snap
// into an embed card. Clamp the visible text to drop a trailing link that is
// still mid-formation, so a reference only ever appears once it is whole. A
// complete link, or plain prose that merely contains a "[", is left untouched.
export function clampPartialEmbed(text: string): string {
  const open = text.lastIndexOf("[");
  if (open === -1) return text;
  const tail = text.slice(open);
  // A complete [label](url) at the tail is safe to show.
  if (/^\[[^\]]*\]\([^)]*\)/.test(tail)) return text;
  // Hide only a clearly-forming link: the url part "](" has opened but not
  // closed, or the label bracket itself is still open. Prose like "see [1]"
  // (a closed bracket not followed by "(") matches neither and shows normally.
  if (/^\[[^\]]*\]\([^)]*$/.test(tail) || /^\[[^\]]*$/.test(tail)) {
    return text.slice(0, open);
  }
  return text;
}

// Typewriter reveal. Updates the assistant message incrementally so the answer
// does not pop in all at once. Returns a promise that resolves when the full
// text is shown.
function revealAnswer(assistantId: string, answer: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (answer.length === 0) {
      resolve();
      return;
    }
    let shown = 0;
    const tick = () => {
      shown = Math.min(answer.length, shown + REVEAL_STEP_CHARS);
      const text = clampPartialEmbed(answer.slice(0, shown));
      useConversationStore.setState((state) => ({
        messages: state.messages.map((m) =>
          m.id === assistantId ? { ...m, content: text } : m,
        ),
      }));
      if (shown >= answer.length) {
        resolve();
        return;
      }
      setTimeout(tick, REVEAL_INTERVAL_MS);
    };
    tick();
  });
}

function nextId(): string {
  counterStore += 1;
  return `msg-${counterStore}-${Date.now()}`;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  // Initial state.
  messages: [],
  sending: false,
  status: null,
  error: null,
  pendingApproval: null,
  currentThreadId: null,
  currentTitle: null,

  clearConversation: () => {
    historyStore = [];
    counterStore = 0;
    pendingApprovalRef = null;
    set({
      messages: [],
      sending: false,
      status: null,
      error: null,
      pendingApproval: null,
      currentThreadId: null,
      currentTitle: null,
    });
  },

  // newChat is the user-facing "start fresh" action behind the + button. It is
  // exactly clearConversation today (which already unbinds the thread), kept as
  // its own name so the intent reads clearly at call sites and so the saved old
  // thread is explicitly left untouched on disk.
  newChat: () => {
    get().clearConversation();
  },

  loadThread: async (id: number) => {
    const stored = await getChat(id);
    if (!stored) {
      set({ error: "That chat could not be opened. It may have been deleted." });
      return;
    }
    // Restore the full loop history so the next send continues context, and the
    // display transcript so the panel renders the prior turns.
    historyStore = stored.history ?? [];
    // Keep the message-id counter ahead of any restored id so newly minted ids
    // never collide with restored ones. Restored ids look like "msg-<n>-<ts>",
    // so parse the <n> and take the max.
    let maxN = 0;
    for (const m of stored.messages ?? []) {
      const match = /^msg-(\d+)-/.exec(m.id);
      if (match) maxN = Math.max(maxN, Number(match[1]));
    }
    counterStore = maxN;
    pendingApprovalRef = null;
    set({
      messages: stored.messages ?? [],
      sending: false,
      status: null,
      error: null,
      pendingApproval: null,
      currentThreadId: stored.id,
      currentTitle: stored.title,
    });
  },

  resolveApproval: (decision: ApprovalDecision) => {
    pendingApprovalRef?.resolve(decision);
  },

  resolveChoice: (selected: string[], cancelled: boolean) => {
    const decision: ChoiceDecision = { kind: "choice", selected, cancelled };
    pendingApprovalRef?.resolve(decision);
  },

  send: async (text: string) => {
    const trimmed = text.trim();
    // Guard: discard empty input or a concurrent send (only one loop at a time).
    if (!trimmed || get().sending) return;

    set({ error: null });
    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: trimmed,
    };
    const assistantId = nextId();

    // Capture whether this is a fresh, not-yet-persisted conversation. We bind
    // the persisted thread below, AFTER the synchronous seed, so the seed and
    // the sending flag still flip on the same tick (the concurrent-send guard
    // and the synchronous-render contract both depend on that).
    const wasFresh = get().currentThreadId === null;

    // Seed an empty assistant bubble so the status line and the revealed answer
    // have a visible target right away.
    set((state) => ({
      messages: [
        ...state.messages,
        userMessage,
        { id: assistantId, role: "assistant", content: "" },
      ],
      sending: true,
      status: "thinking",
    }));

    // On the first user message of a fresh conversation, create a persisted
    // thread titled from that message. We do this just after the seed so a
    // reload mid-answer still leaves a recoverable chat. Failure is non-fatal,
    // the conversation keeps running in memory and a later send retries the
    // bind. The sending guard above already blocks a concurrent send, so this
    // await does not open a race.
    if (wasFresh) {
      const title = deriveChatTitle(trimmed);
      const created = await createChat({
        title,
        messages: get().messages,
        history: historyStore,
      });
      if (created) {
        set({ currentThreadId: created.id, currentTitle: created.title });
      } else {
        // Could not persist (no folder connected), still show the title in the
        // header so the user has a label for the in-memory chat.
        set({ currentTitle: title });
      }
    }

    // Build the loop input. Seed the system prompt once; carry the running
    // history forward so multi-turn context and prior tool results persist.
    if (historyStore.length === 0) {
      historyStore = [{ role: "system", content: BEAKERBOT_SYSTEM_PROMPT }];
    }

    // Inject a fresh per-turn context message so the model can resolve "this"
    // or "the result" to the entity the user currently has open. The context is
    // rebuilt on every send from the live context-bridge store, so it always
    // reflects the current page state. It is NOT persisted to historyStore
    // because:
    //   1. It must never go stale, a context captured two turns ago is wrong.
    //   2. Storing it would duplicate it on every subsequent send.
    // The persisted history starts at index 0 (the base system prompt). The
    // context message, when present, is spliced in at index 1, immediately
    // after the base system prompt and before the conversation turns.
    const ctxDescription = describeBeakerContext(getBeakerContext());
    // Hold the per-turn context message by reference so it can be removed from
    // the persisted history after the run. The loop returns the input array with
    // new turns appended (it only pushes, never clones), so the SAME object
    // identity survives, and an identity filter strips exactly the one we
    // injected.
    const contextMessage: LoopMessage | null = ctxDescription
      ? { role: "system", content: ctxDescription }
      : null;
    const loopInput: LoopMessage[] = contextMessage
      ? [
          historyStore[0], // base system prompt
          contextMessage, // fresh per-turn context
          ...historyStore.slice(1), // rest of persisted history
          { role: "user", content: trimmed },
        ]
      : [
          ...historyStore,
          { role: "user", content: trimmed },
        ];

    try {
      const result = await runAgentLoop({
        messages: loopInput,
        tools: DEFAULT_TOOLS,
        callModel: callModelViaProxy,
        onStatus: (s) => set({ status: statusLabel(s) }),
        // Read the live review mode at each dispatch, so flipping the control
        // mid-conversation takes effect on the next step.
        getReviewMode: getReviewMode,
        requestApproval,
      });

      // Persist the full loop history (including tool turns) for the next send,
      // but strip the per-turn context message by reference so it never persists.
      // Persisting it would let a stale context line accumulate, one extra system
      // message per send.
      historyStore = contextMessage
        ? result.messages.filter((m) => m !== contextMessage)
        : result.messages;
      set({ status: null });

      if (result.answer.length === 0) {
        set((state) => ({
          messages: state.messages.filter((m) => m.id !== assistantId),
          error: "BeakerBot returned an empty reply. Try again.",
        }));
        return;
      }
      await revealAnswer(assistantId, result.answer);

      // Persist the completed turn. We save the post-strip historyStore (the
      // per-turn context message was already removed above) plus the full
      // display transcript, and bump updatedAt. Resilient, a failed write logs
      // a warn inside saveChat and never throws into the loop.
      const threadId = get().currentThreadId;
      if (threadId !== null) {
        await saveChat(threadId, {
          messages: get().messages,
          history: historyStore,
        });
      }
    } catch (err) {
      set({ status: null });
      const message =
        err instanceof ProxyError
          ? err.message
          : "Something went wrong talking to BeakerBot. Try again.";
      set((state) => ({
        error: message,
        messages: state.messages.filter((m) => m.id !== assistantId),
      }));
    } finally {
      set({ sending: false });
    }
  },
}));

// ---- Thread management (used by the History panel) ---------------------------
// These wrap the persistence layer and keep the live store consistent when the
// operation touches the currently open thread. listThreads is re-exported from
// the chats store for one import site in the panel.

import {
  listChats as listChatsStore,
  renameChat as renameChatStore,
  setChatArchived,
  deleteChat as deleteChatStore,
  type StoredBeakerChat,
} from "@/lib/ai/beaker-chats-store";

/** All persisted chats, newest activity first (active + archived). */
export function listThreads(): Promise<StoredBeakerChat[]> {
  return listChatsStore();
}

/** Reopen a thread (thin wrapper over the store action for panel use). */
export function loadThreadAction(id: number): Promise<void> {
  return useConversationStore.getState().loadThread(id);
}

/** Rename a thread. If it is the open thread, update the header title too. */
export async function renameThread(id: number, title: string): Promise<void> {
  const updated = await renameChatStore(id, title);
  if (updated && useConversationStore.getState().currentThreadId === id) {
    useConversationStore.setState({ currentTitle: updated.title });
  }
}

/** Archive or unarchive a thread. */
export async function archiveThread(
  id: number,
  archived: boolean,
): Promise<void> {
  await setChatArchived(id, archived);
}

/**
 * Delete a thread from disk. If it is the currently open thread, also start a
 * brand-new chat so the user is not left looking at a transcript that no longer
 * exists on disk.
 */
export async function deleteThread(id: number): Promise<void> {
  await deleteChatStore(id);
  if (useConversationStore.getState().currentThreadId === id) {
    useConversationStore.getState().newChat();
  }
}

// ---- Test helpers (not for production use) -----------------------------------
// Exported so tests can inspect or reset module-level state without importing
// the internals directly.

/** Returns the current loop history. For tests. */
export function getConversationHistory(): LoopMessage[] {
  return historyStore;
}

/** Resets module-level state (history, counter, approval ref). For tests. */
export function resetConversationModule(): void {
  historyStore = [];
  counterStore = 0;
  pendingApprovalRef = null;
  useConversationStore.setState({
    messages: [],
    sending: false,
    status: null,
    error: null,
    pendingApproval: null,
    currentThreadId: null,
    currentTitle: null,
  });
}
