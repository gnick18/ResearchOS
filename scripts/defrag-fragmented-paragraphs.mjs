#!/usr/bin/env node
/*
 * defrag-fragmented-paragraphs.mjs
 *
 * One-shot helper that defragments paragraphs that earlier hybrid-editor
 * bugs split when the user meant them to stay one thought. The v1 hybrid
 * editor would sometimes drop the user from edit mode (paste / blank-line
 * focus loss / wrap-with-newlines cursor jump), and the user would press
 * Enter to keep going, which inserted a `\n\n` paragraph break the parser
 * then surfaced as two separate blocks. Hybrid v2 (chip-1) addresses the
 * root cause: plain Enter now inserts a CommonMark soft break (`  \n`)
 * which the parser keeps inside one paragraph. This script fixes the
 * accumulated damage in past notes by converting high-confidence cases of
 * `\n\n` between accidentally-split paragraphs into the new `  \n` form.
 *
 * Usage:
 *   node scripts/defrag-fragmented-paragraphs.mjs <data-folder> [--write] [--verbose]
 *
 * Default behaviour is dry-run: prints every candidate merge with three
 * lines of context, no files touched. With --write each modified file is
 * backed up next to itself as <name>.bak before the new content lands.
 *
 * Heuristic, deliberately conservative to avoid lossy false positives:
 *   1. Both adjacent blocks must be paragraphs. Headings, lists,
 *      blockquotes, code fences, tables, hrs, and HTML blocks are skipped.
 *   2. The first paragraph's last non-whitespace char must be a letter
 *      (no terminal punctuation `. ! ? : ; " ) ]`, no trailing comma).
 *   3. The second paragraph's first non-whitespace char must be lowercase.
 *   4. Both blocks must look like prose: trimmed length >= 30 chars AND
 *      at least one internal space. This excludes PCR-recipe entries
 *      ("11 ul" + "pFC902" + "water" + "10s" + "x 35") that happen to
 *      end in letters and start lowercase but are clearly single-token
 *      lab data, not accidentally split prose.
 *   5. Content inside fenced code blocks is never inspected.
 *
 * If either side fails the test the `\n\n` boundary is preserved.
 *
 * Safety:
 *   - --write creates `<file>.bak` next to each modified file before
 *     overwriting. If you have already backed up the data folder via
 *     OneDrive history / Time Machine / git, you can delete those `.bak`
 *     files afterwards.
 *   - Re-running the script on already-defragmented content is a no-op:
 *     the heuristic only fires on `\n\n` boundaries, never on `  \n`.
 *   - Run with --write only after reviewing a dry-run output you trust.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const write = args.includes("--write");
const verbose = args.includes("--verbose");
const positional = args.filter((a) => !a.startsWith("--"));

if (positional.length !== 1) {
  console.error(
    "usage: defrag-fragmented-paragraphs.mjs <data-folder> [--write] [--verbose]"
  );
  process.exit(2);
}

const dataRoot = path.resolve(positional[0]);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Walk `users/<owner>/results/task-N/` and return every notes.md / results.md. */
async function findNoteFiles(root) {
  const usersDir = path.join(root, "users");
  if (!(await exists(usersDir))) return [];
  const out = [];
  const userEntries = await fs.readdir(usersDir, { withFileTypes: true });
  for (const u of userEntries) {
    if (!u.isDirectory()) continue;
    if (u.name.startsWith(".") || u.name.startsWith("_")) continue;
    const resultsDir = path.join(usersDir, u.name, "results");
    if (!(await exists(resultsDir))) continue;
    const taskEntries = await fs.readdir(resultsDir, { withFileTypes: true });
    for (const t of taskEntries) {
      if (!t.isDirectory()) continue;
      if (!t.name.startsWith("task-")) continue;
      for (const name of ["notes.md", "results.md"]) {
        const f = path.join(resultsDir, t.name, name);
        if (await exists(f)) out.push(f);
      }
    }
  }
  return out;
}

/**
 * Split markdown into top-level blocks separated by blank lines, while
 * keeping fenced code regions intact so a stray `  \n` inside a code
 * sample never gets rewritten. Returns an array of strings (the blocks)
 * plus the separators between them as preserved-verbatim entries.
 *
 * The model: for each newline-delimited line, detect fenced code state
 * transitions; outside a fence, blank lines are block boundaries.
 */
function splitIntoBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let cur = [];
  let inFence = false;
  let fenceMarker = "";
  for (const line of lines) {
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1][0];
      } else if (line.startsWith(fenceMarker.repeat(3))) {
        inFence = false;
        fenceMarker = "";
      }
      cur.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      // blank line; flush the current block if non-empty
      if (cur.length > 0) {
        blocks.push({ kind: "block", text: cur.join("\n") });
        cur = [];
      }
      // Use a separator marker so we can rebuild faithfully.
      blocks.push({ kind: "sep", text: "" });
      continue;
    }
    cur.push(line);
  }
  if (cur.length > 0) {
    blocks.push({ kind: "block", text: cur.join("\n") });
  }
  return blocks;
}

/**
 * Collapse consecutive `sep` entries into a single `sep` and trim leading
 * / trailing separators. Result alternates block / sep / block / sep ...
 */
function normalizeBlocks(parts) {
  const out = [];
  let pendingSep = false;
  for (const p of parts) {
    if (p.kind === "sep") {
      pendingSep = true;
      continue;
    }
    if (out.length > 0 && pendingSep) out.push({ kind: "sep", text: "" });
    pendingSep = false;
    out.push(p);
  }
  return out;
}

/** Return true if a block is a plain paragraph (not heading, list, code, etc.). */
function isParagraphBlock(blockText) {
  if (!blockText) return false;
  const firstLine = blockText.split("\n")[0].trimStart();
  if (!firstLine) return false;
  // Heading
  if (/^#{1,6}\s/.test(firstLine)) return false;
  // Unordered list
  if (/^[-*+]\s/.test(firstLine)) return false;
  // Ordered list
  if (/^\d+[.)]\s/.test(firstLine)) return false;
  // Blockquote
  if (/^>/.test(firstLine)) return false;
  // Fenced code
  if (/^(```|~~~)/.test(firstLine)) return false;
  // Table separator on its own would not be a first line, but a header
  // pipe row would. Be conservative: skip anything starting with a pipe.
  if (/^\|/.test(firstLine)) return false;
  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(firstLine)) return false;
  // HTML block (raw tag at column 0)
  if (/^<[a-zA-Z!]/.test(firstLine)) return false;
  return true;
}

/** Last non-whitespace character of a block. */
function lastChar(s) {
  const trimmed = s.replace(/\s+$/, "");
  return trimmed.length > 0 ? trimmed[trimmed.length - 1] : "";
}

/** First non-whitespace character of a block. */
function firstChar(s) {
  const trimmed = s.replace(/^\s+/, "");
  return trimmed.length > 0 ? trimmed[0] : "";
}

/**
 * Decide whether the boundary between two adjacent paragraph blocks looks
 * like accidental fragmentation. The rule (deliberately tight): first
 * block ends in a letter, second block starts with a lowercase letter.
 */
const PROSE_MIN_CHARS = 30;

function looksFragmented(prevBlock, nextBlock) {
  if (!isParagraphBlock(prevBlock) || !isParagraphBlock(nextBlock)) return false;
  const last = lastChar(prevBlock);
  const first = firstChar(nextBlock);
  if (!last || !first) return false;
  const lastIsLetter = /[a-zA-Z]/.test(last);
  const firstIsLowercase = /[a-z]/.test(first);
  if (!lastIsLetter || !firstIsLowercase) return false;
  // Prose gate: short single-token blocks (lab measurements like "11 ul",
  // reagent names like "pFC902", PCR multipliers like "x 35") are excluded
  // even though they pass the letter / lowercase check. Real prose
  // fragmentation has multi-word content on both sides.
  const prevTrim = prevBlock.trim();
  const nextTrim = nextBlock.trim();
  if (prevTrim.length < PROSE_MIN_CHARS || nextTrim.length < PROSE_MIN_CHARS) {
    return false;
  }
  if (!prevTrim.includes(" ") || !nextTrim.includes(" ")) return false;
  return true;
}

/**
 * Rewrite a file's content, replacing `\n\n` boundaries that match the
 * fragmentation heuristic with `  \n`. Returns { newText, merges } where
 * `merges` is an array of { prevTail, nextHead } context strings for
 * dry-run reporting.
 */
function defragText(text) {
  const parts = normalizeBlocks(splitIntoBlocks(text));
  const merges = [];
  for (let i = 1; i < parts.length - 1; i++) {
    if (parts[i].kind !== "sep") continue;
    const prev = parts[i - 1];
    const next = parts[i + 1];
    if (prev.kind !== "block" || next.kind !== "block") continue;
    if (!looksFragmented(prev.text, next.text)) continue;
    // Mark this separator for soft-break replacement.
    parts[i] = { kind: "softbreak", text: "" };
    const prevLines = prev.text.split("\n");
    const nextLines = next.text.split("\n");
    merges.push({
      prevTail: prevLines[prevLines.length - 1],
      nextHead: nextLines[0],
    });
  }
  // Rebuild.
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.kind === "block") {
      out += p.text;
    } else if (p.kind === "sep") {
      out += "\n\n";
    } else if (p.kind === "softbreak") {
      // Defragmented: the previous paragraph's trailing newline becomes
      // a CommonMark soft break, then a single newline starts the next.
      out += "  \n";
    }
  }
  return { newText: out, merges };
}

function relPath(p) {
  return path.relative(dataRoot, p);
}

async function processOne(file) {
  const original = await fs.readFile(file, "utf8");
  const { newText, merges } = defragText(original);
  if (merges.length === 0) return { file, merges: 0, changed: false };
  if (verbose || !write) {
    console.log(`\n${relPath(file)}  (${merges.length} merge${merges.length === 1 ? "" : "s"})`);
    for (const m of merges) {
      const tail = m.prevTail.length > 80 ? "…" + m.prevTail.slice(-79) : m.prevTail;
      const head = m.nextHead.length > 80 ? m.nextHead.slice(0, 79) + "…" : m.nextHead;
      console.log(`  - …${tail}`);
      console.log(`    ↳ ${head}`);
    }
  }
  if (write) {
    const backup = file + ".bak";
    await fs.writeFile(backup, original, "utf8");
    await fs.writeFile(file, newText, "utf8");
  }
  return { file, merges: merges.length, changed: true };
}

async function main() {
  if (!(await exists(dataRoot))) {
    console.error(`Data folder not found: ${dataRoot}`);
    process.exit(1);
  }
  const files = await findNoteFiles(dataRoot);
  console.log(
    `Scanning ${files.length} note/results file${files.length === 1 ? "" : "s"} under ${dataRoot}`
  );
  console.log(write ? "Mode: WRITE (will modify files; .bak backups will be created)" : "Mode: DRY-RUN (no files will be touched)");
  let totalFiles = 0;
  let totalMerges = 0;
  for (const f of files) {
    const r = await processOne(f);
    if (r.changed) {
      totalFiles += 1;
      totalMerges += r.merges;
    }
  }
  console.log(
    `\nSummary: ${totalMerges} fragmentation merge${totalMerges === 1 ? "" : "s"} across ${totalFiles} file${totalFiles === 1 ? "" : "s"}.`
  );
  if (!write && totalMerges > 0) {
    console.log("Review the merges above. To apply, re-run with --write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
