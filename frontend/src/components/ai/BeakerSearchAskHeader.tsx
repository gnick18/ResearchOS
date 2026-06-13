"use client";

// BeakerSearchAskHeader (ai palette-morph bot, 2026-06-11).
//
// The chat chrome that appears inside the BeakerSearch palette when it is in
// Ask mode. Contains (left to right): back-to-search control, the "BeakerBot AI"
// wordmark (no static mark, the riding mascot up top is the only beaker; "AI" in
// the welcome-page rainbow gradient), Save-to control, New chat button, History,
// the review-mode control, and a live AI-balance indicator.
//
// Props:
//   onBack         -> return to search mode (back control click)
//   onNewChat      -> call clearConversation() to start fresh
//
// Save to: serializes the whole transcript (already markdown, with the embed
// links inline) and opens the destination picker. Picking a note / experiment
// drops the conversation in, where the same `#ros=` fragment makes the embeds
// render live. Disabled while there is nothing to save.
//
// History affordance: the clock/history icon is visible but wired to a no-op
// tooltip ("Past chats coming in v2.1"). The past-chats list is deferred.
//
// Review-mode control: reads and writes useBeakerBotReviewMode. Two modes,
// "Step-by-step" (review every step) and "Whole-plan" (approve the plan once,
// then it runs). There is no silent unattended mode.
//
// AI balance indicator: replaces the static "uses credit" hint with a live
// ring/pill that reads fetchAiStatus() on open.
//   - null/loading: renders nothing.
//   - enabled === false (beta default): a calm "AI free in beta" pill.
//   - enabled === true: a small SVG ring arc showing balance vs
//     STARTER_GRANT_TOKENS, with amber/red warn at < 15 % / < 5 %.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useState, useEffect } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { useBeakerBotReviewMode } from "@/lib/ai/review-mode-store";
import { useConversationStore } from "@/lib/ai/conversation-store";
import {
  conversationToMarkdown,
  defaultConversationTitle,
} from "@/lib/ai/conversation-to-markdown";
import ExportConversationPicker from "@/components/references/ExportConversationPicker";
import {
  fetchAiStatus,
  type AiStatus,
} from "@/lib/billing/ai-client";
import { STARTER_GRANT_TOKENS } from "@/lib/billing/ai-config";
import { formatTokens } from "@/components/ai/TurnStatusLine";

// ---- AI balance helpers (pure, exported for tests) --------------------------

/** The ring fraction clamped to [0, 1] using STARTER_GRANT_TOKENS as baseline. */
export function balanceFraction(balance: number): number {
  return Math.min(1, Math.max(0, balance / STARTER_GRANT_TOKENS));
}

export type BalanceLevel = "ok" | "low" | "critical";

/**
 * Returns the warning level for the current balance.
 *   critical: under 5 % of STARTER_GRANT_TOKENS.
 *   low:      under 15 %.
 *   ok:       otherwise.
 */
export function balanceLevel(balance: number): BalanceLevel {
  const frac = balance / STARTER_GRANT_TOKENS;
  if (frac < 0.05) return "critical";
  if (frac < 0.15) return "low";
  return "ok";
}

/** Map a BalanceLevel to a stroke colour for the SVG ring. */
export function ringColor(level: BalanceLevel): string {
  if (level === "critical") return "#ef4444"; // red-500
  if (level === "low") return "#f59e0b";      // amber-500
  return "#22c55e";                            // green-500 (ok)
}

// ---- Small ring SVG (data-viz, not a glyph) ---------------------------------
// The arc is a single SVG circle rendered as a stroke-dashoffset arc.
// r = 7, circumference = 2πr ≈ 43.98.

const RING_R = 7;
const RING_SIZE = 20; // viewBox px
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

function BalanceRing({
  fraction,
  level,
}: {
  fraction: number;
  level: BalanceLevel;
}) {
  const color = ringColor(level);
  const filled = fraction * CIRCUMFERENCE;
  const cx = RING_SIZE / 2;
  const cy = RING_SIZE / 2;

  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      aria-hidden="true"
      className="flex-none"
    >
      {/* Track */}
      <circle
        cx={cx}
        cy={cy}
        r={RING_R}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        className="text-border"
      />
      {/* Fill arc; starts at top (rotate -90 deg) */}
      <circle
        cx={cx}
        cy={cy}
        r={RING_R}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
        strokeDashoffset={CIRCUMFERENCE / 4}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

// ---- Balance indicator widget -----------------------------------------------

function AiBalanceIndicator({ status }: { status: AiStatus | null }) {
  // Loading / error: render nothing.
  if (status === null) return null;

  // Beta: billing enforcement off. Show a neutral informational pill.
  if (!status.enabled) {
    return (
      <Tooltip
        label="BeakerBot AI is free during the beta. Token billing activates before general release."
        placement="bottom"
      >
        <span
          data-testid="beakersearch-ai-beta-pill"
          className="cursor-default rounded-md border border-brand/30 bg-brand/5 px-1.5 py-0.5 text-[10px] font-semibold text-brand"
        >
          AI free in beta
        </span>
      </Tooltip>
    );
  }

  // Billing on: show ring + label.
  const balance = status.balance ?? 0;
  const fraction = balanceFraction(balance);
  const level = balanceLevel(balance);
  const label = `${formatTokens(balance)} tokens remaining`;

  return (
    <Tooltip
      label={`${label} — click to view AI usage in Settings`}
      placement="bottom"
    >
      <a
        href="/settings?section=ai-usage"
        data-testid="beakersearch-ai-balance-ring"
        className="flex items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-[10px] font-semibold text-foreground-muted hover:border-border hover:bg-surface-sunken hover:text-foreground"
      >
        <BalanceRing fraction={fraction} level={level} />
        <span>{formatTokens(balance)} left</span>
      </a>
    </Tooltip>
  );
}

// ---- Component ---------------------------------------------------------------

export default function BeakerSearchAskHeader({
  onBack,
}: {
  onBack: () => void;
}) {
  const reviewMode = useBeakerBotReviewMode((s) => s.mode);
  const toggleReviewMode = useBeakerBotReviewMode((s) => s.toggle);

  // The transcript has nothing to save until there is at least one message. We
  // read the count reactively so the Save-to control enables as soon as the
  // first turn lands. Which chat is open + past chats now live in the left rail
  // (BeakerChatRail), so the header no longer carries a title or a history clock.
  const messageCount = useConversationStore((s) => s.messages.length);
  // Export picker state. payload is captured at click time so the picker pushes
  // a stable snapshot even if the conversation keeps streaming behind it.
  const [exportPayload, setExportPayload] = useState<{
    markdown: string;
    defaultTitle: string;
  } | null>(null);
  // A small confirmation toast after a successful (or failed) save.
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(
    null,
  );

  // AI balance: fetched once when the chat surface opens, null while loading
  // or on network error (the indicator renders nothing in those states).
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAiStatus().then((s) => {
      if (!cancelled) setAiStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openExport = () => {
    const messages = useConversationStore.getState().messages;
    if (messages.length === 0) return;
    setExportPayload({
      markdown: conversationToMarkdown(messages),
      defaultTitle: defaultConversationTitle(messages),
    });
  };

  return (
    <>
      {exportPayload ? (
        <ExportConversationPicker
          markdown={exportPayload.markdown}
          defaultTitle={exportPayload.defaultTitle}
          onClose={() => setExportPayload(null)}
          onResult={(message, ok) => setToast({ message, ok })}
        />
      ) : null}
      {toast ? (
        <div
          role="status"
          data-testid="beakersearch-save-toast"
          className={`mx-3 mt-2 rounded-md border px-3 py-1.5 text-meta ${
            toast.ok
              ? "border-brand bg-brand/5 text-foreground"
              : "border-red-400 bg-red-50 text-red-700"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
      {renderHeader()}
    </>
  );

  function renderHeader() {
    return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      {/* Back to search */}
      <Tooltip label="Back to search" placement="bottom">
        <button
          type="button"
          data-testid="beakersearch-back-to-search"
          aria-label="Back to search"
          onClick={onBack}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-transparent text-foreground-muted hover:border-border hover:bg-surface-sunken hover:text-foreground"
        >
          <Icon name="chevronLeft" className="h-4 w-4" title="Back" />
        </button>
      </Tooltip>

      {/* Brand wordmark. No static mark, the riding mascot up top is the only
          beaker; the "AI" reads in the welcome-page pastel-rainbow gradient. */}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="flex-none text-body font-semibold text-foreground">
          BeakerBot{" "}
          <span
            className="font-bold"
            style={{
              backgroundImage:
                "linear-gradient(90deg, #f7a072, #f2c94c, #6bbf59, #5aa9e6, #b08fdb)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            AI
          </span>
        </span>
      </span>

      {/* Save the conversation to a note or experiment */}
      <Tooltip
        label={
          messageCount === 0
            ? "Nothing to save yet"
            : "Save this conversation to a note or experiment"
        }
        placement="bottom"
      >
        <button
          type="button"
          data-testid="beakersearch-save-to"
          aria-label="Save this conversation to a note or experiment"
          onClick={openExport}
          disabled={messageCount === 0}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-transparent text-foreground-muted hover:border-border hover:bg-surface-sunken hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent"
        >
          <Icon name="export" className="h-4 w-4" title="Save to" />
        </button>
      </Tooltip>

      {/* Review-mode control. Two modes, click the inactive one to switch. There
          is no silent unattended mode, both modes review the work, step-by-step
          confirms each step and whole-plan confirms the whole plan once. */}
      <div
        role="group"
        aria-label="BeakerBot review mode"
        data-testid="beakersearch-review-mode"
        className="flex flex-shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface-sunken p-0.5"
      >
        <Tooltip
          label="Step-by-step. BeakerBot shows each step and waits for you to approve it before it runs."
          placement="bottom"
        >
          <button
            type="button"
            data-testid="beakersearch-review-step"
            aria-label="Step-by-step review, approve each step"
            aria-pressed={reviewMode === "step"}
            onClick={reviewMode === "step" ? undefined : toggleReviewMode}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-meta font-medium transition-colors ${
              reviewMode === "step"
                ? "bg-brand-action text-white shadow-sm"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            Step-by-step
          </button>
        </Tooltip>
        <Tooltip
          label="Whole-plan. BeakerBot proposes the whole plan up front, you approve it once, then it runs every step."
          placement="bottom"
        >
          <button
            type="button"
            data-testid="beakersearch-review-plan"
            aria-label="Whole-plan review, approve the plan once"
            aria-pressed={reviewMode === "plan"}
            onClick={reviewMode === "plan" ? undefined : toggleReviewMode}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-meta font-medium transition-colors ${
              reviewMode === "plan"
                ? "bg-brand-action text-white shadow-sm"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            Whole-plan
          </button>
        </Tooltip>
      </div>

      {/* Live AI balance indicator. Replaces static "uses credit" hint. */}
      <AiBalanceIndicator status={aiStatus} />
    </div>
    );
  }
}
