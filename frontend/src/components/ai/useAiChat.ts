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
import { READ_ONLY_TOOLS } from "@/lib/ai/tools/registry";
import { BEAKERBOT_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";

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
};

function statusLabel(status: LoopStatus): string {
  if (status.phase === "tool") {
    return TOOL_STATUS[status.toolName] ?? "looking something up";
  }
  return "thinking";
}

// Reveal the final answer with a light client-side typewriter effect, so the
// answer does not pop in all at once. This is cosmetic, not real token streaming.
const REVEAL_STEP_CHARS = 3;
const REVEAL_INTERVAL_MS = 16;

export function useAiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          tools: READ_ONLY_TOOLS,
          callModel: callModelViaProxy,
          onStatus: (s) => setStatus(statusLabel(s)),
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
    [sending, nextId, revealAnswer],
  );

  return { messages, sending, status, error, send };
}
