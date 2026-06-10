// Validates the shipped bench-terms.txt asset so a blind regeneration
// cannot silently produce a malformed file.
//
// Rules enforced:
//   - File is non-empty
//   - Every non-blank line matches /^[a-z']+$/ (lowercase alpha + apostrophe only)
//   - Every term is >= 3 characters
//   - No duplicate terms
//   - Size is within a sane bound (> 10 KB, < 300 KB)

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_TERMS_PATH = join(
  __dirname,
  "../../../public/spellcheck/bench-terms.txt",
);

const TERM_RE = /^[a-z']+$/;

describe("bench-terms.txt asset validation", () => {
  const raw = readFileSync(BENCH_TERMS_PATH, "utf8");
  const lines = raw.split("\n");
  const terms = lines.filter((l) => l.trim().length > 0);

  it("is non-empty (at least 500 terms)", () => {
    expect(terms.length).toBeGreaterThanOrEqual(500);
  });

  it("is within a sane file size (> 5 KB, < 300 KB)", () => {
    const stat = statSync(BENCH_TERMS_PATH);
    expect(stat.size).toBeGreaterThan(5 * 1024);
    expect(stat.size).toBeLessThan(300 * 1024);
  });

  it("every non-blank line is lowercase alphabetic (a-z) or apostrophe only", () => {
    const bad: string[] = [];
    for (const term of terms) {
      if (!TERM_RE.test(term)) bad.push(term);
    }
    expect(bad, `Non-conforming terms: ${bad.slice(0, 10).join(", ")}`).toHaveLength(0);
  });

  it("every term is >= 3 characters", () => {
    const short = terms.filter((t) => t.length < 3);
    expect(short, `Too-short terms: ${short.join(", ")}`).toHaveLength(0);
  });

  it("has no duplicate terms", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of terms) {
      if (seen.has(t)) dupes.push(t);
      seen.add(t);
    }
    expect(dupes, `Duplicates: ${dupes.slice(0, 10).join(", ")}`).toHaveLength(0);
  });

  it("file ends with a trailing newline", () => {
    expect(raw.endsWith("\n")).toBe(true);
  });
});
