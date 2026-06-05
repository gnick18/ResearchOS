/**
 * Peer-to-identity map: resolves a Loro peer id to a ResearchOS username.
 *
 * Stored at users/<owner>/.researchos/actors.json so it lives alongside the
 * sidecar notes and shares the same hidden .researchos/ directory convention
 * (see sidecar-store.ts for the path idiom).
 *
 * Shape: { [peerIdString]: { username: string } }
 *
 * Phase 1/2 has one entry per device (the local user). Phase 3 adds
 * collaborator entries when the relay backend imports remote changes, giving
 * the version-history display the identity behind every peer id.
 */

import { fileService } from "@/lib/file-system/file-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActorEntry {
  username: string;
}

export type ActorsMap = Record<string, ActorEntry>;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Canonical path for the actors map file.
 * Locked by Phase 2 design doc section 8, decision 2.
 */
export function actorsPath(owner: string): string {
  return `users/${owner}/.researchos/actors.json`;
}

/** Parent directory that must exist before writing the actors map. */
function actorsDir(owner: string): string {
  return `users/${owner}/.researchos`;
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/**
 * Read the actors map for an owner. Returns an empty map when the file does
 * not exist yet. Errors are swallowed -- the caller (openNote) must not fail
 * because of a missing actors file.
 */
export async function readActors(owner: string): Promise<ActorsMap> {
  try {
    const map = await fileService.readJson<ActorsMap>(actorsPath(owner));
    return map ?? {};
  } catch {
    return {};
  }
}

/**
 * Record that the given peer id belongs to the given username.
 *
 * Merges into the existing map without clobbering other peers' entries,
 * so multiple devices for the same owner (Phase 3 collab) each contribute
 * their own entry without overwriting each other.
 *
 * Best-effort: wrapped in try/catch so a failing write (no folder selected,
 * storage full, etc.) never breaks the editor. The note works fine without
 * the actors map; version-history attribution degrades to showing the raw
 * peer id instead of the username.
 */
export async function recordActor(
  owner: string,
  peerId: bigint,
  username: string,
): Promise<void> {
  try {
    const existing = await readActors(owner);
    const updated: ActorsMap = {
      ...existing,
      [peerId.toString()]: { username },
    };
    await fileService.ensureDir(actorsDir(owner));
    await fileService.writeJson(actorsPath(owner), updated);
  } catch (err) {
    // Best-effort only. Attribution degrades gracefully.
    console.warn("[actors] failed to record actor:", err);
  }
}
