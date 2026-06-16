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

import { type IconName } from "@/components/icons";
import type {
  Capability,
  TableCapabilities,
} from "@/lib/datahub/table-capabilities";
import {
  WidgetHeader,
  WidgetOptionGrid,
  WidgetRow,
  WidgetSection,
  widgetCardClass,
  type WidgetTint,
} from "./widget-kit";

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
  tint,
  icon,
  onPick,
}: {
  title: string;
  items: Capability[];
  /** Domain family for the row tiles + the section dot. */
  tint: WidgetTint;
  /** One glyph per section (analyses vs graphs) from the registry. */
  icon: IconName;
  onPick: (item: Capability) => void;
}) {
  if (items.length === 0) return null;
  return (
    <WidgetSection label={title} tint={tint}>
      <WidgetOptionGrid>
        {items.map((item) => (
          <WidgetRow
            key={`${item.kind}:${item.id}`}
            icon={icon}
            tint={tint}
            label={item.label}
            hint={item.hint}
            onClick={() => onPick(item)}
          />
        ))}
      </WidgetOptionGrid>
    </WidgetSection>
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
    <div className={widgetCardClass(inline)}>
      <WidgetHeader
        icon="chart"
        tint="data"
        title={titleFor(focus, tableName)}
        onClose={onClose}
      />

      <div className={inline ? "px-3 py-2" : "max-h-[420px] overflow-y-auto px-3 py-2"}>
        {showAnalyses && (
          <Section
            title="Analyses"
            items={capabilities.analyses}
            tint="protocol"
            icon="results"
            onPick={onPick}
          />
        )}
        {showGraphs && (
          <Section
            title="Graphs"
            items={capabilities.graphs}
            tint="data"
            icon="figure"
            onPick={onPick}
          />
        )}
      </div>
    </div>
  );
}
