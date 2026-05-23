/**
 * Shared file-type badge utilities.
 *
 * Returns a small bordered extension badge (e.g. ".pdf", ".csv") instead
 * of emoji glyphs so the UI stays text-only and accessible.
 */

import React from "react";

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/**
 * A small monospace badge showing the file extension.
 * Falls back to a generic "file" label when there is no extension.
 *
 * Size: 18-20 px wide, designed to sit alongside a filename at text-xs.
 */
export function FileExtBadge({ filename }: { filename: string }): React.ReactElement {
  const ext = getExtension(filename);
  const label = ext ? `.${ext}` : "file";
  return (
    <span
      className="inline-flex items-center justify-center shrink-0 rounded border border-gray-300 bg-gray-100 text-gray-500 font-mono text-[9px] leading-none px-0.5 py-0.5 min-w-[22px] uppercase tracking-wide"
      aria-hidden="true"
    >
      {label}
    </span>
  );
}
