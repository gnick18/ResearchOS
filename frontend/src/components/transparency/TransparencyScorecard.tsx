/**
 * Trust scorecard hero for the /transparency page. Replaces the dense
 * methodology paragraph as the lead. A reader should grasp the headline in one
 * glance: how many calculations are checked, how many match the reference
 * exactly, how many sit within a documented tolerance, and how many are failing
 * (zero).
 *
 * The long methodology paragraph moves below the metric band as a quiet "How
 * this works" disclosure so the page leads with the result, not the method.
 *
 * Server component, pure markup. No inline SVG. Voice: factual, no em-dashes, no
 * emojis, no mid-sentence colons.
 */

import Kicker from "@/components/marketing/Kicker";

import type { AgreementCounts } from "@/lib/transparency/summary";

import HowThisWorks from "./HowThisWorks";

function Metric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "neutral" | "good" | "muted";
}) {
  const valueClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "muted"
        ? "text-foreground-muted"
        : "text-brand-ink";
  return (
    <div className="rounded-xl border border-border bg-surface-sunken px-4 py-4 text-center">
      <div className={`text-3xl font-bold tabular-nums tracking-tight sm:text-4xl ${valueClass}`}>
        {value}
      </div>
      <div className="mt-1 text-meta font-medium text-foreground-muted">{label}</div>
    </div>
  );
}

export default function TransparencyScorecard({ counts }: { counts: AgreementCounts }) {
  const withinTolerance = counts.within + counts.expected;
  const failing = counts.larger;

  return (
    <header className="rounded-2xl border border-border bg-surface-raised p-5 shadow-sm sm:p-10">
      <div className="mb-4">
        <Kicker>Method validation</Kicker>
      </div>
      <h1 className="mb-4 text-[clamp(1.35rem,5vw,2.25rem)] font-bold leading-tight tracking-tight text-brand-ink sm:text-display sm:text-4xl">
        Checked against the tools scientists already trust
      </h1>
      <p className="max-w-2xl text-body text-foreground-muted">
        Every calculation in ResearchOS is recomputed against an independent reference on each commit,
        and a result past its documented tolerance fails the build.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric value={counts.total} label="Comparisons checked" tone="neutral" />
        <Metric value={counts.exact} label="Exact match" tone="good" />
        <Metric value={withinTolerance} label="Within tolerance" tone="muted" />
        <Metric value={failing} label="Failing" tone={failing === 0 ? "good" : "neutral"} />
      </div>

      <div className="mt-6">
        <HowThisWorks />
      </div>
    </header>
  );
}
