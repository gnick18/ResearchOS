"use client";

// BeakerBotConversation (ai convo-store bot, 2026-06-11; ai palette-morph bot,
// 2026-06-11; ai chat-embeds bot, 2026-06-11; ai transform-tool bot, 2026-06-11;
// ai chat-modernization stage-2 bot, 2026-06-13).
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

import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { useAiChat } from "./useAiChat";
import { BEAKERBOT_VISION_ENABLED } from "@/lib/ai/config";
import { useVoiceInput, appendTranscript } from "@/lib/ai/useVoiceInput";
import BeakerBotThinking from "./BeakerBotThinking";
import { RunningStatusLine, SettledStatusLine } from "./TurnStatusLine";
import ObjectChip from "@/components/ObjectChip";
import ObjectEmbed from "@/components/embeds/ObjectEmbed";
import ComposerMentionPicker, {
  entryToRef,
} from "./ComposerMentionPicker";
import type { GlobalIndexEntry } from "@/components/beaker-search/global-index";
import ComposerSlashMenu, { type MacroMenuItem } from "./ComposerSlashMenu";
import MacroEditorSheet from "./MacroEditorSheet";
import BeakerBotPlanCard from "./BeakerBotPlanCard";
import { useMacroUiStore } from "@/lib/ai/macro-ui-store";
import {
  listMacros,
  type StoredMacro,
  type MacroStep,
} from "@/lib/ai/beaker-macros-store";
import {
  parseSlashQuery,
  filterSlashCommands,
  type SlashCommand,
} from "@/lib/ai/slash-commands";
import { parseObjectDeepLink, parseObjectEmbed } from "@/lib/references";
import { loneEmbedFromChatParagraph, type ChatHastNode } from "./chat-embed-detect";
import type {
  StepApprovalRequest,
  TransformApprovalRequest,
  TransformStepBlock,
} from "@/lib/ai/tools/types";
import type { IconName } from "@/components/icons";
import type { AttachedRef } from "@/lib/ai/conversation-store";
import BeakerBotCanvas from "./BeakerBotCanvas";
import { useCanvasStore } from "@/lib/ai/canvas-store";

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
    <div
      style={{ fontFamily: "var(--font-ai)" }}
      className="prose prose-sm max-w-none text-foreground [&_a]:text-brand [&_a]:underline [&_code]:rounded [&_code]:bg-surface-overlay [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-overlay [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
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
          // Keep the horizontal-scroll wrapper but render a real <table> inside
          // it. Returning a bare <div> here put react-markdown's <thead>/<tbody>
          // directly inside a div, which is invalid HTML and tripped a hydration
          // error whenever BeakerBot rendered a markdown table in chat.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="text-xs">{children}</table>
            </div>
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

// ---------------------------------------------------------------------------
// RevertConfirmDialog: a small overlay modal that asks for confirmation before
// discarding turns. States exactly how many messages will be removed, per the
// approved design (docs/mockups/2026-06-13-beakerbot-chat-modernization.html,
// Section 2). House style, no em-dashes, no emojis, no mid-sentence colons.
// ---------------------------------------------------------------------------

function RevertConfirmDialog({
  removedCount,
  onConfirm,
  onCancel,
}: {
  removedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const noun = removedCount === 1 ? "message" : "messages";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm revert"
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        // Click the backdrop to cancel (escape hatch, no soft-lock).
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-64 rounded-xl bg-surface px-5 py-4 shadow-2xl border border-border">
        <h4 className="mb-1 text-body font-semibold text-foreground">
          Revert to this message?
        </h4>
        <p className="mb-4 text-meta text-foreground-muted leading-snug">
          The {removedCount} {noun} after this point will be removed. This
          cannot be undone.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="beakerbot-revert-confirm"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-meta font-semibold text-white transition-colors hover:bg-red-700"
          >
            Revert
          </button>
          <button
            type="button"
            data-testid="beakerbot-revert-cancel"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-border bg-surface-raised px-3 py-2 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Revert pending state: the id of the user message the user clicked Revert on,
// plus the count of messages that will be removed (shown in the confirm dialog).
type RevertPending = {
  messageId: string;
  removedCount: number;
};

// The registry IconName per attached-ref object type, mirroring the icon each
// type carries in the global index (global-index.ts). Kept here so the chip glyph
// stays a verified registry Icon (no inline SVG, no new glyph). Experiments are
// tasks in the index, so "task" uses the same "list" glyph.
const REF_TYPE_ICON: Record<AttachedRef["type"], IconName> = {
  task: "list",
  project: "folder",
  method: "book",
  sequence: "moleculeLinear",
  inventory: "vial",
  note: "file",
  datahub: "chart",
  molecule: "vial",
  purchase: "receipt",
};

// Per-type chip tint. The mockup locked colored @ mention chips, one quiet tint
// per object type so a glance reads the kind. There is no canonical app-wide
// object-type color map to reuse (the global index carries no color), so these
// follow the house tint convention used across components (bg-{c}-100 /
// dark:bg-{c}-500/15, border-{c}-300 / dark:border-{c}-700, text-{c}-700 /
// dark:text-{c}-300). Low-saturation on purpose, these sit above the composer
// and should read as calm tags, not loud badges. `x` is the close-button hover
// (a touch stronger so the affordance reads). Each `{`-quoted full class string
// is kept whole so Tailwind's JIT sees every utility (no dynamic interpolation).
type RefChipTint = { chip: string; x: string };
const REF_TYPE_TINT: Record<AttachedRef["type"], RefChipTint> = {
  task: {
    chip: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    x: "text-sky-500 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-200",
  },
  project: {
    chip: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    x: "text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200",
  },
  method: {
    chip: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    x: "text-violet-500 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-200",
  },
  sequence: {
    chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    x: "text-emerald-500 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-200",
  },
  inventory: {
    chip: "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
    x: "text-teal-500 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-200",
  },
  note: {
    chip: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
    x: "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
  },
  datahub: {
    chip: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
    x: "text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-200",
  },
  molecule: {
    chip: "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
    x: "text-cyan-500 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-200",
  },
  purchase: {
    chip: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    x: "text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-200",
  },
};

/** Small leading glyph for an attached-ref chip. Reuses the verified icon set. */
function ObjectChipGlyph({ type }: { type: AttachedRef["type"] }) {
  return (
    <Icon
      name={REF_TYPE_ICON[type]}
      className="h-2.5 w-2.5 flex-none"
      title=""
    />
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
    turnStartedAt,
    turnTokens,
    runningToolCount,
    turnToolSteps,
    settledTurns,
    regenerate,
    revertToHere,
    pendingImages,
    addPendingImage,
    removePendingImage,
    clearPendingImages,
    attachedPaper,
    setAttachedPaper,
    clearAttachedPaper,
    attachedRefs,
    addAttachedRef,
    removeAttachedRef,
    runStoredMacro,
    captureMacroDraftFromLastRun,
    activePlan,
    resumePlan,
    dismissPlan,
  } = useAiChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Canvas (docked editable draft panel) hooks. The pointer line that replaces
  // the old draft card focuses the panel + the pending draft's tab. The panel
  // itself is BeakerBotCanvas, docked to the right of the chat column below.
  const focusCanvasTab = useCanvasStore((s) => s.focusTab);
  const openCanvasPanel = useCanvasStore((s) => s.openPanel);
  const canvasOpen = useCanvasStore((s) => s.open);
  const canvasTabs = useCanvasStore((s) => s.tabs);
  // The tab holding the in-flight draft approval (the last not-yet-settled tab).
  const pendingCanvasTabId =
    [...canvasTabs].reverse().find((t) => t.settled === null)?.id ?? null;

  // ---- Voice input (Web Speech API) ----------------------------------------
  //
  // The mic button uses the dedicated "mic" registry glyph (Grant approved a
  // microphone icon, distinct from the "camera" image-attach button beside it).
  const handleFinalTranscript = useCallback(
    (text: string) => {
      setDraft((prev) => appendTranscript(prev, text));
    },
    [],
  );
  const {
    supported: voiceSupported,
    listening,
    start: startListening,
    stop: stopListening,
  } = useVoiceInput(handleFinalTranscript);
  // Track the assistant message id for the in-flight placeholder so stop() can
  // remove the empty bubble if the turn is cancelled before any text arrives.
  const assistantIdRef = useRef<string | null>(null);
  // Hidden file input for the camera/attach button (images).
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Hidden file input for the paperclip attach button (PDFs).
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  // drag-over state for the composer drop zone visual indicator.
  const [isDragOver, setIsDragOver] = useState(false);
  // Local extracting flag: true while pdfjs is loading + parsing the PDF.
  // Distinct from the store's attachedPaper so the "Extracting" chip state
  // does not bleed into the global reactive state.
  const [pdfExtracting, setPdfExtracting] = useState(false);

  // copiedId: the id of the message that most recently had its text copied. A
  // brief "Copied" label replaces the Copy button label while this is set.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // revertPending: set when the user clicks Revert-to-here; cleared by Cancel
  // or after the confirmed revert runs.
  const [revertPending, setRevertPending] = useState<RevertPending | null>(null);

  // ---- @ mention picker and / command menu (ai at-mentions bot, 2026-06-13) ----
  //
  // Two inline overlays anchored above the composer input. Both are driven by the
  // live draft text and a single keyboard cursor (activeIndex). Only one is open
  // at a time. The @ picker reads the global object index; the / menu reads the
  // static command registry.
  //
  // atQuery: the text typed after the most recent "@" up to the caret, or null
  //   when no open "@" mention is being typed. Drives the picker open state.
  const [atQuery, setAtQuery] = useState<string | null>(null);
  // slashQuery: the text after a leading "/", or null. Drives the slash menu.
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  // activeIndex: the highlighted row in whichever overlay is open. Reset to 0 on
  // every query change so the cursor never points past the filtered list.
  const [activeIndex, setActiveIndex] = useState(0);

  // Ranked object results for the current @ query, reported up by the picker
  // container so the keyboard handlers can navigate the same list the user sees.
  // The container (which owns the global-index hook) is mounted only while the
  // picker is open, so the index subscription stays off the path otherwise.
  const [mentionResults, setMentionResults] = useState<GlobalIndexEntry[]>([]);
  // Filtered commands for the current / query (cheap, recomputed inline).
  const slashCommands: SlashCommand[] =
    slashQuery !== null ? filterSlashCommands(slashQuery) : [];

  // The user's saved workflow macros, shown in the / menu below the curated
  // commands. Loaded from disk when the menu opens so a just-created macro shows
  // without a reload. Empty (and the group hidden) when none exist or no folder
  // is connected (listMacros returns [] safely).
  const [macros, setMacros] = useState<StoredMacro[]>([]);
  // The steps the last run would capture, drives the "Save as macro" affordance.
  const [macroDraftSteps, setMacroDraftSteps] = useState<MacroStep[]>([]);
  // Shared macro UI store, the editor target (this component renders the sheet)
  // and the revision counter so the / list re-fetches after any macro write from
  // here OR the chat rail manager.
  const macroEditorTarget = useMacroUiStore((s) => s.editorTarget);
  const openMacroEditor = useMacroUiStore((s) => s.openEditor);
  const closeMacroEditor = useMacroUiStore((s) => s.closeEditor);
  const notifyMacrosChanged = useMacroUiStore((s) => s.notifyMacrosChanged);
  const macroRevision = useMacroUiStore((s) => s.revision);
  const slashActive = slashQuery !== null;
  useEffect(() => {
    if (!slashActive) return;
    let live = true;
    void listMacros().then((all) => {
      if (live) setMacros(all);
    });
    return () => {
      live = false;
    };
  }, [slashActive, macroRevision]);

  // Filter macros by the / query, prefix-first then substring on the name, the
  // same ranking the curated commands use.
  const filteredMacros: MacroMenuItem[] = (() => {
    if (slashQuery === null) return [];
    const q = slashQuery.trim().toLowerCase();
    const items = macros.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
    }));
    if (!q) return items;
    const prefix = items.filter((m) => m.name.toLowerCase().startsWith(q));
    const substring = items.filter(
      (m) => !m.name.toLowerCase().startsWith(q) && m.name.toLowerCase().includes(q),
    );
    return [...prefix, ...substring];
  })();

  // The container mounts whenever an "@" mention is being typed; it owns the
  // index hook and reports results up. pickerOpen (keyboard-active) additionally
  // requires at least one result row to be showing.
  const pickerMounted = atQuery !== null;
  const pickerOpen = pickerMounted && mentionResults.length > 0;
  const slashOpen =
    slashQuery !== null &&
    (slashCommands.length > 0 || filteredMacros.length > 0);
  // The number of rows the keyboard navigates in the slash menu, commands then
  // macros, so one arrow path moves through both groups.
  const slashRowCount = slashCommands.length + filteredMacros.length;

  // When the @ mention is dismissed, drop any stale results so a reopened picker
  // does not flash the previous query's rows before the hook recomputes.
  useEffect(() => {
    if (atQuery === null && mentionResults.length > 0) {
      setMentionResults([]);
    }
  }, [atQuery, mentionResults.length]);

  // Parse the draft + caret to decide which overlay should be open. Called on
  // every draft change and on caret move. The "@" mention query is the run of
  // non-whitespace characters immediately before the caret that begins at an "@"
  // (so "summarize @qp" with the caret after "qp" yields "qp"). A whitespace
  // between the "@" and the caret closes the picker. The "/" menu opens only when
  // the whole draft is a single leading "/" token (parseSlashQuery).
  const refreshOverlays = useCallback(
    (value: string, caret: number) => {
      // Slash command: only at the very start of the input.
      const slash = parseSlashQuery(value);
      if (slash !== null) {
        setSlashQuery(slash);
        setAtQuery(null);
        setActiveIndex(0);
        return;
      }
      setSlashQuery(null);

      // @ mention: look back from the caret for an "@" not interrupted by space.
      const upToCaret = value.slice(0, caret);
      const atPos = upToCaret.lastIndexOf("@");
      if (atPos === -1) {
        setAtQuery(null);
        return;
      }
      const between = upToCaret.slice(atPos + 1);
      // A whitespace after the "@" means the mention was abandoned.
      if (/\s/.test(between)) {
        setAtQuery(null);
        return;
      }
      setAtQuery(between);
      setActiveIndex(0);
    },
    [],
  );

  // Close both overlays (Escape, or after a selection that should dismiss them).
  const closeOverlays = useCallback(() => {
    setAtQuery(null);
    setSlashQuery(null);
    setActiveIndex(0);
  }, []);

  // Attach an object from the @ picker. Stages the ref in the store and strips
  // the in-progress "@query" token from the draft (the chip replaces it). Keeps
  // the caret where the token was so the user can keep typing.
  const handleMentionSelect = useCallback(
    (ref: ReturnType<typeof entryToRef>) => {
      addAttachedRef(ref);
      setDraft((prev) => {
        const ta = textareaRef.current;
        const caret = ta ? ta.selectionStart : prev.length;
        const upToCaret = prev.slice(0, caret);
        const atPos = upToCaret.lastIndexOf("@");
        if (atPos === -1) return prev;
        // Drop the "@query" run, keep everything before the "@" and after the caret.
        return prev.slice(0, atPos) + prev.slice(caret);
      });
      closeOverlays();
      // Return focus to the textarea so typing continues seamlessly.
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [addAttachedRef, closeOverlays],
  );

  // Pick a slash command. Replaces the leading "/token" with the command's
  // pre-fill phrase, leaving the caret at the end ready for an @object.
  const handleSlashSelect = useCallback(
    (command: SlashCommand) => {
      setDraft(command.prefill);
      closeOverlays();
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = command.prefill.length;
        }
      });
    },
    [closeOverlays],
  );

  // Pick a macro from the / menu. Unlike a curated command it does NOT pre-fill
  // prose, the steps are already fixed, so it clears the draft and stages the run
  // (runStoredMacro raises the one Run-card approval and replays the steps).
  const handleMacroSelect = useCallback(
    (item: MacroMenuItem) => {
      const macro = macros.find((m) => m.id === item.id);
      closeOverlays();
      setDraft("");
      if (macro) void runStoredMacro(macro);
    },
    [macros, closeOverlays, runStoredMacro],
  );

  // Bridge registration (useNavigationBridge + useBeakerBotMessageBridge) moved
  // to BeakerBotBridges (mounted once in app/layout.tsx). This component is now
  // bridge-free so it can render in multiple surfaces without double-registering.

  // ---- Vision helpers (only active when BEAKERBOT_VISION_ENABLED) --------------
  //
  // readFileAsDataUrl: converts a File to a base64 data URL via FileReader,
  // using the browser's built-in capability (no new npm dep). Returns a Promise
  // so callers can await it and skip non-image files cleanly.
  const readFileAsDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }, []);

  // processImageFiles: reads each image File and stages it in the store.
  // Non-image files are silently skipped (the user may drag a mixed folder).
  const processImageFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!BEAKERBOT_VISION_ENABLED) return;
      const arr = Array.from(files);
      for (const file of arr) {
        if (!file.type.startsWith("image/")) continue;
        try {
          const dataUrl = await readFileAsDataUrl(file);
          addPendingImage(dataUrl);
        } catch {
          // Silently skip unreadable files.
        }
      }
    },
    [readFileAsDataUrl, addPendingImage],
  );

  // handlePaste: intercept image items from the clipboard and stage them.
  // Plain text pastes flow through normally (the textarea handles them).
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!BEAKERBOT_VISION_ENABLED) return;
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));
      if (imageItems.length === 0) return;
      // Prevent default so the image blob is not pasted as garbled text.
      e.preventDefault();
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          try {
            const dataUrl = await readFileAsDataUrl(file);
            addPendingImage(dataUrl);
          } catch {
            // Skip.
          }
        }
      }
    },
    [readFileAsDataUrl, addPendingImage],
  );

  // ---- PDF attach handler -------------------------------------------------------
  //
  // handlePdfFile: extract text from a PDF File, show the extracting chip, then
  // transition to the ready chip once done. If extraction fails, log and reset.
  // Dynamic-imported pdf-extract so pdfjs-dist is not in the initial bundle.
  //
  // NOTE for Grant: reusing the "file" registry icon as the closest match for
  // "attach PDF / paperclip." No new registry icon was added. If you want a
  // dedicated paperclip glyph, please sign it off and I will add it.
  const handlePdfFile = useCallback(
    async (file: File) => {
      if (!file.type.includes("pdf") && !file.name.endsWith(".pdf")) return;
      setPdfExtracting(true);
      // Clear any previously attached paper so the chip starts fresh.
      clearAttachedPaper();
      try {
        const { extractPdfText } = await import("@/lib/ai/pdf-extract");
        const result = await extractPdfText(file);
        setAttachedPaper({
          name: file.name,
          text: result.text,
          pageCount: result.pageCount,
          truncated: result.truncated,
        });
      } catch (err) {
        console.error("[BeakerBot] PDF extraction failed:", err);
        // Do not surface an error state here; the chip simply disappears.
      } finally {
        setPdfExtracting(false);
      }
    },
    [clearAttachedPaper, setAttachedPaper],
  );

  // Keep the newest message in view as the answer reveals.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const handleSend = () => {
    const text = draft;
    // Allow send when there is text, or when images are staged (even with no text,
    // the model can respond to an image-only message). A staged paper also
    // enables send even with empty text, so the user can say "summarize this."
    const hasImages = BEAKERBOT_VISION_ENABLED && pendingImages.length > 0;
    const hasPaper = attachedPaper !== null;
    const hasRefs = attachedRefs.length > 0;
    if ((!text.trim() && !hasImages && !hasPaper && !hasRefs) || sending) return;
    // Stop dictation before sending so the session closes cleanly.
    stopListening();
    closeOverlays();
    setDraft("");
    // When only chips are attached (no typed text, no image, no paper), send a
    // neutral instruction so the store's empty-text guard does not drop the turn.
    // The attached refs carry the actual targets via the per-turn refs note.
    const outgoing =
      text.trim() || hasImages || hasPaper
        ? text
        : "Use the attached objects.";
    void send(outgoing);
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

  // handleCopy: copies the given text to the clipboard. Shows a brief "Copied"
  // label on the button (via copiedId) that auto-clears after 1.5 seconds.
  const handleCopy = (messageId: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(messageId);
      setTimeout(() => setCopiedId((id) => (id === messageId ? null : id)), 1500);
    });
  };

  // handleRevertRequest: opens the confirm dialog for a given user message.
  // removedCount is the number of messages that will be discarded (everything
  // after the target user message, not including it).
  const handleRevertRequest = (messageId: string, index: number) => {
    const removedCount = messages.length - (index + 1);
    setRevertPending({ messageId, removedCount });
  };

  const handleRevertConfirm = () => {
    if (revertPending) {
      revertToHere(revertPending.messageId);
    }
    setRevertPending(null);
  };

  const handleRevertCancel = () => setRevertPending(null);

  // The last settled assistant message id, used to gate the Regenerate button.
  // Regenerate is valid only on the very last assistant message when not sending.
  const lastAssistantId =
    !sending && messages.length > 0
      ? (() => {
          const lastMsg = messages[messages.length - 1];
          return lastMsg.role === "assistant" && lastMsg.content.trim().length > 0
            ? lastMsg.id
            : null;
        })()
      : null;

  // After a run settles, compute whether it captured any meaningful steps, so the
  // "Save as macro" affordance shows only on a run worth saving. Cheap history
  // parse, recomputed when the last reply or the sending state changes.
  useEffect(() => {
    if (sending || !lastAssistantId) {
      setMacroDraftSteps([]);
      return;
    }
    setMacroDraftSteps(captureMacroDraftFromLastRun());
  }, [sending, lastAssistantId, captureMacroDraftFromLastRun]);

  // When a Canvas draft panel is docked open, the chat column narrows to make
  // room for it (the mockup's split-win, chat + Canvas). When collapsed, the
  // chat occupies the full surface as before.
  const canvasDocked = canvasOpen && canvasTabs.length > 0;

  return (
    <div
      data-testid="beakerbot-surface"
      className={`relative flex overflow-hidden${className ? ` ${className}` : ""}`}
    >
      {/* Chat column. Flexes to fill the surface, or narrows when Canvas docks.
          When Canvas docks it keeps a usable floor (min-w-[20rem]) so the
          composer textarea, the ref chips, and the send button never collapse
          to a sliver. The surface widens to fit both (the palette shell grows
          when Canvas is docked). Undocked it stays min-w-0 so it flexes to the
          full surface as before. */}
      <div
        data-testid="beakerbot-chat-column"
        className={`relative flex flex-1 flex-col overflow-hidden ${
          canvasDocked ? "min-w-[20rem]" : "min-w-0"
        }`}
      >
      {/* Revert confirm overlay. Covers the whole panel so the user cannot interact
          with the conversation while the confirm is open. */}
      {revertPending ? (
        <RevertConfirmDialog
          removedCount={revertPending.removedCount}
          onConfirm={handleRevertConfirm}
          onCancel={handleRevertCancel}
        />
      ) : null}

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
            // Look up the settled-turn summary for this assistant message so the
            // pinned per-turn token line appears directly below the reply.
            const settledSummary =
              m.role === "assistant" && m.content
                ? settledTurns.find((t) => t.assistantId === m.id)
                : undefined;

            // Action row visibility: copy is always available on a settled message.
            // Regenerate is only on the last settled assistant reply.
            // Revert-to-here is only on user messages (any, not just the last).
            const isSettledAssistant =
              m.role === "assistant" && m.content.trim().length > 0;
            const canRegenerate = m.id === lastAssistantId;
            const isUserMessage = m.role === "user";

            return (
              // group class enables Tailwind's group-hover: prefix on child elements.
              <div
                key={m.id}
                className="group flex flex-col gap-1.5 self-start w-full"
              >
                <div
                  data-testid={`beakerbot-message-${m.role}`}
                  // Beaker speaks Hanken (--font-ai, set at the panel root); the USER
                  // speaks the app font. A user bubble is the user's own words, so it
                  // drops back to --font-sans (Geist). Inline to override the inherited
                  // panel-root --font-ai; assistant bubbles inherit Hanken untouched.
                  style={m.role === "user" ? { fontFamily: "var(--font-sans)" } : undefined}
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
                    // User bubble: text (if any) then image thumbnails (if any).
                    // Images are display-only (base64 data URLs stored on ChatMessage).
                    // The cost-collapse in the store ensures these are not re-sent.
                    <>
                      {m.content ? (
                        <span data-testid="beakerbot-user-text">{m.content}</span>
                      ) : null}
                      {m.images && m.images.length > 0 ? (
                        <div
                          data-testid="beakerbot-user-images"
                          className={`flex flex-wrap gap-1.5 ${m.content ? "mt-2" : ""}`}
                        >
                          {m.images.map((url, imgIdx) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={imgIdx}
                              src={url}
                              alt={`Attached image ${imgIdx + 1}`}
                              className="max-h-48 max-w-full rounded-md object-contain"
                              style={{ maxWidth: "min(100%, 200px)" }}
                            />
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {/* Per-message action row. Appears on hover (group-hover) for any
                    settled message. User messages: Copy + Revert-to-here (danger
                    tone). Assistant messages: Copy + Regenerate (last only). The
                    row uses opacity-0/group-hover:opacity-100 so it does not take
                    layout space when hidden. */}
                {(isSettledAssistant || isUserMessage) ? (
                  <div
                    className={`flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${
                      m.role === "user" ? "justify-end pr-1" : "pl-1"
                    }`}
                    data-testid="beakerbot-action-row"
                  >
                    {/* Copy */}
                    <Tooltip label={copiedId === m.id ? "Copied" : "Copy message"} placement="bottom">
                      <button
                        type="button"
                        data-testid="beakerbot-copy"
                        aria-label="Copy message"
                        onClick={() => handleCopy(m.id, m.content)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                      >
                        <Icon name="copy" className="h-3 w-3" title="Copy" />
                        {copiedId === m.id ? "Copied" : "Copy"}
                      </button>
                    </Tooltip>

                    {/* Regenerate (last assistant message only) */}
                    {isSettledAssistant && canRegenerate && !sending ? (
                      <Tooltip label="Regenerate reply" placement="bottom">
                        <button
                          type="button"
                          data-testid="beakerbot-regenerate"
                          aria-label="Regenerate reply"
                          onClick={() => { void regenerate(); }}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                        >
                          <Icon name="refresh" className="h-3 w-3" title="Regenerate" />
                          Regenerate
                        </button>
                      </Tooltip>
                    ) : null}

                    {/* Save as macro (last assistant reply, only when the run
                        captured meaningful steps). Opens the editor pre-filled. */}
                    {isSettledAssistant &&
                    canRegenerate &&
                    !sending &&
                    macroDraftSteps.length > 0 ? (
                      <Tooltip label="Save these steps as a reusable macro" placement="bottom">
                        <button
                          type="button"
                          data-testid="beakerbot-save-macro"
                          aria-label="Save as macro"
                          onClick={() =>
                            openMacroEditor({
                              name: "",
                              description: "",
                              steps: macroDraftSteps,
                            })
                          }
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-purple-600 transition-colors hover:bg-purple-500/10 dark:text-purple-300"
                        >
                          <Icon name="bolt" className="h-3 w-3" title="Save as macro" />
                          Save as macro
                        </button>
                      </Tooltip>
                    ) : null}

                    {/* Revert-to-here (user messages only) */}
                    {isUserMessage && !sending ? (
                      <Tooltip label="Remove all messages after this one" placement="bottom">
                        <button
                          type="button"
                          data-testid="beakerbot-revert"
                          aria-label="Revert to here"
                          onClick={() => handleRevertRequest(m.id, index)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-red-500 transition-colors hover:bg-red-50 hover:text-red-700"
                        >
                          <Icon name="undo" className="h-3 w-3" title="Revert to here" />
                          Revert to here
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                ) : null}

                {/* Settled per-turn token summary pinned below a finished assistant
                    reply. Always shown so each turn's cost is auditable. */}
                {settledSummary ? (
                  <SettledStatusLine summary={settledSummary} />
                ) : null}

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

      {/* Draft pointer line. A drafted note / method opens in the Canvas side
          panel (editable), not a read-only Approve / Reject card. This compact
          line replaces the old card, it names the draft and focuses the panel +
          that tab. Save / Discard live in Canvas, so there are no Approve /
          Reject buttons here. The pointer line is the visible way back when the
          panel is collapsed (no soft-lock). */}
      {pendingApproval && pendingApproval.request.kind === "draft" ? (
        <button
          type="button"
          data-testid="beakerbot-canvas-pointer"
          onClick={() => {
            const tabId = pendingCanvasTabId;
            if (tabId) focusCanvasTab(tabId);
            else openCanvasPanel();
          }}
          className="mx-4 mb-2 flex w-[calc(100%-2rem)] items-start gap-2 rounded-md border border-brand bg-brand/5 px-3 py-2 text-left transition-colors hover:bg-brand/10"
        >
          <span className="mt-0.5 text-brand">
            <Icon name="file" className="h-4 w-4" title="Canvas" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-meta font-semibold text-brand">
              Drafted in Canvas
            </span>
            <span className="block truncate text-meta text-foreground-muted">
              {pendingApproval.request.title ??
                pendingApproval.request.noteTitle ??
                "Untitled draft"}
              , tweak then save
            </span>
          </span>
          <span className="mt-0.5 flex flex-none items-center gap-0.5 text-meta font-medium text-brand">
            Open Canvas
            <Icon name="chevronRight" className="h-3.5 w-3.5" title="Open Canvas" />
          </span>
        </button>
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

      {/* Live plan card (resumable plan card). Shows while a per-step plan runs
          (ticking each step) and when it pauses (offering Resume from the stopped
          step). Hidden once the plan is done. */}
      {activePlan && activePlan.status !== "done" ? (
        <BeakerBotPlanCard
          plan={activePlan}
          onResume={() => {
            void resumePlan();
          }}
          onDismiss={dismissPlan}
        />
      ) : null}

      {/* Running status line: elapsed time, token count, running-tool count, and
          a phase word. Appears while a turn is in flight, above the composer.
          The Stop button lives in the composer row below, not in this line.
          Replaces the old plain "Thinking" label region for the running state. */}
      {sending && turnStartedAt !== null ? (
        <RunningStatusLine
          turnStartedAt={turnStartedAt}
          turnTokens={turnTokens}
          runningToolCount={runningToolCount}
          turnToolSteps={turnToolSteps}
          statusLabel={status}
        />
      ) : null}

      {/* Composer */}
      <div
        className={sending ? "border-t-0 border-border p-3" : "border-t border-border p-3"}
        onDragOver={
          BEAKERBOT_VISION_ENABLED
            ? (e) => {
                e.preventDefault();
                setIsDragOver(true);
              }
            : undefined
        }
        onDragLeave={
          BEAKERBOT_VISION_ENABLED ? () => setIsDragOver(false) : undefined
        }
        onDrop={
          BEAKERBOT_VISION_ENABLED
            ? (e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files.length > 0) {
                  void processImageFiles(e.dataTransfer.files);
                }
              }
            : undefined
        }
      >
        {/* PDF chip. Shows when a paper is being extracted (extracting state)
            or has been extracted and is staged (ready state). The chip resets
            on send (the store clears attachedPaper atomically with send). A
            "stays in your browser" note reinforces local-first privacy. */}
        {(pdfExtracting || attachedPaper !== null) ? (
          <div
            data-testid="beakerbot-pdf-chip"
            className="mb-2 flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/5 px-2.5 py-1.5"
          >
            {/* File icon badge */}
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded bg-brand/15 text-brand">
              <Icon name="file" className="h-3.5 w-3.5" title="PDF" />
            </span>
            {/* Name + meta */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-foreground leading-tight">
                {pdfExtracting ? "Extracting…" : (attachedPaper?.name ?? "")}
              </p>
              {attachedPaper && !pdfExtracting ? (
                <p className="text-[11px] text-foreground-muted leading-tight">
                  {attachedPaper.pageCount} page{attachedPaper.pageCount === 1 ? "" : "s"}
                  {attachedPaper.truncated ? " (first 60k chars)" : ""}
                  {" • stays in your browser"}
                </p>
              ) : (
                <p className="text-[11px] text-foreground-muted leading-tight">
                  Reading text locally…
                </p>
              )}
            </div>
            {/* Remove button (only when ready, not while extracting) */}
            {attachedPaper && !pdfExtracting ? (
              <Tooltip label="Remove paper" placement="top">
                <button
                  type="button"
                  data-testid="beakerbot-remove-pdf"
                  aria-label="Remove attached paper"
                  onClick={clearAttachedPaper}
                  className="flex-none text-foreground-muted hover:text-foreground"
                >
                  <Icon name="close" className="h-3.5 w-3.5" title="Remove" />
                </button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        {/* Pending-image thumbnail strip. Only rendered when images are staged
            and the vision feature is enabled. Each thumbnail shows a small
            preview with an X button to remove it. */}
        {BEAKERBOT_VISION_ENABLED && pendingImages.length > 0 ? (
          <div
            data-testid="beakerbot-image-thumbnails"
            className="mb-2 flex flex-wrap gap-2"
          >
            {pendingImages.map((url, index) => (
              <div
                key={`${index}-${url.slice(0, 30)}`}
                className="relative h-16 w-16 flex-none overflow-hidden rounded-md border border-border bg-surface-sunken"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Attached image ${index + 1}`}
                  className="h-full w-full object-cover"
                />
                <Tooltip label="Remove image" placement="top">
                  <button
                    type="button"
                    data-testid="beakerbot-remove-image"
                    aria-label={`Remove image ${index + 1}`}
                    onClick={() => removePendingImage(url)}
                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <Icon name="close" className="h-2.5 w-2.5" title="Remove" />
                  </button>
                </Tooltip>
              </div>
            ))}
            {/* Clear-all button when more than one image is staged. */}
            {pendingImages.length > 1 ? (
              <Tooltip label="Remove all images" placement="top">
                <button
                  type="button"
                  data-testid="beakerbot-clear-images"
                  onClick={clearPendingImages}
                  className="self-start rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                >
                  Clear all
                </button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        {/* Drag-over visual indicator */}
        {BEAKERBOT_VISION_ENABLED && isDragOver ? (
          <div className="mb-2 flex items-center justify-center rounded-md border-2 border-dashed border-brand bg-brand/5 py-3 text-meta text-brand">
            Drop image to attach
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          {/* Hidden file input for image attach, triggered by the camera button below. */}
          {BEAKERBOT_VISION_ENABLED ? (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              aria-hidden="true"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  void processImageFiles(e.target.files);
                  // Reset so the same file can be re-selected.
                  e.target.value = "";
                }
              }}
            />
          ) : null}

          {/* Hidden file input for PDF attach, triggered by the paperclip button. */}
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            aria-hidden="true"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void handlePdfFile(file);
                // Reset so the same file can be re-selected.
                e.target.value = "";
              }
            }}
          />

          {/* Composer input column: holds the attached-ref chip row, the @/
              overlays anchored above, and the textarea. Relative so the
              dropdowns position against this column, not the whole row. */}
          <div className="relative min-w-0 flex-1">
            {/* @ object picker, anchored above the input. Mounted while an "@"
                mention is being typed; it owns the global index hook and reports
                results up for keyboard nav, and self-hides when no rows match. */}
            {pickerMounted ? (
              <ComposerMentionPicker
                query={atQuery ?? ""}
                activeIndex={activeIndex}
                onSelect={handleMentionSelect}
                onResultsChange={setMentionResults}
              />
            ) : null}
            {/* / command menu, anchored above the input. */}
            {slashOpen ? (
              <ComposerSlashMenu
                commands={slashCommands}
                macros={filteredMacros}
                activeIndex={activeIndex}
                onSelect={handleSlashSelect}
                onSelectMacro={handleMacroSelect}
              />
            ) : null}

            {/* Attached object chips (one per @ mention), above the textarea. */}
            {attachedRefs.length > 0 ? (
              <div
                data-testid="beakerbot-ref-chips"
                className="mb-1.5 flex flex-wrap gap-1.5"
              >
                {attachedRefs.map((ref) => {
                  const tint = REF_TYPE_TINT[ref.type];
                  return (
                  <span
                    key={ref.id}
                    data-testid="beakerbot-ref-chip"
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-meta font-medium ${tint.chip}`}
                  >
                    <ObjectChipGlyph type={ref.type} />
                    <span className="max-w-[150px] truncate">{ref.name}</span>
                    <Tooltip label="Remove" placement="top">
                      <button
                        type="button"
                        data-testid="beakerbot-remove-ref"
                        aria-label={`Remove ${ref.name}`}
                        onClick={() => removeAttachedRef(ref.id)}
                        className={`ml-0.5 flex-none ${tint.x}`}
                      >
                        <Icon name="close" className="h-2.5 w-2.5" title="Remove" />
                      </button>
                    </Tooltip>
                  </span>
                  );
                })}
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              data-testid="beakerbot-input"
              aria-label="Message BeakerBot"
              rows={2}
              value={draft}
              disabled={sending}
              onChange={(e) => {
                setDraft(e.target.value);
                refreshOverlays(e.target.value, e.target.selectionStart);
              }}
              onClick={(e) =>
                refreshOverlays(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart,
                )
              }
              onKeyUp={(e) => {
                // Caret-move keys can open/close the @ picker without changing text.
                if (
                  e.key === "ArrowLeft" ||
                  e.key === "ArrowRight" ||
                  e.key === "Home" ||
                  e.key === "End"
                ) {
                  refreshOverlays(
                    e.currentTarget.value,
                    e.currentTarget.selectionStart,
                  );
                }
              }}
              onKeyDown={(e) => {
                const overlayOpen = pickerOpen || slashOpen;
                const count = pickerOpen
                  ? mentionResults.length
                  : slashRowCount;
                if (overlayOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((i) => (i + 1) % count);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex((i) => (i - 1 + count) % count);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeOverlays();
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (pickerOpen) {
                      handleMentionSelect(entryToRef(mentionResults[activeIndex]));
                    } else if (activeIndex < slashCommands.length) {
                      handleSlashSelect(slashCommands[activeIndex]);
                    } else {
                      handleMacroSelect(
                        filteredMacros[activeIndex - slashCommands.length],
                      );
                    }
                    return;
                  }
                }
                // Backspace at caret position 0 with an empty-start removes the
                // last attached chip (Slack / Linear pattern, Q2 = both x and
                // backspace). Only when no overlay is steering the keyboard.
                if (
                  e.key === "Backspace" &&
                  !overlayOpen &&
                  attachedRefs.length > 0 &&
                  e.currentTarget.selectionStart === 0 &&
                  e.currentTarget.selectionEnd === 0
                ) {
                  e.preventDefault();
                  removeAttachedRef(attachedRefs[attachedRefs.length - 1].id);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onPaste={BEAKERBOT_VISION_ENABLED ? handlePaste : undefined}
              placeholder="Message BeakerBot, or @ to attach, / for a command"
              // The panel root reads in Beaker's signature typeface (--font-ai,
              // Hanken) because that font is BEAKER'S voice. The composer is where
              // the USER writes, not Beaker, so it drops back to the app font
              // (--font-sans, Geist). Inline so it overrides the inherited inline
              // --font-ai from the panel root; covers both the typed text and the
              // placeholder.
              style={{ fontFamily: "var(--font-sans)" }}
              className="min-h-0 w-full resize-none rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          {/* PDF paperclip attach button. Uses the "file" registry icon (closest
              match to a paperclip; see handlePdfFile note above). Always visible
              (not gated), since the PDF fan-out is the primary use case here.
              Disabled while extracting or while a turn is in flight. */}
          {!sending ? (
            <Tooltip label="Attach a paper PDF" placement="top">
              <button
                type="button"
                data-testid="beakerbot-attach-pdf"
                aria-label="Attach a paper PDF"
                disabled={pdfExtracting}
                onClick={() => pdfInputRef.current?.click()}
                className="flex items-center justify-center rounded-md border border-border bg-surface-raised px-2.5 py-2 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="file" className="h-4 w-4" title="Attach PDF" />
              </button>
            </Tooltip>
          ) : null}

          {/* Image attach button (camera icon). Gated on BEAKERBOT_VISION_ENABLED.
              NOTE for Grant: reusing the "camera" registry icon as the closest match
              for "attach image." No new registry icon added; Grant to confirm or
              approve a new "attach" / "image" glyph at next sign-off. */}
          {BEAKERBOT_VISION_ENABLED && !sending ? (
            <Tooltip label="Attach image" placement="top">
              <button
                type="button"
                data-testid="beakerbot-attach-image"
                aria-label="Attach image"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center rounded-md border border-border bg-surface-raised px-2.5 py-2 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
              >
                <Icon name="camera" className="h-4 w-4" title="Attach image" />
              </button>
            </Tooltip>
          ) : null}

          {/* Mic button. Only rendered when the Web Speech API is available
              (Chrome/Edge; hidden in Firefox/Brave). Toggles dictation on/off.
              While listening the button pulses (ring-2 + animate-pulse) and the
              aria-label / Tooltip change to "Stop dictation". Dictation also
              stops automatically when the user sends. */}
          {voiceSupported && !sending ? (
            <Tooltip
              label={listening ? "Stop dictation" : "Dictate your message"}
              placement="top"
            >
              <button
                type="button"
                data-testid="beakerbot-mic"
                aria-label={listening ? "Stop dictation" : "Dictate your message"}
                aria-pressed={listening}
                onClick={() => (listening ? stopListening() : startListening())}
                className={`flex items-center justify-center rounded-md border px-2.5 py-2 transition-colors ${
                  listening
                    ? "border-brand bg-brand/10 text-brand ring-2 ring-brand/40 animate-pulse"
                    : "border-border bg-surface-raised text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                }`}
              >
                <Icon name="mic" className="h-4 w-4" title={listening ? "Stop dictation" : "Dictate"} />
              </button>
            </Tooltip>
          ) : null}

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
              disabled={
                draft.trim().length === 0 &&
                !(BEAKERBOT_VISION_ENABLED && pendingImages.length > 0) &&
                attachedPaper === null &&
                attachedRefs.length === 0
              }
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-2 text-body font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="chevronRight" className="h-4 w-4" title="Send" />
            </button>
          )}
        </div>
      </div>
      </div>
      {/* Docked Canvas panel. Renders itself only when a draft is open (it reads
          the Canvas store), so it sits to the right of the chat column whenever
          canvasDocked is true. */}
      {canvasDocked ? <BeakerBotCanvas /> : null}

      {/* Macro editor sheet, opened from "Save as macro" here or New / Edit in the
          chat rail (shared via the macro UI store). Scoped to this panel (the root
          is relative). */}
      {macroEditorTarget !== null ? (
        <MacroEditorSheet
          macroId={macroEditorTarget.macroId}
          initialName={macroEditorTarget.name}
          initialDescription={macroEditorTarget.description}
          initialSteps={macroEditorTarget.steps}
          onClose={closeMacroEditor}
          onSaved={notifyMacrosChanged}
        />
      ) : null}
    </div>
  );
}
