"use client";

// useProduceEntitlement (send-is-paid gate, 2026-06-18).
//
// The CLIENT-side companion to the server helper isProduceEntitled (see
// lib/billing/model-a/resolve.ts). It answers one question for the UI, may THIS
// account use the PAID produce side (sending a one-time copy outside the folder,
// live co-editing, app pairing). It is the single shared client signal so the
// send-outside gate and the external-live-collab gate read the SAME source, not
// two divergent checks. The server route is always the authoritative gate (it
// returns 402); this hook just lets the UI show a clear upsell BEFORE the user
// reaches for a paid action, instead of a silent failure.
//
// DORMANT during the free beta. The whole feature is inert until billing is live
// on the client (NEXT_PUBLIC_BILLING_LIVE, read through isUpgradeNudgeActive),
// matching the server gate that only fires when isBillingEnabled(). While dormant
// the hook reports entitled (permissive) and never fetches, so the beta behaves
// byte-for-byte as before and no flag is flipped here.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";

import { isUpgradeNudgeActive } from "@/lib/billing/upgrade-nudge";

export interface ProduceEntitlement {
  /** Whether the paid-produce gate is live at all (billing live on the client).
   *  When false the gate is dormant and callers behave as the pre-billing beta. */
  gateActive: boolean;
  /** Whether the account may use the paid produce side. True (permissive) while
   *  the gate is dormant OR the status read is still in flight, so a free user is
   *  never blocked before billing goes live and a control never flashes locked
   *  before the read settles. */
  entitled: boolean;
  /** The status fetch is in flight. Only meaningful when gateActive is true. */
  loading: boolean;
}

/**
 * Pure resolver, unit-tested. `billingLive` is the client billing flag and
 * `produceEntitled` is the /status field (null while still unknown). Permissive
 * when the gate is dormant, and never reports "blocked" before the read settles.
 */
export function resolveProduceEntitlement(
  billingLive: boolean,
  produceEntitled: boolean | null,
): ProduceEntitlement {
  if (!billingLive) return { gateActive: false, entitled: true, loading: false };
  if (produceEntitled === null)
    return { gateActive: true, entitled: false, loading: true };
  return { gateActive: true, entitled: produceEntitled, loading: false };
}

/**
 * Whether the signed-in account may use the paid produce side. Reads the Model-A
 * status endpoint (which resolves a free lab member to their sponsoring PI, so a
 * paid-lab member reads as entitled). Safe to call from any client component, it
 * no-ops the fetch while dormant.
 */
export function useProduceEntitlement(): ProduceEntitlement {
  const billingLive = isUpgradeNudgeActive();
  const [produceEntitled, setProduceEntitled] = useState<boolean | null>(null);

  useEffect(() => {
    // Dormant in the beta. Never fetch, never gate.
    if (!billingLive) return;
    let cancelled = false;
    fetch("/api/billing/model-a/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { produceEntitled?: unknown } | null) => {
        if (cancelled) return;
        // A missing / non-boolean field reads as NOT entitled, so the fail-safe
        // is to show the upsell rather than silently allow a send the server
        // would then reject with a 402.
        setProduceEntitled(
          s && typeof s.produceEntitled === "boolean" ? s.produceEntitled : false,
        );
      })
      .catch(() => {
        if (!cancelled) setProduceEntitled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [billingLive]);

  return resolveProduceEntitlement(billingLive, produceEntitled);
}
