#!/usr/bin/env node
/*
 * migrate-attachments-to-files.mjs
 *
 * One-shot helper that folds the legacy
 *   users/<owner>/results/task-<id>/Attachments/
 * folder into the canonical
 *   users/<owner>/results/task-<id>/Files/
 * folder. Markdown body references in `notes.md` and `results.md` are
 * rewritten in place so `(Attachments/foo.pdf)` becomes `(Files/foo.pdf)`
 * (or whatever non-colliding name was picked).
 *
 * The same migration runs lazily in the app (on first open of a task) and
 * eagerly via Settings → Data maintenance → "Repair attachment paths". This
 * script is for when you want to do the whole tree in one go from the
 * command line, e.g. after a bulk OneDrive sync.
 *
 * Usage:
 *   node scripts/migrate-attachments-to-files.mjs <data-folder> [--dry-run] [--prune-empty-dirs]
 *
 * Examples:
 *   node scripts/migrate-attachments-to-files.mjs "$HOME/Library/CloudStorage/.../ResearchOS_FungalInteractionsLab" --dry-run
 *   node scripts/migrate-attachments-to-files.mjs "$HOME/.../ResearchOS_FungalInteractionsLab" --prune-empty-dirs
 *
 * Safety:
 *   - --dry-run prints what would happen without touching the filesystem.
 *   - Each move is read-write-delete (not atomic rename, since Files/ may live
 *     on a different cloud-sync mount than Attachments/ in pathological setups).
 *     A failed write aborts the per-file step before the source is deleted.
 *   - --prune-empty-dirs removes the now-empty Attachments/ folder after
 *     migration. Off by default.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const pruneEmpty = args.includes("--prune-empty-dirs");
const positional = args.filter((a) => !a.startsWith("--"));

if (positional.length !== 1) {
  console.error("usage: migrate-attachments-to-files.mjs <data-folder> [--dry-run] [--prune-empty-dirs]");
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

/** Walk `users/<owner>/results/` and return every task-N directory. */
async function findTaskDirs(root) {
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
      out.push(path.join(resultsDir, t.name));
    }
  }
  return out;
}

async function migrateOne(taskDir) {
  const attachDir = path.join(taskDir, "Attachments");
  if (!(await exists(attachDir))) return { moved: 0, rewritten: 0, failed: 0, skipped: true };
  const filesDir = path.join(taskDir, "Files");

  let attachNames = [];
  try {
    attachNames = (await fs.readdir(attachDir)).filter((n) => !n.startsWith("."));
  } catch {
    return { moved: 0, rewritten: 0, failed: 0, skipped: true };
  }
  if (attachNames.length === 0) {
    if (pruneEmpty && !dryRun) {
      try { await fs.rmdir(attachDir); } catch { /* not empty or perms */ }
    }
    return { moved: 0, rewritten: 0, failed: 0, skipped: true };
  }

  if (!dryRun) await fs.mkdir(filesDir, { recursive: true });

  let moved = 0;
  let failed = 0;
  const renames = new Map(); // oldRef → newRef

  for (const name of attachNames) {
    try {
      const finalName = dryRun ? name : await pickUniqueFilename(filesDir, name);
      const src = path.join(attachDir, name);
      const dst = path.join(filesDir, finalName);
      if (dryRun) {
        console.log(`  [dry-run] would move: ${src} -> ${dst}`);
      } else {
        await fs.copyFile(src, dst);
        await fs.unlink(src);
      }
      renames.set(`Attachments/${name}`, `Files/${finalName}`);
      moved += 1;
    } catch (err) {
      console.error(`  FAILED to move ${name}: ${err.message}`);
      failed += 1;
    }
  }

  // Rewrite markdown refs in both candidate notes files.
  let rewritten = 0;
  for (const mdName of ["results.md", "notes.md"]) {
    const mdPath = path.join(taskDir, mdName);
    if (!(await exists(mdPath))) continue;
    let body = "";
    try { body = await fs.readFile(mdPath, "utf8"); } catch { continue; }
    let next = body;
    for (const [oldRef, newRef] of renames) {
      if (next.includes(oldRef)) {
        next = next.split(oldRef).join(newRef);
      }
    }
    if (next !== body) {
      if (dryRun) {
        console.log(`  [dry-run] would rewrite ${mdName} refs (${[...renames.keys()].length} candidates)`);
      } else {
        await fs.writeFile(mdPath, next, "utf8");
      }
      rewritten += 1;
    }
  }

  if (pruneEmpty && !dryRun) {
    try {
      const remaining = await fs.readdir(attachDir);
      if (remaining.length === 0) await fs.rmdir(attachDir);
    } catch { /* keep going */ }
  }

  return { moved, rewritten, failed, skipped: false };
}

async function main() {
  if (!(await exists(dataRoot))) {
    console.error(`Data folder does not exist: ${dataRoot}`);
    process.exit(1);
  }
  const taskDirs = await findTaskDirs(dataRoot);
  console.log(`${dryRun ? "[dry-run] " : ""}Scanning ${taskDirs.length} task folder(s) under ${dataRoot}/users/*/results/`);

  let scanned = 0;
  let repaired = 0;
  let alreadyCorrect = 0;
  let totalMoved = 0;
  let totalRewritten = 0;
  let totalFailed = 0;

  for (const dir of taskDirs) {
    scanned += 1;
    const rel = path.relative(dataRoot, dir);
    const result = await migrateOne(dir);
    if (result.skipped) {
      alreadyCorrect += 1;
      continue;
    }
    console.log(`${rel}: moved ${result.moved}, rewrote ${result.rewritten} markdown file(s), failed ${result.failed}`);
    repaired += 1;
    totalMoved += result.moved;
    totalRewritten += result.rewritten;
    totalFailed += result.failed;
  }

  console.log("");
  console.log(`Summary: scanned ${scanned}, repaired ${repaired}, already clean ${alreadyCorrect}`);
  console.log(`Files moved: ${totalMoved}, markdown files rewritten: ${totalRewritten}, failed file ops: ${totalFailed}`);
  if (dryRun) console.log("(dry run — nothing was written)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
