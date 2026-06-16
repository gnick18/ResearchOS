"use client";

// TEMP scratch page (Grant + Claude, 2026-06-15). A standalone surface to
// finalize the storage-flip pricing ladder without the operator gate. It mounts
// the SAME components the /admin Modeling section uses (FinalizeTab plus the two
// reference models), all driven by lib/pricing/modeling.ts, so the numbers here
// are the real model, not a mock.
//
// Once the ladder is locked: copy the numbers into lib/billing/plans.ts and
// lib/pricing/assumptions.ts (the single sources of truth), update the master
// pricing bible, then DELETE this page. It is not linked from anywhere.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { FinalizeTab } from "@/components/admin/PriceModelingModal";

export default function PricingFinalizeDevPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <header>
        <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-meta font-semibold text-amber-800">
          Scratch, delete after lock-in
        </span>
        <h1 className="mt-3 text-heading font-semibold text-foreground">
          Pricing finalize
        </h1>
        <p className="mt-2 max-w-2xl text-body text-foreground-muted leading-relaxed">
          Just the open decisions, the locked rules are fixed context. Set the
          free pool, the sustain, and each tier&apos;s price and write allowance.
          When it looks right we copy the numbers into plans.ts and
          assumptions.ts and the pricing bible. Nothing here writes back. The
          deeper per-subscriber and sustainability models still live in the
          operator console under Modeling.
        </p>
      </header>

      <FinalizeTab />
    </main>
  );
}
