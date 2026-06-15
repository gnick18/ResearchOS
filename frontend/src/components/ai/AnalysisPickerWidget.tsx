"use client";

// Inline analysis/graph picker for BeakerBot (BeakerAI lane, 2026-06-15).
//
// ONE widget, ONE engine, THREE doors (Grant): the suggest_analyses chat tool
// (focus "both"), the Data Hub "Analyze" button (focus "analyses"), and a "Plot
// this" button (focus "graphs") all mount this from the SAME tableCapabilities
// result. It only ever lists analyses + graphs the deterministic engine said can
// RUN on the table, so picking one always works (the suggest-then-refuse fix).
//
// Picking an item calls onPick, the host runs it (the reference-validated engine
// for an analysis, the plot spec for a graph) and shows the result IN PLACE, so
// the chat is never navigated away from.
//
// Inline-scroll: when mounted in the chat (inline), the body must NOT introduce
// its own vertical scroll or it traps the wheel (the bug fixed in 0af1e8c83 /
// the SmartDataWizard inline prop). It grows naturally and the chat scrolls.
//
// Icon-guard: every glyph comes from @/components/icons. No emojis, no em-dashes,
// no mid-sentence colons.

import { Icon } from "@/components/icons";
import type {
  Capability,
  TableCapabilities,
} from "@/lib/datahub/table-capabilities";

export type PickerFocus = "both" | "analyses" | "graphs";

export interface AnalysisPickerWidgetProps {
  tableName: string;
  capabilities: TableCapabilities;
  /** Which sections to show. Defaults to both. */
  focus?: PickerFocus;
  /** Run the chosen analysis or graph (host owns the run + the in-place result). */
  onPick: (item: Capability) => void;
  onClose: () => void;
  /** Mounted in the scrolling chat (drops the internal scroll so the chat owns it). */
  inline?: boolean;
}

function titleFor(focus: PickerFocus, tableName: string): string {
  if (focus === "analyses") return `Analyze ${tableName}`;
  if (focus === "graphs") return `Plot ${tableName}`;
  return `What you can do with ${tableName}`;
}

function Section({
  title,
  items,
  onPick,
}: {
  title: string;
  items: Capability[];
  onPick: (item: Capability) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1">
      <div className="px-1 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <button
            key={`${item.kind}:${item.id}`}
            type="button"
            onClick={() => onPick(item)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:border-brand hover:bg-surface-raised"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">
                {item.label}
              </div>
              <div className="truncate text-[11px] text-foreground-muted">
                {item.hint}
              </div>
            </div>
            <Icon name="chevronRight" className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function AnalysisPickerWidget({
  tableName,
  capabilities,
  focus = "both",
  onPick,
  onClose,
  inline = false,
}: AnalysisPickerWidgetProps) {
  const showAnalyses = focus !== "graphs";
  const showGraphs = focus !== "analyses";

  return (
    <div className="w-[440px] max-w-full overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-xl">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Icon name="chart" className="h-4 w-4 shrink-0 text-accent" />
        <div className="truncate text-sm font-semibold text-foreground">
          {titleFor(focus, tableName)}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto text-foreground-muted hover:text-foreground"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <div className={inline ? "px-3 py-2" : "max-h-[420px] overflow-y-auto px-3 py-2"}>
        {showAnalyses && (
          <Section title="Analyses" items={capabilities.analyses} onPick={onPick} />
        )}
        {showGraphs && (
          <Section title="Graphs" items={capabilities.graphs} onPick={onPick} />
        )}
      </div>
    </div>
  );
}
