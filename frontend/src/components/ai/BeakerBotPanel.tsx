"use client";

// BeakerBotPanel (ai foundation bot, 2026-06-10).
//
// The minimal docked BeakerBot conversation panel for the foundation slice. A
// right-docked column with a header (the BeakerBot name plus the reused vial
// glyph), a scrollable message list of user and assistant bubbles, a text input,
// and a send button. On send it POSTs the conversation to the local proxy and
// streams the assistant reply token-by-token (see useAiChat + lib/ai/sse).
//
// This slice proves the plumbing only: BeakerBot can talk to Llama. No tools, no
// modes, no writes. It is isolated under components/ai and is mounted only by the
// flag-gated /ai route, so it touches no shared global surface.
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useAiChat } from "./useAiChat";

export default function BeakerBotPanel() {
  const { messages, sending, error, send } = useAiChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view as tokens stream in.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    const text = draft;
    if (!text.trim() || sending) return;
    setDraft("");
    void send(text);
  };

  return (
    <div
      data-testid="beakerbot-panel"
      className="flex h-full w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-surface-overlay"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-brand">
          <Icon name="vial" className="h-5 w-5" title="BeakerBot" />
        </span>
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-foreground">BeakerBot</h2>
          <p className="text-meta text-foreground-muted">
            Ask BeakerBot about your work in ResearchOS.
          </p>
        </div>
      </header>

      <div
        ref={listRef}
        data-testid="beakerbot-messages"
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="m-auto max-w-xs text-center text-meta text-foreground-muted">
            Send a message to start. BeakerBot runs on an opt-in model, so nothing
            leaves your device until you ask it something.
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              data-testid={`beakerbot-message-${m.role}`}
              className={
                m.role === "user"
                  ? "self-end max-w-[85%] rounded-lg bg-brand px-3 py-2 text-body text-white"
                  : "self-start max-w-[85%] rounded-lg bg-surface-raised px-3 py-2 text-body text-foreground"
              }
            >
              {m.content || (
                <span className="text-foreground-muted">BeakerBot is thinking</span>
              )}
            </div>
          ))
        )}
      </div>

      {error ? (
        <div
          data-testid="beakerbot-error"
          className="mx-4 mb-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground"
        >
          {error}
        </div>
      ) : null}

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            data-testid="beakerbot-input"
            aria-label="Message BeakerBot"
            rows={2}
            value={draft}
            disabled={sending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Message BeakerBot"
            className="min-h-0 flex-1 resize-none rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <button
            type="button"
            data-testid="beakerbot-send"
            onClick={handleSend}
            disabled={sending || draft.trim().length === 0}
            className="btn-brand rounded-md px-3 py-2 text-body font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="chevronRight" className="h-4 w-4" title="Send" />
          </button>
        </div>
      </div>
    </div>
  );
}
