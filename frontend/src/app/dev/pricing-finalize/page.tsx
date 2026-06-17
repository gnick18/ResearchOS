"use client";

// TEMP scratch page (Grant + Claude, 2026-06-15, rebuilt for Model A 2026-06-17).
// A standalone surface to run the Model A margin explorer without the operator
// gate. Driven by MODEL_A_PLANS + periodCharge + service-model.ts, so the
// numbers are always the real current pricing. Not linked from anywhere.
//
// Delete this page once it is no longer useful as a scratch surface.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { MarginExplorerTab } from "@/components/admin/PriceModelingModal";

export default function PricingFinalizeDevPage() {
  return (
    <main className="mx-auto max-w-[1800px] space-y-8 px-8 py-10">
      <header>
        <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-meta font-semibold text-amber-800">
          Scratch, delete when done
        </span>
        <h1 className="mt-3 text-heading font-semibold text-foreground">
          Model A margin explorer (dev scratch)
        </h1>
      </header>

      <MarginExplorerTab />
    </main>
  );
}
