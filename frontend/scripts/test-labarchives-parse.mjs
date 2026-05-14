import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRONTEND_DIR = resolvePath(__dirname, "..");
const WORKTREE_ROOT = resolvePath(FRONTEND_DIR, "..");

const ZIP_CANDIDATES = [
  resolvePath(WORKTREE_ROOT, "scratch-labarchives-recon/offline_14681.zip"),
  "/tmp/labarchives-recon/offline_14681.zip",
];

let zipPath = null;
for (const candidate of ZIP_CANDIDATES) {
  if (existsSync(candidate)) {
    zipPath = candidate;
    break;
  }
}
if (!zipPath) {
  fail(
    `Sample ZIP not found. Tried:\n  ${ZIP_CANDIDATES.join("\n  ")}\nDrop the LabArchives offline export at one of these paths.`,
  );
}

const adapterUrl = new URL(
  "../src/lib/import/eln/adapters/labarchives.ts",
  import.meta.url,
);
const { parseLabArchivesOfflineZip } = await import(adapterUrl.href);

const buf = readFileSync(zipPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const parsed = await parseLabArchivesOfflineZip(ab);

const failures = [];
function expect(cond, msg) {
  if (!cond) failures.push(msg);
}

expect(
  parsed.notebookName === "The FUNGI lab",
  `notebookName: expected "The FUNGI lab", got ${JSON.stringify(parsed.notebookName)}`,
);

const topFolders = parsed.tree.filter((n) => n.kind === "folder").map((n) => n.name);
expect(
  topFolders.length === 4,
  `expected 4 top-level folders, got ${topFolders.length}: ${JSON.stringify(topFolders)}`,
);

expect(
  parsed.pages.length === 5,
  `expected 5 pages, got ${parsed.pages.length}: ${JSON.stringify(parsed.pages.map((p) => p.pageFile))}`,
);

const pageFileSet = new Set(parsed.pages.map((p) => p.pageFile).sort());
const expectedPages = ["10.html", "11.html", "12.html", "56.html", "92.html"];
for (const f of expectedPages) {
  expect(pageFileSet.has(f), `missing page file: ${f}`);
}

const totalEntries = parsed.pages.reduce((acc, p) => acc + p.entries.length, 0);
expect(
  totalEntries === 12,
  `expected 12 entries total (sample contains 12, brief's "18" was a best-guess), got ${totalEntries}`,
);

const allEntries = parsed.pages.flatMap((p) => p.entries);

const plainText = allEntries.find(
  (e) => e.type === "plain_text" && (e.bodyMarkdown ?? "").includes("**2026-03-26**"),
);
expect(
  plainText !== undefined,
  `no plain_text entry contains the literal "**2026-03-26**"`,
);

const richText = allEntries.find(
  (e) => e.type === "text" && (e.bodyMarkdown ?? "").trim().length > 0,
);
expect(richText !== undefined, "no text entry produced non-empty markdown");

const bodyAttachment = allEntries
  .filter((e) => e.type === "attachment")
  .flatMap((e) => e.attachments)
  .find((a) => a.usage === "body");
expect(
  bodyAttachment !== undefined,
  "no body-usage attachment found",
);
if (bodyAttachment) {
  expect(
    bodyAttachment.filename.length > 0,
    `body attachment has empty filename`,
  );
  expect(
    bodyAttachment.zipPath.startsWith("attachments/original/"),
    `body attachment zipPath should be under attachments/original/, got ${bodyAttachment.zipPath}`,
  );
  const bytes = await bodyAttachment.readBytes();
  expect(
    bytes.byteLength > 0,
    `body attachment readBytes returned 0 bytes`,
  );
}

expect(
  parsed.missingInlineImages.length >= 1,
  `expected >= 1 Form B missing inline image, got ${parsed.missingInlineImages.length}`,
);

const inlineAttachment = allEntries
  .flatMap((e) => e.attachments)
  .find((a) => a.usage === "inline");
expect(inlineAttachment !== undefined, "no Form A inline image preserved as ParsedAttachment");
if (inlineAttachment) {
  expect(
    inlineAttachment.zipPath.startsWith("attachments/inline/"),
    `inline attachment zipPath should be under attachments/inline/, got ${inlineAttachment.zipPath}`,
  );
  expect(inlineAttachment.isImage === true, "inline attachment should have isImage=true");
}

expect(
  parsed.exportedBy === "GRANT NICKLES",
  `exportedBy: expected "GRANT NICKLES", got ${JSON.stringify(parsed.exportedBy)}`,
);
{
  const t = parsed.exportedAt ? Date.parse(parsed.exportedAt) : NaN;
  const exportedDate = Number.isFinite(t) ? new Date(t) : null;
  const expectedMs = Date.parse("2026-05-13T23:04:00-05:00");
  expect(
    exportedDate !== null && Math.abs(exportedDate.getTime() - expectedMs) < 60 * 1000,
    `exportedAt: expected wall-clock May 13 2026 23:04 CDT, got ${JSON.stringify(parsed.exportedAt)}`,
  );
}

const dumpReady = stripClosures(parsed);
const outPath = resolvePath(FRONTEND_DIR, "scratch-parse-output.json");
writeFileSync(outPath, JSON.stringify(dumpReady, null, 2), "utf8");

const summary = {
  notebookName: parsed.notebookName,
  rootBreadcrumb: parsed.rootBreadcrumb,
  topFolders,
  pageCount: parsed.pages.length,
  entryCount: totalEntries,
  perPageEntryCount: parsed.pages.map((p) => `${p.pageFile}=${p.entries.length}`).join(" "),
  missingInlineImages: parsed.missingInlineImages.length,
  output: outPath,
};

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  console.error("Summary:", summary);
  process.exit(1);
}

console.log("PASS:", JSON.stringify(summary));
process.exit(0);

function stripClosures(node) {
  if (Array.isArray(node)) return node.map(stripClosures);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "function") continue;
      out[k] = stripClosures(v);
    }
    return out;
  }
  return node;
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}
