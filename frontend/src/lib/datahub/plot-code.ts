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
  FIG,
  type PlotStyle,
  type PlotGroup,
} from "@/lib/datahub/plot-spec";
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
// Public entry point
// ---------------------------------------------------------------------------

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
  if (style.kind === "xyScatter") {
    return xyScatterCode(spec, content, style);
  }
  const groups = resolvePlotGroups(content, style);
  if (style.kind === "columnBar") {
    return columnBarCode(groups, style);
  }
  // columnScatter is the default column figure; groupedBar / survivalCurve fall
  // back to the scatter path so they still emit a runnable script.
  return columnScatterCode(groups, style);
}
