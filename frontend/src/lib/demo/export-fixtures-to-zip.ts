/**
 * In-browser ZIP builder for the "Save my demo edits as a starter folder"
 * flow on the public /demo route.
 *
 * Approach: fetch the canonical `/demo-lab.zip` (the prebuilt archive
 * that ships with the app), load it via JSZip, then overlay the
 * in-memory fixture's current state on top. The fixture maps reflect
 * the user's in-session edits, so anything they changed in /demo lands
 * in the exported archive. Everything the user didn't touch comes
 * straight from the canonical zip, which guarantees the output unzips
 * to the same `DemoLab/` structure the user would get from the
 * existing "download as starter folder" path — including the 15
 * protocol markdown bodies and miscellaneous text files that the
 * fixture doesn't seed.
 *
 * Returns a `Blob` ready to hand to an `<a download>` element. The
 * caller is responsible for triggering the actual download.
 */

import JSZip from "jszip";
import { getFixtureSnapshot } from "../file-system/wiki-capture-mock";

const ZIP_ROOT = "DemoLab";
const BASE_ZIP_URL = "/demo-lab.zip";

export async function exportFixturesToZip(): Promise<Blob> {
  const baseRes = await fetch(BASE_ZIP_URL);
  if (!baseRes.ok) {
    throw new Error(
      `Failed to fetch base demo zip (${baseRes.status} ${baseRes.statusText}).`,
    );
  }
  const baseBlob = await baseRes.blob();
  const zip = await JSZip.loadAsync(baseBlob);

  const { files, blobs } = getFixtureSnapshot();

  for (const [path, value] of files) {
    const zipPath = `${ZIP_ROOT}/${path}`;
    if (path.endsWith(".json")) {
      zip.file(zipPath, JSON.stringify(value, null, 2));
    } else if (typeof value === "string") {
      zip.file(zipPath, value);
    } else {
      zip.file(zipPath, JSON.stringify(value));
    }
  }

  for (const [path, blob] of blobs) {
    const zipPath = `${ZIP_ROOT}/${path}`;
    zip.file(zipPath, blob);
  }

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
