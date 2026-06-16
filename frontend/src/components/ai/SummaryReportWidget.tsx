"use client";

// BeakerBot summary aggregate card (BeakerAI lane, 2026-06-15).
//
// Layer 3 of the summary suite: renders a summarize_* tool's DETERMINISTIC
// aggregate (SummaryReport) as an inline card, so the counts the user sees come
// straight from the tool, never from the model's prose. It sits ABOVE the items
// record-set widget (RecordSetWidget renders the matched items below). One widget
// renders every summary type off the normalized payload.
//
// This component does ZERO arithmetic on the data: it only scales bar WIDTHS for
// display (a pure layout concern). Every number shown is copied from the payload,
// which the tool computed. Built on the shared widget kit + registry icons.
//
// House style, no inline icons, no emojis, no mid-sentence colons.

import { Icon, type IconName } from "@/components/icons";
import type {
  SummaryReport,
  SummaryTone,
  SummaryBarGroup,
} from "@/lib/ai/summary-report";
import { widgetCardClass, type WidgetTint } from "./widget-kit";

// Per-kind header identity, reusing the domain families from the widget kit so a
// summary card reads like the rest of BeakerBot (experiments = protocol/blue,
// purchases = commerce/amber, and so on).
const KIND_HEADER: Record<string, { icon: IconName; tint: WidgetTint }> = {
  summarize_experiments: { icon: "list", tint: "protocol" },
  summarize_notes: { icon: "pencil", tint: "org" },
  summarize_projects: { icon: "folder", tint: "org" },
  summarize_purchases: { icon: "receipt", tint: "commerce" },
  summarize_inventory: { icon: "box", tint: "commerce" },
  lab_digest: { icon: "chart", tint: "data" },
};

const TILE_TINT: Record<WidgetTint, string> = {
  bio: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  data: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  protocol: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  commerce: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  macro: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  org: "bg-surface-sunken text-foreground-muted",
  neutral: "bg-surface-sunken text-foreground-muted",
};

// Tone -> the value color on a stat tile and the fill color on a bar. STATUS tones,
// not object-domain tints.
const TONE_TEXT: Record<SummaryTone, string> = {
  done: "text-green-600 dark:text-green-400",
  active: "text-blue-600 dark:text-blue-400",
  overdue: "text-red-600 dark:text-red-400",
  upcoming: "text-foreground-muted",
  accent: "text-brand",
  spend: "text-amber-600 dark:text-amber-400",
  neutral: "text-foreground",
};

const TONE_FILL: Record<SummaryTone, string> = {
  done: "bg-green-500",
  active: "bg-blue-500",
  overdue: "bg-red-500",
  upcoming: "bg-border",
  accent: "bg-brand",
  spend: "bg-amber-500",
  neutral: "bg-foreground-muted/50",
};

function StatTile({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  tone?: SummaryTone;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg bg-surface-sunken px-3 py-2">
      <div
        className={`${emphasis ? "text-[22px]" : "text-[19px]"} font-semibold leading-none ${
          tone ? TONE_TEXT[tone] : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-tight text-foreground-muted">{label}</div>
    </div>
  );
}

function BarGroup({ group }: { group: SummaryBarGroup }) {
  // Scale widths to the largest value in THIS group (display-only). Number-coerce
  // every value so one stray non-numeric never turns max into NaN (NaN || 1 => 1,
  // which would make every width > 100% and overflow-clip them all to full width).
  const max =
    group.rows.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0) || 1;
  return (
    <div className="mb-3">
      <div className="px-0.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
        {group.title}
      </div>
      <div className="flex flex-col gap-1.5">
        {group.rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2.5 text-[12px]">
            <span className="w-24 shrink-0 truncate text-foreground" title={row.label}>
              {row.label}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <span
                className={`block h-full rounded-full ${row.tone ? TONE_FILL[row.tone] : TONE_FILL.accent}`}
                style={{
                  width: `${Math.min(100, Math.max(0, Math.round((Number(row.value) / max) * 100)))}%`,
                }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] text-foreground-muted">
              {row.display ?? String(row.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SummaryReportWidget({ report }: { report: SummaryReport }) {
  const header = KIND_HEADER[report.kind] ?? { icon: "chart" as IconName, tint: "neutral" as WidgetTint };
  const histMax = report.histogram
    ? report.histogram.bars.reduce((m, b) => Math.max(m, Number(b.value) || 0), 0) || 1
    : 1;
  // The plot area height in px. Percentage heights on flex items do not resolve
  // reliably (the bars came out invisible), so scale to a fixed pixel height.
  const HIST_PX = 56;

  return (
    <div className={`${widgetCardClass(true)} mt-2`}>
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span
          className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md ${TILE_TINT[header.tint]}`}
        >
          <Icon name={header.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {report.heading} summary
          </div>
        </div>
      </div>

      {report.scope.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {report.scope.map((chip, i) => (
            <span
              key={`${chip}-${i}`}
              className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-foreground-muted"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      {report.stats.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 px-4 pt-3 @sm:grid-cols-4">
          {report.stats.map((s) => (
            <StatTile key={s.label} label={s.label} value={s.value} tone={s.tone} emphasis={s.emphasis} />
          ))}
        </div>
      ) : null}

      <div className="px-4 pt-4">
        {report.barGroups.map((g) => (
          <BarGroup key={g.title} group={g} />
        ))}

        {report.histogram ? (
          <div className="mb-2">
            <div className="px-0.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
              {report.histogram.title}
            </div>
            <div className="flex items-end gap-1" style={{ height: HIST_PX }}>
              {report.histogram.bars.map((b, i) => (
                <span
                  key={`${b.label}-${i}`}
                  title={`${b.label}: ${b.value}`}
                  className="flex-1 rounded-t bg-brand/70"
                  style={{
                    height: `${Math.max(3, Math.round((Number(b.value) / histMax) * HIST_PX))}px`,
                  }}
                />
              ))}
            </div>
            <div className="mt-1 flex gap-1">
              {report.histogram.bars.map((b, i) => (
                <span key={`${b.label}-x-${i}`} className="flex-1 truncate text-center text-[9px] text-foreground-muted">
                  {b.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border px-4 py-2 text-[11px] text-foreground-muted">
        These numbers are counted by BeakerBot&apos;s tools. The assistant only narrates them.
      </div>
    </div>
  );
}
