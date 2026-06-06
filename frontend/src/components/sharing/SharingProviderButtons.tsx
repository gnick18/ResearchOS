"use client";

// The four branded third-party sign-in buttons used to kick off sharing setup.
// Extracted so the setup wizard's chooser AND the "you have no profile yet"
// encouragement cards (Settings, /profile) can show the same inviting buttons
// instead of a single grey "set up" button. The host decides what a click does
// via onProvider, so this component carries no navigation of its own.

import {
  GitHubIcon,
  GoogleIcon,
  LinkedInIcon,
  OrcidIcon,
} from "./icons";

export type SharingProvider = "orcid" | "google" | "github" | "linkedin";

export default function SharingProviderButtons({
  onProvider,
}: {
  onProvider: (provider: SharingProvider) => void;
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onProvider("orcid")}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-[#A6CE39] text-slate-900 hover:bg-[#8fb82e] font-medium transition-colors"
      >
        <OrcidIcon className="w-4 h-4" />
        Sign in with ORCID
      </button>
      <button
        type="button"
        onClick={() => onProvider("google")}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-surface-raised text-slate-800 hover:bg-slate-100 font-medium transition-colors border border-border"
      >
        <GoogleIcon className="w-4 h-4" />
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => onProvider("github")}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-[#24292e] text-white hover:bg-[#2f363d] font-medium transition-colors"
      >
        <GitHubIcon className="w-4 h-4" />
        Continue with GitHub
      </button>
      <button
        type="button"
        onClick={() => onProvider("linkedin")}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-[#0A66C2] text-white hover:bg-[#004182] font-medium transition-colors"
      >
        <LinkedInIcon className="w-4 h-4" />
        Continue with LinkedIn
      </button>
    </div>
  );
}
