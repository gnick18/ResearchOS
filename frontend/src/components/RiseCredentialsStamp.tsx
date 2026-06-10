"use client";

import Image from "next/image";

/**
 * RISE credentials stamp.
 *
 * Fixed-position card in the bottom-right corner of the viewport. Lives
 * on the folder-connect gate (`FolderConnectGate`) as a structural
 * "real academic project, not a data-harvesting scheme" signal that
 * sits visibly out of the main column. Renamed and re-homed from the
 * retired pre-onboarding modal's `CredentialsFooter` on 2026-05-25.
 *
 * Two signals:
 *   1. Funding source (UW-Madison RISE Initiative) with their official
 *      logo
 *   2. Free + open source, with a link to the public GitHub repo
 *
 * Author credit (Dr. Grant R. Nickles, PhD) lives in the picker's
 * welcome copy alongside the funding line, not in this footer.
 *
 * Voice rules: no em-dashes, no emojis. The logo asset is the official
 * RISE PNG from University Research Park, served from
 * `/credentials/uw-rise-logo.png`.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";

export default function RiseCredentialsStamp() {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-1 text-right text-meta text-slate-300"
      data-testid="rise-credentials-stamp"
    >
      {/* Logo on a tight white panel so the cream shield + red field
          read correctly against the dark gradient backdrop. Padding kept
          minimal: the PNG already carries its own internal whitespace,
          so the panel just needs enough hairline breathing room to keep
          the shield border from kissing the rounded corners. */}
      <div className="pointer-events-auto rounded bg-white/95 p-0.5 shadow-sm">
        <Image
          src="/credentials/uw-rise-logo.png"
          alt="Wisconsin RISE Initiative (Wisconsin Research, Innovation and Scholarly Excellence)"
          width={260}
          height={69}
          className="h-14 w-auto"
          unoptimized
          priority
        />
      </div>
      <p className="pointer-events-auto leading-tight">
        Funded by the UW-Madison RISE Initiative.
        <br />
        Free and open source on{" "}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-sky-300 underline-offset-2 hover:text-sky-200 hover:underline"
          data-testid="rise-credentials-github-link"
        >
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
