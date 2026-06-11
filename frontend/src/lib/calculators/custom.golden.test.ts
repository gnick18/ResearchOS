/**
 * GOLDEN / GROUND-TRUTH suite for the 10 shipped calculator templates.
 *
 * Each expected value here was COMPUTED INDEPENDENTLY of our engine (plain
 * arithmetic worked out by hand / in a scratch script, transcribed below with
 * its derivation), then the template is loaded from its real on-disk JSON,
 * evaluated through `evaluateCustomCalculator` on its DEFAULT inputs, and the
 * outputs + guidance messages are pinned to those oracle numbers. A failure
 * here is a real engine or template regression, not float noise (we assert at a
 * tight 1e-12 relative tolerance).
 *
 * Provenance of each oracle is documented inline per case. This file is pure
 * TypeScript with hardcoded oracle numbers, mirroring calculators.golden.test.ts,
 * so it runs in CI with no external dependency.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateCustomCalculator } from "./custom";
import { parseCalculatorTemplate, type CalculatorTemplate } from "./template-catalog";
import type { CustomCalculator as CustomCalculatorType } from "@/lib/types";

const TEMPLATES_DIR = fileURLToPath(
  new URL("../../../public/calculator-templates/templates", import.meta.url),
);

function loadTemplate(slug: string): CalculatorTemplate {
  const raw = JSON.parse(readFileSync(`${TEMPLATES_DIR}/${slug}.json`, "utf8"));
  return parseCalculatorTemplate(raw);
}

/** Turn a template into a runnable CustomCalculator (numeric id placeholder +
 *  timestamps; the engine ignores them). */
function asCalc(t: CalculatorTemplate): CustomCalculatorType {
  return {
    id: 1,
    name: t.name,
    description: t.description,
    field: t.field,
    inputs: t.inputs,
    steps: t.steps,
    conditionals: t.conditionals,
    outputs: t.outputs,
    shared_with: [],
    created_at: "2026-06-10T00:00:00.000Z",
    updated_at: "2026-06-10T00:00:00.000Z",
  };
}

/** Build the default-value input map from a template's declared defaults, the
 *  same set the catalog-files test exercises and the "Use" view starts from. */
function defaultValues(t: CalculatorTemplate): Record<string, number | number[] | string> {
  const values: Record<string, number | number[] | string> = {};
  for (const input of t.inputs) {
    if (input.type === "dropdown") {
      values[input.key] =
        input.default !== undefined && !Array.isArray(input.default)
          ? input.default
          : input.options![0].value;
    } else if (input.default !== undefined) {
      values[input.key] = input.default;
    }
  }
  return values;
}

function evalDefaults(slug: string) {
  const t = loadTemplate(slug);
  return evaluateCustomCalculator(asCalc(t), defaultValues(t));
}

const REL_TOL = 1e-12;
function near(actual: number, oracle: number) {
  const denom = oracle === 0 ? 1 : Math.abs(oracle);
  expect(Math.abs(actual - oracle) / denom).toBeLessThan(REL_TOL);
}

/** Find an output by its label (the first match), asserting it exists. */
function out(result: ReturnType<typeof evalDefaults>, label: string) {
  const o = result.outputs.find((x) => x.label === label);
  expect(o, `output "${label}" present`).toBeDefined();
  return o!;
}

// ===========================================================================
// 1. Cell viability and count
//    Oracle (defaults live=[95,98,92], dead=[5,2,8], dilution=2, volume=10):
//      meanLive = 285/3 = 95 ; meanDead = 15/3 = 5
//      viability = 95/(95+5)*100 = 95 %
//      cells/mL  = 95 * 2 * 1e4 = 1,900,000
//      total     = 1,900,000 * 10 = 19,000,000
//      viability 95 >= 80 -> no guidance message
// ===========================================================================
describe("GOLDEN: cell-viability-count", () => {
  const r = evalDefaults("cell-viability-count");
  it("viability = 95 %", () => near(out(r, "Viability").value, 95));
  it("cells per mL = 1,900,000", () => near(out(r, "Cells per mL").value, 1_900_000));
  it("total cells = 19,000,000", () => near(out(r, "Total cells").value, 19_000_000));
  it("no low-viability guidance at 95 %", () => expect(r.messages).toEqual([]));
});

// ===========================================================================
// 2. CFU per mL from plate counts
//    Oracle (colonies=150, dilution=1e-5, platedVol=0.1):
//      CFU/mL = 150 / (1e-5 * 0.1) = 150 / 1e-6 = 1.5e8
//      150 in [30,300] -> no guidance
// ===========================================================================
describe("GOLDEN: cfu-per-ml", () => {
  const r = evalDefaults("cfu-per-ml");
  it("CFU per mL = 1.5e8", () => near(out(r, "CFU per mL").value, 1.5e8));
  it("no count-reliability guidance at 150 colonies", () => expect(r.messages).toEqual([]));
});

// ===========================================================================
// 3. OD600 to cells per mL
//    Oracle (od=0.5, organism = E. coli 8e8 default = first option):
//      cells/mL = 0.5 * 8e8 = 4e8
//      od 0.5 <= 1 -> no guidance
// ===========================================================================
describe("GOLDEN: od600-to-cells", () => {
  const r = evalDefaults("od600-to-cells");
  it("cells per mL = 4e8", () => near(out(r, "Cells per mL").value, 4e8));
  it("no linear-range guidance at OD 0.5", () => expect(r.messages).toEqual([]));
});

// ===========================================================================
// 4. qPCR amplification efficiency
//    Oracle (slope=-3.32):
//      eff = (10^(-1/-3.32) - 1) * 100 = (10^0.30120481927710846 - 1)*100
//          = 100.08052545562056 %
//      90 <= eff <= 110 -> guidance "Acceptable"
// ===========================================================================
describe("GOLDEN: qpcr-efficiency", () => {
  const r = evalDefaults("qpcr-efficiency");
  it("efficiency = 100.08052545562056 %", () =>
    near(out(r, "Efficiency").value, (Math.pow(10, -1 / -3.32) - 1) * 100));
  it("efficiency oracle constant", () => near(out(r, "Efficiency").value, 100.08052545562056));
  it("guidance is Acceptable", () => expect(r.messages).toEqual(["Acceptable"]));
});

// ===========================================================================
// 5. PCR master mix maker (Phase 5 table form)
//    Now ONE `reagents` table input with a per-row computed `totalUL = perRxn
//    * n` column, aggregated by `sum(col(reagents, "totalUL"))`. Defaults run
//    over the seed rows (no supplied table value, so the engine uses
//    `input.rows`).
//    Oracle (reactions=10, overage=10 -> n = 10*(1+10/100) = 11; seed rows
//      buffer 5, dNTP 1, primerF 1, primerR 1, polymerase 0.5, template 2,
//      water 14.5; sum perRxn = 25):
//      each row totalUL = perRxn * 11 ; total volume = sum = 25 * 11 = 275
// ===========================================================================
describe("GOLDEN: pcr-master-mix (table form)", () => {
  const r = evalDefaults("pcr-master-mix");
  it("total volume = 275 (25 per-rxn * n=11)", () =>
    near(out(r, "Total volume").value, 275));
});

// ===========================================================================
// 6. Injection volume by body weight
//    Oracle (dose=10 mg/kg, weight=25 g, stock=5 mg/mL):
//      weightKg = 0.025 ; volume mL = 10*0.025/5 = 0.05 ; volume uL = 50
//      50 >= 20 -> no guidance
// ===========================================================================
describe("GOLDEN: injection-volume-by-weight", () => {
  const r = evalDefaults("injection-volume-by-weight");
  const ml = r.outputs.find((o) => o.unit === "mL")!;
  const ul = r.outputs.find((o) => o.unit === "uL")!;
  it("volume mL = 0.05", () => near(ml.value, 0.05));
  it("volume uL = 50", () => near(ul.value, 50));
  it("no small-volume guidance at 50 uL", () => expect(r.messages).toEqual([]));
});

// ===========================================================================
// 7. RCF and RPM converter
//    Oracle (radius=80 mm -> rcm=8, mode="rpm" default first option, value=10000):
//      result = 1.118e-5 * 8 * 10000^2 = 1.118e-5 * 8 * 1e8 = 8944 g
// ===========================================================================
describe("GOLDEN: rcf-rpm-converter", () => {
  const r = evalDefaults("rcf-rpm-converter");
  it("RPM 10000 at 80 mm -> 8944 g", () => near(out(r, "Result").value, 8944));
});

// ===========================================================================
// 8. Doubling time and growth rate
//    Oracle (n1=1e5, n2=8e5, hours=6):
//      rate = ln(8) / 6 = 2.0794415416798357 / 6 = 0.34657359027997264 /h
//      doubling = ln(2)/rate = 0.6931471805599453 / 0.34657... = 2 h
// ===========================================================================
describe("GOLDEN: doubling-time", () => {
  const r = evalDefaults("doubling-time");
  it("growth rate = ln(8)/6 per hour", () => near(out(r, "Growth rate").value, Math.log(8) / 6));
  it("doubling time = 2 h", () => near(out(r, "Doubling time").value, 2));
});

// ===========================================================================
// 9. Isotope decay correction
//    Oracle (isotope=32P 14.29 d default first option, days=7, initial=100):
//      fraction = 0.5^(7/14.29) = 0.7120976298478862
//      remaining = 100 * fraction = 71.20976298478861
//      percent   = fraction * 100 = 71.20976298478861
// ===========================================================================
describe("GOLDEN: isotope-decay-correction", () => {
  const r = evalDefaults("isotope-decay-correction");
  const frac = Math.pow(0.5, 7 / 14.29);
  it("remaining activity = 100 * 0.5^(7/14.29)", () =>
    near(out(r, "Remaining activity").value, 100 * frac));
  it("percent remaining oracle", () => near(out(r, "Percent remaining").value, 71.20976298478861));
});

// ===========================================================================
// 10. Shannon diversity index
//    Oracle (counts=[40,30,20,10], total=100, p={0.4,0.3,0.2,0.1}):
//      H = -(0.4 ln0.4 + 0.3 ln0.3 + 0.2 ln0.2 + 0.1 ln0.1)
//        = 1.2798542258336674 (nats)
//      richness = 4
// ===========================================================================
describe("GOLDEN: shannon-diversity", () => {
  const r = evalDefaults("shannon-diversity");
  const counts = [40, 30, 20, 10];
  const total = 100;
  const H = -counts.reduce((h, n) => h + (n / total) * Math.log(n / total), 0);
  it("Shannon H matches hand-computed entropy", () => near(out(r, "Shannon H").value, H));
  it("Shannon H oracle constant", () => near(out(r, "Shannon H").value, 1.2798542258336674));
  it("richness = 4", () => near(out(r, "Richness").value, 4));
});

// ===========================================================================
// 11. Spore concentration (hemocytometer) — Keller Lab method, transcribed
//     verbatim from the source script (internal vs outer five squares).
//       internal: spores/mL = (count * 5) * 1e4 * dilution
//       outer:    spores/mL = (count * 1e4 * dilution) / 5
//     Oracle (count=50, dilution=100):
//       base = 50 * 1e4 * 100 = 5e7
//       internal = 5e7 * 5 = 2.5e8 ; outer = 5e7 / 5 = 1e7
// ===========================================================================
describe("GOLDEN: spore-concentration", () => {
  const t = loadTemplate("spore-concentration");
  const internal = evaluateCustomCalculator(asCalc(t), {
    countType: "i",
    dilution: 100,
    avgCount: 50,
  });
  const outer = evaluateCustomCalculator(asCalc(t), {
    countType: "o",
    dilution: 100,
    avgCount: 50,
  });
  it("internal squares: 2.5e8 spores/mL", () =>
    near(out(internal, "Spores per mL").value, 2.5e8));
  it("outer squares: 1e7 spores/mL", () =>
    near(out(outer, "Spores per mL").value, 1e7));
  // The output declares format "scientific" so a large spore count reads as
  // 2.5e8 rather than 250000000. The numeric .value above is unchanged; only
  // the .display string honors the format.
  it("internal squares display is scientific", () =>
    expect(out(internal, "Spores per mL").display).toBe("2.50e+8"));
});
