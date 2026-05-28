// frontend/src/lib/deposit/repositories.ts
//
// Repository-deposit PHASE 1 (guided-deposit bot, 2026-05-28). The set of
// repositories the HANDOFF step can open, plus the honest framing of what
// each one supports today.
//
// Phase 1 is GUIDED only: we open the repository's own new-upload page in a
// new tab and the user drags the bundle + pastes the metadata. The
// repository mints the DOI. One-click programmatic publishing (Zenodo's
// browser-direct deposit API) is Phase 2 and is surfaced here as "coming
// soon" so the UI stays honest.
//
// No em-dashes, no emojis. Pure data + a tiny lookup helper; no I/O.

export type RepositoryId = "zenodo" | "figshare" | "other";

export interface RepositoryInfo {
  id: RepositoryId;
  name: string;
  // The page the handoff opens in a new tab so the user lands on the upload
  // form. `null` for "Other" (the user goes to their own repository).
  uploadUrl: string | null;
  // One-line description of the repository.
  blurb: string;
  // HONEST capability line shown in the handoff panel. Phase 1 guided deposit
  // works for both Zenodo and Figshare; we say so plainly and flag the
  // Zenodo one-click path as a later phase.
  guidedNote: string;
  // When true, the UI shows a small "One-click publishing coming soon" badge
  // (Zenodo only; its deposit API is browser-direct / CORS-open so Phase 2
  // can light it up without a server).
  oneClickComingSoon: boolean;
}

export const REPOSITORIES: RepositoryInfo[] = [
  {
    id: "zenodo",
    name: "Zenodo",
    uploadUrl: "https://zenodo.org/uploads/new",
    blurb:
      "CERN-operated, free, mints a DOI, and is widely accepted by NIH and other funders for data sharing.",
    guidedNote:
      "Guided deposit works today: open Zenodo's upload page, drag your bundle in, and paste the metadata below.",
    oneClickComingSoon: true,
  },
  {
    id: "figshare",
    name: "Figshare",
    uploadUrl: "https://figshare.com/account/articles/new",
    blurb:
      "Popular general-purpose research repository that also mints a DOI for your dataset.",
    guidedNote:
      "Guided deposit works today: open Figshare's new-item page, upload your bundle, and paste the metadata below.",
    // Figshare's deposit API is not browser-direct (no CORS for the token
    // flow), so a no-server one-click path is not on the near-term roadmap.
    // We do not promise it.
    oneClickComingSoon: false,
  },
  {
    id: "other",
    name: "Other repository",
    uploadUrl: null,
    blurb:
      "Any repository that accepts a file upload and a metadata form (your institution's repository, Dryad, OSF, etc.).",
    guidedNote:
      "Download the bundle and the metadata file below, then upload them to your repository's own web form.",
    oneClickComingSoon: false,
  },
];

/** Look up a repository by id. */
export function findRepository(id: RepositoryId): RepositoryInfo | undefined {
  return REPOSITORIES.find((r) => r.id === id);
}
