"use client";

import { useEffect, useState } from "react";
import BeakerBot from "./BeakerBot";
import BeakerBotMouseWaveScene from "./BeakerBotMouseWaveScene";
import { APP_CHANNEL } from "@/lib/version";
import type { ReleaseNote } from "@/lib/release-notes";

/**
 * <WhatsNewModal /> (whats-new bot)
 *
 * The developer-announcement / "What's New" popup. BeakerBot waves from
 * the top, the latest release's "ResearchOS vX.Y.Z" heading + highlight
 * bullets fill the body, and a single "Got it" button dismisses.
 *
 * Two display shapes, driven by `releases`:
 *   - CATCH-UP (from the manager): `releases` is the missed list,
 *     newest-first, defaulting open on the LATEST release. When more than
 *     one release was missed, a "View all N updates" expander reveals the
 *     rest inline, newest first.
 *   - FULL HISTORY (from Settings "What's new"): `releases` is the entire
 *     eligible log; the expander is pre-expanded so the user sees every
 *     release at once.
 *
 * Purely presentational: it does not read or write the seen-version.
 * Dismiss is the caller's concern (the manager records last-seen; the
 * Settings re-open just closes). House style: no em-dashes, no emojis,
 * BeakerBot is the only mascot, and the icon-only close affordance carries
 * an aria-label.
 */

interface Props {
  /** Releases to display, NEWEST FIRST. The first entry is the headline. */
  releases: ReadonlyArray<ReleaseNote>;
  /** Called when the user dismisses (Got it / close / Escape / backdrop). */
  onDismiss: () => void;
  /** When true, every release is shown expanded from the start (the
   *  Settings "full history" view). Default false (catch-up view, which
   *  starts collapsed to the headline release with an expander). */
  showAllExpanded?: boolean;
  /** Fire the corner BeakerBot wave scene once when the modal opens.
   *  Default true; the Settings on-demand re-open passes false so a
   *  deliberate "show me the history" click does not also trigger the
   *  flourish. */
  waveOnOpen?: boolean;
}

/** Format a release's display heading, e.g. "ResearchOS v0.1.0 beta". */
function releaseHeading(version: string): string {
  return APP_CHANNEL
    ? `ResearchOS v${version} ${APP_CHANNEL}`
    : `ResearchOS v${version}`;
}

function formatDate(iso: string): string {
  // Display-only; parse defensively so a malformed date never throws in
  // render. Falls back to the raw string.
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function ReleaseBlock({ release }: { release: ReleaseNote }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900">
          {releaseHeading(release.version)}
        </h3>
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {formatDate(release.date)}
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {release.highlights.map((h, i) => (
          <li
            key={i}
            className="flex gap-2 text-sm text-gray-700 leading-snug"
          >
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-sky-400"
            />
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function WhatsNewModal({
  releases,
  onDismiss,
  showAllExpanded = false,
  waveOnOpen = true,
}: Props) {
  const [expanded, setExpanded] = useState(showAllExpanded);
  const [waveActive, setWaveActive] = useState(waveOnOpen);

  // Escape-to-dismiss, matching the rest of the modal family.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (releases.length === 0) return null;

  const [headline, ...rest] = releases;
  const extra = rest.length;
  // In the catch-up view the older missed releases hide behind the
  // expander; in the full-history view they are always shown.
  const showRest = showAllExpanded || expanded;

  return (
    <>
      {/* Corner wave flourish. Fire-and-forget overlay (portals to body),
          mirroring how CelebrationManager mounts the same scene. */}
      {waveActive && (
        <BeakerBotMouseWaveScene
          active
          onComplete={() => setWaveActive(false)}
        />
      )}

      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        // Hide the v4 walkthrough ring while this popup is mounted (the
        // manager already suppresses during a tour, but keep parity with
        // the rest of the modal family for the on-demand Settings re-open).
        data-tour-popup-occluding="whats-new"
        onClick={onDismiss}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="whats-new-title"
          data-testid="whats-new-modal"
          className="relative w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header: BeakerBot waving over a soft sky wash. */}
          <div className="relative flex flex-col items-center bg-gradient-to-b from-sky-50 to-white pt-6 pb-4 px-6">
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close what's new"
              data-testid="whats-new-close"
              className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <BeakerBot
              pose="waving"
              className="w-20 h-20 text-sky-500"
              ariaLabel="BeakerBot waving"
            />
            <p
              id="whats-new-title"
              className="mt-2 text-lg font-bold text-gray-900"
            >
              What&apos;s new
            </p>
            <p className="text-xs text-gray-500">
              Here is what changed since you were last in.
            </p>
          </div>

          {/* Body: the headline release, then (optionally) the rest. */}
          <div className="px-6 pb-2 space-y-5 max-h-[50vh] overflow-y-auto">
            <ReleaseBlock release={headline} />

            {extra > 0 && !showAllExpanded && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                data-testid="whats-new-view-all"
                className="text-sm font-medium text-sky-600 hover:text-sky-700 hover:underline"
              >
                View all {releases.length} updates
              </button>
            )}

            {extra > 0 &&
              showRest &&
              rest.map((r) => (
                <div
                  key={r.version}
                  className="border-t border-gray-100 pt-4"
                >
                  <ReleaseBlock release={r} />
                </div>
              ))}
          </div>

          {/* Footer: single dismiss button. */}
          <div className="px-6 py-4">
            <button
              type="button"
              onClick={onDismiss}
              data-testid="whats-new-got-it"
              className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
