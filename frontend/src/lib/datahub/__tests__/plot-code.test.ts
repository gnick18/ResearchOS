// plot-code.test.ts
//
// Pins the matplotlib emitter: per figure kind, the emitted Python imports
// matplotlib, inlines the REAL group names and values, makes the right plotting
// call (bar / errorbar / scatter / plot), carries the resolved hex colors and
// axis labels, and sets figsize + the savefig DPI. We assert content, not pixel
// fidelity, the same discipline as show-code.test.ts.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import type {
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import { buildPlotSpec, withStyle } from "@/lib/datahub/plot-spec";
import { plotCode } from "@/lib/datahub/plot-code";

const COLUMN_META: DataHubDocument = {
  id: "1",
  name: "Viability",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-10T00:00:00.000Z",
};

// Control [10,20,30] (mean 20), Drug A [40,50,60] (mean 50). Round stats.
function twoGroupContent(): DataHubDocContent {
  return {
    meta: COLUMN_META,
    columns: [
      { id: "col-1", name: "Control", role: "y", dataType: "number" },
      { id: "col-2", name: "Drug A", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "r1", cells: { "col-1": 10, "col-2": 40 } },
      { id: "r2", cells: { "col-1": 20, "col-2": 50 } },
      { id: "r3", cells: { "col-1": 30, "col-2": 60 } },
    ],
    analyses: [],
    plots: [],
  };
}

const XY_META: DataHubDocument = {
  id: "xy1",
  name: "Line",
  project_ids: [],
  folder_path: null,
  table_type: "xy",
  created_at: "2026-06-10T00:00:00.000Z",
};

// A perfectly linear y = 2x + 1 so the fit is exact and predictable.
function lineContent(): DataHubDocContent {
  const xs = [0, 1, 2, 3, 4, 5];
  return {
    meta: XY_META,
    columns: [
      { id: "x", name: "X", role: "x", dataType: "number" },
      { id: "y1", name: "Y", role: "y", dataType: "number" },
    ],
    rows: xs.map((x, i) => ({ id: `r${i}`, cells: { x, y1: 2 * x + 1 } })),
    analyses: [],
    plots: [],
  };
}

describe("plot-code: column bar", () => {
  const spec = withStyle(
    buildPlotSpec({
      id: "p",
      kind: "columnBar",
      tableId: "1",
      yTitle: "Cell viability (%)",
      title: "Figure 1",
    }),
    { errorBar: "sd" },
  );
  const code = plotCode(spec, twoGroupContent());

  it("imports matplotlib and numpy", () => {
    expect(code).toContain("import matplotlib.pyplot as plt");
    expect(code).toContain("import numpy as np");
  });

  it("inlines the real group names and means", () => {
    expect(code).toContain('"Control"');
    expect(code).toContain('"Drug A"');
    // Means 20 and 50.
    expect(code).toMatch(/means = \[20, 50\]/);
  });

  it("inlines the SD error bars and calls bar + errorbar", () => {
    // SD = 10 for both groups.
    expect(code).toMatch(/errors = \[10, 10\]/);
    expect(code).toContain("ax.bar(");
    expect(code).toContain("ax.errorbar(");
  });

  it("carries hex colors, axis labels, figsize and savefig dpi", () => {
    expect(code).toMatch(/colors = \["#[0-9a-fA-F]{6}"/);
    expect(code).toContain('ax.set_ylabel("Cell viability (%)")');
    expect(code).toContain('ax.set_title("Figure 1")');
    expect(code).toContain("figsize=(");
    expect(code).toMatch(/savefig\("figure\.png", dpi=\d+\)/);
    expect(code).toContain("plt.show()");
  });

  it("omits error bars when the error kind is none", () => {
    const noErr = withStyle(spec, { errorBar: "none" });
    const c = plotCode(noErr, twoGroupContent());
    expect(c).not.toContain("ax.errorbar(");
    expect(c).toContain("errors = None");
  });
});

describe("plot-code: column scatter", () => {
  const spec = buildPlotSpec({
    id: "p",
    kind: "columnScatter",
    tableId: "1",
    yTitle: "Value",
  });
  const code = plotCode(spec, twoGroupContent());

  it("imports matplotlib and scatters the raw replicates", () => {
    expect(code).toContain("import matplotlib.pyplot as plt");
    expect(code).toContain("ax.scatter(");
  });

  it("inlines the raw replicate values per group", () => {
    // The dots are the raw cells, not the means.
    expect(code).toContain("[10, 20, 30]");
    expect(code).toContain("[40, 50, 60]");
  });

  it("draws a mean line and carries colors + figsize + dpi", () => {
    expect(code).toContain("ax.hlines(");
    expect(code).toMatch(/colors = \["#[0-9a-fA-F]{6}"/);
    expect(code).toContain("figsize=(");
    expect(code).toMatch(/savefig\("figure\.png", dpi=\d+\)/);
  });
});

describe("plot-code: xy scatter", () => {
  const spec = withStyle(
    buildPlotSpec({
      id: "p",
      kind: "xyScatter",
      tableId: "xy1",
      yColumnId: "y1",
      yTitle: "Signal",
      xTitle: "Dose",
    }),
    { fitModel: "linear" },
  );
  const code = plotCode(spec, lineContent());

  it("imports matplotlib and scatters the x / y pairs", () => {
    expect(code).toContain("import matplotlib.pyplot as plt");
    expect(code).toContain("ax.scatter(x, y");
  });

  it("inlines the real x and y arrays", () => {
    expect(code).toContain("x = np.array([0, 1, 2, 3, 4, 5])");
    expect(code).toContain("y = np.array([1, 3, 5, 7, 9, 11])");
  });

  it("plots the fitted line with the fitted slope and intercept", () => {
    expect(code).toContain("ax.plot(xfit, yfit");
    // y = 2x + 1 fit, so the inlined expression carries slope 2, intercept 1.
    expect(code).toMatch(/2 \* xfit \+ 1/);
    expect(code).toContain("np.linspace(");
  });

  it("carries axis labels, figsize and savefig dpi", () => {
    expect(code).toContain('ax.set_ylabel("Signal")');
    expect(code).toContain('ax.set_xlabel("Dose")');
    expect(code).toContain("figsize=(");
    expect(code).toMatch(/savefig\("figure\.png", dpi=\d+\)/);
  });

  it("emits a comment instead of a wrong curve when the fit cannot run", () => {
    // A nonlinear model on too few points cannot fit, so the snippet should
    // describe the model rather than draw a bogus line.
    const tiny: DataHubDocContent = {
      meta: XY_META,
      columns: [
        { id: "x", name: "X", role: "x", dataType: "number" },
        { id: "y1", name: "Y", role: "y", dataType: "number" },
      ],
      rows: [{ id: "r0", cells: { x: 1, y1: 2 } }],
      analyses: [],
      plots: [],
    };
    const fourpl = withStyle(spec, { fitModel: "logistic4pl" });
    const c = plotCode(fourpl, tiny);
    expect(c).not.toContain("ax.plot(xfit");
    expect(c.toLowerCase()).toContain("could not be reproduced");
  });
});

describe("plot-code: estimation plot", () => {
  it("emits a seeded bootstrap and a two-panel figure for the unpaired case", () => {
    const spec = withStyle(
      buildPlotSpec({
        id: "pe",
        kind: "estimationGardnerAltman",
        tableId: "1",
        yTitle: "Viability",
      }),
      { estimationSeed: 99, estimationB: 4000 },
    );
    const code = plotCode(spec, twoGroupContent());
    expect(code).toContain("import numpy as np");
    expect(code).toContain("import matplotlib.pyplot as plt");
    // The seed and B are baked so the snippet redraws reproducibly.
    expect(code).toContain("default_rng(99)");
    expect(code).toContain("B = 4000");
    // Two panels (the data axis and the difference axis).
    expect(code).toContain("ax_data");
    expect(code).toContain("ax_diff");
    // The difference panel draws the bootstrap distribution + the CI + the dot.
    expect(code).toContain("violinplot");
    expect(code).toContain("np.quantile(boot");
    expect(code).toContain("axhline(0");
    // The independent two-sample resampling (group minus control).
    expect(code).toContain("rng.choice(ctrl");
  });

  it("emits the paired difference resampling and slope lines when paired", () => {
    const spec = withStyle(
      buildPlotSpec({
        id: "pep",
        kind: "estimationGardnerAltman",
        tableId: "1",
      }),
      { estimationPaired: true },
    );
    const code = plotCode(spec, twoGroupContent());
    // The paired path resamples the per-pair differences, not the two groups.
    expect(code).toContain("pairs[:, 1] - pairs[:, 0]");
    expect(code).toContain("pairs = np.array(pairs).reshape(-1, 2)");
    // The slope lines connect each matched pair on the data axis.
    expect(code).toContain("ax_data.plot(xs, ys");
  });
});
