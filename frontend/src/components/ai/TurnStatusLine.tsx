"use client";

// TurnStatusLine (BeakerAI lane manager, 2026-06-13).
//
// The Claude-Code-style live status bar for a BeakerBot turn. Appears while a
// turn is running and stays pinned below the assistant reply after it settles.
//
// RUNNING state (sending=true):
//   [BeakerBot-glyph] 2m 14s . 48.3k tokens . [pulse] 1 running . working...  [details]
//   Clicking "details" opens an expandable steps panel listing each tool call
//   with a status badge (running / done / queued).
//
// SETTLED state (sending=false, summary provided):
//   [BeakerBot-glyph] 8s . 12.4k tokens
//   Fades away after SETTLED_VISIBLE_MS then unmounts (like Claude's status).
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Middot
// separators. Tooltip for any interactive element (Stop button is handled
// by BeakerBotConversation, not this component). Icon component for any
// glyph that needs a registry icon; no inline SVG for new icons.

import { useEffect, useRef, useState } from "react";
import BeakerBot from "@/components/BeakerBot";
import Tooltip from "@/components/Tooltip";
import type { TurnSummary, ToolStep } from "@/components/ai/useAiChat";

// ---- Formatting helpers (pure, exportable for tests) -------------------------

/** Format a millisecond duration as "Xs" or "Xm Ys". */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/** Format a raw token count to a compact display like "12.4k" or "182.7k".
 *  Tokens below 1000 show as the raw number. Zero is formatted as "0". */
export function formatTokens(count: number): string {
  if (count <= 0) return "0";
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}

/** Derive a human phase word from the running-tool count and the friendly
 *  status label. Rotates through "starting", "working", "almost done" based
 *  on simple heuristics so the user gets a feel for progress without a timer
 *  dependency. */
export function phaseWord(
  runningToolCount: number,
  toolStepCount: number,
  statusLabel: string | null,
): string {
  if (statusLabel && statusLabel.includes("Waiting")) return "waiting";
  if (toolStepCount === 0) return "starting";
  // Heuristic: when many steps have fired, signal progress regardless of
  // whether a tool is currently running.
  if (toolStepCount >= 3) return "almost done";
  // After all tools complete (no active tool) but before the final answer, the
  // model is doing its final reasoning pass.
  if (runningToolCount === 0) return "wrapping up";
  return "working";
}

// ---- Settled-bar fade constants ----------------------------------------------

/**
 * How long (ms) the settled token bar stays fully visible before it fades.
 * Named constant so tests can reference it without magic numbers.
 */
export const SETTLED_VISIBLE_MS = 2500;

/** Duration (ms) of the opacity-out transition after SETTLED_VISIBLE_MS. */
export const SETTLED_FADE_MS = 400;

/** Pure helper: given elapsed time since the settled bar appeared, return the
 *  CSS opacity value (1 while visible, linearly interpolated to 0 during the
 *  fade, 0 after). Exported for unit testing; the component drives it via a
 *  timer. */
export function settledOpacity(elapsedSinceSettledMs: number): number {
  if (elapsedSinceSettledMs < SETTLED_VISIBLE_MS) return 1;
  const fadeProgress =
    (elapsedSinceSettledMs - SETTLED_VISIBLE_MS) / SETTLED_FADE_MS;
  return Math.max(0, 1 - fadeProgress);
}

// ---- BeakerBot glyph (small rounded square, not a registry icon) -----------
// The BBmark SVG is used inline here. It is the SAME symbol rendered from
// BeakerBot.tsx via the bbmark <symbol>. We inline a small version without
// the shared-SVG-symbol pattern because this is a purely decorative 20x20
// status-line indicator and the symbol is not available globally in tests.
// No new registry icon is added.

function StatusGlyph() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md bg-brand/10"
    >
      <BeakerBot pose="idle" animated={false} className="h-4 w-4" ariaLabel="" />
    </span>
  );
}

// ---- Steps panel -------------------------------------------------------------

function ToolStatusBadge({ status }: { status: ToolStep["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand"
        />
        running
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
        done
      </span>
    );
  }
  // queued
  return (
    <span className="rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-xs text-foreground-muted">
      queued
    </span>
  );
}

function StepsPanel({ steps }: { steps: ToolStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-foreground-muted">
        No tool calls yet this turn.
      </div>
    );
  }
  return (
    <div className="divide-y divide-border">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-1.5">
          <span className="flex-1 truncate font-mono text-xs text-foreground-muted">
            {step.toolName}
          </span>
          <ToolStatusBadge status={step.status} />
        </div>
      ))}
    </div>
  );
}

// ---- Separator middot --------------------------------------------------------

function Sep() {
  return (
    <span aria-hidden="true" className="mx-1.5 select-none text-foreground-muted text-xs">
      &middot;
    </span>
  );
}

// ---- Running status line -----------------------------------------------------

function RunningStatusLine({
  turnStartedAt,
  turnTokens,
  runningToolCount,
  turnToolSteps,
  statusLabel,
}: {
  turnStartedAt: number;
  turnTokens: number | null;
  runningToolCount: number;
  turnToolSteps: ToolStep[];
  statusLabel: string | null;
}) {
  // Tick elapsed time locally in the component. The store holds the settled
  // final value; while running we compute live from turnStartedAt.
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - turnStartedAt);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedMs(Date.now() - turnStartedAt);
    }, 500);
    return () => clearInterval(id);
  }, [turnStartedAt]);

  const phase = phaseWord(runningToolCount, turnToolSteps.length, statusLabel);
  const hasTokens = turnTokens !== null && turnTokens > 0;

  return (
    <div data-testid="beakerbot-status-line-running">
      {/* Collapsed bar */}
      <div className="flex items-center gap-0 px-3 py-1.5 text-xs text-foreground-muted">
        <StatusGlyph />
        <span className="ml-2 font-semibold text-foreground">{formatElapsed(elapsedMs)}</span>
        {hasTokens ? (
          <>
            <Sep />
            <span>{formatTokens(turnTokens!)}&nbsp;tokens</span>
          </>
        ) : null}
        {runningToolCount > 0 ? (
          <>
            <Sep />
            <span className="inline-flex items-center gap-1 font-semibold text-brand">
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand"
              />
              {runningToolCount} running
            </span>
          </>
        ) : null}
        <Sep />
        <span>{phase}&hellip;</span>
        {/* Details toggle, right-aligned */}
        <Tooltip label={expanded ? "Collapse steps" : "Expand steps"} placement="top">
          <button
            type="button"
            data-testid="beakerbot-status-details-toggle"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto text-xs text-brand underline hover:no-underline focus:outline-none"
          >
            {expanded ? "hide" : "details"}
          </button>
        </Tooltip>
      </div>

      {/* Expandable steps panel */}
      {expanded ? (
        <div
          data-testid="beakerbot-status-steps"
          className="border-t border-border bg-surface-sunken"
        >
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs font-semibold text-foreground">Steps so far</span>
            <Tooltip label="Collapse steps" placement="top">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-xs text-brand underline hover:no-underline focus:outline-none"
              >
                collapse
              </button>
            </Tooltip>
          </div>
          <StepsPanel steps={turnToolSteps} />
        </div>
      ) : null}
    </div>
  );
}

// ---- Settled status line -----------------------------------------------------

function SettledStatusLine({ summary }: { summary: TurnSummary }) {
  const hasTokens = summary.tokens > 0;
  const elapsedStr = formatElapsed(summary.elapsedMs);

  // Track elapsed time since this bar appeared so we can compute the fade
  // opacity. appearedAt is a ref so the interval closure always reads the
  // original mount time, never re-creates on renders.
  const appearedAt = useRef<number>(Date.now());
  const [opacity, setOpacity] = useState(1);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Date.now() - appearedAt.current;
      const op = settledOpacity(elapsed);
      setOpacity(op);
      if (op <= 0) {
        clearInterval(id);
        setGone(true);
      }
    }, 50);
    return () => clearInterval(id);
  }, []);

  if (gone) return null;

  return (
    <div
      data-testid="beakerbot-status-line-settled"
      style={{ opacity, transition: `opacity ${SETTLED_FADE_MS}ms linear` }}
      className="flex items-center gap-0 px-3 py-1 text-xs text-foreground-muted"
    >
      <StatusGlyph />
      <span className="ml-2">{elapsedStr}</span>
      {hasTokens ? (
        <>
          <Sep />
          <span>{formatTokens(summary.tokens)}&nbsp;tokens</span>
        </>
      ) : null}
      {summary.elapsedMs >= 10000 ? (
        // "done" label for long turns only, follows the mockup section 5 pattern.
        <>
          <Sep />
          <span className="font-semibold text-green-700">done</span>
        </>
      ) : null}
    </div>
  );
}

// ---- Public exports ---------------------------------------------------------

export { RunningStatusLine, SettledStatusLine };

/** Render the appropriate status line for the current turn state.
 *
 *  Pass `sending=true` with a non-null `turnStartedAt` to show the running bar.
 *  Pass a `settledSummary` to show the fading settled bar.
 *  Returns null when neither condition applies (idle, no prior turn). */
export default function TurnStatusLine({
  sending,
  turnStartedAt,
  turnTokens,
  runningToolCount,
  turnToolSteps,
  statusLabel,
  settledSummary,
}: {
  sending: boolean;
  turnStartedAt: number | null;
  turnTokens: number | null;
  runningToolCount: number;
  turnToolSteps: ToolStep[];
  statusLabel: string | null;
  settledSummary?: TurnSummary;
}) {
  if (sending && turnStartedAt !== null) {
    return (
      <RunningStatusLine
        turnStartedAt={turnStartedAt}
        turnTokens={turnTokens}
        runningToolCount={runningToolCount}
        turnToolSteps={turnToolSteps}
        statusLabel={statusLabel}
      />
    );
  }
  if (settledSummary) {
    return <SettledStatusLine summary={settledSummary} />;
  }
  return null;
}
