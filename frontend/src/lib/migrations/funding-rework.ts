// Funding-rework migration (audit fix-bot, 2026-06-08).
//
// Two idempotent, safe-to-re-run upgrades that bring existing on-disk data onto
// the funding-rework shape (see docs + lib/types.ts):
//
//   1. PurchaseItem backfill: stamp the authoritative foreign key
//      `funding_account_id` on every purchase item that still links to a grant
//      only by the legacy `funding_string` label, by matching that label to a
//      FundingAccount.name. Items already carrying an id, or whose label matches
//      no account, are left untouched.
//
//   2. FundingAccount cleanup: strip the now-removed `spent` / `remaining`
//      fields from every funding-account file. Spend is computed live from
//      purchase items, so the stored counters are dead data.
//
// Both are pure format upgrades (no data loss): the backfill only ADDS a field
// derived from data already on the record, and the strip removes fields nothing
// reads anymore. Re-running is a no-op once applied (already-stamped items skip,
// already-stripped files report no change), so this runs through the standard
// auto-migration runner like the others.
//
// Funding accounts are a LAB-wide store (`users/lab/funding_accounts/`); purchase
// items are per-user (`users/<u>/purchase_items/`), so the backfill walks every
// user directory. The label -> id index is built once from the lab accounts.

import { fileService } from "@/lib/file-system/file-service";
import type { FundingAccount, PurchaseItem } from "@/lib/types";
import type { MigrationReport } from "./types";

export const FUNDING_REWORK_ID = "funding-rework-v1";

const FUNDING_ACCOUNTS_DIR = "users/lab/funding_accounts";

/** Read the lab funding accounts and build a trimmed-name -> id index. The first
 *  account wins on a name collision (a malformed folder), matching the single-row
 *  resolution used everywhere else. */
async function buildAccountNameIndex(): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  let fileNames: string[] = [];
  try {
    fileNames = await fileService.listFiles(FUNDING_ACCOUNTS_DIR);
  } catch {
    return index;
  }
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) continue;
    const acc = await fileService.readJson<FundingAccount>(
      `${FUNDING_ACCOUNTS_DIR}/${fileName}`,
    );
    if (!acc || typeof acc.name !== "string" || typeof acc.id !== "number") {
      continue;
    }
    const name = acc.name.trim();
    if (name.length === 0) continue;
    if (!index.has(name)) index.set(name, acc.id);
  }
  return index;
}

/** Strip `spent` / `remaining` from every funding-account file. Idempotent: a
 *  file already missing both keys is not rewritten. */
async function stripFundingAccountCounters(): Promise<{
  scanned: number;
  changed: number;
  failed: number;
}> {
  let fileNames: string[] = [];
  try {
    fileNames = await fileService.listFiles(FUNDING_ACCOUNTS_DIR);
  } catch {
    return { scanned: 0, changed: 0, failed: 0 };
  }

  let scanned = 0;
  let changed = 0;
  let failed = 0;
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) continue;
    const path = `${FUNDING_ACCOUNTS_DIR}/${fileName}`;
    scanned += 1;
    try {
      const raw = await fileService.readJson<Record<string, unknown>>(path);
      if (!raw) continue;
      if (!("spent" in raw) && !("remaining" in raw)) continue;
      delete raw.spent;
      delete raw.remaining;
      await fileService.writeJson(path, raw);
      changed += 1;
    } catch (err) {
      console.warn(`[migrations] funding-account strip failed for ${path}`, err);
      failed += 1;
    }
  }
  return { scanned, changed, failed };
}

/** Backfill `funding_account_id` on a single user's purchase items. */
async function backfillUserPurchases(
  username: string,
  nameIndex: Map<string, number>,
): Promise<{ scanned: number; changed: number; failed: number }> {
  const dir = `users/${username}/purchase_items`;
  let fileNames: string[] = [];
  try {
    fileNames = await fileService.listFiles(dir);
  } catch {
    return { scanned: 0, changed: 0, failed: 0 };
  }

  let scanned = 0;
  let changed = 0;
  let failed = 0;
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) continue;
    const path = `${dir}/${fileName}`;
    scanned += 1;
    try {
      const item = await fileService.readJson<
        PurchaseItem & Record<string, unknown>
      >(path);
      if (!item) continue;
      // Already linked by id — idempotent skip.
      if (item.funding_account_id != null) continue;
      const raw = item.funding_string;
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      const id = nameIndex.get(trimmed);
      if (id == null) continue; // label matches no known account — leave as-is
      item.funding_account_id = id;
      await fileService.writeJson(path, item);
      changed += 1;
    } catch (err) {
      console.warn(`[migrations] purchase funding backfill failed for ${path}`, err);
      failed += 1;
    }
  }
  return { scanned, changed, failed };
}

/**
 * Run the funding-rework migration: backfill purchase FKs, then strip the dead
 * funding-account counters. Returns the combined report across both passes.
 */
export async function runFundingRework(): Promise<MigrationReport> {
  const nameIndex = await buildAccountNameIndex();

  let users: string[] = [];
  try {
    users = await fileService.listDirectories("users");
  } catch {
    users = [];
  }

  let scanned = 0;
  let changed = 0;
  let failed = 0;

  // 1. Backfill purchase items across every user folder (skip the shared
  //    `lab` / `public` pseudo-users — they hold no purchase_items).
  for (const username of users) {
    if (username === "lab" || username === "public") continue;
    const r = await backfillUserPurchases(username, nameIndex);
    scanned += r.scanned;
    changed += r.changed;
    failed += r.failed;
  }

  // 2. Strip the dead spent / remaining counters from funding-account files.
  const strip = await stripFundingAccountCounters();
  scanned += strip.scanned;
  changed += strip.changed;
  failed += strip.failed;

  return { changed, scanned, failed };
}
