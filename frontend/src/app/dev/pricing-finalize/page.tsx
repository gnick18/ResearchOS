"use client";

// TEMP scratch page (Grant + Claude, 2026-06-15, rebuilt for Path A 2026-06-16).
// A standalone surface to finalize the PATH-A SERVICE TIERS without the operator
// gate. It mounts the SAME FinalizeTab the /admin Modeling section uses, driven
// by lib/pricing/service-model.ts, so the numbers here are the real model, not a
// mock. We charge for cloud SERVICES (send, live co-edit, phone capture, push,
// governance), not GB. Storage is a-la-carte at cost; the GB ladder is gone.
//
// Once the tiers are locked: copy the numbers into lib/billing/plans.ts and
// lib/pricing/assumptions.ts (the single sources of truth), update the master
// pricing bible, then DELETE this page. It is not linked from anywhere.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { FinalizeTab } from "@/components/admin/PriceModelingModal";

export default function PricingFinalizeDevPage() {
  return (
    <main className="mx-auto max-w-[1800px] space-y-8 px-8 py-10">
      <header>
        <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-meta font-semibold text-amber-800">
          Scratch, delete after lock-in
        </span>
        <h1 className="mt-3 text-heading font-semibold text-foreground">
          Service tiers finalize (Path A)
        </h1>
      </header>

      <FinalizeTab splitScroll />
    </main>
  );
}
