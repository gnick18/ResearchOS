// Self-contained correctness check for the GS1/GTIN parser (smart-match layer 2).
// The mobile package has no unit-test runner, so this runs standalone:
//   npx tsx scripts/barcode-check.ts
// Exits non-zero on any failure. Covers GTIN normalization + check digits, UPC-A
// vs EAN-13 equivalence, GS1 prefix region hints, and GS1-128 (parens + FNC1).
import { normalizeGtin, parseBarcode, barcodesMatch } from '../lib/barcode';

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

// Canonical normalization + UPC-A vs EAN-13 equivalence
eq('UPC-A 036000291452 valid', normalizeGtin('036000291452'), '00036000291452');
eq('EAN-13 leading-zero equals UPC-A', normalizeGtin('0036000291452'), normalizeGtin('036000291452'));
eq('EAN-13 4006381333931 valid', normalizeGtin('4006381333931'), '04006381333931');
eq('EAN-8 96385074 valid', normalizeGtin('96385074'), '00000096385074');
eq('bad check digit rejected', normalizeGtin('036000291453'), null);
eq('catalog code rejected', normalizeGtin('F4135'), null);

// Region hint
eq('region Germany (400)', parseBarcode('4006381333931').region, 'Germany');
eq('region US/Canada (036)', parseBarcode('036000291452').region, 'United States / Canada');

// barcodesMatch
eq('match UPC-A vs EAN-13', barcodesMatch('036000291452', '0036000291452'), true);
eq('match GTIN-14 vs UPC-A', barcodesMatch('00036000291452', '036000291452'), true);
eq('non-match different products', barcodesMatch('036000291452', '4006381333931'), false);
eq('catalog exact fallback match', barcodesMatch('F4135', 'F4135'), true);
eq('catalog vs different no match', barcodesMatch('F4135', 'F9999'), false);

// GS1-128 element parse (parens form)
const g = parseBarcode('(01)00036000291452(17)251231(10)ABC123');
eq('gs1 isGs1', g.isGs1, true);
eq('gs1 embedded gtin', g.gtin14, '00036000291452');
eq('gs1 expiry', g.ai.expiry, '2025-12-31');
eq('gs1 lot', g.ai.lot, 'ABC123');

// GS1-128 FNC1 form
const GS = String.fromCharCode(29);
const f = parseBarcode(`01000360002914521725123110LOT9${GS}21SER42`);
eq('gs1 fnc1 gtin', f.gtin14, '00036000291452');
eq('gs1 fnc1 expiry', f.ai.expiry, '2025-12-31');
eq('gs1 fnc1 lot', f.ai.lot, 'LOT9');
eq('gs1 fnc1 serial', f.ai.serial, 'SER42');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
