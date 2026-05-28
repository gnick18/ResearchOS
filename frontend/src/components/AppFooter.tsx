"use client";

import Image from "next/image";
import Link from "next/link";
import { APP_VERSION_LABEL } from "@/lib/version";

/**
 * In-flow site footer for long scrollable content pages (Settings today).
 *
 * Fills the empty tail below short pages with a clean credit + links bar
 * instead of blank whitespace. Two halves:
 *   1. Funding credit: the official UW-Madison RISE Initiative logo + a
 *      "free and open source" line (the same trust signal the
 *      folder-picker's RiseCredentialsStamp carries, restated in-flow).
 *   2. A small link row: GitHub repo, the MIT license, the in-app docs,
 *      and the current version label.
 *
 * Light-themed to match the Settings surface. The logo sits on a white
 * panel so the cream shield reads crisply. Voice rules: no em-dashes, no
 * emojis (every glyph here is text or the official PNG). Pass `className`
 * (e.g. "mt-auto") so a flex-column parent can pin it to the bottom.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";
const LICENSE_URL = "https://github.com/gnick18/ResearchOS/blob/main/LICENSE";

export default function AppFooter({ className = "" }: { className?: string }) {
  const linkClass =
    "text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline transition-colors";
  return (
    <footer
      data-testid="app-footer"
      className={`w-full border-t border-gray-200 bg-gray-50/70 px-6 py-6 ${className}`}
    >
      <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded bg-white p-1 shadow-sm ring-1 ring-gray-200">
            <Image
              src="/credentials/uw-rise-logo.png"
              alt="Wisconsin RISE Initiative (Wisconsin Research, Innovation and Scholarly Excellence)"
              width={260}
              height={69}
              className="h-7 w-auto"
              unoptimized
            />
          </span>
          <p className="text-xs leading-tight text-gray-500">
            Funded for a limited time by a UW–Madison RISE-AI fellowship.
            <br />
            Free and open source. Your data stays on your machine.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            data-testid="app-footer-github"
          >
            GitHub
          </a>
          <a
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            data-testid="app-footer-license"
          >
            MIT License
          </a>
          <Link href="/wiki" className={linkClass}>
            Docs
          </Link>
          <span className="text-gray-400" data-testid="app-footer-version">
            {APP_VERSION_LABEL}
          </span>
        </div>
      </div>
    </footer>
  );
}
