// The per-user migration marker: users/<username>/_schema_migrations.json.
//
// Per-USER, not folder-level, because the repairs operate on the current user's
// data (their tasks/methods/markdown). In a shared folder each member's data
// migrates once for that member. Public/shared records are idempotently
// reconverged by whoever runs first.
//
// The marker is an OPTIMIZATION, not a correctness crutch: every migration is
// idempotent, so a lost or stale marker only costs a re-walk, never corruption.

import { fileService } from "@/lib/file-system/file-service";

export interface SchemaMarker {
  applied: string[];
  updatedAt: string;
}

function markerPath(username: string): string {
  return `users/${username}/_schema_migrations.json`;
}

export async function readMarker(username: string): Promise<SchemaMarker> {
  try {
    const m = await fileService.readJson<SchemaMarker>(markerPath(username));
    if (m && Array.isArray(m.applied)) {
      return { applied: m.applied, updatedAt: m.updatedAt ?? "" };
    }
  } catch {
    // Unreadable marker reads as empty, so all migrations are pending. Safe:
    // they are idempotent, the worst case is a re-walk.
  }
  return { applied: [], updatedAt: "" };
}

export async function writeMarker(
  username: string,
  applied: string[],
): Promise<void> {
  await fileService.writeJson(markerPath(username), {
    applied,
    updatedAt: new Date().toISOString(),
  });
}
