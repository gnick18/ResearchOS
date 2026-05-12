import { fileService } from "@/lib/file-system/file-service";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { imageEvents } from "./image-events";
import { sidecarPath, type ImageSidecar } from "./image-folder";

/**
 * Move an image (and its sidecar, if present) from one base path's
 * `Images/` folder to another's. Used by the inbox panel and inbox toast
 * to "file" an inbox arrival into an active experiment.
 *
 * Both endpoints emit on the image-events bus so any strip / badge that
 * cares about either side refreshes immediately.
 */
/**
 * Rename an image (and its sidecar, if present) inside the same base path's
 * `Images/` folder. Throws if the target filename already exists so the
 * caller can prompt for a different name rather than silently clobbering a
 * file.
 */
export async function renameImageInPlace(
  basePath: string,
  oldFilename: string,
  newFilename: string
): Promise<void> {
  if (oldFilename === newFilename) return;
  if (!newFilename.trim()) throw new Error("New filename is empty");

  const oldImage = `${basePath}/Images/${oldFilename}`;
  const newImage = `${basePath}/Images/${newFilename}`;
  const oldSidecar = sidecarPath(basePath, oldFilename);
  const newSidecar = sidecarPath(basePath, newFilename);

  if (await fileService.fileExists(newImage)) {
    throw new Error(`A file named "${newFilename}" already exists here.`);
  }

  const blob = await fileService.readFileAsBlob(oldImage);
  if (!blob) throw new Error(`Source image not found: ${oldImage}`);
  await fileService.writeFileFromBlob(newImage, blob);

  const sidecar = await fileService.readJson<ImageSidecar>(oldSidecar);
  if (sidecar) {
    await fileService.writeJson(newSidecar, sidecar);
  }

  await fileService.deleteFile(oldImage);
  await fileService.deleteFile(oldSidecar);
  blobUrlResolver.revokePath(oldImage);

  imageEvents.emitAttached({ basePath, relativePath: `Images/${newFilename}` });
  imageEvents.emitDeleted({ basePath, filename: oldFilename });
}

/**
 * Delete an image and its sidecar from a base path's `Images/` folder.
 * Idempotent — missing files are fine. Emits image-deleted so listeners
 * refresh.
 */
export async function deleteImageFromBase(
  basePath: string,
  filename: string
): Promise<void> {
  await fileService.deleteFile(`${basePath}/Images/${filename}`);
  await fileService.deleteFile(sidecarPath(basePath, filename));
  blobUrlResolver.revokePath(`${basePath}/Images/${filename}`);
  imageEvents.emitDeleted({ basePath, filename });
}

export async function moveImageBetweenBases(
  fromBase: string,
  toBase: string,
  filename: string
): Promise<void> {
  if (fromBase === toBase) return;

  const srcImage = `${fromBase}/Images/${filename}`;
  const srcSidecar = sidecarPath(fromBase, filename);
  const destImage = `${toBase}/Images/${filename}`;
  const destSidecar = sidecarPath(toBase, filename);

  const blob = await fileService.readFileAsBlob(srcImage);
  if (!blob) throw new Error(`Source image not found: ${srcImage}`);

  await fileService.writeFileFromBlob(destImage, blob);

  const sidecar = await fileService.readJson<ImageSidecar>(srcSidecar);
  if (sidecar) {
    await fileService.writeJson(destSidecar, sidecar);
  }

  await fileService.deleteFile(srcImage);
  await fileService.deleteFile(srcSidecar);
  blobUrlResolver.revokePath(srcImage);

  imageEvents.emitAttached({ basePath: toBase, relativePath: `Images/${filename}` });
  imageEvents.emitDeleted({ basePath: fromBase, filename });
}
