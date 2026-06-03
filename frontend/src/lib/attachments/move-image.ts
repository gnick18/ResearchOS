import { fileService } from "@/lib/file-system/file-service";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { imageEvents } from "./image-events";
import { sidecarPath, type ImageSidecar } from "./image-folder";
import { annotPath } from "./annotations";

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

  // Carry the photo-annotation overlay sidecar to the new name. Overlay coords
  // are relative to the (unchanged) image, so a verbatim copy is correct and a
  // rename no longer silently breaks the annotation.
  const oldAnnot = annotPath(basePath, oldFilename);
  const annot = await fileService.readJson(oldAnnot);
  if (annot) {
    await fileService.writeJson(annotPath(basePath, newFilename), annot);
  }

  await fileService.deleteFile(oldImage);
  await fileService.deleteFile(oldSidecar);
  await fileService.deleteFile(oldAnnot);
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
  // Also remove the photo-annotation overlay sidecar (annotation arc) so it
  // doesn't orphan once its underlying image is gone.
  await fileService.deleteFile(annotPath(basePath, filename));
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

function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Like `moveImageBetweenBases`, but auto-suffixes the destination filename
 * when a collision would otherwise clobber an existing file in the target
 * `Images/` folder. Returns the final filename written at the destination.
 *
 * Used by the inbox panel's "Send to task" picker so batch-filing a group
 * of inbox photos into a task that already has files with the same stem
 * doesn't silently overwrite the existing attachments.
 */
export async function moveImageBetweenBasesUnique(
  fromBase: string,
  toBase: string,
  filename: string
): Promise<string> {
  if (fromBase === toBase) return filename;

  const srcImage = `${fromBase}/Images/${filename}`;
  const srcSidecar = sidecarPath(fromBase, filename);

  // Pick a non-colliding filename in the destination folder.
  const { stem, ext } = splitExt(filename);
  let finalName = filename;
  let n = 1;
  while (await fileService.fileExists(`${toBase}/Images/${finalName}`)) {
    finalName = `${stem}-${n}${ext}`;
    n += 1;
  }
  const destImage = `${toBase}/Images/${finalName}`;
  const destSidecar = sidecarPath(toBase, finalName);

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

  imageEvents.emitAttached({ basePath: toBase, relativePath: `Images/${finalName}` });
  imageEvents.emitDeleted({ basePath: fromBase, filename });

  return finalName;
}
