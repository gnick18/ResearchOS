"use client";

// Dev scratch page: the approved custom overlay scrollbar (ScrollArea) shown on
// a full document with a light/dark toggle. The behavior now lives in the
// reusable component (src/components/ui/ScrollArea.tsx); this page just exercises
// it. Throwaway, folderless via the providers bypass.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useState } from "react";

import ScrollArea from "@/components/ui/ScrollArea";

export default function ScrollRecedePage() {
  const [dark, setDark] = useState(false);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      if (next) document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      return next;
    });
  }, []);

  return (
    <div className="ros-calm-surface min-h-screen text-foreground">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Custom scrollbar, full document
            </h1>
            <p className="mt-1 text-meta text-foreground-muted">
              Pill thumb. Dim at rest, brighter while you scroll, darker on
              hover. Grab it and it grows at the same tone with a smooth snap,
              then settles back when you let go. Flip dark mode to check the dark
              room.
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="shrink-0 rounded-lg border border-border bg-surface-raised px-4 py-2 text-body font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.06)] transition-all hover:shadow-[0_2px_4px_rgba(15,23,42,0.10),0_4px_10px_rgba(15,23,42,0.10)]"
          >
            {dark ? "Switch to light" : "Switch to dark"}
          </button>
        </div>

        <ScrollArea
          className="h-[68vh] rounded-2xl border border-border/60"
          viewportClassName="px-8 py-7"
        >
          <h2 className="text-xl font-bold">
            Optimized buffer prep and cohort handling
          </h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Working notes, mira and morgan, December 2025
          </p>
          {PARAGRAPHS.map((para, i) => (
            <div key={i}>
              {i % 4 === 0 && (
                <h3 className="mt-6 text-body font-semibold">
                  {SUBHEADS[(i / 4) % SUBHEADS.length]}
                </h3>
              )}
              <p className="mt-3 text-body leading-relaxed">{para}</p>
            </div>
          ))}
        </ScrollArea>
      </div>
    </div>
  );
}

const SUBHEADS = [
  "Reagents and sourcing",
  "Stock solutions",
  "Procedure",
  "Observations",
  "Next steps",
];

const PARAGRAPHS = [
  "Sodium chloride was sourced ACS grade in 500 g units. The second cohort doubled the quantity, so the standing order was raised from two to four units and re-sourced to a vendor with a lower per unit price without changing the grade.",
  "All stock solutions were prepared in fresh deionized water and filtered through a 0.22 micron membrane before use. Concentrations were verified by mass rather than by volume to avoid drift across the longer prep runs.",
  "The buffer series was laid out in the usual order, with the high salt condition prepared last so the bench stayed clear of cross contamination. Each tube was labeled with the date and the preparer initials.",
  "Shipping was renegotiated on the larger order, which brought the per unit landed cost down enough to cover an extra replicate. The savings were logged against the same funding line for traceability.",
  "Observations during the first run were consistent with the prior month. No precipitate formed at the working concentration and the pH held within the expected window across the full set.",
  "For the second run the order status moved from approved to received the same week, so there was no gap in the bench supply. The receiving note was attached to the purchase record for the audit trail.",
  "A short hold step was added between the two cohorts to let the bench reset. This did not change any tracked value, so it is recorded here as context rather than as a protocol change.",
  "The group reviewed the sourcing change on the weekly call and approved it. The approval was captured on the purchase record so the history reads as a real decision rather than a silent edit.",
  "Replicates were balanced across the two preparers to keep any handling differences from loading onto a single condition. Assignments were rotated between runs.",
  "Closing notes for the month: the doubled cohort is covered, the cheaper vendor is locked in for the next quarter, and the buffer series is ready for the downstream assays without further prep.",
  "An additional aliquot set was reserved in case the downstream assay needs a repeat. These were frozen at minus twenty and indexed alongside the working stocks.",
  "Temperature logging continued without interruption. The freezer held within tolerance for the full period and no excursions were recorded against the reserved aliquots.",
  "A duplicate of the receiving note was filed with the department so the procurement record and the bench record agree. This keeps the audit trail consistent across systems.",
  "The downstream assay schedule was drafted around the freezer index so the reserved aliquots are pulled in the right order. Nothing here changes a tracked value.",
  "Final sign off was recorded once both preparers confirmed the stocks matched the labels and the index. The month closes clean with the cohort fully supplied.",
  "Loose ends for next month are limited to confirming the renewed vendor quote and refreshing the membrane filters before the next prep block begins.",
];
