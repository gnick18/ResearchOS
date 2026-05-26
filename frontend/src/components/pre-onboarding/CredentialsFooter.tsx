"use client";

import WisconsinRiseLogo from "@/components/pre-onboarding/WisconsinRiseLogo";

/**
 * Pre-onboarding credentials footer.
 *
 * Sits below the speech bubble across all 4 beats. Establishes authority
 * for a first-time researcher: this is a real academic project, not a
 * sketchy app trying to harvest research data. Two signals:
 *
 *   1. Funding source (UW-Madison RISE Initiative) with their logo
 *   2. Free + open source, with a link to the public GitHub repo
 *
 * Author credit (Dr. Grant R. Nickles, PhD) lives in Beat 1's main copy,
 * not the footer, per Grant 2026-05-25. The footer stays focused on the
 * institutional signal (RISE) + the structural-trust signal (open
 * source, here's the code).
 *
 * Voice rules: NO em-dashes, NO emojis. The RISE logo is an inline SVG
 * (see WisconsinRiseLogo.tsx) so it ships with the bundle and stays
 * resolution-independent at any viewport.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";

export default function CredentialsFooter() {
  return (
    <div
      className="mt-6 flex w-full max-w-2xl flex-col items-center gap-2 text-center text-xs text-slate-300"
      data-testid="pre-onboarding-credentials"
    >
      <p className="leading-relaxed">
        Funded in part by the{" "}
        <span className="font-semibold text-slate-100">
          UW-Madison RISE Initiative
        </span>
        . Free and open source on{" "}
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
      {/* Logo on a soft white panel so the cream shield border + red
          field read correctly against the dark gradient backdrop. */}
      <div className="flex items-center justify-center rounded-md bg-white/95 px-4 py-2 shadow-sm">
        <WisconsinRiseLogo className="h-12 w-auto" />
      </div>
    </div>
  );
}
