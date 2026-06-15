// Cloud-accounts Phase 3 Chunk 3A: client-side avatar resize.
//
// Turns a user-picked image File into a small square data URL we can store inline
// on the account profile row (see AVATAR_MAX_BYTES in account-profile.ts). The
// browser does the resize so we never upload a full-resolution photo; the server
// still caps the result authoritatively. R2 is the scale path if avatars ever
// grow past a thumbnail, but a thumbnail-sized data URL keeps storage to a single
// row read.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { AVATAR_MAX_BYTES } from "@/lib/account/account-profile";

/** The square edge we downscale an avatar to (device-pixels). */
const AVATAR_EDGE = 256;

/**
 * Reads an image File, center-crops it to a square, downscales to AVATAR_EDGE,
 * and encodes a JPEG data URL small enough to pass the server cap. Tries
 * progressively lower JPEG quality until the data URL fits under
 * AVATAR_MAX_BYTES. Resolves to the data URL, or rejects with a human message
 * the caller can show. Browser-only (uses Image + canvas).
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Pick an image file.");
  }
  const bitmap = await loadImage(file);
  try {
    const edge = Math.min(bitmap.width, bitmap.height);
    if (edge <= 0) throw new Error("That image could not be read.");
    const sx = (bitmap.width - edge) / 2;
    const sy = (bitmap.height - edge) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser could not process that image.");
    ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, AVATAR_EDGE, AVATAR_EDGE);

    // Step the JPEG quality down until the encoded data URL fits the cap. JPEG is
    // a good default for photos; the server accepts png/jpeg/webp either way.
    for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= AVATAR_MAX_BYTES) return url;
    }
    throw new Error("That image is too detailed to shrink. Try a simpler one.");
  } finally {
    closeImage(bitmap);
  }
}

/** A minimal drawable image source: width/height plus the canvas drawImage shape. */
type DrawableImage = CanvasImageSource & { width: number; height: number };

/** Decodes a File into a drawable image, preferring createImageBitmap. */
async function loadImage(file: File): Promise<DrawableImage> {
  if (typeof createImageBitmap === "function") {
    return (await createImageBitmap(file)) as unknown as DrawableImage;
  }
  // Fallback for environments without createImageBitmap: an object-URL <img>.
  return await new Promise<DrawableImage>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img as unknown as DrawableImage);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    img.src = url;
  });
}

/** Releases an ImageBitmap if the source was one (no-op for an <img>). */
function closeImage(src: DrawableImage): void {
  if (
    typeof ImageBitmap !== "undefined" &&
    src instanceof ImageBitmap &&
    typeof src.close === "function"
  ) {
    src.close();
  }
}
