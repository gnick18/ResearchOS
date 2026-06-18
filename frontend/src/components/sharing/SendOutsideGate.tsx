"use client";

// SendOutsideGate (send-is-paid gate, 2026-06-18).
//
// Wraps the "ready" body of every send-outside dialog. SENDING a one-time copy
// beyond your folder is the PAID produce side (the sender pays the relay), so
// once billing is live a FREE account sees a clear, escapable upsell here instead
// of the send form. RECEIVING and ACCEPTING what others send stays fully free, so
// those paths never mount this gate.
//
// This is a discovery-surface upsell, NOT a soft-lock. The dialog stays
// escapable (Escape closes, Not now closes), and the server route is the real
// gate (it returns 402). During the free beta the gate is dormant and renders the
// children unchanged, so the beta behaves exactly as before and no flag is flipped.
//
// Icons go through <Icon> (no inline svg, so the icon-guard hook stays green).
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { PLAN_PRICES } from "@/lib/billing/catalog";
import { useProduceEntitlement } from "@/hooks/useProduceEntitlement";

const solo = PLAN_PRICES.solo.base;

/**
 * Gate the send body. When billing is live and the account is on the free tier,
 * render the upsell; otherwise render the children (the normal send form). Shows
 * a brief spinner while the entitlement read is in flight on a billing-live build.
 */
export function SendOutsideGate({
  onClose,
  children,
}: {
  /** Dismiss the dialog (keeps the upsell escapable). */
  onClose: () => void;
  /** The normal send form, rendered when the account may send. */
  children: ReactNode;
}) {
  const produce = useProduceEntitlement();

  if (produce.gateActive && produce.loading) return <GateLoadingBody />;
  if (produce.gateActive && !produce.entitled)
    return <SendIsPaidBody onClose={onClose} />;
  return <>{children}</>;
}

function GateLoadingBody() {
  return (
    <div className="py-8 flex flex-col items-center text-center">
      <div className="w-9 h-9 rounded-full border-2 border-border border-t-blue-500 animate-spin" />
      <p className="text-body text-foreground-muted mt-4">Checking your plan</p>
    </div>
  );
}

// The upsell. Copy mirrors the gentle reactive nudge (UpgradeNudge) so the two
// surfaces read the same, and the Solo price comes from the canonical catalog,
// never hardcoded.
function SendIsPaidBody({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[#5b47d6]">
          <Icon name="bolt" className="w-5 h-5" />
        </span>
        <div>
          <p className="text-body font-medium text-foreground">
            Sending shares this beyond your folder
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            Sending a copy to someone outside your folder is a Solo feature,{" "}
            {solo}/mo plus the small bit of cloud you use, with a cap you set.
            Receiving and opening what others send you stays free. Your local copy
            never changes.
          </p>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="ros-btn-neutral flex-1 py-2 text-body"
        >
          Not now
        </button>
        <a
          href="/pricing#plans"
          onClick={onClose}
          className="ros-btn-raise flex-1 py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white text-center transition-colors"
        >
          See Solo
        </a>
      </div>
    </div>
  );
}
