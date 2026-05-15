#!/usr/bin/env node
/**
 * Backfill `vendor` and `category` on existing PurchaseItem JSON files.
 *
 * Usage:
 *   node scripts/backfill-purchase-vendors.mjs --data-dir <path>
 *                                             [--dry-run] [--apply]
 *                                             [--force]
 *                                             [--verbose-sample [N]]
 *
 * What it does
 * ------------
 * Walks `<data-dir>/users/<u>/purchase_items/*.json` for every user, and
 * for each PurchaseItem JSON:
 *   - if `vendor` is null and the item has a `link`, derive a canonical
 *     vendor from the link's hostname via VENDOR_HOSTNAME_MAP and set it
 *   - if `category` is null, derive a canonical category from item_name
 *     via CATEGORY_PATTERN_MAP and set it
 *
 * Mode flags
 * ----------
 *   --dry-run  Default. Reports what would change without writing.
 *   --apply    Required to actually write back to disk.
 *   --force    Overwrite existing non-null values. Use after improving
 *              the mapping tables when you want to re-tag previously
 *              filled rows.
 *   --verbose-sample [N]  Print up to N (default 3) redacted sample
 *              changes. Items appear as `item_<id>` — never by name.
 *
 * Idempotency
 * -----------
 * Re-running with the same --data-dir is a no-op once the heuristic has
 * converged: the first pass sets nullable fields, subsequent passes see
 * non-null values and skip. `--force` re-runs are stable too — the same
 * hostname / regex always maps to the same canonical value.
 *
 * Privacy
 * -------
 * Grant's real-data folder contains unpublished research. This script
 * NEVER echoes item names, link URLs, vendor strings derived from real
 * items, or note content to stdout in default mode. Aggregate counts
 * only. `--verbose-sample` prints redacted samples (`item_<id>`) for
 * spot-checking; no item names or full links are surfaced even there.
 *
 * Extending the heuristic
 * -----------------------
 * Both tables live in `scripts/lib/vendor-category-heuristics.mjs`.
 * Append new entries to grow coverage. Pattern order matters in
 * CATEGORY_PATTERN_MAP — first match wins, so specific keywords
 * (Equipment, Service) sit above broader catch-alls (Plasticware,
 * Consumables).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferVendorFromLink,
  inferCategoryFromName,
  VENDOR_HOSTNAME_MAP,
  CATEGORY_PATTERN_MAP,
} from "./lib/vendor-category-heuristics.mjs";

// ── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    dataDir: null,
    dryRun: false,
    apply: false,
    force: false,
    verboseSample: false,
    verboseSampleN: 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir") {
      opts.dataDir = argv[++i] ?? null;
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    } else if (a === "--apply") {
      opts.apply = true;
    } else if (a === "--force") {
      opts.force = true;
    } else if (a === "--verbose-sample") {
      opts.verboseSample = true;
      // Next arg may be a count or another flag.
      const next = argv[i + 1];
      if (next != null && /^\d+$/.test(next)) {
        opts.verboseSampleN = parseInt(next, 10);
        i++;
      }
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    } else {
      opts.unknown = a;
      return opts;
    }
  }
  return opts;
}

function printUsage() {
  process.stdout.write(
    `Usage: node scripts/backfill-purchase-vendors.mjs --data-dir <path> [--dry-run] [--apply] [--force] [--verbose-sample [N]]\n`,
  );
}

// ── Filesystem walker ───────────────────────────────────────────────────────

/**
 * Yield absolute paths of every `purchase_items/*.json` file under
 * `<rootDir>/users/<user>/`. Tolerant of missing `purchase_items` dirs
 * (a user with no purchases is silently skipped).
 */
export async function walkPurchaseItemFiles(rootDir) {
  const usersDir = path.join(rootDir, "users");
  let userEntries;
  try {
    userEntries = await fs.readdir(usersDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(`Data dir has no users/ subdirectory: ${rootDir}`);
    }
    throw err;
  }
  const files = [];
  for (const userEntry of userEntries) {
    if (!userEntry.isDirectory()) continue;
    const piDir = path.join(usersDir, userEntry.name, "purchase_items");
    let entries;
    try {
      entries = await fs.readdir(piDir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(path.join(piDir, entry.name));
      }
    }
  }
  files.sort();
  return files;
}

// ── Per-file processing ─────────────────────────────────────────────────────

/**
 * Decide what (if anything) should change on a single PurchaseItem record.
 * Returns { vendor, category } where each is either a new string value to
 * set, undefined to leave alone, or null to leave alone (no inference).
 *
 * Exported for testing.
 */
export function planChanges(item, { force }) {
  const plan = { vendor: undefined, category: undefined };

  const vendorEmpty = item.vendor == null;
  if (force || vendorEmpty) {
    const inferred = inferVendorFromLink(item.link);
    if (inferred != null && inferred !== item.vendor) {
      plan.vendor = inferred;
    }
  }

  const categoryEmpty = item.category == null;
  if (force || categoryEmpty) {
    const inferred = inferCategoryFromName(item.item_name);
    if (inferred != null && inferred !== item.category) {
      plan.category = inferred;
    }
  }

  return plan;
}

// ── Main driver ─────────────────────────────────────────────────────────────

async function run(opts) {
  if (!opts.dataDir) {
    process.stderr.write("Error: --data-dir is required.\n");
    printUsage();
    return 1;
  }

  const writeMode = opts.apply === true;
  // Default behavior: dry-run unless --apply is explicit.
  const dryRun = !writeMode;

  const counts = {
    scanned: 0,
    parseErrors: 0,
    wouldUpdateVendor: 0,
    wouldUpdateCategory: 0,
    skippedVendorAlreadySet: 0,
    skippedVendorNoLink: 0,
    skippedVendorNoMatch: 0,
    skippedCategoryAlreadySet: 0,
    skippedCategoryNoMatch: 0,
    filesChanged: 0,
    filesUnchanged: 0,
    writeErrors: 0,
  };

  const samples = [];

  let files;
  try {
    files = await walkPurchaseItemFiles(opts.dataDir);
  } catch (err) {
    process.stderr.write(`Error walking data dir: ${err.message}\n`);
    return 1;
  }

  for (const file of files) {
    counts.scanned++;
    let item;
    try {
      const text = await fs.readFile(file, "utf8");
      item = JSON.parse(text);
    } catch (err) {
      counts.parseErrors++;
      // Path is intentionally NOT logged — could reveal usernames.
      process.stderr.write(`Parse error in one file (count tracked).\n`);
      continue;
    }

    // Track skip reasons before computing plan.
    const vendorAlreadySet = item.vendor != null;
    const categoryAlreadySet = item.category != null;
    if (vendorAlreadySet && !opts.force) counts.skippedVendorAlreadySet++;
    if (categoryAlreadySet && !opts.force) counts.skippedCategoryAlreadySet++;

    const plan = planChanges(item, { force: opts.force });

    // Refine vendor skip-reason for null-vendor cases that still got no match.
    if (!vendorAlreadySet || opts.force) {
      if (plan.vendor === undefined) {
        const host = item.link;
        if (host == null || host === "") counts.skippedVendorNoLink++;
        else counts.skippedVendorNoMatch++;
      }
    }
    if (!categoryAlreadySet || opts.force) {
      if (plan.category === undefined) counts.skippedCategoryNoMatch++;
    }

    const hasChange = plan.vendor !== undefined || plan.category !== undefined;
    if (!hasChange) {
      counts.filesUnchanged++;
      continue;
    }

    if (plan.vendor !== undefined) counts.wouldUpdateVendor++;
    if (plan.category !== undefined) counts.wouldUpdateCategory++;
    counts.filesChanged++;

    if (samples.length < opts.verboseSampleN) {
      samples.push({
        id: item.id,
        vendor: plan.vendor,
        category: plan.category,
      });
    }

    if (!dryRun) {
      const next = { ...item };
      if (plan.vendor !== undefined) next.vendor = plan.vendor;
      if (plan.category !== undefined) next.category = plan.category;
      try {
        await fs.writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
      } catch (err) {
        counts.writeErrors++;
        process.stderr.write(`Write error in one file (count tracked).\n`);
      }
    }
  }

  // ── Output (aggregate only) ───────────────────────────────────────────────
  const verb = dryRun ? "Would update" : "Updated";
  const w = (s) => process.stdout.write(s + "\n");

  w(`Mode: ${dryRun ? "DRY RUN" : "APPLY"}${opts.force ? " (--force)" : ""}`);
  w(`Scanned ${counts.scanned} purchase items in ${opts.dataDir}`);
  w(`${verb}: ${counts.wouldUpdateVendor} items (vendor), ${counts.wouldUpdateCategory} items (category)`);
  w(`Files ${dryRun ? "that would change" : "changed"}: ${counts.filesChanged}`);
  w(`Files unchanged: ${counts.filesUnchanged}`);
  w(`Skipped (vendor already set): ${counts.skippedVendorAlreadySet}`);
  w(`Skipped (vendor: no link to derive from): ${counts.skippedVendorNoLink}`);
  w(`Skipped (vendor: link hostname not in mapping): ${counts.skippedVendorNoMatch}`);
  w(`Skipped (category already set): ${counts.skippedCategoryAlreadySet}`);
  w(`Skipped (category: no pattern matched item_name): ${counts.skippedCategoryNoMatch}`);
  w(`Mapping coverage: ${VENDOR_HOSTNAME_MAP.length} vendor patterns, ${CATEGORY_PATTERN_MAP.length} category patterns`);
  if (counts.parseErrors > 0) w(`Parse errors: ${counts.parseErrors}`);
  if (counts.writeErrors > 0) w(`Write errors: ${counts.writeErrors}`);

  if (opts.verboseSample && samples.length > 0) {
    w(``);
    w(`Sample changes (redacted, first ${samples.length}):`);
    for (const s of samples) {
      const parts = [];
      if (s.vendor !== undefined) parts.push(`vendor=${s.vendor}`);
      if (s.category !== undefined) parts.push(`category=${s.category}`);
      w(`  item_${s.id}: ${parts.join(", ")}`);
    }
  }

  if (dryRun && (counts.wouldUpdateVendor > 0 || counts.wouldUpdateCategory > 0)) {
    w(``);
    w(`Re-run with --apply to write changes.`);
  }

  return counts.parseErrors > 0 || counts.writeErrors > 0 ? 1 : 0;
}

// ── Entrypoint ──────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    process.exit(0);
  }
  if (opts.unknown) {
    process.stderr.write(`Unknown argument: ${opts.unknown}\n`);
    printUsage();
    process.exit(2);
  }
  if (opts.apply && opts.dryRun) {
    process.stderr.write(`Pass either --dry-run or --apply, not both.\n`);
    process.exit(2);
  }
  run(opts).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`Unhandled error: ${err.message}\n`);
      process.exit(1);
    },
  );
}

export { run, parseArgs };
