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
// Markdown rendering note: assistant replies are rendered with a lightweight
// ReactMarkdown + remarkGfm setup defined here rather than importing the shared
// RenderedMarkdown component. RenderedMarkdown is tightly coupled to the file-
// system-backed note context (blob URL resolution, AnnotatedImage, OcrReveal,
// ObjectChip deep-links). None of that applies to AI chat replies, and pulling it
// in would require providers and side-effects that do not belong in this panel.
// The same underlying packages (react-markdown, remark-gfm) are reused, keeping
// the rendered output consistent with the rest of the app's markdown style.
// User messages are intentionally rendered as plain text, never parsed as markdown,
// so user input cannot inject formatting or HTML.
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { useAiChat } from "./useAiChat";
import { useNavigationBridge } from "./navigation-bridge";
import { useBeakerBotAutonomy } from "@/lib/ai/autonomy-store";

// Lightweight markdown renderer for assistant replies only. Scoped to this panel.
// Uses standard semantic elements styled by the app's Tailwind prose utilities.
// The components map restricts rendering to safe, expected markdown elements and
// keeps links from doing anything unexpected (opens in a new tab, rel=noopener).
function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground [&_a]:text-brand [&_a]:underline [&_code]:rounded [&_code]:bg-surface-overlay [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-overlay [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Open external links safely; keep them from triggering app navigation.
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          ),
          // Tables would overflow the narrow panel. Render as a div so the
          // layout does not break even if the model ignores the formatting
          // guidance and produces one anyway. The system prompt tells BeakerBot
          // to avoid tables; this is the belt-and-suspenders fallback.
          table: ({ children }) => (
            <div className="overflow-x-auto text-xs">{children}</div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function BeakerBotPanel({
  onClose,
}: {
  // When provided, the header shows a close affordance. The app-wide docked
  // mount passes this so the panel can collapse; the full-page /ai route omits
  // it so that surface stays close-free, exactly as before.
  onClose?: () => void;
} = {}) {
  const { messages, sending, status, error, send, pendingApproval, resolveApproval } =
    useAiChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // The autonomy mode (ask-before-doing vs auto) governs whether BeakerBot's
  // actions pause for approval. The header control flips it; default is "ask".
  const autonomy = useBeakerBotAutonomy((s) => s.mode);
  const toggleAutonomy = useBeakerBotAutonomy((s) => s.toggle);

  // Register the soft-navigation handler so guide_to_element can drive a real
  // SPA route change (preserving the fixture capture param) instead of a reload.
  // The tool runs outside React, so this bridge is how it reaches the router.
  useNavigationBridge();

  // Keep the newest message in view as the answer reveals.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

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
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold text-foreground">BeakerBot</h2>
          <p className="text-meta text-foreground-muted">
            Ask BeakerBot about your work in ResearchOS.
          </p>
        </div>
        {/* Autonomy toggle. "Ask" (default) means BeakerBot proposes an action and
            waits for you to allow it. "Auto" lets it act on reversible in-app
            steps without asking, dangerous or outward-facing actions still
            confirm. */}
        <Tooltip
          label={
            autonomy === "auto"
              ? "Auto mode. BeakerBot acts without asking, except for risky actions. Click to require approval."
              : "Ask mode. BeakerBot asks before it acts. Click to let it act automatically."
          }
          placement="bottom"
        >
          <button
            type="button"
            data-testid="beakerbot-autonomy-toggle"
            aria-label={
              autonomy === "auto"
                ? "BeakerBot autonomy, auto. Switch to ask before doing."
                : "BeakerBot autonomy, ask before doing. Switch to auto."
            }
            aria-pressed={autonomy === "auto"}
            onClick={toggleAutonomy}
            className={`flex flex-shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-meta font-medium transition-colors ${
              autonomy === "auto"
                ? "border-brand bg-brand/10 text-brand"
                : "border-border text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
            }`}
          >
            <Icon
              name="gauge"
              className="h-3.5 w-3.5"
              title={autonomy === "auto" ? "Auto" : "Ask"}
            />
            {autonomy === "auto" ? "Auto" : "Ask"}
          </button>
        </Tooltip>
        {onClose ? (
          <button
            type="button"
            data-testid="beakerbot-close"
            aria-label="Close BeakerBot"
            onClick={onClose}
            className="flex-shrink-0 rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            <Icon name="close" className="h-4 w-4" title="Close BeakerBot" />
          </button>
        ) : null}
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
              {m.role === "assistant" ? (
                m.content ? (
                  // Render assistant replies as markdown. The typewriter reveal
                  // updates content incrementally; re-rendering on each update is
                  // intentional and flicker-free because ReactMarkdown is fast at
                  // small strings.
                  <AssistantMarkdown content={m.content} />
                ) : (
                  <span
                    data-testid="beakerbot-status"
                    className="text-foreground-muted"
                  >
                    BeakerBot is {status ?? "thinking"}
                  </span>
                )
              ) : (
                // User messages are always plain text. Never parse user input as
                // markdown to avoid unexpected formatting or injection.
                m.content
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

      {/* Approval prompt. Shown while the agent loop is paused waiting for the
          user to allow an action. The target element is already spotlighted on
          the page (see useAiChat.requestApproval), so the user can SEE what will
          happen before they allow it. A destructive target gets a firmer warning
          tone and an alert glyph. */}
      {pendingApproval ? (
        <div
          data-testid="beakerbot-approval"
          className={`mx-4 mb-2 rounded-md border px-3 py-2 ${
            pendingApproval.request.destructive
              ? "border-red-400 bg-red-50"
              : "border-brand bg-brand/5"
          }`}
        >
          <div className="mb-2 flex items-start gap-2">
            <span
              className={
                pendingApproval.request.destructive
                  ? "text-red-600"
                  : "text-brand"
              }
            >
              <Icon
                name={pendingApproval.request.destructive ? "alert" : "vial"}
                className="h-4 w-4"
                title="BeakerBot wants to act"
              />
            </span>
            <p className="text-meta text-foreground">
              BeakerBot wants to {pendingApproval.request.summary}.
              {pendingApproval.request.destructive
                ? " This action could be hard to undo, so it always asks first."
                : ""}{" "}
              Allow it?
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="beakerbot-approval-allow"
              onClick={() => resolveApproval("allow")}
              className="btn-brand flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium"
            >
              <Icon name="check" className="h-3.5 w-3.5" title="Allow" />
              Allow
            </button>
            <button
              type="button"
              data-testid="beakerbot-approval-skip"
              onClick={() => resolveApproval("skip")}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="skip" className="h-3.5 w-3.5" title="Skip" />
              Skip
            </button>
          </div>
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
