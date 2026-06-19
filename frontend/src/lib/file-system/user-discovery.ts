import { fileService } from "./file-service";
import { readAllUserMetadata } from "./user-metadata";

const SKIP_DIRECTORIES = new Set(["public", "lab", "_no_user_", "_global_counters.json", "_user_metadata.json"]);

export async function validateResearchFolder(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const usersHandle = await handle.getDirectoryHandle("users");
    return usersHandle.kind === "directory";
  } catch (err) {
    // A missing "users" directory is the EXPECTED signal that this is a
    // brand-new / empty folder we're about to initialize. The caller turns
    // a `false` here into `needsInitialization: true`, so a NotFoundError is
    // normal flow, not a fault. Only log genuinely unexpected failures
    // (permissions, I/O) to avoid scaring users with a red console error on
    // every first-time empty-folder link.
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return false;
    }
    console.error("validateResearchFolder error:", err);
    return false;
  }
}

export async function discoverUsers(): Promise<string[]> {
  if (!fileService.isConnected()) return [];

  // Route through `fileService.listDirectories` rather than the raw FSA
  // iterator so the wiki-capture mock (which patches the file service but
  // can't expose an FSA-shaped `values()` on its fake handle) sees the
  // seeded user directories. Real folders go through the same path with
  // no behavior change.
  try {
    const [all, meta] = await Promise.all([
      fileService.listDirectories("users"),
      readAllUserMetadata(),
    ]);
    return all
      .filter((name) => !SKIP_DIRECTORIES.has(name))
      .filter((name) => !meta[name]?.deleted_at)
      .sort();
  } catch (err) {
    console.error("discoverUsers error:", err);
    return [];
  }
}

/**
 * The genuine co-located human users of THIS folder, excluding both tombstoned
 * users (same as discoverUsers) AND materialized co-members.
 *
 * WHY THIS EXISTS (multi-lab Task C):
 *   When LAB_AS_FOLDER_ENABLED is on, the roster materialize writes the head +
 *   every co-member of someone else's lab as `users/<owner>/` scaffolds into a
 *   member's OWN folder so the identity consumers light up. Those dirs are CACHED
 *   identities, not real co-located users this person shares a folder with.
 *   discoverUsers counts them (it only filters tombstones + sentinels), so a lone
 *   member of someone else's lab looked like a "multi-user folder" and the
 *   migrate-to-solo gate (useIsMultiUserFolder) wrongly fired, offering to split
 *   / package out cached co-members. This helper excludes any user whose metadata
 *   entry carries `materialized_member: true`, so it returns only the genuine
 *   co-located humans (a lone member resolves to just themselves).
 *
 *   useIsLabMode deliberately does NOT use this helper: a member of a lab IS in
 *   lab mode (the materialized head's account_type drives the PI badge + lab
 *   chrome), so lab mode must keep counting them. Only the multi-user / migrate
 *   signal needs the narrower, membership-derived count.
 */
export async function discoverRealLocalUsers(): Promise<string[]> {
  if (!fileService.isConnected()) return [];
  try {
    const [all, meta] = await Promise.all([
      fileService.listDirectories("users"),
      readAllUserMetadata(),
    ]);
    return all
      .filter((name) => !SKIP_DIRECTORIES.has(name))
      .filter((name) => !meta[name]?.deleted_at)
      // Exclude materialized co-members (cached identity from another person's
      // lab), so this is the genuine co-located human-user set.
      .filter((name) => meta[name]?.materialized_member !== true)
      .sort();
  } catch (err) {
    console.error("discoverRealLocalUsers error:", err);
    return [];
  }
}

export async function ensureFolderStructure(): Promise<boolean> {
  if (!fileService.isConnected()) return false;

  try {
    await fileService.ensureDir("users");
    await fileService.ensureDir("users/public");
    await fileService.ensureDir("users/public/methods");
    await fileService.ensureDir("users/public/pcr_protocols");
    await fileService.ensureDir("users/lab");
    await fileService.ensureDir("users/lab/funding_accounts");

    const globalCountersExists = await fileService.fileExists("users/_global_counters.json");
    if (!globalCountersExists) {
      await fileService.writeJson("users/_global_counters.json", {});
    }

    const publicCountersExists = await fileService.fileExists("users/public/_counters.json");
    if (!publicCountersExists) {
      await fileService.writeJson("users/public/_counters.json", {});
    }

    return true;
  } catch (err) {
    console.error("ensureFolderStructure failed:", err);
    return false;
  }
}

export async function ensureUserFolderStructure(username: string): Promise<boolean> {
  if (!fileService.isConnected()) return false;

  const sanitized = username.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!sanitized) return false;

  try {
    await fileService.ensureDir(`users/${sanitized}`);
    await fileService.ensureDir(`users/${sanitized}/projects`);
    await fileService.ensureDir(`users/${sanitized}/tasks`);
    await fileService.ensureDir(`users/${sanitized}/dependencies`);
    await fileService.ensureDir(`users/${sanitized}/methods`);
    await fileService.ensureDir(`users/${sanitized}/events`);
    await fileService.ensureDir(`users/${sanitized}/goals`);
    await fileService.ensureDir(`users/${sanitized}/pcr_protocols`);
    await fileService.ensureDir(`users/${sanitized}/purchase_items`);
    await fileService.ensureDir(`users/${sanitized}/lab_links`);
    await fileService.ensureDir(`users/${sanitized}/notes`);
    await fileService.ensureDir(`users/${sanitized}/Images`);
    await fileService.ensureDir(`users/${sanitized}/Files`);

    const countersExists = await fileService.fileExists(`users/${sanitized}/_counters.json`);
    if (!countersExists) {
      await fileService.writeJson(`users/${sanitized}/_counters.json`, {});
    }

    return true;
  } catch {
    return false;
  }
}
