"use client";

// "AI usage" section of the unified Settings page (settings-build bot,
// 2026-06-11). The flagship new surface. A plain-language readout of the
// BeakerBot token balance, recent task costs, and prepaid blocks, framed to
// match the /pricing voice. Numbers are illustrative fixtures today (see
// usage-fixtures.ts), they wire up to a real token ledger when AI billing lands.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/icons";
import {
  AI_USAGE_FIXTURE,
  RECENT_AI_TASKS_FIXTURE,
  TOKEN_BLOCKS_FIXTURE,
} from "@/lib/usage/usage-fixtures";

function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export default function AiUsageSection() {
  const [selectedBlock, setSelectedBlock] = useState<number>(
    TOKEN_BLOCKS_FIXTURE.findIndex((b) => b.recommended) >= 0
      ? TOKEN_BLOCKS_FIXTURE.findIndex((b) => b.recommended)
      : 0,
  );

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

        <div className="flex items-baseline gap-2 mt-4">
          <span className="text-display font-bold text-foreground tracking-tight">
            {formatTokens(AI_USAGE_FIXTURE.tokensLeft)}
          </span>
          <span className="text-body font-semibold text-foreground-muted">
            tokens left
          </span>
        </div>

        <div className="mt-2 rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50/60 dark:bg-blue-500/10 px-3 py-2 text-body text-foreground-muted leading-relaxed">
          That is roughly{" "}
          <span className="font-medium text-foreground">
            {AI_USAGE_FIXTURE.balanceTranslation}
          </span>
          .
        </div>

        {AI_USAGE_FIXTURE.includesSignupTrial && (
          <div className="mt-2">
            <span className="inline-block rounded-md bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-meta font-semibold px-2 py-0.5">
              Includes your one-time sign-up gift, about 750,000 tokens
            </span>
          </div>
        )}

        <div className="mt-5">
          <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mb-2">
            Recent tasks
          </p>
          <ul className="divide-y divide-border">
            {RECENT_AI_TASKS_FIXTURE.map((task) => (
              <li
                key={task.name}
                className="flex items-center gap-3 py-2 text-body"
              >
                <span className="flex-1 text-foreground">{task.name}</span>
                <span className="text-meta font-semibold text-foreground-muted bg-surface-sunken rounded px-1.5 py-0.5">
                  {task.kind}
                </span>
                <span className="text-meta font-medium text-foreground-muted tabular-nums whitespace-nowrap">
                  {formatTokens(task.tokens)} tokens
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mt-5 mb-2">
          Buy more tokens
        </p>
        <div className="flex gap-2">
          {TOKEN_BLOCKS_FIXTURE.map((block, i) => {
            const selected = i === selectedBlock;
            return (
              <button
                key={block.price}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedBlock(i)}
                className={`flex-1 rounded-xl border p-3 text-center transition-colors ${
                  selected
                    ? "border-blue-400 bg-blue-50 dark:bg-blue-500/15"
                    : "border-border bg-surface-raised hover:border-blue-300"
                }`}
              >
                <span className="block text-title font-bold text-foreground">
                  {block.price}
                </span>
                <span className="block text-meta text-foreground-muted mt-0.5">
                  {block.tasks}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="w-full mt-3 px-3 py-2 text-body font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
        >
          Buy tokens
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
