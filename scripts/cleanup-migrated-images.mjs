#!/usr/bin/env node
/*
 * cleanup-migrated-images.mjs
 *
 * After the in-app migration has copied per-user images into a target dir
 * (e.g. `results/task-{id}/Images/` or `methods/{slug}/Images/`) and recorded
 * the move in `.migrated-images.json` next to the markdown file, this script:
 *   1. Bundles every file slated for removal into a single zip on your Desktop
 *      (so there's a recoverable copy even if something looks wrong later).
 *   2. Deletes the originals.
 *
 * Usage:
 *   node scripts/cleanup-migrated-images.mjs <data-folder> [--dry-run] [--prune-empty-dirs] [--no-backup]
 *
 * Examples:
 *   node scripts/cleanup-migrated-images.mjs "$HOME/Library/CloudStorage/.../ResearchOS_FungalInteractionsLab" --dry-run
 *   node scripts/cleanup-migrated-images.mjs "$HOME/.../ResearchOS_FungalInteractionsLab" --prune-empty-dirs
 *
 * Safety:
 *   - Backup zip is created BEFORE any deletion. Zip lives at
 *     ~/Desktop/ResearchOS-image-backup-<timestamp>.zip with a sibling
 *     ResearchOS-image-backup-<timestamp>.manifest.json listing exact paths.
 *   - Each original is only deleted if the recorded destination still exists
 *     AND its byte-length matches the original.
 *   - --dry-run prints what would happen without touching the filesystem
 *     (no backup, no delete).
 *   - --prune-empty-dirs removes parent directories that become empty after
 *     deletion. Off by default.
 *   - --no-backup skips the backup zip (only use if you're already sure).
 */

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const pruneEmpty = args.includes("--prune-empty-dirs");
const noBackup = args.includes("--no-backup");
const positional = args.filter((a) => !a.startsWith("--"));

if (positional.length !== 1) {
  console.error("usage: cleanup-migrated-images.mjs <data-folder> [--dry-run] [--prune-empty-dirs] [--no-backup]");
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

async function sizeOf(p) {
  try {
    const st = await fs.stat(p);
    return st.size;
  } catch {
    return null;
  }
}

/**
 * Find `.migrated-images.json` files inside the immediate children of `parent`.
 * `nameFilter` lets the caller restrict which child dirs are inspected
 * (e.g. only `task-*` under `results/`); pass `null` to inspect all children
 * (used for `methods/`, where the dirname is the method slug).
 */
async function findManifestsIn(parent, nameFilter) {
  if (!(await exists(parent))) return [];
  const out = [];
  const entries = await fs.readdir(parent, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (nameFilter && !nameFilter(e.name)) continue;
    const manifestPath = path.join(parent, e.name, ".migrated-images.json");
    if (await exists(manifestPath)) out.push(manifestPath);
  }
  return out;
}

async function readManifest(p) {
  try {
    const raw = await fs.readFile(p, "utf-8");
    const json = JSON.parse(raw);
    if (!Array.isArray(json?.entries)) return null;
    return json;
  } catch {
    return null;
  }
}

async function pruneAncestors(filePath, stopAt) {
  let dir = path.dirname(filePath);
  while (dir.startsWith(stopAt) && dir !== stopAt) {
    let items;
    try {
      items = await fs.readdir(dir);
    } catch {
      break;
    }
    if (items.length > 0) break;
    if (dryRun) {
      console.log(`[dry-run] rmdir ${path.relative(dataRoot, dir)}`);
    } else {
      try {
        await fs.rmdir(dir);
        console.log(`removed empty dir ${path.relative(dataRoot, dir)}`);
      } catch {
        break;
      }
    }
    dir = path.dirname(dir);
  }
}

/**
 * Run `zip` (BSD/macOS or Info-ZIP) with the given relative file list, working
 * from `cwd`. Returns when the process exits. Throws on non-zero exit.
 *
 * Relative paths are passed via stdin (`zip -@`) to avoid argv length limits.
 */
function runZip(cwd, zipPath, relativePaths) {
  return new Promise((resolve, reject) => {
    const proc = spawn("zip", ["-r", "-@", "--symlinks", zipPath], { cwd, stdio: ["pipe", "inherit", "inherit"] });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`zip exited with code ${code}`));
    });
    proc.stdin.end(relativePaths.join("\n") + "\n");
  });
}

/**
 * Build the Desktop backup zip. Returns the absolute path of the zip, or null
 * if there was nothing to back up.
 */
async function createBackupZip(eligibleEntries) {
  if (eligibleEntries.length === 0) return null;
  const desktop = path.join(os.homedir(), "Desktop");
  if (!(await exists(desktop))) {
    throw new Error(`Desktop folder not found at ${desktop}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  const zipPath = path.join(desktop, `ResearchOS-image-backup-${stamp}.zip`);
  const manifestPath = path.join(desktop, `ResearchOS-image-backup-${stamp}.manifest.json`);

  // Convert absolute originalPath strings into paths relative to dataRoot so
  // the zip preserves the same `users/{user}/Images/...` layout you'd expect.
  const relPaths = eligibleEntries.map((e) => e.originalPath);

  console.log(`Backing up ${relPaths.length} file(s) → ${zipPath}`);
  await runZip(dataRoot, zipPath, relPaths);

  // Sanity check: zip should now exist and be non-empty
  const zipSize = await sizeOf(zipPath);
  if (!zipSize || zipSize === 0) {
    throw new Error("Backup zip is missing or empty — refusing to proceed.");
  }

  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        dataRoot,
        zipPath,
        zipSizeBytes: zipSize,
        fileCount: relPaths.length,
        entries: eligibleEntries,
      },
      null,
      2
    )
  );
  console.log(`Wrote manifest ${manifestPath}`);
  return zipPath;
}

async function main() {
  if (!(await exists(dataRoot))) {
    console.error(`data folder not found: ${dataRoot}`);
    process.exit(1);
  }

  const resultsManifests = await findManifestsIn(path.join(dataRoot, "results"), (name) => name.startsWith("task-"));
  const methodsManifests = await findManifestsIn(path.join(dataRoot, "methods"), null);
  const manifests = [...resultsManifests, ...methodsManifests];
  if (manifests.length === 0) {
    console.log("no migration manifests found — nothing to do.");
    return;
  }

  // ── First pass: figure out what's actually deletable.
  // We need the eligible list BEFORE deletion so we can zip-back-up first.
  const plan = []; // { taskLabel, originalAbs, newAbs, entry }
  let alreadyGone = 0;
  let missingNew = 0;
  let sizeMismatch = 0;

  for (const manifestPath of manifests) {
    const manifest = await readManifest(manifestPath);
    if (!manifest) continue;
    // Prefer the directory name (e.g. `task-5`, `test-pcr`) as the label since
    // it's the most readable for both task and method manifests.
    const taskLabel = path.basename(path.dirname(manifestPath));

    for (const entry of manifest.entries) {
      const originalAbs = path.join(dataRoot, entry.originalPath);
      const newAbs = path.join(dataRoot, entry.newPath);

      if (!(await exists(originalAbs))) {
        alreadyGone += 1;
        continue;
      }
      if (!(await exists(newAbs))) {
        missingNew += 1;
        console.warn(`[${taskLabel}] SKIP ${entry.originalPath} — destination ${entry.newPath} missing`);
        continue;
      }
      const [a, b] = await Promise.all([sizeOf(originalAbs), sizeOf(newAbs)]);
      if (a !== null && b !== null && a !== b) {
        sizeMismatch += 1;
        console.warn(`[${taskLabel}] SKIP ${entry.originalPath} — size differs (${a} vs ${b})`);
        continue;
      }
      plan.push({ taskLabel, originalAbs, entry });
    }
  }

  if (plan.length === 0) {
    console.log("\nNothing eligible for deletion — all originals already removed or skipped.");
    console.log(`  manifests:        ${manifests.length}`);
    console.log(`  already gone:     ${alreadyGone}`);
    console.log(`  missing dest:     ${missingNew}`);
    console.log(`  size mismatch:    ${sizeMismatch}`);
    return;
  }

  // ── Backup phase
  let backupZipPath = null;
  if (dryRun) {
    console.log(`[dry-run] would back up ${plan.length} file(s) to ~/Desktop/ResearchOS-image-backup-<timestamp>.zip`);
  } else if (noBackup) {
    console.log("--no-backup specified, skipping zip backup.");
  } else {
    try {
      backupZipPath = await createBackupZip(plan.map((p) => p.entry));
    } catch (err) {
      console.error(`Backup failed: ${err.message}`);
      console.error("Refusing to delete originals without a successful backup. Use --no-backup to override.");
      process.exit(1);
    }
  }

  // ── Deletion phase
  let deleted = 0;
  for (const { taskLabel, originalAbs, entry } of plan) {
    if (dryRun) {
      console.log(`[dry-run] rm ${entry.originalPath}`);
    } else {
      try {
        await fs.unlink(originalAbs);
        console.log(`[${taskLabel}] removed ${entry.originalPath}`);
      } catch (err) {
        console.warn(`[${taskLabel}] failed to remove ${entry.originalPath}: ${err.message}`);
        continue;
      }
    }
    deleted += 1;

    if (pruneEmpty) {
      await pruneAncestors(originalAbs, dataRoot);
    }
  }

  console.log("");
  console.log(`Summary${dryRun ? " (dry run)" : ""}:`);
  console.log(`  manifests:        ${manifests.length}`);
  console.log(`  eligible:         ${plan.length}`);
  console.log(`  deleted:          ${deleted}`);
  console.log(`  already gone:     ${alreadyGone}`);
  console.log(`  missing dest:     ${missingNew}`);
  console.log(`  size mismatch:    ${sizeMismatch}`);
  if (backupZipPath) {
    console.log(`  backup zip:       ${backupZipPath}`);
  }
  if (dryRun) console.log("\nRun again without --dry-run to actually back up + delete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
