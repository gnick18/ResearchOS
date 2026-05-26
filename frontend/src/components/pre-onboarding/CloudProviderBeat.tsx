"use client";

/**
 * Pre-onboarding Beat 4: Cloud-provider setup (conditional).
 *
 * Only fires when the user picked "cloud-synced" on Beat 3. The job
 * here is to point the user at the per-provider wiki page for setting
 * up the desktop sync app, then send them on to the folder picker.
 *
 * The wiki pages live under `/wiki/shared-lab-accounts/<provider>`
 * (existing convention — OneDrive, Google Drive, Dropbox, iCloud are
 * already on disk; Box is referenced here so the wiki manager can fill
 * it in during P6 per the proposal §5). All five tiles emit links to
 * the expected wiki path even if the page does not exist yet — that
 * way the wiki manager only needs to create the markdown, not also
 * wire the link.
 *
 * Tiles open in a new tab so the user keeps the pre-onboarding flow
 * open behind them. The primary CTA ("I'm ready, pick the folder")
 * advances to `done`, which dismisses pre-onboarding and the existing
 * DataSetupScreen takes over (per L7 in the proposal).
 */
export interface CloudProviderBeatProps {
  onContinue: () => void;
}

interface ProviderCard {
  name: string;
  caption: string;
  href: string;
}

// Alphabetical ordering per open question #4 in the proposal — fair
// across providers and easy to scan. The wiki path conventions follow
// the existing `/wiki/shared-lab-accounts/<slug>` layout.
const PROVIDER_CARDS: ReadonlyArray<ProviderCard> = [
  {
    name: "Box",
    caption: "Sync via Box Drive",
    href: "/wiki/shared-lab-accounts/box",
  },
  {
    name: "Dropbox",
    caption: "Sync via the Dropbox desktop app",
    href: "/wiki/shared-lab-accounts/dropbox",
  },
  {
    name: "Google Drive",
    caption: "Sync via Google Drive for desktop",
    href: "/wiki/shared-lab-accounts/google-drive",
  },
  {
    name: "iCloud Drive",
    caption: "Sync via iCloud Drive (macOS)",
    href: "/wiki/shared-lab-accounts/icloud",
  },
  {
    name: "OneDrive",
    caption: "Sync via the OneDrive desktop app",
    href: "/wiki/shared-lab-accounts/onedrive",
  },
];

export default function CloudProviderBeat({
  onContinue,
}: CloudProviderBeatProps) {
  return (
    <div data-testid="pre-onboarding-beat-cloud-provider">
      <h2 className="mb-3 text-2xl font-bold text-slate-900">
        Cool, you picked cloud sync.
      </h2>
      <p className="mb-4 text-base leading-relaxed text-slate-700">
        Make sure your provider&apos;s desktop app is installed and the folder
        you want to use is already syncing on your machine. The setup guides
        below walk through each one.
      </p>
      <ul
        className="mb-4 grid gap-2 sm:grid-cols-2"
        data-testid="pre-onboarding-cloud-provider-list"
      >
        {PROVIDER_CARDS.map((p) => (
          <li key={p.name}>
            <a
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-sky-300 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
              data-testid={`pre-onboarding-provider-${p.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-slate-900">
                  {p.name}
                </span>
                <span className="text-xs text-slate-600">{p.caption}</span>
              </span>
              {/* External-link glyph: inline SVG, no icon lib */}
              <span
                aria-hidden="true"
                className="text-slate-400 transition-colors group-hover:text-sky-500"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 3.5h-2.5a1 1 0 0 0 -1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1 -1v-2.5" />
                  <path d="M9 2.5h4.5v4.5" />
                  <path d="M7 9l6.5 -6.5" />
                </svg>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mb-6 text-xs leading-relaxed text-slate-500">
        Once the provider&apos;s app is syncing, come back here and pick the
        synced folder when ResearchOS prompts you.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          data-testid="pre-onboarding-cloud-provider-continue"
        >
          I&apos;m ready, pick the folder
        </button>
      </div>
    </div>
  );
}
