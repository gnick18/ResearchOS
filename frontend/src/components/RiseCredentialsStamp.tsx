"use client";

/**
 * Funding credentials stamp.
 *
 * Fixed-position card in the bottom-right corner of the viewport. Lives
 * on the folder-connect gate (`FolderConnectGate`) as a structural
 * "real academic project, not a data-harvesting scheme" signal that
 * sits visibly out of the main column. Renamed and re-homed from the
 * retired pre-onboarding modal's `CredentialsFooter` on 2026-05-25.
 *
 * Two signals:
 *   1. Funding source (a UW Distinguished Research Fellowship, with WARF
 *      funding), as the approved text acknowledgment
 *   2. Free + open source, with a link to the public GitHub repo
 *
 * Funding acknowledgment (2026-06-11): the old "UW-Madison RISE Initiative"
 * name + logo were retired here. We use the official program name and OVCR/WARF
 * wording instead. The logo is not shown, since logo usage on the product site
 * is pending OVCR (Cynthia) confirmation; text acknowledgment only.
 *
 * Voice rules: no em-dashes, no emojis. (File still named RiseCredentialsStamp
 * for import stability; an internal rename is a separate cleanup.)
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";

export default function RiseCredentialsStamp() {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-1 text-right text-meta text-slate-300"
      data-testid="rise-credentials-stamp"
    >
      <p className="pointer-events-auto max-w-[280px] leading-tight">
        Supported by a UW Distinguished Research Fellowship at UW-Madison, with
        funding from the Wisconsin Alumni Research Foundation.
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
