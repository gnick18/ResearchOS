"use client";

// WorkspaceToolbar (datahub-chrome). A reusable slim action bar for the Data Hub
// workspace, matching the toolbar in docs/mockups/datahub-table-results-audit.html
// and the chrome we just shipped on the graph editor: a thin bar of grouped
// buttons on a raised surface, with hairline dividers between groups and a single
// accented primary action that carries the headline move (Analyze on a table,
// New analysis on a result).
//
// The toolbar is generic. It takes an array of GROUPS, each a list of buttons,
// and renders the groups left to right with a thin vertical divider between them.
// A button can be primary (accent bg-brand-action text-white transition-colors hover:bg-brand-action/90 styling), disabled, or icon-only (it
// gets a Tooltip so the action is still legible). Every button can carry a
// tooltip; icon-only buttons require one so they are never a mystery glyph.
//
// House style: <Icon> only, Tooltip on icon-only buttons, brand + semantic
// tokens, no emojis / em-dashes / mid-sentence colons.

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

export interface ToolbarButton {
  /** A registry icon name. Required when there is no label (icon-only button). */
  icon?: React.ComponentProps<typeof Icon>["name"];
  /** The button label. Omit for an icon-only button (then icon + tooltip are required). */
  label?: string;
  onClick: () => void;
  /** Render as the accent primary action (the headline move). */
  primary?: boolean;
  disabled?: boolean;
  /** Hover help. Required when the button is icon-only. */
  tooltip?: string;
  /** Render with the danger affordance (a red-tinted destructive action). */
  danger?: boolean;
  /** A stable test id passthrough. */
  testId?: string;
}

export type ToolbarGroup = ToolbarButton[];

function ToolbarAction({ btn }: { btn: ToolbarButton }) {
  const iconOnly = !btn.label;
  const base =
    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-meta font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const tone = btn.primary
    ? "bg-brand-action text-white transition-colors hover:bg-brand-action/90"
    : btn.danger
      ? "border border-border bg-surface-raised text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
      : "border border-border bg-surface-raised text-foreground hover:bg-surface-sunken";
  const node = (
    <button
      type="button"
      onClick={btn.onClick}
      disabled={btn.disabled}
      aria-label={iconOnly ? btn.tooltip ?? btn.label : undefined}
      data-testid={btn.testId}
      className={`${base} ${tone} ${iconOnly ? "px-2" : ""}`}
    >
      {btn.icon ? <Icon name={btn.icon} className="h-3.5 w-3.5 shrink-0" /> : null}
      {btn.label ? <span className="whitespace-nowrap">{btn.label}</span> : null}
    </button>
  );
  // Icon-only buttons always get a tooltip; labelled buttons get one when asked.
  if (iconOnly || btn.tooltip) {
    return <Tooltip label={btn.tooltip ?? btn.label ?? ""}>{node}</Tooltip>;
  }
  return node;
}

export default function WorkspaceToolbar({
  groups,
  testId,
}: {
  /** Groups of buttons, rendered left to right with a divider between groups. */
  groups: ToolbarGroup[];
  testId?: string;
}) {
  // Drop empty groups so a conditional (omitted) button never leaves a stray
  // divider behind.
  const filled = groups.filter((g) => g.length > 0);
  return (
    <div
      data-testid={testId}
      className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-raised px-3 py-2"
    >
      {filled.map((group, gi) => (
        <div key={gi} className="flex items-center gap-1.5">
          {gi > 0 ? (
            <span
              aria-hidden
              className="mx-1 h-5 w-px shrink-0 bg-border"
            />
          ) : null}
          {group.map((btn, bi) => (
            <ToolbarAction key={btn.testId ?? btn.label ?? `${gi}-${bi}`} btn={btn} />
          ))}
        </div>
      ))}
    </div>
  );
}
