// plot-code.ts
//
// Generate the reproducible Python (matplotlib) that redraws each Data Hub
// figure, parameterized by the REAL group names and values, so a researcher can
// paste it into a notebook and get the same plot. This is the figure twin of
// show-code.ts (which emits the analysis math): together they answer "where did
// this come from" for both the number and the picture, the open-source proof a
// closed tool like Prism cannot give.
//
// Pure string building. No engine call beyond the same fit math the on-screen
// curve already ran, no I/O. The verbatim values come from the same group / pair
// arrays the renderer drew, so the snippet and the on-screen figure are built
// from one source. The script imports numpy + matplotlib only, writes
// figure.png at the figure's export DPI, and shows the plot.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  AnalysisSpec,
  DataHubDocContent,
  PlotSpec,
} from "@/lib/datahub/model/types";
import {
  readPlotStyle,
  readPlotSource,
  resolvePlotGroups,
  errorMagnitude,
  toInches,
  seriesColors,
  FIG,
  type PlotStyle,
  type PlotGroup,
} from "@/lib/datahub/plot-spec";
import { pairedRows } from "@/lib/datahub/estimation-plot";
import { partsOfWhole } from "@/lib/datahub/parts-of-whole-table";
import {
  resolveQQSample,
  residualPositions,
  rocCurveData,
} from "@/lib/datahub/diagnostic-plot";
import { yColumns, xyPairs } from "@/lib/datahub/xy-table";
import { getModel, fitModel } from "@/lib/datahub/engine";

// ---------------------------------------------------------------------------
// Python literal helpers (shared style with show-code.ts)
// ---------------------------------------------------------------------------

/** A Python string literal (double-quoted, escaped). */
function pyStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render a number list as a Python list literal, trimming float noise. */
function pyList(values: number[]): string {
  return `[${values.map(pyNum).join(", ")}]`;
}

/** Render a list of strings as a Python list literal. */
function pyStrList(values: string[]): string {
  return `[${values.map(pyStr).join(", ")}]`;
}

/** A tidy number for a Python literal (no trailing-zero noise, finite only). */
function pyNum(v: number): string {
  if (!Number.isFinite(v)) return "float('nan')";
  // Keep integers plain; round long decimals so the snippet stays readable while
  // preserving enough precision to redraw the same figure.
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(10)));
}

// ---------------------------------------------------------------------------
// Figure size + the shared header
// ---------------------------------------------------------------------------

/** The figure's physical size in inches (width, height) for matplotlib figsize. */
function figsizeInches(style: PlotStyle): { w: number; h: number } {
  const unit = style.sizeUnit ?? "px";
  const hasSize =
    typeof style.width === "number" &&
    style.width > 0 &&
    typeof style.height === "number" &&
    style.height > 0;
  if (!hasSize) {
    // No custom size: fall back to the base design box treated as px / 96.
    return { w: toInches(FIG.width, "px"), h: toInches(FIG.height, "px") };
  }
  return {
    w: toInches(style.width as number, unit),
    h: toInches(style.height as number, unit),
  };
}

/** The export rasterization density (matches the figure's stored DPI). */
function figureDpi(style: PlotStyle): number {
  return style.dpi && style.dpi > 0 ? Math.round(style.dpi) : 300;
}

/** A round-up float for figsize so the literal stays short. */
function inchAttr(n: number): number {
  return Number(n.toFixed(3));
}

/** The header comment that opens every emitted script (show-code.ts voice). */
function header(kindLabel: string): string {
  return `# ${kindLabel} redrawn with matplotlib, from the same values the figure shows.
# Paste this into a notebook to reproduce the plot. Requires numpy + matplotlib.`;
}

/** The savefig + show footer, shared by every kind. */
function footer(dpi: number): string {
  return `fig.tight_layout()
fig.savefig("figure.png", dpi=${dpi})
plt.show()`;
}

// ---------------------------------------------------------------------------
// Column bar: grouped bars to the group means with error bars
// ---------------------------------------------------------------------------

function columnBarCode(
  groups: PlotGroup[],
  style: PlotStyle,
): string {
  const { w, h } = figsizeInches(style);
  const dpi = figureDpi(style);
  const names = groups.map((g) => g.name);
  const means = groups.map((g) => (g.stats.mean === null ? NaN : g.stats.mean));
  const errs = groups.map((g) => errorMagnitude(g.stats, style.errorBar) ?? 0);
  const colors = groups.map((g) => g.color);
  const errLabel =
    style.errorBar === "sd" ? "SD" : style.errorBar === "sem" ? "SEM" : "none";
  const errLine =
    style.errorBar === "none"
      ? "errors = None  # error bars are off for this figure"
      : `errors = ${pyList(errs)}  # ${errLabel} per group, from the raw replicates`;

  const lines: string[] = [];
  lines.push(header("Column bar chart (group means)"));
  lines.push("");
  lines.push("import numpy as np");
  lines.push("import matplotlib.pyplot as plt");
  lines.push("");
  lines.push(`labels = ${pyStrList(names)}`);
  lines.push(`means = ${pyList(means)}`);
  lines.push(errLine);
  lines.push(`colors = ${pyStrList(colors)}`);
  lines.push("");
  lines.push("x = np.arange(len(labels))");
  lines.push(
    `fig, ax = plt.subplots(figsize=(${inchAttr(w)}, ${inchAttr(h)}))`,
  );
  lines.push(
    "ax.bar(x, means, color=colors, width=0.6, edgecolor=\"none\", alpha=0.85)",
  );
  if (style.errorBar !== "none") {
    lines.push(
      "ax.errorbar(x, means, yerr=errors, fmt=\"none\", ecolor=\"#334155\", capsize=4, linewidth=1.4)",
    );
  }
  lines.push("ax.set_xticks(x)");
  lines.push("ax.set_xticklabels(labels)");
  if (style.yTitle.trim() !== "")
    lines.push(`ax.set_ylabel(${pyStr(style.yTitle)})`);
  if (style.xTitle.trim() !== "")
    lines.push(`ax.set_xlabel(${pyStr(style.xTitle)})`);
  if (style.title.trim() !== "")
    lines.push(`ax.set_title(${pyStr(style.title)})`);
  lines.push("");
  lines.push(footer(dpi));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Column scatter: raw replicates as a strip plot over a mean line
// ---------------------------------------------------------------------------

function columnScatterCode(
  groups: PlotGroup[],
  style: PlotStyle,
): string {
  const { w, h } = figsizeInches(style);
  const dpi = figureDpi(style);
  const names = groups.map((g) => g.name);
  const colors = groups.map((g) => g.color);
  // Each group's raw finite replicates, as a list of lists.
  const valueLists = groups.map((g) =>
    pyList(g.values.filter((v) => Number.isFinite(v))),
  );
  const means = groups.map((g) => (g.stats.mean === null ? NaN : g.stats.mean));
  const errs = groups.map((g) => errorMagnitude(g.stats, style.errorBar) ?? 0);
  const errLabel =
    style.errorBar === "sd" ? "SD" : style.errorBar === "sem" ? "SEM" : "none";

  const lines: string[] = [];
  lines.push(header("Column scatter (replicates over the group mean)"));
  lines.push("");
  lines.push("import numpy as np");
  lines.push("import matplotlib.pyplot as plt");
  lines.push("");
  lines.push(`labels = ${pyStrList(names)}`);
  lines.push(`colors = ${pyStrList(colors)}`);
  lines.push("# Each group's raw replicates (the dots).");
  lines.push(`groups = [${valueLists.join(", ")}]`);
  lines.push(`means = ${pyList(means)}`);
  if (style.errorBar !== "none") {
    lines.push(
      `errors = ${pyList(errs)}  # ${errLabel} per group, from the raw replicates`,
    );
  }
  lines.push("");
  lines.push("rng = np.random.default_rng(0)  # seeded jitter so the dots are reproducible");
  lines.push(
    `fig, ax = plt.subplots(figsize=(${inchAttr(w)}, ${inchAttr(h)}))`,
  );
  lines.push("for i, (values, color) in enumerate(zip(groups, colors)):");
  lines.push("    if not values:");
  lines.push("        continue");
  lines.push("    jitter = rng.uniform(-0.12, 0.12, size=len(values))");
  lines.push(
    "    ax.scatter(np.full(len(values), i) + jitter, values, color=color, s=28, alpha=0.9, zorder=3)",
  );
  lines.push("    # The mean line across the group band.");
  lines.push("    if not np.isnan(means[i]):");
  lines.push(
    "        ax.hlines(means[i], i - 0.25, i + 0.25, color=color, linewidth=2.4, zorder=4)",
  );
  if (style.errorBar !== "none") {
    lines.push("        ax.errorbar(i, means[i], yerr=errors[i], fmt=\"none\", ecolor=color, capsize=4, linewidth=1.4, zorder=2)");
  }
  lines.push("");
  lines.push("ax.set_xticks(np.arange(len(labels)))");
  lines.push("ax.set_xticklabels(labels)");
  if (style.yTitle.trim() !== "")
    lines.push(`ax.set_ylabel(${pyStr(style.yTitle)})`);
  if (style.xTitle.trim() !== "")
    lines.push(`ax.set_xlabel(${pyStr(style.xTitle)})`);
  if (style.title.trim() !== "")
    lines.push(`ax.set_title(${pyStr(style.title)})`);
  lines.push("");
  lines.push(footer(dpi));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// XY scatter: the (x, y) pairs plus the fitted curve when a model is set
// ---------------------------------------------------------------------------

/** The Python expression for a fitted model, given its baked parameter values. */
function modelExpr(modelId: string, params: number[]): string | null {
  // y as a function of x with the fitted params inlined. These mirror the model
  // formulas in engine/fit/models.ts exactly, so the curve matches the figure.
  if (modelId === "linear") {
    const [m, b] = params;
    return `${pyNum(m)} * x + ${pyNum(b)}`;
  }
  if (modelId === "polynomial2") {
    const [a, b, c] = params;
    return `${pyNum(a)} * x**2 + ${pyNum(b)} * x + ${pyNum(c)}`;
  }
  if (modelId === "michaelis-menten") {
    const [vmax, km] = params;
    return `(${pyNum(vmax)} * x) / (${pyNum(km)} + x)`;
  }
  if (modelId === "logistic4pl") {
    const [bottom, top, logEC50, hill] = params;
    return `${pyNum(bottom)} + (${pyNum(top)} - ${pyNum(bottom)}) / (1 + 10**((${pyNum(logEC50)} - x) * ${pyNum(hill)}))`;
  }
  if (modelId === "exp-decay-1phase") {
    const [y0, plateau, k] = params;
    return `${pyNum(plateau)} + (${pyNum(y0)} - ${pyNum(plateau)}) * np.exp(-${pyNum(k)} * x)`;
  }
  if (modelId === "exp-association-1phase") {
    const [y0, plateau, k] = params;
    return `${pyNum(y0)} + (${pyNum(plateau)} - ${pyNum(y0)}) * (1 - np.exp(-${pyNum(k)} * x))`;
  }
  if (modelId === "gaussian") {
    const [amp, mu, sigma, offset] = params;
    return `${pyNum(amp)} * np.exp(-((x - ${pyNum(mu)})**2) / (2 * ${pyNum(sigma)}**2)) + ${pyNum(offset)}`;
  }
  return null;
}

function xyScatterCode(
  spec: PlotSpec,
  content: DataHubDocContent,
  style: PlotStyle,
): string {
  const { w, h } = figsizeInches(style);
  const dpi = figureDpi(style);
  const source = readPlotSource(spec);
  const ys = yColumns(content);
  const targetY =
    (source.yColumnId && ys.find((c) => c.id === source.yColumnId)?.id) ||
    ys[0]?.id ||
    null;
  const pairs = targetY ? xyPairs(content, targetY) : { x: [], y: [] };
  const xs = pairs.x;
  const yvals = pairs.y;
  const color = style.colorOverrides?.[0] ?? "#1AA0E6";

  const lines: string[] = [];
  lines.push(header("XY scatter with the fitted curve"));
  lines.push("");
  lines.push("import numpy as np");
  lines.push("import matplotlib.pyplot as plt");
  lines.push("");
  lines.push(`x = np.array(${pyList(xs)})`);
  lines.push(`y = np.array(${pyList(yvals)})`);
  lines.push("");
  lines.push(
    `fig, ax = plt.subplots(figsize=(${inchAttr(w)}, ${inchAttr(h)}))`,
  );
  lines.push(
    `ax.scatter(x, y, color=${pyStr(color)}, s=32, alpha=0.9, zorder=3)`,
  );

  // The fitted curve: run the same engine fit the on-screen curve used, then
  // inline the fitted parameters so the Python redraws the identical line.
  const modelId = style.fitModel;
  if (modelId && modelId !== "none") {
    const model = getModel(modelId);
    let emitted = false;
    if (model && xs.length > model.paramNames.length) {
      const result = fitModel(modelId, xs, yvals);
      if (result.ok) {
        const params = result.parameters.map((p) => p.value);
        if (params.every((v) => Number.isFinite(v))) {
          const expr = modelExpr(modelId, params);
          if (expr) {
            const paramNote = model.paramNames
              .map((n, i) => `${n} = ${pyNum(params[i])}`)
              .join(", ");
            lines.push("");
            lines.push(`# Fitted ${model.label} (${paramNote}).`);
            lines.push(
              "# The parameters are the ones the figure fitted, so this redraws the same curve.",
            );
            lines.push("xfit = np.linspace(x.min(), x.max(), 200)");
            lines.push(`yfit = ${expr}`.replace(/\bx\b/g, "xfit"));
            lines.push(
              `ax.plot(xfit, yfit, color=${pyStr(color)}, linewidth=2, zorder=2)`,
            );
            emitted = true;
          }
        }
      }
    }
    if (!emitted) {
      // The fit could not run here (too few points, or a model with no closed
      // matplotlib form). Emit the model form as a comment rather than a wrong
      // curve, so the researcher can fit it themselves with scipy.optimize.
      const label = model ? model.label : modelId;
      lines.push("");
      lines.push(
        `# A ${label} fit was requested but could not be reproduced inline here.`,
      );
      lines.push(
        "# Fit it with scipy.optimize.curve_fit on the x / y above, then plot the curve.",
      );
    }
  }

  lines.push("");
  if (style.yTitle.trim() !== "")
    lines.push(`ax.set_ylabel(${pyStr(style.yTitle)})`);
  if (style.xTitle.trim() !== "")
    lines.push(`ax.set_xlabel(${pyStr(style.xTitle)})`);
  if (style.title.trim() !== "")
    lines.push(`ax.set_title(${pyStr(style.title)})`);
  lines.push("");
  lines.push(footer(dpi));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Estimation plot: the raw data plus the bootstrap mean-difference and CI
// ---------------------------------------------------------------------------

/**
 * Reproduce an estimation figure (Gardner-Altman / Cumming) in matplotlib + numpy.
 *
 * WHY this re-runs the bootstrap rather than baking the curve: the figure's whole
 * point is the bootstrap sampling distribution, and a researcher who pastes the
 * snippet wants to see THAT computation, not a frozen polyline. The snippet uses a
 * seeded numpy generator so the distribution + CI are reproducible, the same seed
 * convention the on-screen figure uses. The numbers a reader gets from this script
 * match the figure up to Monte-Carlo noise (a JS PRNG and numpy cannot share a
 * resample stream), which is the honest, DABEST-style reproduction. The percentile
 * method is emitted (the simplest correct interval); a note points at the BCa
 * option when the figure used it, so the script stays short and runnable.
 */
function estimationCode(
  spec: PlotSpec,
  content: DataHubDocContent,
  style: PlotStyle,
): string {
  const { w, h } = figsizeInches(style);
  const dpi = figureDpi(style);
  const groups = resolvePlotGroups(content, style);
  const ctrlIdx = Math.min(
    Math.max(0, style.estimationControlIndex ?? 0),
    Math.max(0, groups.length - 1),
  );
  const control = groups[ctrlIdx];
  const paired = !!style.estimationPaired && groups.length === 2;
  const ci = style.estimationCi ?? 0.95;
  const alpha = 1 - ci;
  const B = style.estimationB ?? 5000;
  const seed = style.estimationSeed ?? 12345;
  const names = groups.map((g) => g.name);
  const colors = groups.map((g) => g.color);

  const lines: string[] = [];
  lines.push(
    header(
      groups.length >= 3
        ? "Cumming estimation plot (effect size with bootstrap CI)"
        : "Gardner-Altman estimation plot (effect size with bootstrap CI)",
    ),
  );
  lines.push("");
  lines.push("import numpy as np");
  lines.push("import matplotlib.pyplot as plt");
  lines.push("");
  lines.push(`labels = ${pyStrList(names)}`);
  lines.push(`colors = ${pyStrList(colors)}`);
  lines.push("# Each group's raw values (the dots on the data axis).");
  lines.push(
    `groups = [${groups
      .map((g) => pyList(g.values.filter((v) => Number.isFinite(v))))
      .join(", ")}]`,
  );
  lines.push(`control_index = ${ctrlIdx}  # the shared reference group`);

  if (paired) {
    // The matched pairs (control value, group value) per row, so the paired
    // difference and the slope lines redraw from the same matching the figure used.
    const otherIdx = ctrlIdx === 0 ? 1 : 0;
    const pairs = pairedRows(content, control.id, groups[otherIdx].id);
    lines.push(
      `# Matched pairs (control, treatment) per subject, one row each.`,
    );
    lines.push(`pairs = ${pyList(pairs.flatMap((p) => [p.control, p.group]))}`);
    lines.push("pairs = np.array(pairs).reshape(-1, 2)");
  }
  lines.push("");
  lines.push(`B = ${B}  # bootstrap resamples`);
  lines.push(`rng = np.random.default_rng(${seed})  # seeded so the CI is reproducible`);
  lines.push(`alpha = ${pyNum(alpha)}  # ${Math.round(ci * 100)}% CI`);
  lines.push("");

  if (paired) {
    lines.push("# Paired bootstrap: resample the per-pair differences.");
    lines.push("diffs = pairs[:, 1] - pairs[:, 0]");
    lines.push("boot = np.array([");
    lines.push("    rng.choice(diffs, size=len(diffs), replace=True).mean()");
    lines.push("    for _ in range(B)");
    lines.push("])");
    lines.push("effect = diffs.mean()");
    lines.push("contrasts = [(1, effect, boot)]  # one contrast (treatment vs control)");
  } else {
    lines.push("# Two-sample bootstrap: resample each group independently, then");
    lines.push("# take the mean difference (group minus control) per resample.");
    lines.push("ctrl = np.array(groups[control_index], dtype=float)");
    lines.push("contrasts = []");
    lines.push("for i, vals in enumerate(groups):");
    lines.push("    if i == control_index:");
    lines.push("        continue");
    lines.push("    arr = np.array(vals, dtype=float)");
    lines.push("    boot = np.array([");
    lines.push("        rng.choice(arr, size=len(arr), replace=True).mean()");
    lines.push("        - rng.choice(ctrl, size=len(ctrl), replace=True).mean()");
    lines.push("        for _ in range(B)");
    lines.push("    ])");
    lines.push("    contrasts.append((i, arr.mean() - ctrl.mean(), boot))");
  }
  lines.push("");
  if ((style.estimationBootMethod ?? "bca") === "bca") {
    lines.push(
      "# The figure used the BCa interval. This snippet reports the simpler",
    );
    lines.push(
      "# percentile interval so it stays short; use scipy.stats.bootstrap for BCa.",
    );
  }
  lines.push("");
  lines.push(
    `fig, (ax_data, ax_diff) = plt.subplots(2, 1, figsize=(${inchAttr(w)}, ${inchAttr(h)}), sharex=True, height_ratios=[1.3, 1])`,
  );
  lines.push("");
  lines.push("# Top panel: the raw data of every group.");
  lines.push("for i, (vals, color) in enumerate(zip(groups, colors)):");
  lines.push("    if not vals:");
  lines.push("        continue");
  lines.push("    jitter = rng.uniform(-0.08, 0.08, size=len(vals))");
  lines.push(
    "    ax_data.scatter(np.full(len(vals), i) + jitter, vals, color=color, s=24, alpha=0.9, zorder=3)",
  );
  lines.push(
    "    ax_data.hlines(np.mean(vals), i - 0.2, i + 0.2, color=color, linewidth=2.4, zorder=4)",
  );
  if (paired) {
    lines.push("# Slope lines connect each matched pair.");
    lines.push("other = 1 if control_index == 0 else 0");
    lines.push("for row in pairs:");
    lines.push(
      "    xs = (control_index, other) if control_index < other else (other, control_index)",
    );
    lines.push(
      "    ys = (row[0], row[1]) if control_index < other else (row[1], row[0])",
    );
    lines.push("    ax_data.plot(xs, ys, color=\"#cbd5e1\", linewidth=0.8, zorder=2)");
  }
  lines.push("ax_data.set_xticks(np.arange(len(labels)))");
  lines.push("ax_data.set_xticklabels(labels)");
  if (style.yTitle.trim() !== "")
    lines.push(`ax_data.set_ylabel(${pyStr(style.yTitle)})`);
  if (style.title.trim() !== "")
    lines.push(`ax_data.set_title(${pyStr(style.title)})`);
  lines.push("");
  lines.push("# Bottom panel: the bootstrap mean-difference distribution + CI.");
  lines.push("for i, effect, boot in contrasts:");
  lines.push("    lo, hi = np.quantile(boot, [alpha / 2, 1 - alpha / 2])");
  lines.push("    color = colors[i]");
  lines.push("    # The distribution as a violin at the group's x position.");
  lines.push(
    "    parts = ax_diff.violinplot(boot, positions=[i], showextrema=False, widths=0.5)",
  );
  lines.push("    for body in parts['bodies']:");
  lines.push("        body.set_facecolor(color)");
  lines.push("        body.set_alpha(0.2)");
  lines.push("    ax_diff.plot([i, i], [lo, hi], color=color, linewidth=2, zorder=3)");
  lines.push("    ax_diff.scatter([i], [effect], color=color, s=28, zorder=4)");
  lines.push("ax_diff.axhline(0, color=\"#94a3b8\", linewidth=1, linestyle=\"--\")");
  lines.push("ax_diff.set_ylabel(\"Mean difference\")");
  if (style.xTitle.trim() !== "")
    lines.push(`ax_diff.set_xlabel(${pyStr(style.xTitle)})`);
  lines.push("");
  lines.push(footer(dpi));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Diagnostic plots (Theme 4): normal QQ, residual-vs-fitted, and the ROC visual
// ---------------------------------------------------------------------------

/**
 * Reproduce a normal QQ plot in scipy + matplotlib. The same ordered sample the
 * figure draws is baked in, and scipy.stats.probplot draws the points and the
 * least-squares reference line. The sample is a Column-table group, or a linked
 * regression's residuals (resolved exactly as the renderer resolves it).
 */
function qqCode(
  content: DataHubDocContent,
  style: PlotStyle,
  analysis: AnalysisSpec | null,
): string {
  const { w, h } = figsizeInches(style);
  const dpi = figureDpi(style);
  const sample = resolveQQSample(content, style, analysis);
  const values = sample ? sample.values.filter((v) => Number.isFinite(v)) : [];
  const name = sample ? sample.name : "Sample";
  const lines: string[] = [];
  lines.push(header("Normal QQ plot"));
  lines.push("");
  lines.push("import numpy as np");
  lines.push("import matplotlib.pyplot as plt");
  lines.push("from scipy import stats");
  lines.push("");
  lines.push(`sample = ${pyList(values)}  # ${name}`);
  lines.push("");
  lines.push(
    `fig, ax = plt.subplots(figsize=(${inchAttr(w)}, ${inchAttr(h)}))`,
  );
  // probplot draws the ordered sample against the theoretical normal quantiles
  // and the least-squares reference line, the same positions the figure plots.
  lines.push("stats.probplot(np.asarray(sample, float), dist=\"norm\", plot=ax)");
  lines.push(
    `ax.set_xlabel(${pyStr(style.xTitle.trim() !== "" ? style.xTitle : "Theoretical quantiles")})`,
  );
  lines.push(
    `ax.set_ylabel(${pyStr(style.yTitle.trim() !== "" ? style.yTitle : "Sample quantiles")})`,
  );
  lines.push(
    `ax.set_title(${pyStr(style.title.trim() !== "" ? style.title : `Normal QQ plot (${name})`)})`,
  );
  lines.push("");
  lines.push(footer(dpi));
  return lines.join("\n");
}

/**
 * Reproduce a residual-vs-fitted plot in matplotlib. The fitted values and
 * residuals the figure draws (recomputed from the linked regression's
 * coefficients) are baked in, with a dashed y = 0 reference line.
 */
function residualCode(
  style: PlotStyle,
  analysis: AnalysisSpec | null,
): string {
  const { w, h } = figsizeInches(style);
  const dpi = figureDpi(style);
  const data = residualPositions(analysis);
  const fitted = data ? data.points.map((p) => p.fitted) : [];
  const resid = data ? data.points.map((p) => p.residual) : [];
  const yName = data ? data.yName : "Y";
  const lines: string[] = [];
  lines.push(header("Residual vs fitted plot"));
  lines.push("");
  lines.push("import matplotlib.pyplot as plt");
  lines.push("");
  lines.push(`fitted = ${pyList(fitted)}  # model fitted values for ${yName}`);
  lines.push(`residuals = ${pyList(resid)}  # observed minus fitted`);
  lines.push("");
  lines.push(
    `fig, ax = plt.subplots(figsize=(${inchAttr(w)}, ${inchAttr(h)}))`,
  );
  lines.push("ax.axhline(0, color=\"#94a3b8\", linestyle=\"--\", linewidth=1)");
  lines.push(
    `ax.scatter(fitted, residuals, color=${pyStr(style.colorOverrides?.[0] ?? "#0284c7")}, alpha=0.9)`,
  );
  lines.push(
    `ax.set_xlabel(${pyStr(style.xTitle.trim() !== "" ? style.xTitle : "Fitted value")})`,
  );
  lines.push(
    `ax.set_ylabel(${pyStr(style.yTitle.trim() !== "" ? style.yTitle : "Residual")})`,
  );
  if (style.title.trim() !== "")
    lines.push(`ax.set_title(${pyStr(style.title)})`);
  lines.push("");
  lines.push(footer(dpi));
  return lines.join("\n");
}

/**
 * Reproduce the ROC curve visual in matplotlib. The validated swept points and
 * AUC from the linked rocCurve analysis are baked in, with the chance diagonal.
 */
function rocCode(
  style: PlotStyle,
  analysis: AnalysisSpec | null,
): string {
  const { w, h } = figsizeInches(style);
  const dpi = figureDpi(style);
  const data = rocCurveData(analysis);
  const fpr = data ? data.points.map((p) => p.fpr) : [];
  const tpr = data ? data.points.map((p) => p.tpr) : [];
  const auc = data ? data.auc : NaN;
  const lines: string[] = [];
  lines.push(header("ROC curve"));
  lines.push("");
  lines.push("import matplotlib.pyplot as plt");
  lines.push("");
  lines.push(`fpr = ${pyList(fpr)}  # false positive rate`);
  lines.push(`tpr = ${pyList(tpr)}  # true positive rate`);
  lines.push(`auc = ${pyNum(auc)}  # area under the curve`);
  lines.push("");
  lines.push(
    `fig, ax = plt.subplots(figsize=(${inchAttr(w)}, ${inchAttr(h)}))`,
  );
  lines.push("ax.plot([0, 1], [0, 1], color=\"#94a3b8\", linestyle=\"--\", linewidth=1)");
  lines.push(
    `ax.plot(fpr, tpr, color=${pyStr(style.colorOverrides?.[0] ?? "#0284c7")}, linewidth=2, label=f"AUC = {auc:.3f}")`,
  );
  lines.push("ax.set_xlim(0, 1)");
  lines.push("ax.set_ylim(0, 1)");
  lines.push(
    `ax.set_xlabel(${pyStr(style.xTitle.trim() !== "" ? style.xTitle : "False positive rate")})`,
  );
  lines.push(
    `ax.set_ylabel(${pyStr(style.yTitle.trim() !== "" ? style.yTitle : "True positive rate")})`,
  );
  if (style.title.trim() !== "")
    lines.push(`ax.set_title(${pyStr(style.title)})`);
  lines.push("ax.legend(loc=\"lower right\")");
  lines.push("");
  lines.push(footer(dpi));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Parts of whole: pie / donut / 100-percent stacked bar
// ---------------------------------------------------------------------------

/** The pie / donut matplotlib script (one wedge per category sized by value). */
function pieCode(
  content: DataHubDocContent,
  style: PlotStyle,
  donut: boolean,
): string {
  const { w, h } = figsizeInches(style);
  const dpi = figureDpi(style);
  const parts = partsOfWhole(content).categories.filter(
    (c) => c.value !== null && c.value > 0,
  );
  const labels = parts.map((c) => c.label);
  const values = parts.map((c) => c.value as number);
  const colors = seriesColors(style, parts.length);
  const lines: string[] = [];
  lines.push(header(donut ? "Donut chart (parts of whole)" : "Pie chart (parts of whole)"));
  lines.push("");
  lines.push("import matplotlib.pyplot as plt");
  lines.push("");
  lines.push(`labels = ${pyStrList(labels)}`);
  lines.push(`values = ${pyList(values)}`);
  lines.push(`colors = ${pyStrList(colors)}`);
  lines.push("");
  lines.push(`fig, ax = plt.subplots(figsize=(${inchAttr(w)}, ${inchAttr(h)}))`);
  // autopct prints each slice's percent of the total, the same readout the
  // figure shows. A donut sets a wedge width to leave the center hole.
  const ratio =
    typeof style.donutHoleRatio === "number" &&
    style.donutHoleRatio >= 0 &&
    style.donutHoleRatio < 0.9
      ? style.donutHoleRatio
      : 0.6;
  const wedgeProps = donut
    ? `, wedgeprops={"width": ${Number((1 - ratio).toFixed(3))}}`
    : "";
  lines.push(
    `ax.pie(values, labels=labels, colors=colors, autopct="%1.1f%%", startangle=90, counterclock=False${wedgeProps})`,
  );
  lines.push('ax.axis("equal")  # a circular pie / donut');
  if (style.title.trim() !== "")
    lines.push(`ax.set_title(${pyStr(style.title)})`);
  lines.push("");
  lines.push(footer(dpi));
  return lines.join("\n");
}

/** The 100-percent stacked-bar matplotlib script (one segment per category). */
function stackedBarCode(content: DataHubDocContent, style: PlotStyle): string {
  const { w, h } = figsizeInches(style);
  const dpi = figureDpi(style);
  const { categories, total } = partsOfWhole(content);
  const parts = categories.filter((c) => c.value !== null && c.value > 0);
  const labels = parts.map((c) => c.label);
  const percents = parts.map((c) => (c.percent ?? 0));
  const colors = seriesColors(style, parts.length);
  const lines: string[] = [];
  lines.push(header("100% stacked bar (parts of whole)"));
  lines.push("");
  lines.push("import matplotlib.pyplot as plt");
  lines.push("");
  lines.push(`labels = ${pyStrList(labels)}`);
  lines.push(`percents = ${pyList(percents)}  # each category as a percent of ${pyNum(total)}`);
  lines.push(`colors = ${pyStrList(colors)}`);
  lines.push("");
  lines.push(`fig, ax = plt.subplots(figsize=(${inchAttr(w)}, ${inchAttr(h)}))`);
  lines.push("bottom = 0.0");
  lines.push("for label, pct, color in zip(labels, percents, colors):");
  lines.push('    ax.bar(0, pct, bottom=bottom, width=0.5, color=color, label=label)');
  lines.push("    bottom += pct");
  lines.push("ax.set_ylim(0, 100)");
  lines.push('ax.set_ylabel("Percent of total")');
  lines.push("ax.set_xticks([])");
  lines.push('ax.legend(loc="center left", bbox_to_anchor=(1.02, 0.5))');
  if (style.title.trim() !== "")
    lines.push(`ax.set_title(${pyStr(style.title)})`);
  lines.push("");
  lines.push(footer(dpi));
  return lines.join("\n");
}

/**
 * The runnable matplotlib script that reproduces a figure on screen, with the
 * real group names + values baked in. The optional analysis is accepted for
 * parity with show-code.ts and future bracket overlays; the figure values come
 * from the spec + content the renderer also reads. Pure (no DOM, no I/O).
 *
 * The grouped-bar and survival kinds reuse the column path (grouped bar) or are
 * left to a follow-up, so this covers the three core kinds the brief names
 * (columnBar, columnScatter, xyScatter).
 */
export function plotCode(
  spec: PlotSpec,
  content: DataHubDocContent,
  _analysis?: AnalysisSpec | null,
): string {
  const style = readPlotStyle(spec);
  const analysis = _analysis ?? null;
  if (style.kind === "xyScatter") {
    return xyScatterCode(spec, content, style);
  }
  if (
    style.kind === "estimationGardnerAltman" ||
    style.kind === "estimationCumming"
  ) {
    return estimationCode(spec, content, style);
  }
  if (style.kind === "qqPlot") {
    return qqCode(content, style, analysis);
  }
  if (style.kind === "residualPlot") {
    return residualCode(style, analysis);
  }
  if (style.kind === "rocCurve") {
    return rocCode(style, analysis);
  }
  if (style.kind === "pie" || style.kind === "donut") {
    return pieCode(content, style, style.kind === "donut");
  }
  if (style.kind === "stackedBar") {
    return stackedBarCode(content, style);
  }
  const groups = resolvePlotGroups(content, style);
  if (style.kind === "columnBar") {
    return columnBarCode(groups, style);
  }
  // columnScatter is the default column figure; groupedBar / survivalCurve fall
  // back to the scatter path so they still emit a runnable script.
  return columnScatterCode(groups, style);
}
