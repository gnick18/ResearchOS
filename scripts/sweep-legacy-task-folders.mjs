#!/usr/bin/env node
/*
 * sweep-legacy-task-folders.mjs
 *
 * One-shot sweep for orphan content under the pre-namespacing
 *   <data-folder>/results/task-<id>/
 * directory. The per-user namespacing migration (commit 6112693d) moved each
 * task's notes/results/Images into
 *   <data-folder>/users/<owner>/results/task-<id>/
 * and dropped a `.migrated-from-legacy.json` sentinel at the canonical base.
 * The copy was non-destructive — legacy global retained its content as a
 * fallback during partial-migration risk. That left orphan trees on disk
 * that the gallery's hero-card probe used to scan as a fallback path,
 * surfacing stale images that the popup's per-tab strips never showed.
 *
 * Bug context: 2026-05-20, tasks 37 + 47 surfaced the mismatch (hero card
 * pulled phylogenetic-tree PNGs from legacy global while the Results tab
 * showed no images). Grant fixed those two by hand; this script reconciles
 * the rest.
 *
 * The probe was hardened the same day to drop the legacy candidate when
 * the marker exists, so the user-visible bug is already gone. This script
 * is the disk-tidy follow-up — migrate any unmigrated content to the
 * canonical path and remove the empty legacy directory.
 *
 * Usage:
 *   node scripts/sweep-legacy-task-folders.mjs <data-folder> [--apply] [--verbose]
 *
 * Examples:
 *   # Dry-run (default) — reports what would happen, touches nothing
 *   node scripts/sweep-legacy-task-folders.mjs "$HOME/.../ResearchOS_FungalInteractionsLab"
 *
 *   # Apply for real (only after reviewing the dry-run output)
 *   node scripts/sweep-legacy-task-folders.mjs "$HOME/.../ResearchOS_FungalInteractionsLab" --apply
 *
 * What it does
 * ------------
 * For each `<data-folder>/results/task-<N>/` directory:
 *   1. Find which user(s) own this task ID by checking for
 *      `<data-folder>/users/<owner>/results/task-<N>/.migrated-from-legacy.json`.
 *   2. If exactly ONE owner has the marker, the task is post-migration —
 *      migrate any remaining legacy subdirectories into the canonical path
 *      and remove the legacy folder.
 *      - `Images/*`     → `users/<owner>/results/task-<N>/results/Images/`
 *      - `NotesPDFs/*`  → `users/<owner>/results/task-<N>/NotesPDFs/`
 *      - `ResultsPDFs/*`→ `users/<owner>/results/task-<N>/ResultsPDFs/`
 *      Any other content (notes.md, results.md, Files/, unexpected files)
 *      is REPORTED but never moved — that's manual-review territory.
 *   3. If NO owner has the marker, this is genuine pre-migration data.
 *      Leave it alone; report as PRE_MIGRATION.
 *   4. If MULTIPLE owners have the marker (id-collision pre-namespacing),
 *      this is ambiguous. Leave it alone; report as AMBIGUOUS.
 *
 * Safety
 * ------
 *   - Dry-run is the DEFAULT. You must pass `--apply` to actually move/delete.
 *   - Copies are read+write+verify (size match) before unlink, so a torn
 *     copy can't lose data.
 *   - Legacy folder is only removed when fully empty (after the recognized
 *     migrations). Unrecognized content blocks the removal and gets logged.
 *   - File-name collisions on the destination are suffixed `-1`, `-2`, …
 *     so we never overwrite existing canonical content.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const verbose = args.includes("--verbose");
const positional = args.filter((a) => !a.startsWith("--"));

if (positional.length !== 1) {
  console.error(
    "usage: sweep-legacy-task-folders.mjs <data-folder> [--apply] [--verbose]"
  );
  process.exit(2);
}

const dataRoot = path.resolve(positional[0]);
const dryRun = !apply;

const RECOGNIZED_SUBDIRS = ["Images", "NotesPDFs", "ResultsPDFs"];
const CANONICAL_DEST_FOR = {
  Images: ["results", "Images"], // per-tab Results/Images per the 2026-05-20 pick
  NotesPDFs: ["NotesPDFs"],
  ResultsPDFs: ["ResultsPDFs"],
};

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function sizeOf(p) {
  try {
    const st = await fs.stat(p);
    return st.size;
  } catch {
    return -1;
  }
}

function splitFilenameExt(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

async function pickUniqueFilename(dirPath, desired) {
  const { stem, ext } = splitFilenameExt(desired);
  let candidate = desired;
  let n = 1;
  while (await exists(path.join(dirPath, candidate))) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

async function listChildren(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isEmptyDir(dir) {
  const entries = await listChildren(dir);
  const real = entries.filter((e) => !e.name.startsWith("."));
  return real.length === 0;
}

/** Discover every `<dataRoot>/results/task-<N>/` directory. */
async function findLegacyTaskDirs(root) {
  const legacyResults = path.join(root, "results");
  if (!(await exists(legacyResults))) return [];
  const entries = await listChildren(legacyResults);
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith("task-")) continue;
    const idStr = e.name.slice("task-".length);
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) continue;
    out.push({ id, path: path.join(legacyResults, e.name) });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Find users whose canonical task-N base has the migration marker. */
async function findMigratedOwnersFor(taskId) {
  const usersDir = path.join(dataRoot, "users");
  if (!(await exists(usersDir))) return [];
  const userEntries = await listChildren(usersDir);
  const owners = [];
  for (const u of userEntries) {
    if (!u.isDirectory()) continue;
    if (u.name.startsWith(".") || u.name.startsWith("_")) continue;
    const marker = path.join(
      usersDir,
      u.name,
      "results",
      `task-${taskId}`,
      ".migrated-from-legacy.json"
    );
    if (await exists(marker)) owners.push(u.name);
  }
  return owners;
}

/**
 * Move every file under `srcDir` into `destDir`, suffixing collisions. Returns
 * { moved, failed }. Subdirectories inside `srcDir` are NOT recursed — those
 * surface as unrecognized content one level up (none of the recognized
 * subdirs are nested).
 */
async function migrateFolderContents(srcDir, destDir, label) {
  let entries;
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return { moved: 0, failed: 0, leftover: [] };
  }
  const files = entries.filter((e) => e.isFile() && !e.name.startsWith("."));
  const leftover = entries
    .filter((e) => !e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name);

  let moved = 0;
  let failed = 0;

  if (files.length === 0) {
    if (verbose) console.log(`    ${label}: empty`);
    return { moved, failed, leftover };
  }

  if (!dryRun) await fs.mkdir(destDir, { recursive: true });

  for (const f of files) {
    const src = path.join(srcDir, f.name);
    const desiredName = f.name;
    try {
      let finalName = desiredName;
      let dst = path.join(destDir, finalName);
      if (!dryRun) {
        finalName = await pickUniqueFilename(destDir, desiredName);
        dst = path.join(destDir, finalName);
      } else if (await exists(dst)) {
        // Predict the collision-resolved name for the dry-run log so the
        // user can see what would actually happen.
        finalName = await pickUniqueFilename(destDir, desiredName);
        dst = path.join(destDir, finalName);
      }

      if (dryRun) {
        console.log(
          `    [dry-run] ${label}: would move ${path.relative(dataRoot, src)} -> ${path.relative(dataRoot, dst)}`
        );
        moved += 1;
        continue;
      }

      const srcSize = await sizeOf(src);
      await fs.copyFile(src, dst);
      const dstSize = await sizeOf(dst);
      if (srcSize !== dstSize) {
        console.error(
          `    ${label}: FAILED size mismatch on ${src} (src=${srcSize}, dst=${dstSize}) — leaving source in place`
        );
        try {
          await fs.unlink(dst);
        } catch {
          /* leave the bad copy; user can clean it up */
        }
        failed += 1;
        continue;
      }
      await fs.unlink(src);
      moved += 1;
      if (verbose) {
        console.log(
          `    ${label}: moved ${path.relative(dataRoot, src)} -> ${path.relative(dataRoot, dst)}`
        );
      }
    } catch (err) {
      console.error(`    ${label}: FAILED ${src}: ${err.message}`);
      failed += 1;
    }
  }

  return { moved, failed, leftover };
}

async function sweepOne({ id, path: legacyDir }) {
  const owners = await findMigratedOwnersFor(id);
  const rel = path.relative(dataRoot, legacyDir);

  if (owners.length === 0) {
    console.log(
      `task-${id}: PRE_MIGRATION — no .migrated-from-legacy.json marker for any user. Leaving legacy in place at ${rel}`
    );
    return { status: "pre_migration", moved: 0, failed: 0, removed: false };
  }
  if (owners.length > 1) {
    console.log(
      `task-${id}: AMBIGUOUS — multiple users have the marker (${owners.join(", ")}). Manual review required. Leaving ${rel} in place`
    );
    return { status: "ambiguous", moved: 0, failed: 0, removed: false };
  }

  const owner = owners[0];
  const canonicalBase = path.join(
    dataRoot,
    "users",
    owner,
    "results",
    `task-${id}`
  );

  let totalMoved = 0;
  let totalFailed = 0;
  const actions = [];
  // In dry-run nothing actually disappears, so track which subdirs WOULD be
  // emptied by a successful run to predict whether the legacy folder would
  // be removable.
  const wouldRemoveSubdirs = new Set();

  for (const sub of RECOGNIZED_SUBDIRS) {
    const srcDir = path.join(legacyDir, sub);
    if (!(await exists(srcDir))) continue;
    if (await isEmptyDir(srcDir)) {
      wouldRemoveSubdirs.add(sub);
      if (!dryRun) {
        try {
          await fs.rmdir(srcDir);
          if (verbose) console.log(`    ${sub}: removed empty dir`);
        } catch {
          /* not actually empty, fall through */
        }
      }
      continue;
    }
    const destDir = path.join(canonicalBase, ...CANONICAL_DEST_FOR[sub]);
    const result = await migrateFolderContents(srcDir, destDir, sub);
    totalMoved += result.moved;
    totalFailed += result.failed;
    if (result.leftover.length > 0) {
      console.log(
        `    ${sub}: UNRECOGNIZED nested directories left in place: ${result.leftover.join(", ")}`
      );
    } else if (result.failed === 0) {
      // All files would move and no nested dirs remain — the subdir is
      // empty after a clean run.
      wouldRemoveSubdirs.add(sub);
    }
    actions.push(`${sub} (${result.moved}${result.failed ? `, ${result.failed} failed` : ""})`);
    if (!dryRun) {
      try {
        if (await isEmptyDir(srcDir)) await fs.rmdir(srcDir);
      } catch {
        /* leave it */
      }
    }
  }

  // Anything still left at the top of the legacy dir blocks removal. In
  // dry-run we project the post-migration state by ignoring subdirs we
  // would have cleared.
  const remaining = await listChildren(legacyDir);
  const realRemaining = remaining.filter((e) => {
    if (e.name.startsWith(".")) return false;
    if (dryRun && e.isDirectory() && wouldRemoveSubdirs.has(e.name)) return false;
    return true;
  });

  if (realRemaining.length === 0) {
    if (dryRun) {
      console.log(
        `task-${id}: owner=${owner} — ${actions.length === 0 ? "no orphans" : actions.join(", ")} + would remove empty legacy ${rel}`
      );
    } else {
      try {
        // Drop any leftover dotfiles (e.g. .DS_Store) so rmdir succeeds.
        for (const e of remaining) {
          if (e.isFile() && e.name.startsWith(".")) {
            try {
              await fs.unlink(path.join(legacyDir, e.name));
            } catch {
              /* best-effort */
            }
          }
        }
        await fs.rmdir(legacyDir);
        console.log(
          `task-${id}: owner=${owner} — ${actions.length === 0 ? "no orphans" : actions.join(", ")}; removed legacy ${rel}`
        );
      } catch (err) {
        console.log(
          `task-${id}: owner=${owner} — ${actions.length === 0 ? "no orphans" : actions.join(", ")}; legacy ${rel} NOT removed (${err.message})`
        );
        return {
          status: "partial",
          moved: totalMoved,
          failed: totalFailed + 1,
          removed: false,
        };
      }
    }
    return {
      status: "swept",
      moved: totalMoved,
      failed: totalFailed,
      removed: !dryRun,
    };
  }

  // Unrecognized content blocks removal.
  const leftover = realRemaining.map(
    (e) => `${e.name}${e.isDirectory() ? "/" : ""}`
  );
  console.log(
    `task-${id}: owner=${owner} — UNRECOGNIZED content blocks removal: ${leftover.join(", ")}. Legacy ${rel} left in place${actions.length ? ` (already migrated: ${actions.join(", ")})` : ""}`
  );
  return {
    status: "unrecognized",
    moved: totalMoved,
    failed: totalFailed,
    removed: false,
  };
}

async function main() {
  if (!(await exists(dataRoot))) {
    console.error(`Data folder does not exist: ${dataRoot}`);
    process.exit(1);
  }

  const legacyDirs = await findLegacyTaskDirs(dataRoot);
  console.log(
    `${dryRun ? "[dry-run] " : ""}Sweeping ${legacyDirs.length} legacy task folder(s) under ${path.relative(process.cwd(), dataRoot)}/results/`
  );
  if (legacyDirs.length === 0) {
    console.log("(nothing to do)");
    return;
  }

  const totals = {
    swept: 0,
    pre_migration: 0,
    ambiguous: 0,
    unrecognized: 0,
    partial: 0,
    moved: 0,
    failed: 0,
    removed: 0,
  };

  for (const entry of legacyDirs) {
    const r = await sweepOne(entry);
    totals[r.status] = (totals[r.status] ?? 0) + 1;
    totals.moved += r.moved;
    totals.failed += r.failed;
    if (r.removed) totals.removed += 1;
  }

  console.log("");
  console.log("Summary:");
  console.log(`  scanned:           ${legacyDirs.length}`);
  console.log(`  swept:             ${totals.swept}`);
  console.log(`  pre-migration:     ${totals.pre_migration} (no marker, left alone)`);
  console.log(`  ambiguous:         ${totals.ambiguous} (multiple owners with marker)`);
  console.log(`  unrecognized:      ${totals.unrecognized} (untouched content blocks removal)`);
  console.log(`  partial:           ${totals.partial} (rmdir failed)`);
  console.log(`  files moved:       ${totals.moved}`);
  console.log(`  file ops failed:   ${totals.failed}`);
  console.log(`  legacy dirs gone:  ${totals.removed}`);
  if (dryRun) {
    console.log("");
    console.log("(dry run — nothing was written. Re-run with --apply to commit changes.)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
