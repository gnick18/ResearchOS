"use client";

// useAiChat (ai tools bot, 2026-06-10).
//
// The conversation state for the BeakerBot panel, now driven by the browser agent
// loop instead of a single streamed round-trip. On send it prepends the authored
// system prompt, runs `runAgentLoop` with the read-only toolset and the
// proxy-backed model caller, and renders the final answer with a light client-side
// typewriter reveal. The loop executes tools locally (read-only), so BeakerBot can
// answer from the user's real folder data.
//
// Why the loop and not the old stream, true token streaming of the final answer is
// a later polish (design doc), what unlocks real answers now is tool calling, and
// tool_calls are read reliably from a non-streaming response, not from SSE deltas.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useRef, useState } from "react";
import {
  runAgentLoop,
  type LoopMessage,
  type LoopStatus,
} from "@/lib/ai/agent-loop";
import { callModelViaProxy, ProxyError } from "@/lib/ai/proxy-client";
import { DEFAULT_TOOLS } from "@/lib/ai/tools/registry";
import { BEAKERBOT_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { getAutonomyMode } from "@/lib/ai/autonomy-store";
import { resolveRef } from "@/lib/ai/page-perception";
import { showSpotlight, dismissSpotlight } from "@/components/ai/spotlight-controller";
import type {
  ApprovalRequest,
  ApprovalDecision,
} from "@/lib/ai/tools/types";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

// A small map from tool name to a human status line the panel shows while a tool
// runs. Concept-first, the user sees what BeakerBot is doing, not the function
// name. Falls back to a generic line for any tool not listed.
const TOOL_STATUS: Record<string, string> = {
  get_my_tasks: "checking your tasks",
  get_my_projects: "looking at your projects",
  read_page: "looking at the page",
  go_to_page: "taking you there",
  guide_to_element: "showing you where",
  click_element: "clicking for you",
  propose_plan: "planning the steps",
};

function statusLabel(status: LoopStatus): string {
  if (status.phase === "tool") {
    return TOOL_STATUS[status.toolName] ?? "looking something up";
  }
  if (status.phase === "awaiting-approval") {
    return "waiting for your go-ahead";
  }
  return "thinking";
}

// The pending approval the panel renders while the loop is paused on the user.
// It carries the human summary plus a resolver, clicking Allow / Skip in the
// panel calls the resolver, which unblocks the loop's requestApproval promise.
export type PendingApproval = {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
};

// Reveal the final answer with a light client-side typewriter effect, so the
// answer does not pop in all at once. This is cosmetic, not real token streaming.
const REVEAL_STEP_CHARS = 3;
const REVEAL_INTERVAL_MS = 16;

export function useAiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The approval the panel is currently asking the user about, or null when the
  // loop is not paused on a confirm. The panel renders an Allow / Skip prompt
  // from this and calls resolveApproval on the user's choice.
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  // A ref mirror of the pending approval so the Allow / Skip handler can resolve
  // the in-flight promise without depending on render state (the loop runs across
  // renders). Kept in sync wherever pendingApproval is set.
  const pendingApprovalRef = useRef<PendingApproval | null>(null);
  const counterRef = useRef(0);
  // The running loop history (with system prompt + tool turns), kept out of React
  // state because the panel only renders user + assistant text.
  const historyRef = useRef<LoopMessage[]>([]);

  const nextId = useCallback(() => {
    counterRef.current += 1;
    return `msg-${counterRef.current}-${Date.now()}`;
  }, []);

  const revealAnswer = useCallback((assistantId: string, answer: string) => {
    return new Promise<void>((resolve) => {
      if (answer.length === 0) {
        resolve();
        return;
      }
      let shown = 0;
      const tick = () => {
        shown = Math.min(answer.length, shown + REVEAL_STEP_CHARS);
        const text = answer.slice(0, shown);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m)),
        );
        if (shown >= answer.length) {
          resolve();
          return;
        }
        setTimeout(tick, REVEAL_INTERVAL_MS);
      };
      tick();
    });
  }, []);

  // The approval bridge the agent loop calls. It handles two request shapes, a
  // PLAN proposal (the whole plan up front, Approve / Cancel) and a single ACTION
  // confirm (the destructive hard-stop or a lone action, Allow / Skip). For an
  // action that targets a perceived element, it spotlights the target so the user
  // can SEE what will happen before allowing it (the same highlight
  // guide_to_element draws). A plan has no single target, so no spotlight. Either
  // way it surfaces the prompt and resolves with the user's decision. Returns a
  // promise that stays pending until the panel calls resolveApproval, which
  // pauses the loop without blocking the UI thread.
  const requestApproval = useCallback(
    (request: ApprovalRequest): Promise<ApprovalDecision> => {
      // Show the target so the user can see exactly what is about to be clicked
      // before they allow it. Only the single-action shape carries a ref, a plan
      // proposal does not. Best-effort, a stale ref simply shows no highlight,
      // the text summary still says what BeakerBot wants to do.
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
            // Clear the highlight and the prompt as the user answers, so neither
            // lingers into the next step. Guard against a double resolve.
            if (pendingApprovalRef.current !== pending) return;
            pendingApprovalRef.current = null;
            dismissSpotlight();
            setPendingApproval(null);
            resolve(decision);
          },
        };
        pendingApprovalRef.current = pending;
        setPendingApproval(pending);
      });
    },
    [],
  );

  // Called by the panel's Allow / Skip buttons. Resolves the in-flight approval
  // promise, unblocking the agent loop with the user's decision. The resolver
  // (set in requestApproval) clears the highlight and the prompt state itself, so
  // this only forwards the decision.
  const resolveApproval = useCallback(
    (decision: ApprovalDecision) => {
      pendingApprovalRef.current?.resolve(decision);
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      setError(null);
      const userMessage: ChatMessage = {
        id: nextId(),
        role: "user",
        content: trimmed,
      };
      const assistantId = nextId();

      // Seed an empty assistant bubble so the status and the revealed answer have a
      // visible target.
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setSending(true);
      setStatus("thinking");

      // Build the loop input. Seed the system prompt once, then carry the running
      // history forward so multi-turn context (and prior tool results) persist.
      if (historyRef.current.length === 0) {
        historyRef.current = [
          { role: "system", content: BEAKERBOT_SYSTEM_PROMPT },
        ];
      }
      const loopInput: LoopMessage[] = [
        ...historyRef.current,
        { role: "user", content: trimmed },
      ];

      try {
        const result = await runAgentLoop({
          messages: loopInput,
          tools: DEFAULT_TOOLS,
          callModel: callModelViaProxy,
          onStatus: (s) => setStatus(statusLabel(s)),
          // Read the live autonomy mode at each dispatch, so flipping the toggle
          // mid-conversation takes effect on the next action.
          getAutonomy: getAutonomyMode,
          requestApproval,
        });

        // Persist the full loop history (including tool turns) for the next send.
        historyRef.current = result.messages;
        setStatus(null);

        if (result.answer.length === 0) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          setError("BeakerBot returned an empty reply. Try again.");
          return;
        }
        await revealAnswer(assistantId, result.answer);
      } catch (err) {
        setStatus(null);
        // The proxy error text tells a dev exactly what to fix (missing key, etc).
        const message =
          err instanceof ProxyError
            ? err.message
            : "Something went wrong talking to BeakerBot. Try again.";
        setError(message);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setSending(false);
      }
    },
    [sending, nextId, revealAnswer, requestApproval],
  );

  return {
    messages,
    sending,
    status,
    error,
    send,
    pendingApproval,
    resolveApproval,
  };
}
