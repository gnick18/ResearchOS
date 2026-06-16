// Render tests for the summary aggregate card (BeakerAI lane, 2026-06-15). These
// pin the two layout bugs the live verify caught: count-based breakdown bars must
// scale proportionally (a non-numeric value must not collapse max to NaN and clip
// every bar to full width), and the period histogram bars must have a real height.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import SummaryReportWidget from "../SummaryReportWidget";
import type { SummaryReport } from "@/lib/ai/summary-report";

afterEach(cleanup);

const report: SummaryReport = {
  kind: "summarize_experiments",
  heading: "Experiments",
  scope: ["whole lab"],
  stats: [{ label: "experiments", value: "12", emphasis: true }],
  barGroups: [
    {
      title: "By owner",
      rows: [
        { label: "alex", value: 12, tone: "accent" },
        { label: "morgan", value: 3, tone: "accent" },
      ],
    },
  ],
  histogram: {
    title: "Over time",
    bars: [
      { label: "2026-04", value: 2 },
      { label: "2026-05", value: 8 },
    ],
  },
};

/** Pull every inline width string in document order (the bar fills). */
function widths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[style]"))
    .map((el) => el.style.width)
    .filter((w) => w.endsWith("%"));
}

describe("SummaryReportWidget bar scaling", () => {
  it("scales count breakdown bars proportionally (max bar 100%, smaller bar < 100%)", () => {
    const { container } = render(<SummaryReportWidget report={report} />);
    const w = widths(container);
    // alex is the group max -> 100%; morgan (3 of 12) -> 25%, NOT also 100%.
    expect(w).toContain("100%");
    expect(w).toContain("25%");
    expect(w.every((x) => x === "100%")).toBe(false);
  });

  it("never collapses max to NaN when a value is non-numeric (defends the bug)", () => {
    const bad: SummaryReport = {
      ...report,
      barGroups: [
        {
          title: "By owner",
          // a stray non-number must not turn every width into >100% / full
          rows: [
            { label: "alex", value: 12, tone: "accent" },
            { label: "morgan", value: NaN as unknown as number, tone: "accent" },
          ],
        },
      ],
    };
    const { container } = render(<SummaryReportWidget report={bad} />);
    const w = widths(container);
    expect(w).toContain("100%");
    // every width stays within [0,100], none overflow-clip to full
    expect(w.every((x) => parseInt(x, 10) >= 0 && parseInt(x, 10) <= 100)).toBe(true);
  });

  it("gives histogram bars a real pixel height that varies with the value", () => {
    const { container } = render(<SummaryReportWidget report={report} />);
    const heights = Array.from(container.querySelectorAll<HTMLElement>("[style]"))
      .map((el) => el.style.height)
      .filter((h) => h.endsWith("px"));
    expect(heights.length).toBeGreaterThanOrEqual(2);
    // the 8-count month is taller than the 2-count month
    const px = heights.map((h) => parseInt(h, 10));
    expect(Math.max(...px)).toBeGreaterThan(Math.min(...px));
  });
});
