// frontend/src/lib/deposit/bundle.ts
//
// Repository-deposit PHASE 1 (guided-deposit bot, 2026-05-28). Assembles the
// downloadable deposit bundle: the curated experiment (built by the EXISTING
// export pipeline) wrapped in a ZIP alongside the prefilled `datacite.json`
// metadata file.
//
// We REUSE the export pipeline (`buildRawZip` / `buildHtmlBundle` / `buildPdf`)
// and never reimplement bundling. The only deposit-specific work is wrapping
// the chosen format's result together with the metadata file so the user
// downloads ONE archive to drag into the repository.
//
// The metadata file is part of the DOWNLOADABLE bundle. It is NEVER written
// into the user's on-disk data folder (no new sidecar, no _deposits.json).
//
// No em-dashes, no emojis.

import JSZip from "jszip";
import { slugify } from "@/lib/export/slug";
import { buildRawZip } from "@/lib/export/raw";
import { buildHtmlBundle } from "@/lib/export/html";
import { buildPdf } from "@/lib/export/pdf";
import type {
  ExperimentExportPayload,
  ExportFormat,
  ExportResult,
} from "@/lib/export/types";
import {
  serializeDepositMetadata,
  type DepositMetadata,
} from "./datacite";

/** The metadata filename that lands at the top of the deposit bundle. */
export const DEPOSIT_METADATA_FILENAME = "datacite.json";

async function buildFormat(
  payload: ExperimentExportPayload,
  format: ExportFormat,
  baseFilename: string,
): Promise<ExportResult> {
  switch (format) {
    case "raw":
      return buildRawZip(payload, baseFilename);
    case "html":
      return buildHtmlBundle(payload, baseFilename);
    case "pdf":
      return buildPdf(payload, baseFilename);
  }
}

export interface DepositBundleResult extends ExportResult {
  // The serialized metadata JSON, also exposed separately so the handoff
  // panel can render / copy it without re-reading the zip.
  metadataJson: string;
}

/**
 * Build the deposit bundle for an already-curated payload. The chosen export
 * format's output (a single file for pdf, a zip for raw/html) is nested
 * inside a wrapper ZIP next to `datacite.json`, so the user gets one archive
 * that carries both the curated data and the prefilled metadata.
 *
 * Naming: `{slug}-deposit.zip`. Inside:
 *   - datacite.json
 *   - {slug}.pdf | {slug}.html (unwrapped) | {slug}-raw.zip
 *
 * For the HTML format we UNWRAP the inner zip into a `{slug}/` subfolder so
 * the deposit archive is directly browsable (mirrors how the multi-export
 * wrapper handles HTML).
 */
export async function buildDepositBundle(
  payload: ExperimentExportPayload,
  format: ExportFormat,
  metadata: DepositMetadata,
): Promise<DepositBundleResult> {
  const slug = slugify(payload.task.name);
  const inner = await buildFormat(payload, format, slug);
  const metadataJson = serializeDepositMetadata(metadata);

  const zip = new JSZip();
  zip.file(DEPOSIT_METADATA_FILENAME, metadataJson);

  if (format === "html") {
    // Unwrap the inner html zip into a browsable subfolder.
    const innerBytes = await inner.blob.arrayBuffer();
    const innerZip = await JSZip.loadAsync(innerBytes);
    const folder = zip.folder(slug);
    if (!folder) {
      throw new Error(`Could not create subfolder ${slug} in deposit zip`);
    }
    await Promise.all(
      Object.values(innerZip.files).map(async (entry) => {
        if (entry.dir) return;
        const data = await entry.async("uint8array");
        folder.file(entry.name, data);
      }),
    );
  } else {
    // pdf + raw: drop the format result in as a single top-level entry.
    zip.file(inner.filename, inner.blob);
  }

  // Deterministic mtimes (mirror the export pipeline's convention) so
  // re-building the same deposit is byte-stable at the zip-frame level.
  const stamp = new Date(payload.meta.exportedAt);
  for (const entry of Object.values(zip.files)) {
    entry.date = stamp;
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return {
    blob,
    filename: `${slug}-deposit.zip`,
    mimeType: "application/zip",
    metadataJson,
  };
}

/**
 * Trigger a browser download for a blob with a chosen filename. Mirrors the
 * export pipeline's `downloadResult` revoke-after-click pattern so deposit
 * downloads behave identically (Safari-safe deferred revoke).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
