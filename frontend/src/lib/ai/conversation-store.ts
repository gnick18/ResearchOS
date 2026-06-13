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
import { getReviewMode, type BeakerBotReviewMode } from "@/lib/ai/review-mode-store";
import {
  getBeakerContext,
  describeBeakerContext,
} from "@/components/ai/context-bridge";
import { resolveRef } from "@/lib/ai/page-perception";
import {
  showSpotlight,
  dismissSpotlight,
} from "@/components/ai/spotlight-controller";
import { getMemoryEntries, buildMemoryContext } from "@/lib/ai/user-memory";
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
  // Optional follow-up suggestion chips parsed from the model's hidden directive.
  // Only the most recent assistant message surfaces these; older ones are cleared
  // on each new send so chips never pile up across turns.
  followups?: string[];
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

// The AbortController for the currently in-flight send. Null when idle.
// stop() aborts this, send() creates a fresh one each time.
let abortControllerRef: AbortController | null = null;

// Single-slot queue for a message typed while a turn is in flight (Bug 2 fix).
// send() while sending=true stores the trimmed text here instead of silently
// dropping it. The turn's finally block picks it up and fires a new send().
// stop() clears it so an explicit user cancel does not auto-fire the queued
// message. Single-slot design: if the user types a second queued message before
// the first fires, the newer text replaces the older one.
let pendingQueuedText: string | null = null;

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
  // Reactive mirror of the single-slot queue so the composer can show a
  // "queued" chip. Null when no message is queued. Set whenever
  // pendingQueuedText changes so the UI re-renders.
  queuedText: string | null;
}

interface ConversationActions {
  send: (text: string) => Promise<void>;
  /**
   * Abort the currently in-flight send. Clears the sending/loading state and
   * removes the empty assistant placeholder bubble so it does not hang on
   * "Thinking" forever. If a pending approval promise is in flight, it is
   * resolved with "skip" so nothing is left dangling. Safe to call when idle.
   * Also discards any queued message so an explicit cancel does not auto-fire
   * the next message.
   */
  stop: (placeholderAssistantId?: string) => void;
  /**
   * Discard the queued message without cancelling the current turn. Used by
   * the queued-indicator chip's Discard button.
   */
  clearQueue: () => void;
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

// Parse and strip the optional follow-up suggestions directive the model may
// append to a reply. The directive form is:
//   <!-- followups: First suggestion | Second suggestion | Third -->
// Only the LAST occurrence is used (in case the model produced malformed
// duplicates earlier in a long reply). The comment is stripped regardless of
// whether the suggestions are valid so the user never sees the raw directive.
// Returns at most 3 trimmed, non-empty suggestions.
//
// Exported pure for unit tests.
export function extractFollowups(text: string): {
  stripped: string;
  followups: string[];
} {
  // Match the last occurrence, stripping all whitespace around the delimiter.
  const pattern = /<!--\s*followups\s*:([\s\S]*?)-->/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    lastMatch = m;
  }
  if (!lastMatch) {
    return { stripped: text, followups: [] };
  }
  // Strip the comment from the displayed text even when no valid suggestions exist.
  const stripped = text.slice(0, lastMatch.index) + text.slice(lastMatch.index + lastMatch[0].length);
  const raw = lastMatch[1] ?? "";
  const followups = raw
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);
  return { stripped: stripped.trimEnd(), followups };
}

// The one-line directive injected into each turn's context note so the model
// behaves for the active review mode (the gate enforces the same split, but the
// model must KNOW the mode to decide whether to propose one plan up front). Kept
// pure and exported so it is unit-testable.
export function reviewModeDirective(mode: BeakerBotReviewMode): string {
  if (mode === "plan") {
    return "REVIEW MODE: whole-plan. Before you run any step, call propose_plan ONCE with the FULL sequence of steps as short human sentences (include every Data Hub analysis, transform, plot, and write step). After the user approves the plan, run every step start to finish without asking again. This overrides the per-tool 'do not call propose_plan' notes. A single-step request is a one-line plan. A destructive or outward-facing step still confirms at the moment it runs.";
  }
  return "REVIEW MODE: step-by-step. Do not call propose_plan for the self-gating Data Hub and write tools; each one shows its own review block at the moment it runs, and that block is the consent. Follow the per-tool guidance.";
}

// Today's date as a context line, so the model resolves relative dates ("next
// Monday", "in two weeks") to a real ISO date instead of guessing the weekday.
// Local date (not UTC) since the user's "today" is local. Injected each turn so
// it is never stale. Exported pure for tests; pass `now` in tests.
export function todayContext(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const weekday = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][now.getDay()];
  return `Today is ${yyyy}-${mm}-${dd} (${weekday}). Resolve any relative date the user gives ("next Monday", "in two weeks", "tomorrow") against this, to a real ISO YYYY-MM-DD date.`;
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
  queuedText: null,

  stop: (placeholderAssistantId?: string) => {
    // Guard: nothing to abort when idle.
    if (!abortControllerRef) return;
    // Abort the in-flight request. The loop's catch block treats AbortError as a
    // clean stop and returns an empty answer, which the send() finally block then
    // handles via the normal cleanup path. We also do a proactive cleanup here so
    // the UI responds immediately even before the async chain settles.
    abortControllerRef.abort();
    abortControllerRef = null;
    // Discard any queued message. An explicit user cancel means "stop everything",
    // not "stop and then fire the next thing I typed while waiting".
    pendingQueuedText = null;
    // If a pending approval promise is in flight, resolve it with "skip" so the
    // loop's await does not dangle forever waiting for user input that will never
    // arrive.
    if (pendingApprovalRef) {
      pendingApprovalRef.resolve("skip");
      // pendingApprovalRef is cleared by the resolve wrapper above.
    }
    // Remove the empty assistant placeholder (the "Thinking" bubble) if the
    // caller passed its id. We only remove it when it is still empty, so a
    // partial typewriter reveal is never wiped.
    set((state) => ({
      sending: false,
      status: null,
      queuedText: null,
      messages: placeholderAssistantId
        ? state.messages.filter(
            (m) => !(m.id === placeholderAssistantId && m.content === ""),
          )
        : state.messages,
    }));
  },

  clearQueue: () => {
    pendingQueuedText = null;
    set({ queuedText: null });
  },

  clearConversation: () => {
    historyStore = [];
    counterStore = 0;
    pendingApprovalRef = null;
    abortControllerRef = null;
    pendingQueuedText = null;
    set({
      messages: [],
      sending: false,
      status: null,
      error: null,
      pendingApproval: null,
      currentThreadId: null,
      currentTitle: null,
      queuedText: null,
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
    // display transcript so the panel renders the prior turns. Drop any empty
    // assistant bubble, an interrupted turn (for example a reload that raced the
    // post-reply save) would otherwise render forever as a "Thinking" placeholder.
    historyStore = stored.history ?? [];
    const restoredMessages = (stored.messages ?? []).filter(
      (m) => !(m.role === "assistant" && m.content.trim() === ""),
    );
    // Keep the message-id counter ahead of any restored id so newly minted ids
    // never collide with restored ones. Restored ids look like "msg-<n>-<ts>",
    // so parse the <n> and take the max.
    let maxN = 0;
    for (const m of restoredMessages) {
      const match = /^msg-(\d+)-/.exec(m.id);
      if (match) maxN = Math.max(maxN, Number(match[1]));
    }
    counterStore = maxN;
    pendingApprovalRef = null;
    set({
      messages: restoredMessages,
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
    // Guard: discard empty input.
    if (!trimmed) return;
    // If a turn is already in flight, store the message in the single-slot
    // queue instead of silently dropping it. The running turn's finally block
    // will pick it up. Later queued calls replace an earlier one (last-wins).
    if (get().sending) {
      pendingQueuedText = trimmed;
      set({ queuedText: trimmed });
      return;
    }

    set({ error: null });

    // Create a fresh controller for this send. Guard against a stale ref from a
    // previous turn that was not cleaned up (belt-and-suspenders).
    if (abortControllerRef) {
      abortControllerRef.abort();
    }
    const controller = new AbortController();
    abortControllerRef = controller;

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
    // have a visible target right away. Clear followups from all existing
    // messages so only the most recent reply shows chips.
    set((state) => ({
      messages: [
        ...state.messages.map((m) =>
          m.followups ? { ...m, followups: undefined } : m,
        ),
        userMessage,
        { id: assistantId, role: "assistant" as ChatRole, content: "" },
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
        // Persist without the empty assistant placeholder, so a reload before
        // the reply lands leaves a recoverable user-only chat, never an empty
        // assistant bubble that reopens as a stuck "Thinking". The completed
        // assistant turn is written by the saveChat after revealAnswer below.
        messages: [userMessage],
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
    // Always lead the per-turn note with the live review mode so the model knows
    // whether to gate each step (step-by-step) or propose one plan up front
    // (whole-plan). Read fresh every send so flipping the header mid-conversation
    // takes effect on the next turn. The page context, when present, follows it.
    const reviewDirective = reviewModeDirective(getReviewMode());
    const dateLine = todayContext();
    const injectedContent = ctxDescription
      ? `${dateLine}\n\n${reviewDirective}\n\n${ctxDescription}`
      : `${dateLine}\n\n${reviewDirective}`;
    // Hold the per-turn message by reference so it can be removed from the
    // persisted history after the run. The loop returns the input array with new
    // turns appended (it only pushes, never clones), so the SAME object identity
    // survives, and an identity filter strips exactly the one we injected.
    const contextMessage: LoopMessage = { role: "system", content: injectedContent };

    // Inject the user's standing memory preferences as a second per-turn system
    // line. Read fresh every send so a just-saved preference applies immediately.
    // Held by reference for the same identity-filter-before-persist pattern as
    // contextMessage: it is stripped from result.messages before historyStore is
    // updated so it never accumulates (one stale copy per send is the bug to avoid).
    // Silently skipped when no memory file exists or no folder is connected.
    const memoryEntries = await getMemoryEntries();
    const memoryContent = buildMemoryContext(memoryEntries);
    const memoryMessage: LoopMessage | null = memoryContent
      ? { role: "system", content: memoryContent }
      : null;

    const loopInput: LoopMessage[] = [
      historyStore[0], // base system prompt
      contextMessage, // fresh per-turn review mode + context
      ...(memoryMessage ? [memoryMessage] : []), // per-turn user preferences
      ...historyStore.slice(1), // rest of persisted history
      { role: "user", content: trimmed },
    ];

    // Snapshot the thread id now. A concurrent newChat() or loadThread() call
    // during the async loop or typewriter could clear currentThreadId in the
    // store; we keep the id we got here so saveChat always targets the right
    // record regardless of what the UI does while we are awaiting.
    let boundThreadId = get().currentThreadId;

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
        signal: controller.signal,
      });

      // Persist the full loop history (including tool turns) for the next send,
      // but strip ALL per-turn injected messages by reference so they never persist.
      // Persisting any of them would let a stale line accumulate, one extra system
      // message per send. Both contextMessage and memoryMessage (when present) are
      // filtered by the same identity check.
      historyStore = result.messages.filter(
        (m) => m !== contextMessage && m !== memoryMessage,
      );
      set({ status: null });

      // A stopped (aborted) run returns an empty answer. Remove the placeholder
      // and return quietly, no error banner needed. We still save the user message
      // to disk (it was already seeded in createChat for fresh threads, but an
      // existing thread's user message must be written so it is not lost on reload).
      if (controller.signal.aborted || result.answer.length === 0) {
        set((state) => ({
          messages: state.messages.filter((m) => m.id !== assistantId),
          // Show an error only for a genuine empty reply, not a user-initiated stop.
          ...(result.answer.length === 0 && !controller.signal.aborted
            ? { error: "BeakerBot returned an empty reply. Try again." }
            : {}),
        }));
        // Re-read boundThreadId in case it was assigned during an awaited createChat
        // that completed just before the abort check. Only persist the user message
        // (no assistant reply) so the thread is at least recoverable on reload.
        boundThreadId = boundThreadId ?? get().currentThreadId;
        if (boundThreadId !== null && !controller.signal.aborted) {
          const existingMessages = get().messages.filter(
            (m) => !(m.role === "assistant" && m.content === ""),
          );
          await saveChat(boundThreadId, {
            messages: existingMessages,
            history: historyStore,
          });
        }
        return;
      }

      // Parse and strip the optional follow-up suggestions directive before
      // revealing the answer, so the typewriter never shows the raw comment.
      const { stripped: displayAnswer, followups } = extractFollowups(result.answer);
      await revealAnswer(assistantId, displayAnswer);

      // Stamp the followups onto the assistant message after the reveal, so
      // chips appear once the answer is fully typed rather than mid-reveal.
      if (followups.length > 0) {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === assistantId ? { ...m, followups } : m,
          ),
        }));
      }

      // Snapshot the completed messages before any further async. This guards
      // against a concurrent newChat() that clears get().messages between the
      // revealAnswer resolve and the saveChat write. We capture BOTH the thread
      // id and the message snapshot here so the save is fully self-contained.
      const savedMessages = get().messages;

      // Persist the completed turn. We save the post-strip historyStore (the
      // per-turn context message was already removed above) plus the full
      // display transcript, and bump updatedAt. Resilient, a failed write logs
      // a warn inside saveChat and never throws into the loop.
      if (boundThreadId !== null) {
        await saveChat(boundThreadId, {
          messages: savedMessages,
          history: historyStore,
        });
      }
    } catch (err) {
      set({ status: null });
      // Defensive: err may be undefined, null, or a non-Error value if something
      // in the agent loop or the proxy re-throws a non-Error. Always normalize to
      // a safe string so the error state never contains undefined. A thrown
      // undefined is the pathological case that crashes Next 16.1.6's .digest
      // handler if it escapes to the React error boundary.
      const message =
        err instanceof ProxyError
          ? err.message
          : "Something went wrong talking to BeakerBot. Try again.";
      set((state) => ({
        error: message,
        messages: state.messages.filter((m) => m.id !== assistantId),
      }));
    } finally {
      // Clear the controller ref if it is still pointing at this send's controller.
      // If stop() already replaced it with null, leave it alone.
      if (abortControllerRef === controller) {
        abortControllerRef = null;
      }
      set({ sending: false, queuedText: null });
      // If a message was queued while this turn ran, fire it now. The queue slot
      // is cleared first so a stop() during the queued send can cancel that turn
      // without re-queuing.
      const next = pendingQueuedText;
      pendingQueuedText = null;
      if (next) {
        // Defer one tick so the sending=false state settles before re-entering
        // send(). Without the deferral the sending guard would still see true
        // in synchronous code that executes within the same microtask.
        void Promise.resolve().then(() => get().send(next));
      }
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

/** Returns the current single-slot queued text. For tests. */
export function getPendingQueuedText(): string | null {
  return pendingQueuedText;
}

/** Resets module-level state (history, counter, approval ref, abort ref, queue). For tests. */
export function resetConversationModule(): void {
  historyStore = [];
  counterStore = 0;
  pendingApprovalRef = null;
  abortControllerRef = null;
  pendingQueuedText = null;
  useConversationStore.setState({
    messages: [],
    sending: false,
    status: null,
    error: null,
    pendingApproval: null,
    currentThreadId: null,
    currentTitle: null,
    queuedText: null,
  });
}
