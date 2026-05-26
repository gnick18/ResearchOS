"use client";

import Image from "next/image";

/**
 * Pre-onboarding credentials stamp.
 *
 * Fixed-position card in the bottom-right corner of the viewport. Visible
 * across all 4 beats but stays out of BeakerBot's spotlight: the mascot
 * + speech bubble own the screen, the credentials sit as a small
 * "powered by" stamp.
 *
 * Two signals:
 *   1. Funding source (UW-Madison RISE Initiative) with their official logo
 *   2. Free + open source, with a link to the public GitHub repo
 *
 * Author credit (Dr. Grant R. Nickles, PhD) lives in Beat 1's main copy,
 * not the footer, per Grant 2026-05-25.
 *
 * Repositioned to bottom-right 2026-05-25 (Grant: the original
 * below-the-bubble white panel was distracting from BeakerBot).
 *
 * Voice rules: NO em-dashes, NO emojis. The logo asset is the official
 * RISE PNG from University Research Park, served from
 * `/credentials/uw-rise-logo.png`.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";

export default function CredentialsFooter() {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-1 text-right text-[10px] text-slate-300"
      data-testid="pre-onboarding-credentials"
    >
      {/* Logo on a tight white panel so the cream shield + red field
          read correctly against the dark gradient backdrop. Padding kept
          minimal (Grant 2026-05-25): the PNG already carries its own
          internal whitespace, so the panel just needs enough hairline
          breathing room to keep the shield border from kissing the
          rounded corners. */}
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
          data-testid="pre-onboarding-github-link"
        >
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
