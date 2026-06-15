"use client";

// Dev scratch page: option 5 (Recede + boost) shown on a realistic full
// document so Grant can judge the recede behavior in context.
//
// The fix vs the picker: a pure :hover boost gets stuck bright because Chrome
// repaints the scrollbar on hover-IN but not reliably on hover-OUT. Instead a
// tiny scroll-activity class (added on scroll, removed after ~700ms idle) drives
// the boost — a class toggle forces the repaint :hover skips, so it reliably
// settles back to dim. Direct thumb :hover / :active still brighten on top.
//
// Throwaway, folderless via the providers bypass. Delete once the standard is
// picked. House style, no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";

export default function ScrollRecedePage() {
  const [dark, setDark] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      if (next) document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      return next;
    });
  }, []);

  // Scroll-activity: brighten the thumb while scrolling, settle back to dim
  // after a brief idle. The class toggle forces the repaint a :hover-out does
  // not, so the recede is reliable.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      el.classList.add("sb-active");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("sb-active"), 700);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="ros-calm-surface min-h-screen text-foreground">
      <style>{RECEDE_CSS}</style>

      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Recede + boost (option 5), full document
            </h1>
            <p className="mt-1 text-meta text-foreground-muted">
              Scroll the panel. The bar brightens while you scroll and settles
              back to dim about 0.7s after you stop. Grab it directly to brighten
              it fully. Flip dark mode to check the dark room.
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

        {/* A tall document panel, like a real note / methods body on the calm
            surface, so the scrollbar is judged in context. */}
        <div
          ref={scrollRef}
          className="sb5 h-[70vh] overflow-y-auto rounded-2xl border border-border/60 px-8 py-7"
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
        </div>
      </div>
    </div>
  );
}

// Option 5, recede + boost, driven by the .sb-active scroll-activity class.
// 10px gutter, 2.5px inset -> 5px pill. Dim at rest (10%), boost while scrolling
// (34%), full on direct thumb hover / drag.
const RECEDE_CSS = `
.sb5::-webkit-scrollbar { width: 10px; height: 10px; }
.sb5::-webkit-scrollbar-track { background: transparent; }
.sb5::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--foreground) 10%, transparent);
  border-radius: 9999px;
  border: 2.5px solid transparent;
  background-clip: padding-box;
  transition: background-color 0.25s ease;
}
.sb5.sb-active::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--foreground) 34%, transparent);
}
.sb5::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in srgb, var(--foreground) 46%, transparent);
}
.sb5::-webkit-scrollbar-thumb:active {
  background-color: color-mix(in srgb, var(--foreground) 54%, transparent);
}
`;

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
];
