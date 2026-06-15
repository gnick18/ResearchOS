// Lab identity + branding: client-side lab-logo prep.
//
// Turns a user-picked logo File into bytes + a content-type ready for
// uploadLabLogo (lab-profile-client.ts), which ships them to the relay LAB_DATA
// R2 bucket. A raster logo (png/jpeg/webp) is downscaled to LOGO_MAX_EDGE on its
// longest side, preserving aspect ratio (a logo is not necessarily square, so we
// do NOT center-crop), then re-encoded as PNG to keep transparency. An SVG is
// passed through verbatim (it is already resolution-independent and tiny) as long
// as it fits the relay cap. The relay caps the size authoritatively; this just
// keeps the upload small.
//
// No emojis, no em-dashes, no mid-sentence colons.

/** Longest-edge target for a rasterized logo, in device pixels. */
const LOGO_MAX_EDGE = 512;

/** Relay-side cap mirrored here for an early, friendly client message. */
const LOGO_MAX_BYTES = 512 * 1024;

export interface PreparedLogo {
  bytes: Uint8Array;
  contentType: string;
  /** An object-friendly data URL for an instant preview. */
  previewUrl: string;
}

/**
 * Prepares a user-picked logo File for upload. Resolves to the bytes +
 * content-type + a preview data URL, or rejects with a human message the caller
 * can show. Browser-only (uses Image + canvas for raster sources).
 */
export async function fileToLabLogo(file: File): Promise<PreparedLogo> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Pick an image file.");
  }

  // SVG is already scalable and small; pass it through unchanged if it fits.
  if (file.type === "image/svg+xml") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > LOGO_MAX_BYTES) {
      throw new Error("That SVG is too large. Try a simpler one.");
    }
    const text = new TextDecoder().decode(bytes);
    const previewUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
    return { bytes, contentType: "image/svg+xml", previewUrl };
  }

  const bitmap = await loadImage(file);
  try {
    const { width, height } = bitmap;
    if (width <= 0 || height <= 0) {
      throw new Error("That image could not be read.");
    }
    // Scale the longest edge down to LOGO_MAX_EDGE, never up.
    const scale = Math.min(1, LOGO_MAX_EDGE / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser could not process that image.");
    ctx.drawImage(bitmap, 0, 0, width, height, 0, 0, outW, outH);

    // PNG keeps transparency (logos commonly have it). Verify the size fits.
    const previewUrl = canvas.toDataURL("image/png");
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!blob) throw new Error("Your browser could not process that image.");
    if (blob.size > LOGO_MAX_BYTES) {
      throw new Error("That image is too detailed to shrink. Try a simpler one.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes, contentType: "image/png", previewUrl };
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
