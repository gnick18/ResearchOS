"use client";

// useAiChat (ai foundation bot, 2026-06-10).
//
// The conversation state + streaming send for the BeakerBot panel. It POSTs the
// running conversation to the local proxy at /api/ai/chat, reads the streamed
// response with a ReadableStream reader, and feeds each decoded chunk through the
// pure SseDeltaParser so the assistant reply renders token-by-token.
//
// The plumbing here is the only thing this foundation slice proves: BeakerBot can
// talk to Llama. No tools, no agent loop, no modes, no writes. Just a streamed
// chat round-trip.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useRef, useState } from "react";
import { SseDeltaParser } from "@/lib/ai/sse";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

const ENDPOINT = "/api/ai/chat";

export function useAiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counterRef = useRef(0);

  const nextId = useCallback(() => {
    counterRef.current += 1;
    return `msg-${counterRef.current}-${Date.now()}`;
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

      // Seed an empty assistant bubble so tokens stream into a visible target.
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setSending(true);

      // Send the whole running conversation (the proxy only forwards role +
      // content). Build the wire payload from the pre-send history plus the new
      // user turn, so the just-seeded empty assistant bubble is excluded.
      const wire = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: wire }),
        });

        if (!res.ok || !res.body) {
          // The proxy returns a JSON { error } on the missing-key and provider
          // error paths. Surface it in the panel instead of a silent failure.
          let message = `Request failed (status ${res.status}).`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data?.error) message = data.error;
          } catch {
            // Non-JSON error body, keep the status message.
          }
          setError(message);
          // Drop the empty assistant bubble that will never fill.
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseDeltaParser();
        let acc = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const { deltas, done: streamDone } = parser.push(chunk);
          if (deltas.length > 0) {
            acc += deltas.join("");
            const text = acc;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: text } : m,
              ),
            );
          }
          if (streamDone) break;
        }

        // Drain any complete trailing line with no terminating newline.
        const tail = parser.flush();
        if (tail.deltas.length > 0) {
          acc += tail.deltas.join("");
          const text = acc;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: text } : m,
            ),
          );
        }

        if (acc.length === 0) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          setError("BeakerBot returned an empty reply. Try again.");
        }
      } catch {
        setError("Something went wrong talking to BeakerBot. Try again.");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setSending(false);
      }
    },
    [messages, sending, nextId],
  );

  return { messages, sending, error, send };
}
