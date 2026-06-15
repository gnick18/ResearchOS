"use client";

/**
 * Origin credentials stamp.
 *
 * Fixed-position card in the bottom-right corner of the viewport. Lives
 * on the folder-connect gate (`FolderConnectGate`) as a structural
 * "real academic project, not a data-harvesting scheme" signal that
 * sits visibly out of the main column. Renamed and re-homed from the
 * retired pre-onboarding modal's `CredentialsFooter` on 2026-05-25.
 *
 * Two signals:
 *   1. Origin credit: ResearchOS grew out of a UW-Madison Distinguished
 *      Research Fellowship (origin only, no claim of ongoing funding)
 *   2. Free + open source, with a link to the public GitHub repo
 *
 * Wording (2026-06-15, per UW OVCR request): the credit is origin-only and must
 * not state or imply that UW-Madison or WARF funding supports the company. The
 * earlier "supported by ... with funding from the Wisconsin Alumni Research
 * Foundation" text was changed to this origin credit. No logo is shown.
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
        ResearchOS grew out of work begun during a UW-Madison Distinguished
        Research Fellowship.
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
