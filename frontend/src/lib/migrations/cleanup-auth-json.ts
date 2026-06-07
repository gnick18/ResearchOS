// Destructive-but-recoverable migration: remove the orphaned `_auth.json` files
// (the retired PBKDF2 login-hash sidecar). Login moved to the local keypair in
// `users/<u>/_account.json`, and NOTHING reads `_auth.json` anymore (its old
// readers, hasPassword/verifyPassword, are gone). So every `_auth.json` on disk
// is dead data; trash (not delete) it so the old password system leaves no
// residue. This lets `lib/auth/password.ts` be deleted entirely.

import { fileService } from "@/lib/file-system/file-service";
import { trashFile } from "./trash";
import type { MigrationReport } from "./types";

export const AUTH_JSON_CLEANUP_ID = "auth-json-orphan-cleanup-v1";

export async function cleanupOrphanAuthJson(): Promise<MigrationReport> {
  let users: string[] = [];
  try {
    users = await fileService.listDirectories("users");
  } catch {
    return { changed: 0, scanned: 0, failed: 0 };
  }

  let scanned = 0;
  let changed = 0;
  let failed = 0;
  for (const u of users) {
    const path = `users/${u}/_auth.json`;
    scanned += 1;
    try {
      if (await trashFile(path, AUTH_JSON_CLEANUP_ID)) changed += 1;
    } catch (err) {
      console.warn(`[migrations] _auth.json cleanup failed for ${path}`, err);
      failed += 1;
    }
  }
  return { changed, scanned, failed };
}
