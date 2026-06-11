/**
 * Drift guard for the ported phone calculator engine (Phase 3, 2026-06-10).
 *
 * The phone engine (custom.ts) is a verbatim port of the laptop evaluator
 * (frontend/src/lib/calculators/custom.ts). This test pins the SAME oracle
 * values the laptop golden suite uses (custom.golden.test.ts), so any drift
 * between the two engines fails here. The three representative templates the
 * brief calls out are covered with their on-disk default inputs:
 *   1. Cell viability and count -> 95 %   (replicate inputs + mean)
 *   2. RCF and RPM converter    -> 8944 g (dropdown enum string + step + if)
 *   3. Shannon diversity index  -> 1.2798542258336674 nats (list helper)
 * Plus direct checks of sd (n-1) and geomean to exercise more list helpers.
 *
 * No mobile test runner is installed (mobile/package.json has no jest/vitest),
 * so this file is a self-contained node test: run it from the mobile/ directory
 * with native TypeScript stripping, no framework required:
 *
 *   cd mobile && node --experimental-strip-types lib/calculators/custom.test.ts
 *
 * It prints one line per assertion and exits non-zero on the first failure, so
 * it slots into CI as a plain script. The template specs below are transcribed
 * verbatim from frontend/public/calculator-templates/templates/<slug>.json so
 * the oracle is exactly the same shape the laptop golden suite loads from disk.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
// Extension-bearing import so the file runs directly under node native TS
// stripping (node --experimental-strip-types resolves the .ts specifier; the
// app bundler resolves the same path extensionless). See the header for how to
// run this.
import {
  evaluateCustomCalculator,
  type CustomCalculatorSpec,
  type CustomCalcResult,
} from './custom.ts';

// ── Tiny assert harness (no framework on the phone) ───────────────────────────

let passed = 0;
let failed = 0;
const REL_TOL = 1e-12;

function near(label: string, actual: number, oracle: number): void {
  const denom = oracle === 0 ? 1 : Math.abs(oracle);
  const ok = Math.abs(actual - oracle) / denom < REL_TOL;
  if (ok) {
    passed += 1;
    console.log(`  ok  ${label} = ${actual}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}: got ${actual}, expected ${oracle}`);
  }
}

function eqMessages(label: string, actual: string[], oracle: string[]): void {
  const ok = JSON.stringify(actual) === JSON.stringify(oracle);
  if (ok) {
    passed += 1;
    console.log(`  ok  ${label} = ${JSON.stringify(actual)}`);
  } else {
    failed += 1;
    console.error(
      `FAIL  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(oracle)}`,
    );
  }
}

function out(r: CustomCalcResult, label: string): number {
  const o = r.outputs.find((x) => x.label === label);
  if (!o) {
    failed += 1;
    console.error(`FAIL  output "${label}" missing`);
    return NaN;
  }
  return o.value;
}

/** Read one output's display string (the format-honoring render). */
function disp(r: CustomCalcResult, label: string): string {
  const o = r.outputs.find((x) => x.label === label);
  if (!o) {
    failed += 1;
    console.error(`FAIL  output "${label}" missing`);
    return '';
  }
  return o.display;
}

function eqStr(label: string, actual: string, oracle: string): void {
  if (actual === oracle) {
    passed += 1;
    console.log(`  ok  ${label} = ${JSON.stringify(actual)}`);
  } else {
    failed += 1;
    console.error(
      `FAIL  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(oracle)}`,
    );
  }
}

/** Build the default-value input map from a spec's declared defaults, the same
 *  set the laptop golden suite and the "Use" view start from. */
function defaultValues(
  spec: CustomCalculatorSpec,
): Record<string, number | number[] | string> {
  const values: Record<string, number | number[] | string> = {};
  for (const input of spec.inputs) {
    if (input.type === 'dropdown') {
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

function run(spec: CustomCalculatorSpec): CustomCalcResult {
  return evaluateCustomCalculator(spec, defaultValues(spec));
}

// ── Template specs (verbatim from the on-disk templates) ──────────────────────

const cellViability: CustomCalculatorSpec = {
  name: 'Cell viability and count',
  description: '',
  field: 'Cell culture',
  inputs: [
    { key: 'live', type: 'replicate', label: 'Live cell counts', default: [95, 98, 92] },
    { key: 'dead', type: 'replicate', label: 'Dead cell counts', default: [5, 2, 8] },
    { key: 'dilution', type: 'number', label: 'Dilution factor', default: 2 },
    { key: 'volume', type: 'number', label: 'Suspension volume', unit: 'mL', default: 10 },
  ],
  steps: [
    { key: 'meanLive', expr: 'mean(live)' },
    { key: 'meanDead', expr: 'mean(dead)' },
  ],
  conditionals: [
    { expr: 'if(meanLive/(meanLive+meanDead)*100 < 80, "Viability below 80%, check handling", "")' },
  ],
  outputs: [
    { label: 'Viability', expr: 'meanLive/(meanLive+meanDead)*100', unit: '%' },
    { label: 'Cells per mL', expr: 'meanLive*dilution*1e4', unit: 'cells/mL' },
    { label: 'Total cells', expr: '(meanLive*dilution*1e4)*volume', unit: 'cells' },
  ],
};

const rcfRpm: CustomCalculatorSpec = {
  name: 'RCF and RPM converter',
  description: '',
  field: 'General lab',
  inputs: [
    { key: 'radius', type: 'number', label: 'Rotor radius', unit: 'mm', default: 80 },
    {
      key: 'mode',
      type: 'dropdown',
      label: 'Convert',
      options: [
        { label: 'RPM to g', value: 'rpm' },
        { label: 'g to RPM', value: 'g' },
      ],
    },
    { key: 'value', type: 'number', label: 'Value', default: 10000 },
  ],
  steps: [{ key: 'rcm', expr: 'radius/10' }],
  conditionals: [],
  outputs: [
    {
      label: 'Result',
      expr: 'if(mode == "rpm", 1.118e-5*rcm*value^2, sqrt(value/(1.118e-5*rcm)))',
    },
  ],
};

const shannonDiversity: CustomCalculatorSpec = {
  name: 'Shannon diversity index',
  description: '',
  field: 'Ecology and microbiome',
  inputs: [
    { key: 'counts', type: 'replicate', label: 'Per-taxon counts', default: [40, 30, 20, 10] },
  ],
  steps: [],
  conditionals: [],
  outputs: [
    { label: 'Shannon H', expr: 'shannon(counts)' },
    { label: 'Richness', expr: 'count(counts)', unit: 'taxa' },
  ],
};

// ── Assertions ────────────────────────────────────────────────────────────────

console.log('GOLDEN: cell-viability-count');
const cv = run(cellViability);
near('viability', out(cv, 'Viability'), 95);
near('cells per mL', out(cv, 'Cells per mL'), 1_900_000);
near('total cells', out(cv, 'Total cells'), 19_000_000);
eqMessages('no low-viability guidance at 95 %', cv.messages, []);

console.log('GOLDEN: rcf-rpm-converter');
const rc = run(rcfRpm);
// RPM 10000 at 80 mm -> 1.118e-5 * 8 * 1e8 = 8944 g (dropdown enum string + step).
near('RCF result', out(rc, 'Result'), 8944);

console.log('GOLDEN: shannon-diversity');
const sh = run(shannonDiversity);
const counts = [40, 30, 20, 10];
const total = 100;
const H = -counts.reduce((h, n) => h + (n / total) * Math.log(n / total), 0);
near('Shannon H (hand-computed)', out(sh, 'Shannon H'), H);
near('Shannon H oracle constant', out(sh, 'Shannon H'), 1.2798542258336674);
near('richness', out(sh, 'Richness'), 4);

// Direct list-helper coverage (sample sd n-1, geometric mean) so the ported
// helpers are exercised beyond the three template paths.
console.log('LIST HELPERS: sd + geomean');
const sdGeo: CustomCalculatorSpec = {
  name: 'helpers',
  description: '',
  inputs: [{ key: 'xs', type: 'replicate', label: 'xs', default: [2, 4, 4, 4, 5, 5, 7, 9] }],
  steps: [],
  conditionals: [],
  outputs: [
    { label: 'SD', expr: 'sd(xs)' },
    { label: 'GeoMean', expr: 'geomean(xs)' },
  ],
};
const hg = run(sdGeo);
// xs = [2,4,4,4,5,5,7,9], mean 5, sample variance = 32/7, sd = sqrt(32/7).
near('sample sd (n-1)', out(hg, 'SD'), Math.sqrt(32 / 7));
// geomean = exp(mean(ln xs)).
const geoOracle = Math.exp(
  [2, 4, 4, 4, 5, 5, 7, 9].reduce((s, x) => s + Math.log(x), 0) / 8,
);
near('geomean', out(hg, 'GeoMean'), geoOracle);

// Table input + col() helper (Phase 5). Mirrors the laptop master-mix oracle:
// a reagents table with a per-row computed totalUL = perRxn * n, aggregated by
// sum(col(reagents, "totalUL")). Seed rows sum to 25 per reaction; n = 11, so
// the total is 275. col() drops a non-numeric cell rather than poisoning it.
console.log('TABLE + col(): master-mix shape');
const masterMix: CustomCalculatorSpec = {
  name: 'PCR master mix maker',
  description: '',
  inputs: [
    { key: 'reactions', type: 'number', label: 'Reactions', default: 10 },
    { key: 'overagePct', type: 'number', label: 'Overage', unit: '%', default: 10 },
    {
      key: 'reagents',
      type: 'table',
      label: 'Reagents',
      columns: [
        { key: 'name', label: 'Reagent', kind: 'input' },
        { key: 'perRxn', label: 'Per reaction', kind: 'input', unit: 'uL' },
        { key: 'totalUL', label: 'Batch total', kind: 'computed', unit: 'uL', expr: 'perRxn * n' },
      ],
      rows: [
        { name: 'Buffer', perRxn: 5 },
        { name: 'dNTP', perRxn: 1 },
        { name: 'Primer F', perRxn: 1 },
        { name: 'Primer R', perRxn: 1 },
        { name: 'Polymerase', perRxn: 0.5 },
        { name: 'Template', perRxn: 2 },
        { name: 'Water', perRxn: 14.5 },
      ],
    },
  ],
  steps: [{ key: 'n', expr: 'reactions*(1+overagePct/100)' }],
  conditionals: [],
  outputs: [{ label: 'Total volume', expr: 'sum(col(reagents, "totalUL"))', unit: 'uL' }],
};
const mm = run(masterMix);
near('master-mix total volume (25 per-rxn * n=11)', out(mm, 'Total volume'), 275);

// col() on supplied rows, with a non-numeric cell that must drop out.
const colSpec: CustomCalculatorSpec = {
  name: 'col probe',
  description: '',
  inputs: [
    {
      key: 'grid',
      type: 'table',
      label: 'Grid',
      columns: [{ key: 'val', label: 'val', kind: 'input' }],
    },
  ],
  steps: [],
  conditionals: [],
  outputs: [
    { label: 'sum', expr: 'sum(col(grid, "val"))' },
    { label: 'count', expr: 'count(col(grid, "val"))' },
  ],
};
const cg = evaluateCustomCalculator(colSpec, {
  grid: [{ val: 4 }, { val: '' }, { val: 6 }],
});
near('col() sum drops the blank cell', out(cg, 'sum'), 10);
near('col() count drops the blank cell', out(cg, 'count'), 2);

// ── Per-output number format (matches the laptop engine) ──────────────────────

console.log('FORMAT: per-output auto / scientific / fixed');
const fmtSpec: CustomCalculatorSpec = {
  name: 'format probe',
  description: '',
  inputs: [{ key: 'n', type: 'number', label: 'n', default: 250000000 }],
  steps: [],
  conditionals: [],
  outputs: [
    { label: 'auto', expr: 'n' },
    { label: 'sci', expr: 'n', format: 'scientific' },
    { label: 'sci1', expr: 'n', format: 'scientific', decimals: 1 },
    { label: 'fixed', expr: 'n / 1e8', format: 'fixed' },
    { label: 'fixed3', expr: 'n / 1e8', format: 'fixed', decimals: 3 },
  ],
};
const fmt = run(fmtSpec);
near('format leaves numeric value untouched', out(fmt, 'sci'), 250000000);
eqStr('auto display is the clean default', disp(fmt, 'auto'), '250000000');
eqStr('scientific display (default 2 dp)', disp(fmt, 'sci'), '2.50e+8');
eqStr('scientific display (1 dp)', disp(fmt, 'sci1'), '2.5e+8');
eqStr('fixed display (default 2 dp)', disp(fmt, 'fixed'), '2.50');
eqStr('fixed display (3 dp)', disp(fmt, 'fixed3'), '2.500');

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
