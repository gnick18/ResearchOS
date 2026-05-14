"use client";

/**
 * Generator for the cred-less "DevTools" path: produces a self-contained
 * IIFE the user pastes into the browser console while logged into
 * LabArchives. Because it runs INSIDE the labarchives.com origin, the
 * `fetch(..., { credentials: "include" })` calls carry the user's session
 * cookies and authorize naturally — no API key needed.
 *
 * The script:
 *   1. Loads JSZip from a CDN (so we don't need to inline a 60kB library
 *      into the rendered string).
 *   2. Fetches each URL in series with a small polite delay.
 *   3. Packages successful fetches into a single ZIP keyed by filename.
 *   4. Triggers ONE browser download.
 *
 * The user drops the ZIP into the manual-drop panel, which uses the same
 * filename-matching path as raw folder drops.
 *
 * Security posture:
 *   - The script runs in the user's browser only. ResearchOS never sees
 *     the bytes until the user explicitly drops the resulting ZIP back
 *     into the wizard.
 *   - The URLs are hard-coded into the script (no dynamic eval, no
 *     network round-trip back to ResearchOS).
 *   - `credentials: "include"` only attaches cookies the user already
 *     has — they can't fetch anything they couldn't load by clicking the
 *     image in their own notebook.
 */

import type { MissingInlineImage } from "@/lib/import/eln/types";

/** Pinned CDN URL for JSZip. Same version as the in-app dependency so
 *  any subtle behavioral diff stays out of the equation. */
const JSZIP_CDN_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

export interface DevToolsScriptOptions {
  /** Missing-image entries we want the script to fetch. The script
   *  iterates these and embeds the URL + filename pair so the resulting
   *  ZIP keys match what the manual-drop matcher expects. */
  images: MissingInlineImage[];
  /** Optional friendly notebook label used in the downloaded ZIP filename.
   *  Defaults to "labarchives-images". Sanitized to safe filename chars. */
  notebookLabel?: string;
}

function sanitizeForFilename(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "labarchives-images"
  );
}

/**
 * Build the script text the user will paste into DevTools. The result is
 * a multi-line IIFE; rendering it as-is in a `<pre>` block + copying via
 * `navigator.clipboard.writeText()` is the intended UX.
 */
export function buildDevToolsFetchScript(opts: DevToolsScriptOptions): string {
  const safeLabel = sanitizeForFilename(opts.notebookLabel ?? "labarchives-images");
  // Each entry is just { url, filename }. We do NOT need entryPartId here —
  // the original URL is a complete LabArchives-side reference and the
  // user's session cookies handle authorization.
  const payload = opts.images.map((m) => ({
    url: m.originalUrl,
    filename: m.filename,
  }));
  const payloadJson = JSON.stringify(payload);
  const cdn = JSON.stringify(JSZIP_CDN_URL);
  const zipNameBase = JSON.stringify(safeLabel);

  // The script is intentionally written to be readable when pasted —
  // generous comments, simple control flow, no minification. A user
  // peeking at it in DevTools should be able to verify it doesn't do
  // anything weird.
  return `// ResearchOS — LabArchives inline-image grabber
// Paste this into the DevTools Console while you have your LabArchives
// notebook open. It will fetch each online-only inline image using your
// existing session, package them into a single ZIP, and trigger ONE
// download. Drop the ZIP back into the ResearchOS import wizard.
(async () => {
  const ITEMS = ${payloadJson};
  const ZIP_NAME_BASE = ${zipNameBase};
  const JSZIP_URL = ${cdn};

  // Refuse to run anywhere except labarchives.com so a misclick from a
  // different tab can't go anywhere weird.
  if (!/(?:^|\\.)labarchives\\.com$/i.test(location.hostname)) {
    console.warn("[ResearchOS] This script must be run on labarchives.com (you're on " + location.hostname + ").");
    return;
  }

  console.log("[ResearchOS] Will fetch " + ITEMS.length + " image(s) from your session.");

  // Load JSZip from CDN (skip if already present, e.g. if you've run this
  // script before in the same tab).
  if (typeof JSZip === "undefined") {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = JSZIP_URL;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load JSZip from " + JSZIP_URL));
      document.head.appendChild(s);
    });
  }

  const zip = new JSZip();
  let ok = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < ITEMS.length; i++) {
    const item = ITEMS[i];
    try {
      const res = await fetch(item.url, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      // Disambiguate same-filename collisions by adding the index.
      let name = item.filename || ("image-" + i + ".bin");
      if (zip.file(name)) {
        const dotIdx = name.lastIndexOf(".");
        if (dotIdx > 0) {
          name = name.slice(0, dotIdx) + "-" + i + name.slice(dotIdx);
        } else {
          name = name + "-" + i;
        }
      }
      zip.file(name, blob);
      ok++;
      if ((i + 1) % 10 === 0 || i === ITEMS.length - 1) {
        console.log("[ResearchOS] " + (i + 1) + " / " + ITEMS.length + " done (" + ok + " ok, " + failed + " failed).");
      }
    } catch (err) {
      failed++;
      errors.push({ url: item.url, message: err && err.message ? err.message : String(err) });
    }
  }

  if (errors.length > 0) {
    console.warn("[ResearchOS] " + errors.length + " image(s) failed to fetch:", errors);
  }

  if (ok === 0) {
    console.error("[ResearchOS] No images fetched — nothing to download.");
    return;
  }

  console.log("[ResearchOS] Packaging ZIP…");
  const zipBlob = await zip.generateAsync({ type: "blob" });

  // Timestamp keeps re-runs from clobbering each other in the Downloads folder.
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const zipName = ZIP_NAME_BASE + "-" + ts + ".zip";

  const a = document.createElement("a");
  a.href = URL.createObjectURL(zipBlob);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);

  console.log("[ResearchOS] Downloaded " + zipName + " (" + ok + " image(s)). Drop it back into the ResearchOS wizard.");
})();
`;
}
