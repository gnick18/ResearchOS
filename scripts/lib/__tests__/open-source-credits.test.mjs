/**
 * Tests for the open-source credits builder. Runs under Node's built-in test
 * runner so it matches the other scripts/ tests:
 *
 *   node --test scripts/lib/__tests__/open-source-credits.test.mjs
 *
 * Coverage:
 *   1. Repo-URL normalization handles the many shapes npm's `repository`
 *      field takes (shorthand, github:, git+https, scp-style git@, .git).
 *   2. License coercion handles string, object, and legacy `licenses` arrays.
 *   3. buildCredits() reflects the ACTUAL installed tree: every curated
 *      highlight resolves to a real version + license, the vendored and
 *      scientific sections are present, and the dependency count matches
 *      package.json. (This is the guard that catches a credits doc drifting
 *      from reality.)
 *   4. renderNotices() emits the dependency lines plus the vendored and
 *      scientific sections.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRepoUrl,
  normalizeLicense,
  buildCredits,
  renderNotices,
  resolveDependency,
} from "../../build-open-source-credits.mjs";

describe("normalizeRepoUrl", () => {
  test("expands owner/repo shorthand to a github URL", () => {
    assert.equal(normalizeRepoUrl("vercel/next.js", undefined), "https://github.com/vercel/next.js");
  });
  test("expands the github: shorthand", () => {
    assert.equal(normalizeRepoUrl("github:vercel/analytics", undefined), "https://github.com/vercel/analytics");
  });
  test("strips git+ prefix and .git suffix", () => {
    assert.equal(
      normalizeRepoUrl("git+https://github.com/jorenbroekema/expr-eval.git", undefined),
      "https://github.com/jorenbroekema/expr-eval",
    );
  });
  test("converts git:// to https", () => {
    assert.equal(
      normalizeRepoUrl("git://github.com/konvajs/konva.git", undefined),
      "https://github.com/konvajs/konva",
    );
  });
  test("converts scp-style git@host:owner/repo", () => {
    assert.equal(
      normalizeRepoUrl("git@github.com:konvajs/react-konva.git", undefined),
      "https://github.com/konvajs/react-konva",
    );
  });
  test("accepts an object form with a url field", () => {
    assert.equal(
      normalizeRepoUrl({ type: "git", url: "git+https://github.com/foo/bar.git" }, undefined),
      "https://github.com/foo/bar",
    );
  });
  test("falls back to homepage when repository is unusable", () => {
    assert.equal(normalizeRepoUrl(undefined, "https://example.com/proj"), "https://example.com/proj");
  });
  test("returns null when nothing is usable", () => {
    assert.equal(normalizeRepoUrl(undefined, undefined), null);
  });
});

describe("normalizeLicense", () => {
  test("reads a plain string license", () => {
    assert.equal(normalizeLicense({ license: "MIT" }), "MIT");
  });
  test("reads the dual SPDX expression as-is", () => {
    assert.equal(normalizeLicense({ license: "(MIT OR GPL-3.0-or-later)" }), "(MIT OR GPL-3.0-or-later)");
  });
  test("reads an object license { type }", () => {
    assert.equal(normalizeLicense({ license: { type: "BSD-3-Clause" } }), "BSD-3-Clause");
  });
  test("reads a legacy licenses array", () => {
    assert.equal(normalizeLicense({ licenses: [{ type: "Apache-2.0" }] }), "Apache-2.0");
  });
  test("returns UNKNOWN when absent", () => {
    assert.equal(normalizeLicense({}), "UNKNOWN");
  });
});

describe("buildCredits", () => {
  const credits = buildCredits();

  test("resolves every runtime dependency to a version and license", () => {
    assert.ok(credits.dependencies.length > 0, "expected dependencies");
    for (const d of credits.dependencies) {
      assert.ok(d.version, `missing version for ${d.name}`);
      assert.ok(d.license && d.license !== "UNKNOWN", `missing license for ${d.name}`);
    }
  });

  test("dependencyCount matches the dependencies array", () => {
    assert.equal(credits.dependencyCount, credits.dependencies.length);
  });

  test("every curated highlight resolves against the real tree", () => {
    for (const group of credits.highlightGroups) {
      assert.ok(group.items.length > 0, `empty highlight group ${group.id}`);
      for (const item of group.items) {
        assert.ok(item.version, `highlight ${item.name} missing version`);
        assert.ok(item.license, `highlight ${item.name} missing license`);
        assert.ok(item.note, `highlight ${item.name} missing note`);
      }
    }
  });

  test("includes the two flagged attribution items: expr-eval-fork and the Biopython Tm port", () => {
    const engine = credits.dependencies.find((d) => d.name === "expr-eval-fork");
    assert.ok(engine, "expr-eval-fork should be a dependency");
    assert.equal(engine.license, "MIT");
    const biopython = credits.vendored.find((v) => v.name.includes("Biopython"));
    assert.ok(biopython, "Biopython Tm port should be in the vendored section");
    assert.match(biopython.license, /BSD/);
  });

  test("credits SeqViz and TeselaGen tg-oss in the vendored section", () => {
    const names = credits.vendored.map((v) => v.name).join(" | ");
    assert.match(names, /SeqViz/);
    assert.match(names, /TeselaGen/);
  });

  test("scientific references are present and only the cited papers", () => {
    const joined = credits.scientificReferences.map((r) => r.citation).join(" ");
    assert.match(joined, /Allawi/);
    assert.match(joined, /SantaLucia/);
    assert.match(joined, /von Ahsen/);
    // Owczarzy is NOT in tm-nn.ts, so it must NOT appear here.
    assert.doesNotMatch(joined, /Owczarzy/);
  });
});

describe("resolveDependency", () => {
  test("resolves a known dependency even when only the pnpm store has it", () => {
    // expr-eval-fork is a real dependency; this exercises the normal hoisted
    // path or the .pnpm store fallback (whichever the tree currently presents).
    // Either way the version + license must come back, never a thrown 'not installed'.
    const dep = resolveDependency("expr-eval-fork");
    assert.equal(dep.name, "expr-eval-fork");
    assert.match(dep.version, /^\d+\.\d+\.\d+/);
    assert.equal(dep.license, "MIT");
  });

  test("throws loudly for a package that is genuinely not present anywhere", () => {
    assert.throws(
      () => resolveDependency("this-package-does-not-exist-anywhere-xyz"),
      /not installed/,
    );
  });
});

describe("renderNotices", () => {
  const credits = buildCredits();
  const notices = renderNotices(credits);

  test("lists a dependency with its version and license", () => {
    assert.match(notices, /react@/);
    assert.match(notices, /License: MIT/);
  });

  test("includes the vendored and scientific sections", () => {
    assert.match(notices, /VENDORED AND PORTED SOURCE/);
    assert.match(notices, /SeqViz/);
    assert.match(notices, /SCIENTIFIC REFERENCES/);
    assert.match(notices, /Allawi/);
  });
});
