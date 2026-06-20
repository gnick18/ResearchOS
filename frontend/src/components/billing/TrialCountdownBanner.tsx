"use client";

// Lab-head trial countdown banner (Grant 2026-06-19). Reassures during the
// 90-day no-card trial and escalates gently as it ends. Reads the live trial
// status from /api/billing/model-a/status; all the show/escalate logic is the
// pure trialCountdown helper. Mounted once in the root layout (like UpgradeNudge)
// and self-gates, so only a lab head who is actually trialing ever sees it.
//
// Dismiss is per urgency tier: dismissing the calm banner still lets it return
// when it escalates to "soon" then "final", so the ending is never missed.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import {
  trialBannerCopy,
  trialCountdown,
  trialDismissKey,
  type TrialUrgency,
} from "@/lib/billing/trial-countdown";

export default function TrialCountdownBanner() {
  const [view, setView] = useState<{ daysLeft: number; urgency: TrialUrgency } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/billing/model-a/status");
        if (!res.ok) return; // 404 when billing is off, 401 when not signed in
        const s = await res.json();
        const c = trialCountdown(s.trialPhase, s.trialEndsAt, Date.now());
        if (cancelled || !c.show) return;
        let isDismissed = false;
        try {
          isDismissed = localStorage.getItem(trialDismissKey(c.urgency)) === "1";
        } catch {
          /* private mode: just show it */
        }
        if (isDismissed) return;
        setView({ daysLeft: c.daysLeft, urgency: c.urgency });
      } catch {
        /* offline / status unreachable: no banner */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!view) return null;

  const { title, body } = trialBannerCopy(view.daysLeft, view.urgency);
  const accent =
    view.urgency === "final"
      ? "border-amber-400/60"
      : view.urgency === "soon"
        ? "border-amber-300/50"
        : "border-border";

  const dismiss = () => {
    try {
      localStorage.setItem(trialDismissKey(view.urgency), "1");
    } catch {
      /* ignore */
    }
    setView(null);
  };

  return (
    <div
      role="status"
      className={`fixed bottom-4 left-4 z-[200] w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border ${accent} bg-surface-overlay p-4 shadow-xl`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand-action/10 text-brand-action">
          <Icon name="hourglass" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{body}</p>
          <div className="mt-3 flex items-center gap-3">
            <Link
              href="/settings"
              className="rounded-lg bg-[#1283c9] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0f6fa8]"
            >
              Add a card
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="text-xs font-medium text-foreground-muted transition-colors hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
