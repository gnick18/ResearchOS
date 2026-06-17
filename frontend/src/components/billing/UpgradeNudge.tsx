"use client";

// The mounted host for the gentle upgrade nudge (lib/billing/upgrade-nudge). It
// renders a small, dismissible card in the corner when a produce-feature paywall
// fires triggerUpgradeNudge for a free user. Mounted once at the root; renders
// nothing until triggered, and the cooldown lives in the lib so it stays rare.
//
// Copy is feature-specific and explains the thing the user just reached for. The
// Solo price comes from the canonical catalog, never hardcoded.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";

import { PLAN_PRICES } from "@/lib/billing/catalog";
import {
  subscribeUpgradeNudge,
  type NudgeFeature,
} from "@/lib/billing/upgrade-nudge";

const solo = PLAN_PRICES.solo.base;

const COPY: Record<NudgeFeature, { h: string; p: string }> = {
  send: {
    h: "Sending shares this beyond your folder",
    p: `That is a Solo feature, ${solo}/mo plus the small bit of cloud you use, with a cap you set. Your local copy never changes.`,
  },
  coedit: {
    h: "Live co-editing is a paid feature",
    p: `Co-editing in real time runs on Solo, ${solo}/mo plus usage. You can keep working locally for free in the meantime.`,
  },
  app: {
    h: "Pairing the app needs a paid plan",
    p: `Live capture and sync from your phone is on Solo, ${solo}/mo plus usage. The app stays free to use offline.`,
  },
};

export default function UpgradeNudge() {
  const [feature, setFeature] = useState<NudgeFeature | null>(null);

  useEffect(() => subscribeUpgradeNudge((f) => setFeature(f)), []);

  if (!feature) return null;
  const c = COPY[feature];

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-[200] w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[#c7b8f5] bg-surface-raised p-4 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#ede9fe] text-[#5b47d6] font-bold"
        >
          +
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-foreground">{c.h}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{c.p}</p>
          <div className="mt-3 flex items-center gap-2">
            <a
              href="/pricing#plans"
              className="rounded-lg bg-[#1283c9] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0f6fa8]"
              onClick={() => setFeature(null)}
            >
              See Solo
            </a>
            <button
              type="button"
              className="rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground"
              onClick={() => setFeature(null)}
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
