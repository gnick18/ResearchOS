"use client";

import { useState } from "react";
import { DONATION_CONFIG, isDonationConfigured } from "@/lib/config/donation";
import Tooltip from "@/components/Tooltip";

interface BetaDonationButtonProps {
  variant?: "floating" | "link";
}

/**
 * Stroke-style heart icon (Lucide-shape) — matches the rest of the app's
 * outline iconography. `aria-hidden` because the surrounding button/link
 * always carries the human-readable label or aria-label.
 */
function HeartIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export default function BetaDonationButton({ variant = "floating" }: BetaDonationButtonProps) {
  const [showModal, setShowModal] = useState(false);

  if (!DONATION_CONFIG.enabled || !isDonationConfigured()) {
    return null;
  }

  if (variant === "link") {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="text-slate-500 hover:text-white text-xs transition-colors inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 rounded"
        >
          <HeartIcon className="w-3.5 h-3.5" />
          Support this project
        </button>

        {showModal && (
          <DonationModal onClose={() => setShowModal(false)} />
        )}
      </>
    );
  }

  // Floating variant: icon-only round button. Positioning comes from the
  // AppShell floating cluster (flex row, fixed bottom-right), so the
  // button itself just declares its size/colors. Pairs with `<Tooltip>`
  // for the action label.
  return (
    <>
      <Tooltip label="Support this project" placement="top">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          aria-label="Support this project"
          className="pointer-events-auto w-12 h-12 rounded-full bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2"
        >
          <HeartIcon className="w-5 h-5" />
        </button>
      </Tooltip>

      {showModal && (
        <DonationModal onClose={() => setShowModal(false)} />
      )}
    </>
  );
}

function DonationModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      // pointer-events-auto (Grant 2026-05-27): DonationModal is
      // rendered inside AppShell's floating-cluster div which has
      // `pointer-events-none` so the cluster's bounding box doesn't
      // eat clicks on the underlying page. Without this override the
      // modal subtree inherits `pointer-events: none`, so the X
      // close button (and the backdrop) silently no-op. The heart
      // trigger button has its own `pointer-events-auto`; the modal
      // it spawns needs the same treatment.
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="donation-modal"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-rose-100 text-rose-600">
                <HeartIcon className="w-4 h-4" />
              </span>
              Support ResearchOS
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-600 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
            >
              <svg aria-hidden className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-gray-600 text-sm mb-5">
            {DONATION_CONFIG.message}
          </p>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              How ResearchOS stays free
            </p>
            <ul className="space-y-2.5 text-sm text-gray-700">
              <li>
                <span className="font-semibold text-gray-900">
                  Free for every lab.
                </span>{" "}
                The hosted app and self-hosting are both free, with no paid tiers
                and no per-seat fees.
              </li>
              <li>
                <span className="font-semibold text-gray-900">
                  Funded by a fellowship.
                </span>{" "}
                A UW-Madison RISE fellowship supports ResearchOS, so there is
                nothing to pay to use it.
              </li>
              <li>
                <span className="font-semibold text-gray-900">
                  Voluntary support, later.
                </span>{" "}
                Down the road, labs that come to rely on it and can afford to
                chip in keep it running, which is what keeps it free for the labs
                that cannot.
              </li>
              <li>
                <span className="font-semibold text-gray-900">
                  Open source, yours to keep.
                </span>{" "}
                You can always run ResearchOS yourself from the public repo, even
                if the hosted version ever goes away.
              </li>
            </ul>
          </div>

          <p className="text-sm text-gray-600">
            There is nothing to pay, not now and never as a requirement. The best
            way to support ResearchOS today is to use it, tell another lab about
            it, and send us feedback.
          </p>
        </div>
      </div>
    </div>
  );
}
