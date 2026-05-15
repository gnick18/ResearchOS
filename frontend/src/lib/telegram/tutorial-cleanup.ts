import { fileService } from "@/lib/file-system/file-service";
import {
  hasImageExtension,
  sidecarPath,
  type ImageSidecar,
} from "@/lib/attachments/image-folder";

/**
 * Inbox-only auto-cleanup for photos sent during the guided tutorial's
 * first-photo step. Each tutorial-mode photo write (see
 * `image-router.ts`) stamps its sidecar with `tutorial_test: true`; this
 * helper runs on tutorial-end (orchestrator `tutorial-state: null`
 * signal) to delete the file + sidecar so the inbox doesn't accumulate
 * test photos between runs.
 *
 * Scope is INBOX-only by design: a tutorial photo that landed in an
 * open task's `Images/` dir keeps the marker as a breadcrumb but is NOT
 * auto-deleted (the user explicitly chose that destination by having
 * the popup open). Failures are logged + swallowed so a single missing
 * file or permission error never blocks the rest of the scan.
 */

function inboxBase(username: string): string {
  return `users/${username}/inbox`;
}

/**
 * Scan the user's inbox `Images/` directory for sidecars marked
 * `tutorial_test: true` and delete the file + sidecar pair. Returns the
 * count of photos successfully cleaned up. Returns 0 on any scan-level
 * failure (missing dir, listFiles throws); per-file failures continue
 * the scan and are logged but not counted.
 */
export async function cleanupTutorialTestPhotos(
  username: string,
): Promise<number> {
  const base = inboxBase(username);
  const inboxImagesDir = `${base}/Images`;
  let cleanedCount = 0;
  let fileNames: string[];
  try {
    fileNames = await fileService.listFiles(inboxImagesDir);
  } catch (err) {
    console.warn(
      `[tutorial-cleanup] inbox scan failed for user ${username}:`,
      err,
    );
    return 0;
  }
  const imageNames = fileNames.filter(
    (n) => !n.startsWith(".") && hasImageExtension(n),
  );
  for (const name of imageNames) {
    const scPath = sidecarPath(base, name);
    let sidecar: ImageSidecar | null;
    try {
      sidecar = await fileService.readJson<ImageSidecar>(scPath);
    } catch (err) {
      console.warn(
        `[tutorial-cleanup] sidecar read failed for ${name}:`,
        err,
      );
      continue;
    }
    if (sidecar?.tutorial_test !== true) continue;
    const fileDeleted = await fileService.deleteFile(
      `${inboxImagesDir}/${name}`,
    );
    if (!fileDeleted) {
      console.warn(`[tutorial-cleanup] failed to delete image ${name}`);
      continue;
    }
    const sidecarDeleted = await fileService.deleteFile(scPath);
    if (!sidecarDeleted) {
      console.warn(
        `[tutorial-cleanup] image deleted but sidecar delete failed for ${name}`,
      );
    }
    cleanedCount++;
  }
  return cleanedCount;
}
