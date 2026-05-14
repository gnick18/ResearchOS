// Verification probe: assert the export pipeline's `extractUserContent`
// strips stamp metadata from a real on-disk demo notes.md file.
//
// Background: the §8 export-feature audit flagged that the stamp-strip code
// path (html.ts:299, pdf.ts:675 → extractUserContent → parseContent) was
// unobserved in real export output because the four supplied audit zips had
// no stamp metadata. Alex's task-2 notes.md now ships with a canonical
// `<!-- stamp:start -->` header in the demo seed; this probe loads that file
// and confirms the strip behaves correctly.
//
// Implementation note: we import `parseContent` from `stamp-utils.ts`
// directly (no `@/` alias to resolve) and reproduce `extractUserContent`'s
// one-line body locally — it's verbatim `parseContent(c).content.trim()` per
// frontend/src/lib/export/markdown.ts. This exercises the identical code
// path the HTML/PDF exporters call into, without dragging the path-alias
// resolver into a one-off script.
//
// Pass = stamp lines absent from extractUserContent output, banner + body
// preserved. Fail = bug to file.

import { readFileSync } from "node:fs";
import { register } from "node:module";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

register("./lib/ts-resolver.mjs", import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRONTEND_DIR = resolvePath(__dirname, "..");

const NOTES_PATH = resolvePath(
  FRONTEND_DIR,
  "public/demo-data/users/alex/results/task-2/notes.md",
);

const stampModUrl = new URL("../src/lib/stamp-utils.ts", import.meta.url);
const { parseStamp, parseContent } = await import(stampModUrl.href);

// Mirror of `extractUserContent` from src/lib/export/markdown.ts. Kept inline
// so this probe doesn't have to resolve the project's `@/` path alias.
function extractUserContent(content) {
  if (!content) return "";
  return parseContent(content).content.trim();
}
// Mirror of `hasUserContent` (same file) — used for the negative assertion.
function hasUserContent(content) {
  if (!content || !content.trim()) return false;
  const userContent = parseContent(content).content.trim();
  if (!userContent) return false;
  const headerOnlyPattern = /^#\s+(Lab Notes|Results):\s+.+\s*$/i;
  if (headerOnlyPattern.test(userContent.trim())) return false;
  return true;
}

const raw = readFileSync(NOTES_PATH, "utf8");

const failures = [];
function expect(cond, msg) {
  if (!cond) failures.push(msg);
}

// ── Sanity: the fixture itself has the stamp we expect ─────────────────────
expect(raw.includes("<!-- stamp:start -->"), "Input fixture missing <!-- stamp:start --> marker");
expect(raw.includes("<!-- stamp:end -->"), "Input fixture missing <!-- stamp:end --> marker");

const parsedStamp = parseStamp(raw);
expect(parsedStamp !== null, "parseStamp() returned null on the seeded fixture");
if (parsedStamp) {
  expect(parsedStamp.date === "2026-05-08", `Expected stamp date 2026-05-08, got ${parsedStamp.date}`);
  expect(
    parsedStamp.experimentName === "Yeast transformation: pYES-GAL1::flbA",
    `Expected stamp experiment name to round-trip, got ${parsedStamp.experimentName}`,
  );
  expect(
    parsedStamp.projectFolder === "DEMO: Engineer FakeYeast for biofuel",
    `Expected stamp project folder to round-trip, got ${parsedStamp.projectFolder}`,
  );
}

// ── Core assertion: extractUserContent strips the stamp ────────────────────
const stripped = extractUserContent(raw);

expect(
  !stripped.includes("<!-- stamp:start -->"),
  "extractUserContent left <!-- stamp:start --> in output",
);
expect(
  !stripped.includes("<!-- stamp:end -->"),
  "extractUserContent left <!-- stamp:end --> in output",
);
expect(
  !stripped.includes("[last-access]:"),
  "extractUserContent left [last-access] marker in output",
);
expect(
  !stripped.includes("9:42 AM"),
  "extractUserContent left stamp-time line in output",
);
expect(
  !stripped.includes("experiment: Yeast transformation"),
  "extractUserContent left stamp experiment line in output",
);
expect(
  !stripped.includes("project folder: DEMO:"),
  "extractUserContent left stamp project-folder line in output",
);

// ── Negative: body content is preserved ────────────────────────────────────
expect(
  stripped.includes("This is fake demo data"),
  "extractUserContent dropped the demo banner (body content)",
);
expect(
  stripped.includes("Transformation notes — 2026-05-08"),
  "extractUserContent dropped the H2 heading (body content)",
);
expect(
  stripped.includes("FakeYeast-001"),
  "extractUserContent dropped a body bullet (FakeYeast-001 strain)",
);
expect(
  stripped.includes("heat shock 38 min"),
  "extractUserContent dropped a body bullet (heat-shock detail)",
);

// ── hasUserContent should still report true for the stamped file ──────────
expect(
  hasUserContent(raw) === true,
  "hasUserContent() returned false on a clearly non-empty stamped notes.md",
);

// ── Reporting ──────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error("FAIL — stamp-strip verification on alex/results/task-2/notes.md");
  for (const f of failures) console.error("  - " + f);
  console.error("");
  console.error("First 300 chars of extractUserContent output:");
  console.error(stripped.slice(0, 300));
  process.exit(1);
} else {
  console.log("PASS — extractUserContent strips stamp metadata from a real on-disk fixture.");
  console.log(`  Source: ${NOTES_PATH.replace(FRONTEND_DIR + "/", "")}`);
  console.log(`  Stamp parsed: date=${parsedStamp.date} exp="${parsedStamp.experimentName}"`);
  console.log(`  Stripped length: ${stripped.length} chars (raw was ${raw.length})`);
}
