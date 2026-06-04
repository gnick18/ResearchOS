// Tiny assertion + reporting helper shared across the four gate harnesses.
// No dependencies, prints a per-gate PASS/FAIL banner that the report quotes.

let total = 0;
let failed = 0;
const failures = [];

export function check(label, cond, detail) {
  total += 1;
  const ok = !!cond;
  if (!ok) {
    failed += 1;
    failures.push(label);
  }
  const tag = ok ? "PASS" : "FAIL";
  let line = `  [${tag}] ${label}`;
  if (detail !== undefined) line += `  ->  ${detail}`;
  console.log(line);
  return ok;
}

export function section(title) {
  console.log(`\n--- ${title} ---`);
}

export function banner(gateName) {
  const verdict = failed === 0 ? "PASS" : "FAIL";
  console.log(`\n========================================`);
  console.log(`${gateName}: ${verdict}  (${total - failed}/${total} checks passed)`);
  if (failed > 0) console.log(`failed: ${failures.join("; ")}`);
  console.log(`========================================`);
  if (failed > 0) process.exitCode = 1;
}

export function reset() {
  total = 0;
  failed = 0;
  failures.length = 0;
}
