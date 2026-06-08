// Lab-tier Phase 3 chunk 2b-bind: per-member manifest persistence over the app
// file service.
//
// DESIGN: a thin adapter that maps the abstract ManifestStore interface onto
// the app's singleton fileService. Each lab member's manifest is stored as a
// JSON file at `users/<owner>/_lab_sync_manifest.json` inside the connected
// data folder. An absent or unreadable file is treated as an empty manifest
// (first-run full push).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import type { LabSyncManifest } from "./lab-sync";

// ---------------------------------------------------------------------------
// Public constants.
// ---------------------------------------------------------------------------

/** Filename used for the per-member sync manifest inside the user's folder. */
export const LAB_SYNC_MANIFEST_FILE = "_lab_sync_manifest.json";

// ---------------------------------------------------------------------------
// ManifestStore interface.
// ---------------------------------------------------------------------------

/**
 * A minimal interface for loading and saving a per-member LabSyncManifest.
 * The production implementation is backed by fileService; tests inject a
 * lightweight fake.
 */
export interface ManifestStore {
  /**
   * Load the manifest for `owner`. Returns an empty object when no manifest
   * exists yet (first-run semantics: a full push will occur).
   */
  load(owner: string): Promise<LabSyncManifest>;

  /**
   * Persist `manifest` for `owner`, replacing any prior value.
   */
  save(owner: string, manifest: LabSyncManifest): Promise<void>;
}

// ---------------------------------------------------------------------------
// createFileServiceManifestStore: production implementation.
// ---------------------------------------------------------------------------

/**
 * Returns a ManifestStore backed by the app's singleton fileService.
 *
 * Paths used:
 *   load/save: `users/<owner>/_lab_sync_manifest.json`
 *
 * A null return from readJson (file absent or malformed) is normalised to {}
 * so the first sync run performs a full push of all live records.
 */
export function createFileServiceManifestStore(): ManifestStore {
  return {
    async load(owner: string): Promise<LabSyncManifest> {
      const path = `users/${owner}/${LAB_SYNC_MANIFEST_FILE}`;
      return (await fileService.readJson<LabSyncManifest>(path)) ?? {};
    },

    async save(owner: string, manifest: LabSyncManifest): Promise<void> {
      const path = `users/${owner}/${LAB_SYNC_MANIFEST_FILE}`;
      await fileService.writeJson(path, manifest);
    },
  };
}
