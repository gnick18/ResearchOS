"use client";

/**
 * "What you are paying for today" competitor-savings tool on /pricing.
 *
 * A people slider plus tickable competitor rows (LabArchives, SnapGene, Quartzy,
 * Benchling) tally the lab's current annual spend, subtract a conservative
 * per-person optional-cloud estimate, and show an honest "you save" figure plus
 * the 5-year total. All numbers come from lib/pricing/assumptions, and the
 * formula mirrors the approved mockup so the figures come out identical.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import { COMPETITORS, CLOUD_PER_PERSON_YR } from "@/lib/pricing/assumptions";
import { usd0 } from "@/lib/pricing/cost-math";

export default function CompetitorSavings() {
  const [people, setPeople] = useState(8);
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(COMPETITORS.map((c) => [c.id, !!c.defaultOn])),
  );

  const isLab = people > 1;

  const { stackTotal, rosCost, save, save5 } = useMemo(() => {
    let total = 0;
    for (const c of COMPETITORS) {
      if (!on[c.id]) continue;
      total += c.mode === "user" ? c.cost * people : c.cost;
    }
    // A solo researcher genuinely pays nothing: the whole app runs free on their
    // own disk and they need no cloud. A lab exists to collaborate, which needs
    // the optional cloud, so a lab's real ResearchOS cost is that cloud, not $0.
    // We only count the cloud for a lab, so we never claim a team of eight is free.
    const cloud = people * CLOUD_PER_PERSON_YR;
    const cost = isLab ? cloud : 0;
    const saved = Math.max(0, total - cost);
    return {
      stackTotal: total,
      rosCost: cost,
      save: saved,
      save5: saved * 5,
    };
  }, [people, on, isLab]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Current stack */}
        <div className="rounded-2xl border border-border bg-surface-raised p-5">
          <h4 className="mb-4 text-sm font-extrabold text-foreground">
            Your current stack
          </h4>
          <div className="mb-4">
            <label className="mb-2 flex items-center justify-between text-[12.5px] font-semibold text-foreground">
              People in your lab
              <span className="font-extrabold tabular-nums text-brand-action">
                {people}
              </span>
            </label>
            <input
              type="range"
              min={1}
              max={40}
              step={1}
              value={people}
              onChange={(e) => setPeople(Number(e.target.value))}
              aria-label="People in your lab"
              className="w-full cursor-pointer accent-[color:var(--color-brand-action)]"
            />
          </div>
          <div className="flex flex-col gap-2">
            {COMPETITORS.map((c) => {
              const active = !!on[c.id];
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setOn((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "border-brand-action bg-brand-action/5"
                      : "border-border bg-surface-raised hover:border-foreground-muted"
                  }`}
                >
                  <span
                    className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border ${
                      active
                        ? "border-brand-action bg-brand-action text-white"
                        : "border-border"
                    }`}
                  >
                    {active ? <Icon name="check" className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-foreground">
                      {c.name}
                    </span>
                    <span className="text-[11.5px] text-foreground-muted">
                      {c.blurb}
                    </span>
                  </span>
                  <span
                    className={`whitespace-nowrap text-right text-[12px] font-bold tabular-nums ${
                      c.free ? "text-green-600 dark:text-green-400" : "text-foreground"
                    }`}
                  >
                    {c.priceLabel}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] leading-snug text-foreground-muted">
            ResearchOS also replaces GraphPad Prism, ChemDraw, and your
            file-sharing cloud. We will add those here once we have their academic
            prices cited.
          </p>
        </div>

        {/* What it costs you */}
        <div className="rounded-2xl border border-border bg-surface-raised p-5">
          <h4 className="mb-4 text-sm font-extrabold text-foreground">
            What it costs you
          </h4>
          <div className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px] text-foreground-muted">
            <span>Your tools today</span>
            <b className="font-semibold tabular-nums text-foreground">
              {usd0(stackTotal)} / yr
            </b>
          </div>
          {isLab ? (
            <div className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px] text-foreground-muted">
              <span>
                ResearchOS, free on your disk, you pay only the optional cloud so
                the lab can share
              </span>
              <b className="font-semibold tabular-nums text-foreground">
                ~{usd0(rosCost)} / yr
              </b>
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px] text-foreground-muted">
              <span>
                ResearchOS, the whole app free on your own disk, solo and local
              </span>
              <b className="font-semibold tabular-nums text-green-600 dark:text-green-400">
                $0
              </b>
            </div>
          )}
          <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-border pt-3 text-foreground">
            <span className="text-[12.5px]">You save</span>
            <span className="text-3xl font-extrabold tabular-nums text-green-600 dark:text-green-400">
              {usd0(save)} / yr
            </span>
          </div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-action/10 px-3.5 py-1.5 text-[12px] font-extrabold text-brand-action">
            <span className="h-2 w-2 flex-none rounded-full bg-brand-action" />
            <span>about {usd0(save5)} over 5 years</span>
          </div>
          {/* AI is not in the savings math (it is a separate metered-at-cost
              feature, not a fixed line), but it is a real value-add over the
              stack, so highlight it here and point to the AI pricing below. */}
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-[11.5px] leading-snug text-foreground dark:border-sky-500/30 dark:bg-sky-500/10">
            <span className="font-bold text-brand-action">
              Plus an AI assistant, at cost.
            </span>{" "}
            BeakerBot reasons over the data on your own disk for about a penny a
            task, with free tokens to start. It is the only metered part, and it
            is priced near our cost, not an enterprise AI upsell.{" "}
            <a
              href="#ai-pricing"
              className="font-semibold text-brand-action underline-offset-2 hover:underline"
            >
              See how AI is priced
            </a>
            .
          </div>
          <p className="mt-2.5 text-[11.5px] leading-snug text-foreground-muted">
            List prices, so a negotiated campus license runs lower per seat, but
            the gap stays large. A solo researcher pays nothing, the whole app
            runs free on their own disk. A lab pays only for the optional cloud it
            shares through, free up to the 5 GB pool, then a few dollars a month
            per person, and we count a heavy-use estimate of that here rather than
            pretend a team of eight is free.
          </p>
        </div>
      </div>
    </div>
  );
}
