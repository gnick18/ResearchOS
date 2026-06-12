"use client";

// "AI usage" section of the unified Settings page. The flagship new surface, a
// plain-language readout of the BeakerBot token balance and recent task costs,
// framed to match the /pricing voice.
//
// The balance and recent tasks are now REAL reads from the AI ledger (BeakerAI
// billing Phase 4) via fetchAiStatus, with loading, signed-out, and empty states.
// When AI billing enforcement is off (the current beta default) the endpoint
// returns a clearly-flagged inert response, so we show the "AI is free during the
// beta" framing instead of a balance. The $10/$25/$50 packs are DISPLAY-ONLY for
// now, Phase 3 wires the Stripe purchase, so the buy action is disabled with a
// "top-ups coming soon" affordance rather than a dead button. The pack token
// amounts derive from PACK_TOKENS so they stay honest with the live rate, the
// fixture supplies only the rough "about N analyses" labels.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/icons";
import { PACK_TOKENS } from "@/lib/billing/ai-config";
import { fetchAiStatus, type AiStatus } from "@/lib/billing/ai-client";
import { TOKEN_BLOCKS_FIXTURE } from "@/lib/usage/usage-fixtures";

function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** The display-only packs, the dollar tile + its rough coverage label (fixture)
 *  paired with the token amount the live rate buys (PACK_TOKENS). */
const PACKS: { price: string; dollars: 10 | 25 | 50; tasks: string; recommended?: boolean }[] = [
  { price: "$10", dollars: 10, tasks: TOKEN_BLOCKS_FIXTURE[0]?.tasks ?? "", },
  { price: "$25", dollars: 25, tasks: TOKEN_BLOCKS_FIXTURE[1]?.tasks ?? "", recommended: true },
  { price: "$50", dollars: 50, tasks: TOKEN_BLOCKS_FIXTURE[2]?.tasks ?? "", },
];

export default function AiUsageSection() {
  const [selectedPack, setSelectedPack] = useState<number>(
    PACKS.findIndex((p) => p.recommended) >= 0
      ? PACKS.findIndex((p) => p.recommended)
      : 0,
  );
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void fetchAiStatus().then((s) => {
      if (!alive) return;
      setStatus(s);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const enabled = status?.enabled === true;
  const balance = status?.balance ?? 0;
  const recentTasks = status?.recentTasks ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6">
      {/* Token balance + buy */}
      <section className="bg-surface-raised rounded-xl border border-blue-200 dark:border-blue-500/30 p-5">
        <h3 className="flex items-center gap-2 text-title font-semibold text-foreground">
          <Icon name="bolt" className="h-4 w-4 text-blue-600 dark:text-blue-300" />
          BeakerBot tokens
        </h3>
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          Your prepaid balance for the AI assistant. A token is a small chunk of
          text, a typical question is a few thousand.
        </p>

        {loading ? (
          <div className="mt-4 h-8 w-48 rounded bg-surface-sunken animate-pulse" />
        ) : enabled ? (
          <>
            <div className="flex items-baseline gap-2 mt-4">
              <span className="text-display font-bold text-foreground tracking-tight">
                {formatTokens(balance)}
              </span>
              <span className="text-body font-semibold text-foreground-muted">
                tokens left
              </span>
            </div>
            <div className="mt-2 rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50/60 dark:bg-blue-500/10 px-3 py-2 text-body text-foreground-muted leading-relaxed">
              That covers roughly{" "}
              <span className="font-medium text-foreground">
                a few dozen full analyses or a hundred-plus quick questions
              </span>
              , depending on how big each question is.
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10 px-3 py-2 text-body text-foreground-muted leading-relaxed">
            BeakerBot is free during the beta, so there is no balance to track
            yet. When metered billing turns on you start with a one-time sign-up
            gift of about{" "}
            <span className="font-medium text-foreground">750,000 tokens</span>.
          </div>
        )}

        {enabled && (
          <div className="mt-5">
            <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mb-2">
              Recent tasks
            </p>
            {recentTasks.length === 0 ? (
              <p className="text-meta text-foreground-muted leading-relaxed">
                No BeakerBot tasks yet. Once you run an analysis or ask a question,
                its token cost shows up here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {recentTasks.map((task) => (
                  <li
                    key={task.taskId}
                    className="flex items-center gap-3 py-2 text-body"
                  >
                    <span className="flex-1 text-foreground truncate">
                      {task.taskId}
                    </span>
                    <span className="text-meta font-semibold text-foreground-muted bg-surface-sunken rounded px-1.5 py-0.5">
                      {task.kind}
                    </span>
                    <span className="text-meta font-medium text-foreground-muted tabular-nums whitespace-nowrap">
                      {formatTokens(task.tokens)} tokens
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mt-5 mb-2">
          Buy more tokens
        </p>
        <div className="flex gap-2">
          {PACKS.map((pack, i) => {
            const selected = i === selectedPack;
            return (
              <button
                key={pack.price}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedPack(i)}
                className={`flex-1 rounded-xl border p-3 text-center transition-colors ${
                  selected
                    ? "border-blue-400 bg-blue-50 dark:bg-blue-500/15"
                    : "border-border bg-surface-raised hover:border-blue-300"
                }`}
              >
                <span className="block text-title font-bold text-foreground">
                  {pack.price}
                </span>
                <span className="block text-meta text-foreground-muted mt-0.5">
                  {pack.tasks}
                </span>
                <span className="block text-meta text-foreground-muted mt-0.5 tabular-nums">
                  {formatTokens(PACK_TOKENS[pack.dollars])} tokens
                </span>
              </button>
            );
          })}
        </div>
        {/* Display-only until Phase 3 wires Stripe top-ups. Disabled with a clear
            affordance rather than a dead button. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Token top-ups are coming soon."
          className="w-full mt-3 px-3 py-2 text-body font-medium bg-surface-sunken text-foreground-muted rounded-lg cursor-not-allowed"
        >
          Top-ups coming soon
        </button>

        <p className="text-meta text-foreground-muted leading-relaxed border-t border-dashed border-border pt-3 mt-4">
          During the beta the AI is free. After that you pay only for what you
          use, near our cost, because the open-weight model and the in-browser
          agent loop keep it cheap.{" "}
          <Link href="/pricing" className="text-blue-600 dark:text-blue-300 font-semibold hover:underline">
            See how AI is priced
          </Link>
          .
        </p>
      </section>

      {/* How the cost works */}
      <section className="bg-surface-raised rounded-xl border border-border p-5">
        <h3 className="flex items-center gap-2 text-title font-semibold text-foreground">
          <Icon name="ask" className="h-4 w-4 text-blue-600 dark:text-blue-300" />
          How the cost works
        </h3>
        <p className="text-meta text-foreground-muted leading-relaxed mt-2">
          BeakerBot is the assistant that reasons over your work, runs an
          analysis, makes a plot, and writes it up, always with your approval
          before it changes anything.
        </p>
        <p className="text-meta text-foreground-muted leading-relaxed mt-3">
          It is metered because each task calls a hosted model that costs us real
          money to run. We run an open-weight model and the agent loop runs in
          your browser, so only a small result ever crosses to the model, never
          your files. Low cost and your-data-stays-home are the same fact.
        </p>
        <p className="text-meta text-foreground-muted leading-relaxed mt-3">
          Your lab, department, or institution can fund a shared pool, so you can
          use BeakerBot without entering a card.
        </p>
        <p className="text-meta text-foreground-muted leading-relaxed border-t border-dashed border-border pt-3 mt-4">
          <Link href="/pricing" className="text-blue-600 dark:text-blue-300 font-semibold hover:underline">
            Manage billing / see plans
          </Link>
        </p>
      </section>
    </div>
  );
}
