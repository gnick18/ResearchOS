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
