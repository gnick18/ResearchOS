"use client";

import { useState, type ReactNode } from "react";

/**
 * PickerTrustSections
 *
 * Three quiet, default-collapsed strips that live under the main
 * "Link Folder / Create New Folder" cards on `ResearchFolderSetupNew`.
 * Each strip is reference material for a fresh visitor: users who
 * already trust the app can skip past visually, users who want
 * reassurance can expand and read.
 *
 * Replaces the retired 4-beat pre-onboarding modal's Security,
 * FolderChoice, and CloudProvider beats — all three were forced reads
 * before the picker showed up; here they are optional reads alongside
 * the picker. Copy is salvaged verbatim where it still lands, polished
 * lightly where the new context (no mascot speech bubble framing it)
 * needs a different lead-in.
 *
 * Voice rules: plain English, no jargon, no em-dashes, no emojis. All
 * icons are inline SVG.
 */

interface CollapsibleStripProps {
  /** Stable id for the test hooks and aria-controls wiring. */
  id: string;
  /** Plain-English label rendered on the chevron button. */
  label: string;
  /** Body content rendered when expanded. */
  children: ReactNode;
}

function CollapsibleStrip({ id, label, children }: CollapsibleStripProps) {
  const [open, setOpen] = useState(false);
  const bodyId = `${id}-body`;
  return (
    <div
      className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm"
      data-testid={id}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-slate-200 transition-colors hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        data-testid={`${id}-toggle`}
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          className={`text-slate-400 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </span>
      </button>
      {open && (
        <div
          id={bodyId}
          className="border-t border-white/10 px-4 py-4 text-sm leading-relaxed text-slate-300"
          data-testid={`${id}-body`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface ProviderCard {
  name: string;
  caption: string;
  href: string;
}

// Alphabetical, matches the retired CloudProviderBeat ordering. Wiki
// pages live under `/wiki/shared-lab-accounts/<slug>` (existing
// convention).
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

export default function PickerTrustSections() {
  return (
    <div
      className="mt-6 flex flex-col gap-2"
      data-testid="picker-trust-sections"
    >
      <CollapsibleStrip
        id="picker-trust-security"
        label="Your data stays on your computer"
      >
        <p className="mb-3 text-slate-300">
          ResearchOS is local-first. The folder you pick is yours. Every
          experiment, note, and measurement lives inside it on your
          machine, and the browser reads and writes that folder directly
          through your operating system (a feature called the File System
          Access API). No upload step happens.
        </p>
        <ul className="mb-3 space-y-2">
          <li className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-400"
            />
            <span>
              <strong className="font-semibold text-slate-100">
                Nothing uploads.
              </strong>{" "}
              Your research never leaves your computer. There is no
              ResearchOS server reading your folder.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-400"
            />
            <span>
              <strong className="font-semibold text-slate-100">
                We cannot see your data.
              </strong>{" "}
              Even if we wanted to, we have no way to read what is in
              your folder. The website only sees what your browser shows
              on screen.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-400"
            />
            <span>
              <strong className="font-semibold text-slate-100">
                No analytics on your research.
              </strong>{" "}
              We do not log the contents of your notes, measurements, or
              files anywhere.
            </span>
          </li>
        </ul>
        <p className="text-xs text-slate-400">
          Backups and sharing are your call. If you ever want to sync
          across devices or share with the lab, you can put the folder
          inside a cloud-sync app like Dropbox or OneDrive. See the next
          section for the setup guides.
        </p>
      </CollapsibleStrip>

      <CollapsibleStrip
        id="picker-trust-local-vs-cloud"
        label="Local folder or cloud-synced? Help me decide."
      >
        <p className="mb-3 text-slate-300">
          The picker above accepts either kind of folder. The difference
          is where the folder lives on disk:
        </p>
        <ul className="mb-3 space-y-2">
          <li className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-400"
            />
            <span>
              <strong className="font-semibold text-slate-100">
                Local folder.
              </strong>{" "}
              A folder on your machine, outside any cloud-sync app. Fast,
              simple, no sync. Recommended for solo use.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-400"
            />
            <span>
              <strong className="font-semibold text-slate-100">
                Cloud-synced folder.
              </strong>{" "}
              A folder inside Dropbox, OneDrive, Google Drive, Box, or
              iCloud Drive. Requires the provider&apos;s desktop app
              already installed and syncing. Use this when you want to
              work across devices or share a folder with the lab.
            </span>
          </li>
        </ul>
        <p className="text-xs text-slate-400">
          Not sure? Pick local. It is the fastest path and you can move
          the folder into a cloud-sync app at any time.
        </p>
      </CollapsibleStrip>

      <CollapsibleStrip
        id="picker-trust-cloud-setup"
        label="Setting up cloud sync? Pick your provider."
      >
        <p className="mb-3 text-slate-300">
          Make sure your provider&apos;s desktop app is installed and the
          folder you want to use is already syncing on your machine. The
          guides below walk through each one.
        </p>
        <ul
          className="mb-3 grid gap-2 sm:grid-cols-2"
          data-testid="picker-trust-cloud-provider-list"
        >
          {PROVIDER_CARDS.map((p) => (
            <li key={p.name}>
              <a
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-left transition-colors hover:border-sky-400/50 hover:bg-sky-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                data-testid={`picker-trust-provider-${p.name
                  .toLowerCase()
                  .replace(/\s+/g, "-")}`}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-slate-100">
                    {p.name}
                  </span>
                  <span className="text-xs text-slate-400">{p.caption}</span>
                </span>
                <span aria-hidden="true" className="text-slate-400">
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
        <p className="text-xs text-slate-400">
          Once the provider&apos;s app is syncing, come back here and
          pick the synced folder above.
        </p>
      </CollapsibleStrip>
    </div>
  );
}
