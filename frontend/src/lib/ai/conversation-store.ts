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
  type TokenUsage,
  type ModelCaller,
  type PlanProgress,
  type PlanRunState,
} from "@/lib/ai/agent-loop";
import { BEAKERBOT_PLAN_STEPS_ENABLED } from "@/lib/ai/config";
import { callModelViaProxy, proxyCallerForTask, ProxyError } from "@/lib/ai/proxy-client";

// ---- Dev-only model-caller override seam ------------------------------------
//
// The production ModelCaller (callModelViaProxy) is used by default. A dev page
// can inject a mock by calling setModelCallerOverride(mockFn), and restore the
// original by calling setModelCallerOverride(null). Null by default so production
// behavior is completely unaffected.

let modelCallerOverride: ModelCaller | null = null;

/**
 * Replace the model caller used inside send(). Pass null to restore
 * callModelViaProxy. For dev pages only; has no effect in production builds
 * when no dev page calls this.
 */
export function setModelCallerOverride(fn: ModelCaller | null): void {
  modelCallerOverride = fn;
}

/** Returns the active model caller: the override when set, otherwise the real
 *  proxy. When a taskId is given (one per BeakerBot task), the proxy caller is
 *  bound to it so every turn of the task meters under one task_id in the ledger. */
function getModelCaller(taskId?: string): ModelCaller {
  if (modelCallerOverride) return modelCallerOverride;
  return taskId ? proxyCallerForTask(taskId) : callModelViaProxy;
}
import { DEFAULT_TOOLS } from "@/lib/ai/tools/registry";
import { BEAKERBOT_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import {
  runMacro,
  summarizeMacroRun,
  invocationsFromHistory,
} from "@/lib/ai/macro-runner";
import {
  captureMacroSteps,
  type StoredMacro,
  type MacroStep,
} from "@/lib/ai/beaker-macros-store";
import { getReviewMode, type BeakerBotReviewMode } from "@/lib/ai/review-mode-store";
import {
  getBeakerContext,
  describeBeakerContext,
} from "@/components/ai/context-bridge";
import { resolveRef } from "@/lib/ai/page-perception";
import {
  showSpotlight,
  dismissSpotlight,
  setSpotlightSuppressed,
} from "@/components/ai/spotlight-controller";
import { getMemoryEntries, buildMemoryContext } from "@/lib/ai/user-memory";
import type {
  ApprovalRequest,
  ApprovalDecision,
  ChoiceDecision,
} from "@/lib/ai/tools/types";
import { statusLabel } from "@/components/ai/thinking-status";
import { useCanvasStore } from "@/lib/ai/canvas-store";
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
  // Base64 data URLs of images attached to this message (vision feature, gated
  // on NEXT_PUBLIC_BEAKERBOT_VISION). Stored on the DISPLAY message for rendering
  // only. The persisted historyStore collapses these to a "[image attached]" text
  // marker so images are NOT re-sent on every subsequent turn (multimodal providers
  // charge per-image per-turn). The display message keeps .images so the user still
  // sees the thumbnails after sending.
  images?: string[];
};

// The pending approval the UI renders while the loop is paused on the user.
// Carries the human summary plus a resolver. Clicking Allow / Skip in the UI
// calls the resolver, which unblocks the loop's requestApproval promise.
export type PendingApproval = {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
};

// A settled-turn summary pinned below each assistant reply. Stays visible for
// the rest of the conversation so the user can audit what each turn cost.
export type TurnSummary = {
  // The assistant message id this summary belongs to, used to anchor the
  // summary UI directly below that reply.
  assistantId: string;
  // Wall-clock duration of the turn in milliseconds.
  elapsedMs: number;
  // Total tokens (prompt + completion) for the turn. Zero when the provider
  // did not report usage; the UI omits the token count when zero.
  tokens: number;
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

// Bumped on every clearConversation / newChat. A queued message is fired one
// microtask after its turn settles; if the user started a fresh chat in that
// window, the epoch no longer matches and the stale queued send is dropped
// instead of firing into the new conversation.
let conversationEpoch = 0;

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

  // ---- Live status line fields (STAGE 1, 2026-06-13) ------------------------
  //
  // These drive the running status line (elapsed, tokens, running-count) and the
  // settled per-turn token summary that stays pinned after each turn finishes.
  //
  // turnStartedAt: wall-clock time (Date.now()) when the current turn began.
  //   Non-null only while sending is true.
  turnStartedAt: number | null;
  // turnElapsedMs: reactive elapsed time for the running turn, ticked by a
  //   setInterval in the component. Stays at the final value after settling so
  //   the pinned summary can show the real duration. Reset to null on newChat.
  turnElapsedMs: number | null;
  // turnTokens: cumulative prompt+completion tokens for the current (or last)
  //   turn, updated live via onUsage. Zero when the provider did not report
  //   usage; the UI shows it only when > 0. Reset to null on newChat.
  turnTokens: number | null;
  // runningToolCount: number of tool calls in progress right now. The agent
  //   loop reports tool-phase status one tool at a time (serial dispatch), so
  //   this is 0 or 1 today, but the field is a count so parallel dispatch in a
  //   future iteration requires no schema change. Reset to 0 on settle.
  runningToolCount: number;
  // settledTurns: per-turn summaries that stay pinned below each assistant
  //   reply after the turn finishes. Each entry carries the assistant message id
  //   (so the UI can match it), the elapsed duration, and the total tokens.
  settledTurns: TurnSummary[];
  // turnToolSteps: ordered list of tool calls dispatched in the current turn,
  //   with a status per call. Used by the expandable steps panel. Each entry
  //   starts as "running" when onStatus fires for that tool, then flips to
  //   "done" when a subsequent thinking or different-tool phase arrives. Reset
  //   to [] on each new turn.
  turnToolSteps: ToolStep[];

  // ---- Vision / image attachment state (gated on NEXT_PUBLIC_BEAKERBOT_VISION) --
  //
  // pendingImages: base64 data URLs the user has staged for the NEXT send. The
  //   composer reads this to show removable thumbnails. Cleared on every send()
  //   and on clearConversation/newChat.
  pendingImages: string[];

  // ---- PDF paper attachment state -----------------------------------------------
  //
  // attachedPaper: the paper currently staged for the next send. Null when no PDF
  //   is attached. Cleared on every send() (the text is injected as a per-turn
  //   context message on that turn, then discarded so it is NOT re-sent every later
  //   turn) and on clearConversation/newChat. The composer reads this to show the
  //   PDF chip with extracting/ready states.
  attachedPaper: AttachedPaper | null;

  // ---- @ mention attached refs state --------------------------------------------
  //
  // attachedRefs: the list of objects the user has picked via the @ picker and
  //   staged for the next send. Each ref is rendered as a per-type colored chip
  //   above the composer input. Cleared on every send() (injected as a per-turn
  //   context system note on that turn, then discarded via the identity-filter
  //   pattern so it is NOT re-sent on every later turn) and on
  //   clearConversation/newChat.
  attachedRefs: AttachedRef[];

  // ---- Resumable plan card (2026-06-13) -----------------------------------------
  //
  // The live state of a per-step-driven plan, gated on BEAKERBOT_PLAN_STEPS_ENABLED.
  // Set from runAgentLoop's onPlanProgress while a plan runs, flipped to "paused"
  // on settle when the run stopped with steps remaining (so the card can offer
  // Resume). Null when no plan is active. Persisted with the thread so a paused
  // plan survives a reload.
  activePlan: ActivePlan | null;
}

// The plan shown in the live plan card. `index` is the current/last step run;
// `status` drives the card (running ticks, paused offers Resume, done collapses).
export type ActivePlan = {
  steps: string[];
  index: number;
  status: "running" | "paused" | "done";
  summary?: string;
};

// ---- Attached object refs (@ mentions) ----------------------------------------
//
// An AttachedRef is one object the user selected via the @ picker. It carries
// just enough metadata to inject a per-turn context note for the model (the
// model uses the id + type + name to call the right read tool) and to render
// the chip in the composer.
//
// Cleared on send() and on clearConversation/newChat so they never carry over
// to the next turn.

/** One user-selected object attached via the @ mention picker. */
export type AttachedRef = {
  /** The canonical object type from the global index. */
  type: "task" | "project" | "method" | "sequence" | "inventory" | "note" | "datahub" | "molecule" | "purchase";
  /** The composite key (e.g. "note-gnickles:42"), unique within the index. */
  id: string;
  /** Display name shown on the chip and injected into the per-turn note. */
  name: string;
  /** Deep-link href to open the object (carried for future chip-click nav). */
  deepLink: string;
};

/** A paper PDF that has been extracted and staged for the next send. */
export type AttachedPaper = {
  /** Original file name (for display in the chip). */
  name: string;
  /** Extracted text, already capped by TEXT_BUDGET_CHARS. */
  text: string;
  /** Total page count reported by pdfjs. */
  pageCount: number;
  /** Whether the text was truncated at the budget. */
  truncated: boolean;
};

// A single tool call entry in the live steps panel.
export type ToolStep = {
  toolName: string;
  // The current status of this step in the panel.
  status: "running" | "done" | "queued";
};

interface ConversationActions {
  send: (text: string) => Promise<void>;
  /**
   * Run a saved workflow macro. Raises one Run-card approval (the same plan
   * approval UI), and on approval replays the macro's steps deterministically via
   * runMacro, reusing the same approval bridge so a destructive step still
   * self-confirms mid-run. No model is called on the happy path. Posts a /command
   * user line and a one-line result, and reuses the live steps panel. A no-op when
   * a turn is already in flight.
   */
  runStoredMacro: (macro: StoredMacro) => Promise<void>;
  /**
   * Capture the most recent run as macro steps, for the "Save as macro"
   * affordance. Reads the executed tool calls from the loop history (where the
   * args live), labels each via the tool's describeAction, and drops navigation
   * and read noise. Returns the captured steps (empty when the last turn ran no
   * meaningful tools), the editor takes it from there. Pure read, no side effect.
   */
  captureMacroDraftFromLastRun: () => MacroStep[];
  /**
   * Resume a paused per-step plan from where it stopped. Re-enters the agent loop
   * with the remaining steps seeded as already-approved (no re-approval), injecting
   * a directive for the current step. No-op unless an activePlan is paused and no
   * turn is in flight.
   */
  resumePlan: () => Promise<void>;
  /** Dismiss the active plan card (Cancel the rest). Clears activePlan, does not
   *  undo steps already done. */
  dismissPlan: () => void;
  /** Stage a base64 data URL image for the next send. Gated on the vision flag in the UI; the store accepts it regardless so tests can call it directly. */
  addPendingImage: (dataUrl: string) => void;
  /** Remove a staged image by its data URL. */
  removePendingImage: (dataUrl: string) => void;
  /** Clear all staged images without sending. */
  clearPendingImages: () => void;
  /** Stage an extracted paper for the next send. Replaces any previously staged paper. */
  setAttachedPaper: (paper: AttachedPaper) => void;
  /** Remove the staged paper without sending. */
  clearAttachedPaper: () => void;
  /** Add an object ref via the @ picker. Deduplicates by id. */
  addAttachedRef: (ref: AttachedRef) => void;
  /** Remove one attached ref by its id. */
  removeAttachedRef: (id: string) => void;
  /** Clear all attached refs without sending. */
  clearAttachedRefs: () => void;
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
  /**
   * Re-run the most recent user turn to get a fresh assistant reply.
   *
   * The last assistant message is dropped from both the reactive messages array
   * and the historyStore (leaving the history at the point just after the last
   * user message was appended but before the assistant replied). The last user
   * message text is then re-sent via the normal send() path.
   *
   * Guard: only valid when the last settled assistant reply exists and no send
   * is currently in flight. No-op otherwise.
   */
  regenerate: () => Promise<void>;
  /**
   * Rewind the conversation to a given user message, discarding all turns that
   * came after it.
   *
   * What is kept: every message up to AND INCLUDING the identified user message.
   * What is removed: the assistant reply to that user message and every message
   * after it (later user turns and their replies).
   *
   * Both the reactive messages array and historyStore are truncated to the same
   * point so they remain in sync. conversationEpoch is bumped so any queued
   * deferred send that was queued before the revert cannot fire into the rewound
   * conversation.
   *
   * Guard: only valid when the target message exists with role "user" and no
   * send is currently in flight. No-op otherwise.
   */
  revertToHere: (messageId: string) => void;
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
      // force: an approval spotlight is the consent moment for a destructive or
      // outward-facing step and must show even while a plan run suppresses the
      // per-step coaching spotlights.
      showSpotlight(el, `BeakerBot wants to ${request.summary}.`, { force: true });
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

    // A DRAFT request is editable, so it opens in Canvas (the docked side panel)
    // instead of a read-only Approve / Reject card in the chat. The chat renders
    // a compact "Drafted in Canvas" pointer line off pendingApproval; the actual
    // consent (Save) and rejection (Discard) happen in Canvas. We hand Canvas the
    // SAME pending.resolve, so Save resolves a draft-save decision (the edited
    // buffer) and Discard resolves "skip" through the one guarded resolver. The
    // pointer line carries no buttons, so Canvas is the only path that resolves.
    if (request.kind === "draft") {
      useCanvasStore.getState().openDraft({
        id: `draft-${counterStore}-${Date.now()}`,
        toolName: request.toolName,
        title: request.title ?? request.noteTitle ?? "",
        mode: request.mode,
        ...(request.noteTitle ? { noteTitle: request.noteTitle } : {}),
        content: request.content,
        resolve: pending.resolve,
      });
    }
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
  // Live status line initial values.
  turnStartedAt: null,
  turnElapsedMs: null,
  turnTokens: null,
  runningToolCount: 0,
  settledTurns: [],
  turnToolSteps: [],
  // Vision attachment state.
  pendingImages: [],
  // PDF paper attachment state.
  attachedPaper: null,
  // @ mention attached refs.
  attachedRefs: [],
  // Resumable plan card.
  activePlan: null,

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
    // Tear down any open Canvas drafts so a stopped turn does not leave a stale
    // pending draft panel. reset() resolves any still-pending tab "skip" too (a
    // belt-and-suspenders no-op when stop already resolved the shared resolver).
    useCanvasStore.getState().reset();
    // Remove the empty assistant placeholder (the "Thinking" bubble) if the
    // caller passed its id. We only remove it when it is still empty, so a
    // partial typewriter reveal is never wiped.
    set((state) => ({
      sending: false,
      status: null,
      queuedText: null,
      runningToolCount: 0,
      turnStartedAt: null,
      turnToolSteps: [],
      messages: placeholderAssistantId
        ? state.messages.filter(
            (m) => !(m.id === placeholderAssistantId && m.content === ""),
          )
        : state.messages,
    }));
  },

  addPendingImage: (dataUrl: string) => {
    set((state) => ({ pendingImages: [...state.pendingImages, dataUrl] }));
  },

  removePendingImage: (dataUrl: string) => {
    set((state) => ({
      pendingImages: state.pendingImages.filter((u) => u !== dataUrl),
    }));
  },

  clearPendingImages: () => {
    set({ pendingImages: [] });
  },

  setAttachedPaper: (paper: AttachedPaper) => {
    set({ attachedPaper: paper });
  },

  clearAttachedPaper: () => {
    set({ attachedPaper: null });
  },

  addAttachedRef: (ref: AttachedRef) => {
    set((state) => {
      // Deduplicate by id so double-selecting the same object is a no-op.
      if (state.attachedRefs.some((r) => r.id === ref.id)) return state;
      return { attachedRefs: [...state.attachedRefs, ref] };
    });
  },

  removeAttachedRef: (id: string) => {
    set((state) => ({
      attachedRefs: state.attachedRefs.filter((r) => r.id !== id),
    }));
  },

  clearAttachedRefs: () => {
    set({ attachedRefs: [] });
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
    // Tear down any open Canvas drafts on a fresh chat. reset() resolves any
    // still-pending tab "skip" so a paused agent loop does not dangle.
    useCanvasStore.getState().reset();
    // Invalidate any in-flight deferred queued-send so it cannot fire into the
    // fresh conversation (the stale "Queued: ..." re-trigger on new chat).
    conversationEpoch += 1;
    set({
      messages: [],
      sending: false,
      status: null,
      error: null,
      pendingApproval: null,
      currentThreadId: null,
      currentTitle: null,
      queuedText: null,
      // Reset all status-line fields on a fresh chat.
      turnStartedAt: null,
      turnElapsedMs: null,
      turnTokens: null,
      runningToolCount: 0,
      settledTurns: [],
      turnToolSteps: [],
      // Clear any staged images when starting fresh.
      pendingImages: [],
      // Clear any staged paper when starting fresh.
      attachedPaper: null,
      // Clear any attached refs when starting fresh.
      attachedRefs: [],
      // Clear any active plan card when starting fresh.
      activePlan: null,
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
    // Tear down any open Canvas drafts when switching threads.
    useCanvasStore.getState().reset();
    set({
      messages: restoredMessages,
      sending: false,
      status: null,
      error: null,
      pendingApproval: null,
      currentThreadId: stored.id,
      currentTitle: stored.title,
      // Settled-turn summaries are session-only and not persisted, so a reopened
      // thread starts with an empty list. Token counts are not shown for prior
      // sessions in this version.
      turnStartedAt: null,
      turnElapsedMs: null,
      turnTokens: null,
      runningToolCount: 0,
      settledTurns: [],
      turnToolSteps: [],
      // Discard any staged images when switching threads.
      pendingImages: [],
      // Discard any staged paper when switching threads.
      attachedPaper: null,
      // Discard any attached refs when switching threads.
      attachedRefs: [],
      // Restore a paused plan so the reopened thread offers Resume (only paused
      // plans are persisted; a running one was in-flight and is not resumed blind).
      activePlan:
        stored.activePlan && stored.activePlan.status === "paused"
          ? stored.activePlan
          : null,
    });
  },

  resolveApproval: (decision: ApprovalDecision) => {
    pendingApprovalRef?.resolve(decision);
  },

  resolveChoice: (selected: string[], cancelled: boolean) => {
    const decision: ChoiceDecision = { kind: "choice", selected, cancelled };
    pendingApprovalRef?.resolve(decision);
  },

  regenerate: async () => {
    const state = get();
    // Guard: nothing to regenerate while a turn is in flight.
    if (state.sending) return;
    const msgs = state.messages;
    if (msgs.length === 0) return;

    // Find the last assistant message. It must be a settled (non-empty) reply.
    const lastAssistant = [...msgs].reverse().find(
      (m) => m.role === "assistant" && m.content.trim().length > 0,
    );
    if (!lastAssistant) return;

    // Find the user message that preceded the last assistant reply.
    const lastAssistantIndex = msgs.findIndex((m) => m.id === lastAssistant.id);
    if (lastAssistantIndex < 1) return;
    const lastUser = msgs[lastAssistantIndex - 1];
    if (!lastUser || lastUser.role !== "user") return;

    // Drop both the last user message and the last assistant message from the
    // reactive transcript. send() will re-append the user message and a fresh
    // assistant placeholder, so removing both keeps the count correct.
    const nextMessages = msgs.slice(0, lastAssistantIndex - 1);
    set({ messages: nextMessages });

    // Drop the last assistant reply (and the user turn before it) from
    // historyStore. The historyStore contains system turns, tool turns, and the
    // user/assistant text turns. Strip from the last matching user message
    // onward so the history is at the state it was BEFORE the user sent this
    // turn. send() will re-inject the user message as a fresh LoopMessage.
    const lastUserContent = lastUser.content;
    const lastHistUserIdx = [...historyStore]
      .reverse()
      .findIndex(
        (m) => m.role === "user" && m.content === lastUserContent,
      );
    if (lastHistUserIdx !== -1) {
      const forwardIndex = historyStore.length - 1 - lastHistUserIdx;
      // Trim to just before the last user message.
      historyStore = historyStore.slice(0, forwardIndex);
    }

    // Re-send the last user message through the normal path. send() will seed a
    // fresh assistant placeholder and run the full loop.
    await get().send(lastUser.content);
  },

  revertToHere: (messageId: string) => {
    const state = get();
    // Guard: cannot revert while a send is in flight.
    if (state.sending) return;

    const msgs = state.messages;
    const targetIndex = msgs.findIndex((m) => m.id === messageId);
    if (targetIndex === -1) return;
    const target = msgs[targetIndex];
    if (!target || target.role !== "user") return;

    // Keep everything up to and including the target user message.
    // Remove: the assistant reply to this user message and every message after
    // it. The chat is left ready for the user to re-ask or continue from here.
    const keptMessages = msgs.slice(0, targetIndex + 1);
    set({ messages: keptMessages });

    // Trim historyStore to the same logical point. The target user message in
    // historyStore is the last LoopMessage with role "user" and content
    // matching the target. Everything after it (tool calls, assistant reply,
    // subsequent turns) is discarded.
    const targetContent = target.content;
    const lastHistUserIndex = [...historyStore]
      .reverse()
      .findIndex(
        (m) => m.role === "user" && m.content === targetContent,
      );
    if (lastHistUserIndex !== -1) {
      const forwardIndex = historyStore.length - 1 - lastHistUserIndex;
      // Keep through and including this user message; drop what follows.
      historyStore = historyStore.slice(0, forwardIndex + 1);
    }

    // Bump the epoch so any deferred queued send cannot fire into the rewound
    // conversation.
    conversationEpoch += 1;
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

    // Snapshot and clear the staged images atomically with the send. Any images
    // the user staged before pressing Send are consumed on this turn only; the
    // store slot is emptied so they do not carry over to the next turn.
    const capturedImages = get().pendingImages;
    // Snapshot and clear the staged paper atomically with the send. The paper
    // text is injected as a per-turn system message (paperMessage) and is
    // identity-filtered out of historyStore after the loop, so it is NOT
    // re-sent on every subsequent turn (the same pattern as contextMessage /
    // memoryMessage). Cleared here so it does not carry over to the next turn.
    const capturedPaper = get().attachedPaper;
    // Snapshot and clear any @ mention attached refs atomically with the send.
    // Injected as a per-turn refsMessage (identity-filtered out after the loop
    // so they are NOT re-sent on every later turn). Cleared here so chips do
    // not carry over to the next message.
    const capturedRefs = get().attachedRefs;
    set({ pendingImages: [], attachedPaper: null, attachedRefs: [] });

    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: trimmed,
      // Attach the display-only images. The thread render uses these for
      // thumbnails. They are NOT persisted to historyStore verbatim (see the
      // cost-collapse below).
      ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
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
    //
    // Also record the turn start time and reset the live status-line fields so
    // any values from a prior turn do not bleed into this one.
    const turnStartedAt = Date.now();
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
      // Live status-line fields for the new turn.
      turnStartedAt,
      turnElapsedMs: 0,
      turnTokens: null,
      runningToolCount: 0,
      turnToolSteps: [],
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

    // Inject the attached paper text as a per-turn system message. Held by
    // reference for the same identity-filter-before-persist pattern as
    // contextMessage and memoryMessage: it is stripped from result.messages
    // before historyStore is updated so the large paper text is NOT re-sent on
    // every subsequent turn. Null when no paper is attached on this turn.
    // Format: "[Attached paper: <name>, <N> pages]\n<text>[TRUNCATED]"
    const paperMessage: LoopMessage | null = capturedPaper
      ? {
          role: "system",
          content: [
            `[Attached paper: ${capturedPaper.name}, ${capturedPaper.pageCount} page${capturedPaper.pageCount === 1 ? "" : "s"}]`,
            capturedPaper.truncated
              ? `${capturedPaper.text}\n\n[Note: paper text was truncated at 60,000 characters because the document is very long. Only the first portion of the paper is shown above.]`
              : capturedPaper.text,
          ].join("\n"),
        }
      : null;

    // Inject the @ mention attached refs as a per-turn system message. The
    // note lists each object by type, name, and id so the model can call the
    // correct read tool without guessing. Held by reference for the same
    // identity-filter-before-persist pattern as contextMessage; stripped from
    // result.messages before historyStore is updated so it is NOT re-sent on
    // every later turn. Null when no refs are attached on this turn.
    const refsMessage: LoopMessage | null =
      capturedRefs.length > 0
        ? {
            role: "system",
            content: [
              "The user attached these objects via @ mention. Act on exactly these objects. Do not guess or infer other objects from the conversation.",
              ...capturedRefs.map(
                (r) => `- ${r.type} "${r.name}" (id: ${r.id})`,
              ),
            ].join("\n"),
          }
        : null;

    // Build the user turn for the loop. When images are staged, content is a
    // LoopContentBlock array so the vision router in the API proxy selects the
    // vision model. The text block is omitted when the message is image-only
    // (trimmed is empty). When no images are staged, content stays a plain
    // string so non-vision turns reach the standard model unchanged.
    //
    // COST-COLLAPSE: the image blocks appear only in the live turn sent to the
    // model. The historyStore entry that persists for subsequent turns uses the
    // text content plus a short "[image attached]" marker so the image data URL
    // is NOT re-sent on every later turn (multimodal providers charge per image
    // per turn). The DISPLAY message keeps .images for thumbnails.
    //
    // The collapseMessage is held by reference (like contextMessage) so the
    // identity-filter after runAgentLoop can strip it from result.messages
    // before persisting to historyStore. We then push a collapsed version in
    // its place.
    let userLoopMessage: LoopMessage;
    let collapseMessage: LoopMessage | null = null;
    if (capturedImages.length > 0) {
      // The image_url block goes to the model on this turn.
      const imageBlocks = capturedImages.map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      }));
      const textBlock = trimmed
        ? [{ type: "text" as const, text: trimmed }]
        : [];
      userLoopMessage = {
        role: "user",
        content: [...textBlock, ...imageBlocks],
      };
      // The collapsed version stored in historyStore for subsequent turns.
      // Images are replaced with a terse marker. The model reads this on later
      // turns so it knows an image was present without re-paying the per-image
      // token cost.
      const collapseText = trimmed
        ? `${trimmed} [image attached]`
        : "[image attached]";
      collapseMessage = { role: "user", content: collapseText };
    } else {
      userLoopMessage = { role: "user", content: trimmed };
    }

    const loopInput: LoopMessage[] = [
      historyStore[0], // base system prompt
      contextMessage, // fresh per-turn review mode + context
      ...(memoryMessage ? [memoryMessage] : []), // per-turn user preferences
      ...(paperMessage ? [paperMessage] : []), // per-turn attached paper text (if any)
      ...(refsMessage ? [refsMessage] : []), // per-turn @ mention refs (if any)
      ...historyStore.slice(1), // rest of persisted history
      userLoopMessage, // this turn's user message (may be multimodal)
    ];

    // Snapshot the thread id now. A concurrent newChat() or loadThread() call
    // during the async loop or typewriter could clear currentThreadId in the
    // store; we keep the id we got here so saveChat always targets the right
    // record regardless of what the UI does while we are awaiting.
    let boundThreadId = get().currentThreadId;

    // One id per task so the billing ledger groups every turn of this task.
    const taskId = crypto.randomUUID();
    try {
      const result = await runAgentLoop({
        messages: loopInput,
        tools: DEFAULT_TOOLS,
        callModel: getModelCaller(taskId),
        onStatus: (s) => {
          // Update the friendly status label for the existing "Thinking" text.
          // Also update the running-tool count and the steps panel list.
          const label = statusLabel(s);
          const isToolPhase = s.phase === "tool";
          set((state) => {
            // Mark any currently-running step as done before adding a new one.
            const prevSteps = state.turnToolSteps.map((step) =>
              step.status === "running" ? { ...step, status: "done" as const } : step,
            );
            const nextSteps = isToolPhase
              ? [
                  ...prevSteps,
                  { toolName: (s as { toolName: string }).toolName, status: "running" as const },
                ]
              : prevSteps;
            return {
              status: label,
              runningToolCount: isToolPhase ? 1 : 0,
              turnToolSteps: nextSteps,
            };
          });
        },
        // Read the live review mode at each dispatch, so flipping the control
        // mid-conversation takes effect on the next step.
        getReviewMode: getReviewMode,
        requestApproval,
        signal: controller.signal,
        // Resumable plan card (flag-gated): drive an approved plan one step at a
        // time and mirror each tick into activePlan for the live card.
        drivePlanPerStep: BEAKERBOT_PLAN_STEPS_ENABLED,
        onPlanProgress: (p: PlanProgress) => {
          set({
            activePlan: {
              steps: p.steps,
              index: p.index,
              status: p.status,
            },
          });
          // Nav polish: suppress the per-step coaching spotlights while the plan
          // is actively running so a fast multi-step run does not flash a ring +
          // bubble on every navigation. The finally block clears suppression on
          // any exit, so a "running" left at abort time never sticks.
          setSpotlightSuppressed(p.status === "running");
        },
        // Update the reactive token total after each model iteration so the
        // status line ticks live. The loop fires this only when the provider
        // reports non-zero usage, so a zero here is always a real zero.
        onUsage: (cumulative: TokenUsage) => {
          set({
            turnTokens:
              cumulative.promptTokens + cumulative.completionTokens,
          });
        },
      });

      // Resumable plan card: if the driven plan stopped with steps remaining
      // (abort, guard, error), mark it paused so the card offers Resume from the
      // in-progress step. A completed plan already reported "done" via onPlanProgress.
      if (result.planRun && result.planRun.active) {
        set((state) =>
          state.activePlan
            ? {
                activePlan: {
                  ...state.activePlan,
                  index: result.planRun!.index,
                  status: "paused",
                },
              }
            : {},
        );
      }

      // Persist the full loop history (including tool turns) for the next send,
      // but strip ALL per-turn injected messages by reference so they never persist.
      // Persisting any of them would let a stale line accumulate, one extra system
      // message per send. contextMessage, memoryMessage, and paperMessage (when
      // present) are all filtered by the same identity check. The large paper text
      // in particular must not persist, as re-sending it on every later turn would
      // be extremely expensive and incorrect (it was used on the turn it was needed).
      //
      // COST-COLLAPSE: when images were attached on this turn, userLoopMessage
      // carries the full image_url blocks. We replace that exact reference with
      // collapseMessage (plain text + "[image attached]") so the image data is NOT
      // re-sent on every subsequent turn. The display ChatMessage.images still
      // holds the thumbnails for rendering; only the historyStore entry is collapsed.
      const filteredMessages = result.messages.filter(
        (m) => m !== contextMessage && m !== memoryMessage && m !== paperMessage && m !== refsMessage,
      );
      if (collapseMessage !== null) {
        historyStore = filteredMessages.map((m) =>
          m === userLoopMessage ? collapseMessage! : m,
        );
      } else {
        historyStore = filteredMessages;
      }
      // Settle the turn. Compute the final elapsed time from the start timestamp
      // captured before the loop, then clear the running-tool count.
      const turnEndedAt = Date.now();
      const turnElapsedMs = turnEndedAt - turnStartedAt;
      const finalTokens = result.totalUsage.promptTokens + result.totalUsage.completionTokens;
      set((state) => ({
        status: null,
        runningToolCount: 0,
        // Keep turnElapsedMs at the final value so the settled status line can
        // show the real duration. It is only reset on newChat/clearConversation.
        turnElapsedMs,
        turnTokens: finalTokens > 0 ? finalTokens : state.turnTokens,
        // Mark any still-running step as done at settle time (the loop may have
        // returned the final answer without a subsequent thinking-phase callback
        // to flip the running step).
        turnToolSteps: state.turnToolSteps.map((step) =>
          step.status === "running" ? { ...step, status: "done" as const } : step,
        ),
      }));

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
            activePlan:
              get().activePlan?.status === "paused" ? get().activePlan : null,
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

      // Pin the settled-turn summary below the assistant reply. This fires after
      // the typewriter reveal so the summary appears once the answer is fully
      // shown. The turn elapsed time was computed above at loop settle, so it
      // reflects the full model+tool duration, not just the reveal time.
      const turnSummary: TurnSummary = {
        assistantId,
        elapsedMs: turnElapsedMs,
        tokens: finalTokens,
      };
      set((state) => ({
        settledTurns: [...state.settledTurns, turnSummary],
      }));

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
          activePlan:
            get().activePlan?.status === "paused" ? get().activePlan : null,
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
      // Clear the turn-in-progress marker. turnElapsedMs and turnTokens are left
      // at their settled values so the pinned summary line can still read them.
      // They are only fully reset by clearConversation/newChat.
      set({ sending: false, queuedText: null, turnStartedAt: null });
      // Nav polish: always re-enable coaching spotlights at turn end, so a plan
      // that stopped mid-step (abort, guard, error) never leaves them suppressed.
      setSpotlightSuppressed(false);
      // If a message was queued while this turn ran, fire it now. The queue slot
      // is cleared first so a stop() during the queued send can cancel that turn
      // without re-queuing.
      const next = pendingQueuedText;
      pendingQueuedText = null;
      if (next) {
        // Defer one tick so the sending=false state settles before re-entering
        // send(). Without the deferral the sending guard would still see true
        // in synchronous code that executes within the same microtask. Capture
        // the epoch now and bail if a newChat/clearConversation happened in the
        // meantime, so the queued message never fires into a fresh conversation.
        const epochAtSettle = conversationEpoch;
        void Promise.resolve().then(() => {
          if (conversationEpoch === epochAtSettle) get().send(next);
        });
      }
    }
  },

  runStoredMacro: async (macro: StoredMacro) => {
    // A macro run is a turn, so it respects the same single-turn guard as send.
    // Unlike a typed message it is not queued, the user can re-run it after.
    if (get().sending) return;

    set({ error: null });

    if (abortControllerRef) {
      abortControllerRef.abort();
    }
    const controller = new AbortController();
    abortControllerRef = controller;

    const enabledSteps = macro.steps.filter((s) => s.enabled !== false);

    // The display turn. The user line is the /command they invoked, the assistant
    // bubble is seeded empty so the steps panel and the result line have a target.
    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: `/${macro.name}`,
    };
    const assistantId = nextId();
    const wasFresh = get().currentThreadId === null;
    const turnStartedAt = Date.now();
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
      turnStartedAt,
      turnElapsedMs: 0,
      turnTokens: null,
      runningToolCount: 0,
      turnToolSteps: [],
    }));

    // Seed the system prompt once so a thread opened from a macro run is a valid
    // conversation the user can keep typing into afterwards.
    if (historyStore.length === 0) {
      historyStore = [{ role: "system", content: BEAKERBOT_SYSTEM_PROMPT }];
    }

    if (wasFresh) {
      const title = `/${macro.name}`;
      const created = await createChat({
        title,
        messages: [userMessage],
        history: historyStore,
      });
      if (created) {
        set({ currentThreadId: created.id, currentTitle: created.title });
      } else {
        set({ currentTitle: title });
      }
    }

    let boundThreadId = get().currentThreadId;

    try {
      // The single Run-card approval, reusing the plan approval UI. The labels are
      // the steps the user will see, the summary is the macro's description.
      const decision = await requestApproval({
        kind: "plan",
        toolName: `/${macro.name}`,
        steps: enabledSteps.map((s) => s.label),
        ...(macro.description ? { summary: macro.description } : {}),
      });

      if (decision !== "allow") {
        set({ status: null, runningToolCount: 0 });
        await revealAnswer(
          assistantId,
          `Cancelled /${macro.name}. Nothing ran.`,
        );
        boundThreadId = boundThreadId ?? get().currentThreadId;
        if (boundThreadId !== null) {
          await saveChat(boundThreadId, {
            messages: get().messages,
            history: historyStore,
          });
        }
        return;
      }

      // Replay the steps. runMacro reuses the agent-loop gate with the run
      // pre-approved, so routine steps run free and a destructive step still
      // raises its own confirm through the same requestApproval bridge.
      const result = await runMacro({
        macro,
        tools: DEFAULT_TOOLS,
        requestApproval,
        signal: controller.signal,
        onStep: (event) => {
          set((state) => {
            // Flip any running step to done before reacting to this event.
            const settled = state.turnToolSteps.map((step) =>
              step.status === "running"
                ? { ...step, status: "done" as const }
                : step,
            );
            if (event.status === "running") {
              return {
                status: `Running ${event.step.label}`,
                runningToolCount: 1,
                turnToolSteps: [
                  ...settled,
                  { toolName: event.step.label, status: "running" as const },
                ],
              };
            }
            // Terminal event (done, skipped, skipped-dangling, failed). The step
            // panel marks it done, the result detail is carried in the summary
            // line below so the panel stays simple.
            return { runningToolCount: 0, turnToolSteps: settled };
          });
        },
      });

      const turnElapsedMs = Date.now() - turnStartedAt;
      set((state) => ({
        status: null,
        runningToolCount: 0,
        turnElapsedMs,
        turnToolSteps: state.turnToolSteps.map((step) =>
          step.status === "running"
            ? { ...step, status: "done" as const }
            : step,
        ),
      }));

      // A user-initiated stop returns aborted, remove the placeholder quietly.
      if (controller.signal.aborted) {
        set((state) => ({
          messages: state.messages.filter((m) => m.id !== assistantId),
        }));
        return;
      }

      await revealAnswer(assistantId, summarizeMacroRun(macro.name, result));

      set((state) => ({
        settledTurns: [
          ...state.settledTurns,
          { assistantId, elapsedMs: turnElapsedMs, tokens: 0 },
        ],
      }));

      boundThreadId = boundThreadId ?? get().currentThreadId;
      if (boundThreadId !== null) {
        await saveChat(boundThreadId, {
          messages: get().messages,
          history: historyStore,
        });
      }
    } catch (err) {
      set({ status: null });
      console.warn("[conversation-store] runStoredMacro failed", err);
      set((state) => ({
        error: "Something went wrong running the macro. Try again.",
        messages: state.messages.filter((m) => m.id !== assistantId),
      }));
    } finally {
      if (abortControllerRef === controller) {
        abortControllerRef = null;
      }
      set({ sending: false, queuedText: null, turnStartedAt: null });
      setSpotlightSuppressed(false);
    }
  },

  captureMacroDraftFromLastRun: () => {
    const toolMap = new Map(DEFAULT_TOOLS.map((t) => [t.name, t] as const));
    const describeLabel = (
      tool: string,
      args: Record<string, unknown>,
    ): string => {
      try {
        const summary = toolMap.get(tool)?.describeAction?.(args)?.summary;
        if (summary && summary.trim().length > 0) return summary;
      } catch {
        // describeAction can throw on loose args, fall back to a generic label.
      }
      return `Run ${tool}`;
    };
    const invocations = invocationsFromHistory(historyStore, describeLabel);
    return captureMacroSteps(invocations);
  },

  dismissPlan: () => {
    set({ activePlan: null });
  },

  resumePlan: async () => {
    const plan = get().activePlan;
    if (get().sending) return;
    if (!plan || plan.status !== "paused") return;

    set({ error: null });
    if (abortControllerRef) abortControllerRef.abort();
    const controller = new AbortController();
    abortControllerRef = controller;

    const assistantId = nextId();
    const turnStartedAt = Date.now();
    set((state) => ({
      messages: [
        ...state.messages.map((m) =>
          m.followups ? { ...m, followups: undefined } : m,
        ),
        { id: assistantId, role: "assistant" as ChatRole, content: "" },
      ],
      sending: true,
      status: "thinking",
      turnStartedAt,
      turnElapsedMs: 0,
      turnTokens: null,
      runningToolCount: 0,
      turnToolSteps: [],
      activePlan: { ...plan, status: "running" },
    }));

    if (historyStore.length === 0) {
      historyStore = [{ role: "system", content: BEAKERBOT_SYSTEM_PROMPT }];
    }

    // The directive for the step we resume on. The loop drives the rest from the
    // seeded plan, treating it as already approved (no re-approval).
    const directive: LoopMessage = {
      role: "user",
      content: `Resume the approved plan. Do ONLY step ${plan.index + 1} of ${plan.steps.length}: "${plan.steps[plan.index]}". Do just this one step, then stop and say in one short sentence that it is done.`,
    };
    const loopInput: LoopMessage[] = [...historyStore, directive];

    let boundThreadId = get().currentThreadId;
    // One id per task so the billing ledger groups every turn of this task.
    const taskId = crypto.randomUUID();
    try {
      const result = await runAgentLoop({
        messages: loopInput,
        tools: DEFAULT_TOOLS,
        callModel: getModelCaller(taskId),
        getReviewMode: getReviewMode,
        requestApproval,
        signal: controller.signal,
        drivePlanPerStep: true,
        initialPlanRun: {
          steps: plan.steps,
          index: plan.index,
          active: true,
        },
        onPlanProgress: (p: PlanProgress) => {
          set({
            activePlan: { steps: p.steps, index: p.index, status: p.status },
          });
          // Nav polish (resume path): same coaching-spotlight suppression as the
          // send() driver. Cleared in the finally on any exit.
          setSpotlightSuppressed(p.status === "running");
        },
        onStatus: (s) => {
          const label = statusLabel(s);
          const isToolPhase = s.phase === "tool";
          set((state) => {
            const prevSteps = state.turnToolSteps.map((step) =>
              step.status === "running"
                ? { ...step, status: "done" as const }
                : step,
            );
            const nextSteps = isToolPhase
              ? [
                  ...prevSteps,
                  {
                    toolName: (s as { toolName: string }).toolName,
                    status: "running" as const,
                  },
                ]
              : prevSteps;
            return {
              status: label,
              runningToolCount: isToolPhase ? 1 : 0,
              turnToolSteps: nextSteps,
            };
          });
        },
        onUsage: (cumulative: TokenUsage) => {
          set({
            turnTokens: cumulative.promptTokens + cumulative.completionTokens,
          });
        },
      });

      // Strip the per-turn directive before persisting so it does not accumulate.
      historyStore = result.messages.filter((m) => m !== directive);

      const turnElapsedMs = Date.now() - turnStartedAt;
      set((state) => ({
        status: null,
        runningToolCount: 0,
        turnElapsedMs,
        turnToolSteps: state.turnToolSteps.map((step) =>
          step.status === "running" ? { ...step, status: "done" as const } : step,
        ),
      }));

      if (result.planRun && result.planRun.active) {
        set((state) =>
          state.activePlan
            ? {
                activePlan: {
                  ...state.activePlan,
                  index: result.planRun!.index,
                  status: "paused",
                },
              }
            : {},
        );
      }

      if (controller.signal.aborted || result.answer.length === 0) {
        set((state) => ({
          messages: state.messages.filter((m) => m.id !== assistantId),
        }));
        return;
      }

      const { stripped: displayAnswer } = extractFollowups(result.answer);
      await revealAnswer(assistantId, displayAnswer);

      boundThreadId = boundThreadId ?? get().currentThreadId;
      if (boundThreadId !== null) {
        await saveChat(boundThreadId, {
          messages: get().messages,
          history: historyStore,
          activePlan:
            get().activePlan?.status === "paused" ? get().activePlan : null,
        });
      }
    } catch (err) {
      set({ status: null });
      console.warn("[conversation-store] resumePlan failed", err);
      set((state) => ({
        error: "Something went wrong resuming the plan. Try again.",
        messages: state.messages.filter((m) => m.id !== assistantId),
      }));
    } finally {
      if (abortControllerRef === controller) {
        abortControllerRef = null;
      }
      set({ sending: false, queuedText: null, turnStartedAt: null });
      setSpotlightSuppressed(false);
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
  useCanvasStore.getState().reset();
  useConversationStore.setState({
    messages: [],
    sending: false,
    status: null,
    error: null,
    pendingApproval: null,
    currentThreadId: null,
    currentTitle: null,
    queuedText: null,
    turnStartedAt: null,
    turnElapsedMs: null,
    turnTokens: null,
    runningToolCount: 0,
    settledTurns: [],
    turnToolSteps: [],
    pendingImages: [],
    attachedPaper: null,
    attachedRefs: [],
  });
}
