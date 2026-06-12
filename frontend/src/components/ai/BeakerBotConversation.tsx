"use client";

// BeakerBotConversation (ai convo-store bot, 2026-06-11).
//
// Reusable conversation body extracted from BeakerBotPanel. Contains the
// message thread, the AssistantMarkdown renderer with ObjectChip tile upgrades,
// all four approval-card shapes (plan, action, draft, choice), the status line,
// and the composer (textarea + send button).
//
// It reads from the persistent conversation store via useAiChat(), so two
// surfaces can render the same conversation simultaneously, and the state
// survives the component unmounting and remounting (e.g. the BeakerSearch
// palette opening and closing). BeakerBotPanel uses this component for its
// body; the BeakerSearch palette will add it in Phase 2.
//
// The navigation bridge (useNavigationBridge) and the message-bridge
// registration (useBeakerBotMessageBridge) are mounted HERE, not in
// BeakerBotPanel, because in Phase 2 this component will be the active
// conversation surface when the palette is open. BeakerBotPanel re-registers
// the same hooks via this component, so the behavior is identical to before.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@/components/icons";
import { useAiChat } from "./useAiChat";
import { useNavigationBridge } from "./navigation-bridge";
import { useBeakerBotMessageBridge } from "./message-bridge";
import ObjectChip from "@/components/ObjectChip";
import { parseObjectDeepLink } from "@/lib/references";

// Lightweight markdown renderer for assistant replies only. Scoped to this
// component. Uses standard semantic elements styled by the app's Tailwind prose
// utilities. Object deep-links are rendered as ObjectChip instead of plain
// anchors, turning a "write_note succeeded" reply into a real clickable tile.
// External links still open in a new tab with rel=noopener.
export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground [&_a]:text-brand [&_a]:underline [&_code]:rounded [&_code]:bg-surface-overlay [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-overlay [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const objectRef = parseObjectDeepLink(href ?? "");
            if (objectRef) {
              const label =
                typeof children === "string"
                  ? children
                  : Array.isArray(children)
                    ? String(children.join(""))
                    : String(children ?? objectRef.id);
              return (
                <ObjectChip
                  type={objectRef.type}
                  href={href ?? ""}
                  label={label}
                />
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
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

// The choice prompt (ask_user). Renders a button per option. Single-select
// resolves on a tap. Multi-select toggles chips and resolves on Confirm.
// Keyed on the question by the parent so each fresh ask_user remounts with a
// clean selection.
function ChoicePrompt({
  question,
  options,
  select,
  count,
  onResolve,
}: {
  question: string;
  options: string[];
  select: "one" | "multiple";
  count?: number;
  onResolve: (selected: string[], cancelled: boolean) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const multiple = select === "multiple";

  const toggle = (option: string) => {
    setPicked((prev) =>
      prev.includes(option)
        ? prev.filter((o) => o !== option)
        : [...prev, option],
    );
  };

  const confirmValid =
    picked.length >= 1 && (count === undefined || picked.length === count);

  const countHint =
    multiple && count !== undefined
      ? count === picked.length
        ? `${count} selected`
        : `Pick ${count} (${picked.length} selected)`
      : null;

  return (
    <div
      data-testid="beakerbot-choice"
      className="mx-4 mb-2 rounded-md border border-brand bg-brand/5 px-3 py-2"
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="text-brand">
          <Icon name="vial" className="h-4 w-4" title="BeakerBot has a question" />
        </span>
        <p className="text-meta text-foreground">{question}</p>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {options.map((option) => {
          const isPicked = picked.includes(option);
          return (
            <button
              key={option}
              type="button"
              data-testid="beakerbot-choice-option"
              aria-pressed={multiple ? isPicked : undefined}
              onClick={() => {
                if (multiple) toggle(option);
                else onResolve([option], false);
              }}
              className={`rounded-md border px-2.5 py-1 text-meta font-medium transition-colors ${
                multiple && isPicked
                  ? "btn-brand border-transparent"
                  : "border-border text-foreground hover:border-brand hover:bg-brand/10"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {countHint ? (
        <p
          data-testid="beakerbot-choice-hint"
          className="mb-2 text-meta text-foreground-muted"
        >
          {countHint}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        {multiple ? (
          <button
            type="button"
            data-testid="beakerbot-choice-confirm"
            disabled={!confirmValid}
            onClick={() => onResolve(picked, false)}
            className="btn-brand flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="check" className="h-3.5 w-3.5" title="Confirm" />
            Confirm
          </button>
        ) : null}
        <button
          type="button"
          data-testid="beakerbot-choice-cancel"
          onClick={() => onResolve([], true)}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
        >
          <Icon name="close" className="h-3.5 w-3.5" title="Cancel" />
          Cancel
        </button>
      </div>
    </div>
  );
}

// The full conversation body: thread, approvals, status, composer.
// Accepts an optional className to let the parent control sizing.
export default function BeakerBotConversation({
  className,
}: {
  className?: string;
} = {}) {
  const {
    messages,
    sending,
    status,
    error,
    send,
    pendingApproval,
    resolveApproval,
    resolveChoice,
  } = useAiChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // Register the soft-navigation handler so guide_to_element can drive a real
  // SPA route change without reloading the page and tearing down the panel.
  useNavigationBridge();

  // Register the send function into the message bridge so the BeakerSearch
  // command palette can seed a query into this conversation from outside the
  // React tree. Flushed immediately on registration if a message was queued.
  useBeakerBotMessageBridge(send);

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
    <div className={`flex flex-col overflow-hidden${className ? ` ${className}` : ""}`}>
      {/* Message thread */}
      <div
        ref={listRef}
        data-testid="beakerbot-messages"
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="m-auto max-w-xs text-center text-meta text-foreground-muted">
            Send a message to start. BeakerBot runs on an opt-in model, so
            nothing leaves your device until you ask it something.
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
                m.content
              )}
            </div>
          ))
        )}
      </div>

      {/* Error banner */}
      {error ? (
        <div
          data-testid="beakerbot-error"
          className="mx-4 mb-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground"
        >
          {error}
        </div>
      ) : null}

      {/* Plan approval. Approve / Cancel for the whole sequence. */}
      {pendingApproval && pendingApproval.request.kind === "plan" ? (
        <div
          data-testid="beakerbot-approval-plan"
          className="mx-4 mb-2 rounded-md border border-brand bg-brand/5 px-3 py-2"
        >
          <div className="mb-2 flex items-start gap-2">
            <span className="text-brand">
              <Icon
                name="vial"
                className="h-4 w-4"
                title="BeakerBot has a plan"
              />
            </span>
            <p className="text-meta text-foreground">
              {pendingApproval.request.summary
                ? `${pendingApproval.request.summary}. Here is the plan.`
                : "BeakerBot has a plan. Here are the steps."}
            </p>
          </div>
          <ol className="mb-2 ml-1 list-decimal space-y-0.5 pl-4 text-meta text-foreground">
            {pendingApproval.request.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="beakerbot-approval-approve"
              onClick={() => resolveApproval("allow")}
              className="btn-brand flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium"
            >
              <Icon name="check" className="h-3.5 w-3.5" title="Approve" />
              Approve
            </button>
            <button
              type="button"
              data-testid="beakerbot-approval-cancel"
              onClick={() => resolveApproval("skip")}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="close" className="h-3.5 w-3.5" title="Cancel" />
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Single-action approval. Allow / Skip for one step. */}
      {pendingApproval && pendingApproval.request.kind === "action" ? (
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

      {/* Draft preview (write_note). Review + Approve or Reject before writing. */}
      {pendingApproval && pendingApproval.request.kind === "draft" ? (
        <div
          data-testid="beakerbot-approval-draft"
          className="mx-4 mb-2 rounded-md border border-brand bg-brand/5 px-3 py-2"
        >
          <div className="mb-2 flex items-start gap-2">
            <span className="text-brand">
              <Icon
                name="vial"
                className="h-4 w-4"
                title="BeakerBot drafted a note"
              />
            </span>
            <p className="text-meta text-foreground">
              {pendingApproval.request.mode === "create"
                ? `I drafted a note${
                    pendingApproval.request.title
                      ? ` "${pendingApproval.request.title}"`
                      : ""
                  }. Review it before I write it.`
                : `I drafted a section to add${
                    pendingApproval.request.noteTitle
                      ? ` to "${pendingApproval.request.noteTitle}"`
                      : " to your note"
                  }. Review it before I write it.`}
            </p>
          </div>
          <div
            data-testid="beakerbot-draft-preview"
            className="mb-2 max-h-60 overflow-y-auto rounded border border-border bg-surface px-2 py-1.5"
          >
            <AssistantMarkdown content={pendingApproval.request.content} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="beakerbot-draft-approve"
              onClick={() => resolveApproval("allow")}
              className="btn-brand flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium"
            >
              <Icon name="check" className="h-3.5 w-3.5" title="Approve" />
              Approve
            </button>
            <button
              type="button"
              data-testid="beakerbot-draft-reject"
              onClick={() => resolveApproval("skip")}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="close" className="h-3.5 w-3.5" title="Reject" />
              Reject
            </button>
          </div>
        </div>
      ) : null}

      {/* Choice prompt (ask_user). Button per option. Keyed on the question so
          each fresh ask_user remounts with a clean selection. */}
      {pendingApproval && pendingApproval.request.kind === "choice" ? (
        <ChoicePrompt
          key={pendingApproval.request.question}
          question={pendingApproval.request.question}
          options={pendingApproval.request.options}
          select={pendingApproval.request.select}
          count={pendingApproval.request.count}
          onResolve={resolveChoice}
        />
      ) : null}

      {/* Composer */}
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
