import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildContrastReport,
  contrastRatio,
  parseColor,
  parseThemeTokens,
} from "./contrast";

// Read globals.css (the single source of truth for theme tokens) so this gate
// scores the values actually shipped, not a copy that can drift.
const cssPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../app/globals.css",
);
const css = readFileSync(cssPath, "utf8");
const tokens = parseThemeTokens(css);

describe("theme token parsing", () => {
  it("finds both the light (:root) and dark token blocks", () => {
    expect(tokens.light["--foreground"]).toBeTruthy();
    expect(tokens.light["--surface"]).toBeTruthy();
    expect(tokens.dark["--foreground"]).toBeTruthy();
    expect(tokens.dark["--surface"]).toBeTruthy();
    // Light and dark must actually differ (caught a copy-paste where the dark
    // block was never overridden).
    expect(tokens.dark["--surface"]).not.toBe(tokens.light["--surface"]);
  });
});

describe("known contrast ratios (formula sanity)", () => {
  it("black on white is 21:1", () => {
    const black = parseColor("#000000")!;
    const white = parseColor("#ffffff")!;
    expect(Math.round(contrastRatio(black, white))).toBe(21);
  });
});

describe("WCAG AA contrast gate (light + dark)", () => {
  const report = buildContrastReport(tokens);

  it("checks a meaningful number of text-on-surface pairs in both themes", () => {
    expect(report.length).toBeGreaterThanOrEqual(12);
    expect(report.some((c) => c.theme === "dark")).toBe(true);
    expect(report.some((c) => c.theme === "light")).toBe(true);
  });

  it("every text-on-surface pair clears its AA threshold in both themes", () => {
    const failures = report.filter((c) => !c.pass);
    const detail = failures
      .map(
        (c) =>
          `  ${c.theme}: ${c.label} = ${c.ratio}:1 (needs ${c.min}:1, ${c.level})`,
      )
      .join("\n");
    expect(failures, `Contrast regressions:\n${detail}`).toHaveLength(0);
  });
});
