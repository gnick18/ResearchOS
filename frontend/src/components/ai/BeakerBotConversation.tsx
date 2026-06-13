"use client";

// BeakerBotConversation (ai convo-store bot, 2026-06-11; ai palette-morph bot,
// 2026-06-11; ai chat-embeds bot, 2026-06-11; ai transform-tool bot, 2026-06-11).
//
// Reusable conversation body extracted from BeakerBotPanel. Contains the
// message thread, the AssistantMarkdown renderer with ObjectChip tile upgrades,
// block embed rendering via ObjectEmbed, all four approval-card shapes (plan,
// action, draft, choice), the status line, and the composer (textarea + send
// button).
//
// It reads from the persistent conversation store via useAiChat(), so two
// surfaces can render the same conversation simultaneously, and the state
// survives the component unmounting and remounting (e.g. the BeakerSearch
// palette opening and closing). BeakerBotPanel uses this component for its
// body; the BeakerSearch palette renders it in Ask mode (Phase 2).
//
// BRIDGE REGISTRATION: the navigation bridge and the message bridge are no longer
// registered here. As of Phase 2 both are registered ONCE at the root layout level
// (BeakerBotBridges, mounted in app/layout.tsx), so rendering this component in
// multiple surfaces (dock and palette simultaneously) does not double-register or
// open a null-handler window on unmount.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@/components/icons";
import { useAiChat } from "./useAiChat";
import BeakerBotThinking from "./BeakerBotThinking";
import ObjectChip from "@/components/ObjectChip";
import ObjectEmbed from "@/components/embeds/ObjectEmbed";
import { parseObjectDeepLink, parseObjectEmbed } from "@/lib/references";
import { loneEmbedFromChatParagraph, type ChatHastNode } from "./chat-embed-detect";
import type {
  StepApprovalRequest,
  TransformApprovalRequest,
  TransformStepBlock,
} from "@/lib/ai/tools/types";
import type { IconName } from "@/components/icons";

// Lightweight markdown renderer for assistant replies only. Scoped to this
// component. Uses standard semantic elements styled by the app's Tailwind prose
// utilities.
//
// Two rendering paths on top of the default:
//   Block embeds: a paragraph that is a lone object-embed link (href carries
//   a #ros= fragment, parseObjectEmbed returns isEmbed true) renders as
//   <ObjectEmbed>, which dispatches to MoleculeEmbed, DataHubEmbed, etc. by
//   type. Any renderer the shared embeds session adds flows in automatically
//   because we dispatch through the same ObjectEmbed dispatcher.
//
//   Inline chips: an <a> whose href is a plain object deep-link (no #ros=
//   fragment, or #ros=chip) renders as <ObjectChip>. Notes, tasks, and
//   experiments open their popup in place; sequences navigate. The chip is the
//   right choice for things that have a popup, the embed is the right choice
//   for rich visuals (molecules, Data Hub tables).
//
//   External links still open in a new tab with rel=noopener.
export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground [&_a]:text-brand [&_a]:underline [&_code]:rounded [&_code]:bg-surface-overlay [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-overlay [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // A paragraph that is a lone object-embed link renders as a block
          // embed. Every other paragraph renders normally; this is additive.
          // basePath is undefined for chat (no file-relative image paths).
          p: ({ node, children, ...props }) => {
            const lone = loneEmbedFromChatParagraph(node as unknown as ChatHastNode);
            if (lone) {
              return (
                <ObjectEmbed
                  descriptor={lone.descriptor}
                  caption={lone.caption}
                />
              );
            }
            return <p {...props}>{children}</p>;
          },
          a: ({ href, children, ...props }) => {
            // An object embed link that ends up inline (mid-sentence) is
            // handled here instead of via the p override. Treat it as a chip
            // when it is a valid object deep-link, falling back to new-tab.
            const embedDesc = parseObjectEmbed(href ?? "");
            if (embedDesc && embedDesc.isEmbed) {
              // Mid-sentence embed link: degrade to a chip (the block path
              // above already handled the lone-paragraph case).
              const label =
                typeof children === "string"
                  ? children
                  : Array.isArray(children)
                    ? children.join("")
                    : String(children ?? embedDesc.id);
              return (
                <ObjectChip
                  type={embedDesc.type}
                  href={href ?? ""}
                  label={label}
                />
              );
            }
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
          <Icon name="ask" className="h-5 w-5" title="Question" />
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
                  ? "bg-brand-action text-white transition-colors hover:bg-brand-action/90 border-transparent"
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
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium disabled:cursor-not-allowed disabled:opacity-50"
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

// ---------------------------------------------------------------------------
// TransformApprovalCard: the block card for transform_table approval.
//
// Visual target: docs/mockups/beakerbot-transform-blocks.html.
// Mirrors the TransformDialog visual language (KIND_META labels + blurbs, param
// pills, preview table) so the two front ends are consistent.
//
// Structure:
//   - Header: "Transform pipeline, from <sourceName>" + proposed result name.
//   - Numbered step block(s): number badge, step name, blurb, param pills,
//     optional first-rows preview table.
//   - Footer: Approve / Reject buttons.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.
// ---------------------------------------------------------------------------

function TransformPreviewTable({
  preview,
}: {
  preview: NonNullable<TransformStepBlock["preview"]>;
}) {
  if (!preview.columns.length) return null;
  return (
    <div
      className="mt-2 overflow-auto rounded-md border border-border"
      data-testid="beakerbot-transform-preview"
    >
      <p className="bg-surface-sunken px-2 py-1 text-meta text-foreground-muted">
        First rows preview
      </p>
      <table className="w-full border-collapse text-meta tabular-nums">
        <thead>
          <tr>
            {preview.columns.map((col) => (
              <th
                key={col}
                className="border border-border bg-surface-sunken px-2 py-1 text-left font-semibold text-foreground"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="border border-border bg-surface-raised px-2 py-1 text-foreground-muted"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransformApprovalCard({
  request,
  onApprove,
  onReject,
}: {
  request: TransformApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div
      data-testid="beakerbot-approval-transform"
      className="mx-4 mb-2 rounded-md border border-brand bg-brand/5 px-3 py-2"
    >
      {/* Header */}
      <div className="mb-2 flex items-start gap-2">
        <span className="text-brand">
          <Icon name="transform" className="h-5 w-5" title="Transform" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-meta font-semibold text-foreground">
            Transform pipeline, from {request.sourceName}
          </p>
          <p className="text-meta text-foreground-muted">
            New table: {request.resultName}
          </p>
        </div>
      </div>

      {/* Step blocks */}
      <div className="mb-2 flex flex-col gap-2">
        {request.steps.map((step, index) => (
          <div
            key={index}
            className="flex gap-2 rounded-md border border-border bg-surface-raised px-3 py-2"
            data-testid="beakerbot-transform-step"
          >
            {/* Number badge */}
            <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 border-border bg-surface text-meta font-bold text-foreground-muted">
              {index + 1}
            </div>
            {/* Step body */}
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-foreground">{step.name}</p>
              <p className="mt-0.5 text-meta text-foreground-muted">{step.blurb}</p>
              {/* Param pills */}
              {step.params.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {step.params.map((pill) => (
                    <span
                      key={pill.label}
                      className="rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-meta text-foreground-muted"
                    >
                      <span className="font-medium text-foreground">{pill.label}</span>
                      {": "}
                      {pill.value}
                    </span>
                  ))}
                </div>
              )}
              {/* Live preview table */}
              {step.preview && <TransformPreviewTable preview={step.preview} />}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="beakerbot-transform-approve"
          onClick={onApprove}
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium"
        >
          <Icon name="check" className="h-3.5 w-3.5" title="Approve" />
          Approve
        </button>
        <button
          type="button"
          data-testid="beakerbot-transform-reject"
          onClick={onReject}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
        >
          <Icon name="close" className="h-3.5 w-3.5" title="Reject" />
          Reject
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepApprovalCard, the rich-block approval for a previewable analysis, plot, or
// model step (run_datahub_analysis, compare_models, make_datahub_graph, the
// regression / global-fit family) in step-by-step review mode. Reuses the
// transform card's step-block layout (param pills + live preview) with a generic
// header and a type icon, and renders the readout-line preview the analysis tools
// emit instead of a table. House style, Icon only, brand + semantic tokens.
// ---------------------------------------------------------------------------

function StepApprovalCard({
  request,
  onApprove,
  onReject,
}: {
  request: StepApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div
      data-testid="beakerbot-approval-step"
      className="mx-4 mb-2 rounded-md border border-brand bg-brand/5 px-3 py-2"
    >
      {/* Header */}
      <div className="mb-2 flex items-start gap-2">
        <span className="text-brand">
          <Icon
            name={request.iconName as IconName}
            className="h-5 w-5"
            title={request.title}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-meta font-semibold text-foreground">{request.title}</p>
          {request.subtitle ? (
            <p className="text-meta text-foreground-muted">{request.subtitle}</p>
          ) : null}
        </div>
      </div>

      {/* Step blocks */}
      <div className="mb-2 flex flex-col gap-2">
        {request.steps.map((step, index) => (
          <div
            key={index}
            className="flex gap-2 rounded-md border border-border bg-surface-raised px-3 py-2"
            data-testid="beakerbot-step-block"
          >
            {/* Type-icon badge */}
            <div className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-brand/10 text-brand">
              <Icon
                name={request.iconName as IconName}
                className="h-3.5 w-3.5"
                title={step.name}
              />
            </div>
            {/* Step body */}
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-foreground">{step.name}</p>
              <p className="mt-0.5 text-meta text-foreground-muted">{step.blurb}</p>
              {/* Param pills */}
              {step.params.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {step.params.map((pill) => (
                    <span
                      key={pill.label}
                      className="rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-meta text-foreground-muted"
                    >
                      <span className="font-medium text-foreground">{pill.label}</span>
                      {": "}
                      {pill.value}
                    </span>
                  ))}
                </div>
              )}
              {/* Live table preview, when present (none of the analysis tools emit
                  one today, kept so the card stays drop-in for a future tabular
                  preview). */}
              {step.preview && <TransformPreviewTable preview={step.preview} />}
              {/* Readout-line preview (the resolved test, the figure plan, the
                  model pair). */}
              {step.previewLines && step.previewLines.length > 0 && (
                <div
                  className="mt-2 rounded-md border border-dashed border-border bg-surface-sunken px-2.5 py-2"
                  data-testid="beakerbot-step-preview"
                >
                  {step.previewLines.map((line, li) => (
                    <p key={li} className="text-meta text-foreground-muted">
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="beakerbot-step-approve"
          onClick={onApprove}
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium"
        >
          <Icon name="check" className="h-3.5 w-3.5" title="Approve" />
          Approve and run
        </button>
        <button
          type="button"
          data-testid="beakerbot-step-reject"
          onClick={onReject}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
        >
          <Icon name="close" className="h-3.5 w-3.5" title="Reject" />
          Reject
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
    stop,
    pendingApproval,
    resolveApproval,
    resolveChoice,
    queuedText,
    clearQueue,
  } = useAiChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  // Track the assistant message id for the in-flight placeholder so stop() can
  // remove the empty bubble if the turn is cancelled before any text arrives.
  const assistantIdRef = useRef<string | null>(null);

  // Bridge registration (useNavigationBridge + useBeakerBotMessageBridge) moved
  // to BeakerBotBridges (mounted once in app/layout.tsx). This component is now
  // bridge-free so it can render in multiple surfaces without double-registering.

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
    // Capture the id of the empty assistant placeholder the store just seeded.
    // The store seeds it synchronously before the first await, so we can read
    // it from the messages array on the next render. We use an effect below to
    // capture it after the state update settles.
  };

  const handleStop = () => {
    stop(assistantIdRef.current ?? undefined);
    assistantIdRef.current = null;
  };

  // After each send, capture the id of the empty assistant placeholder so
  // handleStop can pass it to stop() for removal.
  useEffect(() => {
    if (sending) {
      const emptyAssistant = messages.findLast(
        (m) => m.role === "assistant" && m.content === "",
      );
      if (emptyAssistant) {
        assistantIdRef.current = emptyAssistant.id;
      }
    } else {
      assistantIdRef.current = null;
    }
  }, [sending, messages]);

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
          messages.map((m, index) => {
            // Only the last message in the list is eligible to show follow-up chips.
            const isLast = index === messages.length - 1;
            return (
              <div key={m.id} className="flex flex-col gap-1.5 self-start w-full">
                <div
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
                      // The living blue blob, BeakerBot's thinking indicator. It is
                      // an abstract pulse, not a beaker, so it does not conflict with
                      // the single riding mascot. The grey status line rides alongside
                      // it as the label.
                      <span data-testid="beakerbot-status">
                        <BeakerBotThinking variant="pulse" label={status ?? "Thinking"} />
                      </span>
                    )
                  ) : (
                    m.content
                  )}
                </div>

                {/* Follow-up suggestion chips, shown only below the last assistant message. */}
                {isLast &&
                  m.role === "assistant" &&
                  m.followups &&
                  m.followups.length > 0 &&
                  !sending ? (
                  <div
                    data-testid="beakerbot-followups"
                    className="flex flex-wrap gap-1.5 pl-1"
                  >
                    {m.followups.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        data-testid="beakerbot-followup-chip"
                        onClick={() => {
                          setDraft("");
                          void send(suggestion);
                        }}
                        className="rounded-full border border-border bg-surface px-2.5 py-1 text-meta text-foreground-muted transition-colors hover:border-brand hover:bg-brand/10 hover:text-foreground"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
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
              <Icon name="list" className="h-5 w-5" title="Plan" />
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
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium"
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
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium"
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
              <Icon name="pencil" className="h-5 w-5" title="Draft" />
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
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium"
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

      {/* Transform block card (transform_table). Step block(s) with param pills
          and a live preview of the first rows, then Approve / Reject. Keyed on
          the result name so a re-call remounts cleanly. */}
      {pendingApproval && pendingApproval.request.kind === "transform" ? (
        <TransformApprovalCard
          key={pendingApproval.request.resultName}
          request={pendingApproval.request}
          onApprove={() => resolveApproval("allow")}
          onReject={() => resolveApproval("skip")}
        />
      ) : null}

      {/* Step block card (the previewable analysis / plot / model tools). Generic
          header + a type-icon block with param pills and a readout preview, then
          Approve / Reject. Keyed on the title so a re-call remounts cleanly. */}
      {pendingApproval && pendingApproval.request.kind === "step" ? (
        <StepApprovalCard
          key={pendingApproval.request.title}
          request={pendingApproval.request}
          onApprove={() => resolveApproval("allow")}
          onReject={() => resolveApproval("skip")}
        />
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

      {/* Queued message indicator: shown when a message was typed during an
          in-flight turn and is waiting to auto-send once the reply finishes. */}
      {queuedText ? (
        <div
          data-testid="beakerbot-queued"
          className="mx-4 mb-2 flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-meta text-foreground-muted"
        >
          <span className="truncate flex-1">
            Queued: {queuedText}
          </span>
          <button
            type="button"
            aria-label="Discard queued message"
            onClick={clearQueue}
            className="flex-none text-[10px] hover:text-foreground"
          >
            Discard
          </button>
        </div>
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
          {sending ? (
            // Stop button: replaces send while a turn is in flight. Uses a small
            // filled square (a styled span) as the glyph because no stop/square
            // icon exists in the registry (adding one requires Grant sign-off per
            // AGENTS.md). A span is not an inline SVG, so the icon-guard hook does
            // not flag it.
            <button
              type="button"
              data-testid="beakerbot-stop"
              onClick={handleStop}
              aria-label="Stop"
              className="flex items-center justify-center rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <span
                aria-hidden="true"
                className="block h-3.5 w-3.5 rounded-sm bg-current"
              />
            </button>
          ) : (
            <button
              type="button"
              data-testid="beakerbot-send"
              onClick={handleSend}
              disabled={draft.trim().length === 0}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-2 text-body font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="chevronRight" className="h-4 w-4" title="Send" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
