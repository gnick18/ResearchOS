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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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

          <p className="text-gray-600 text-sm mb-6">
            {DONATION_CONFIG.message}
          </p>

          <div className="space-y-3">
            {DONATION_CONFIG.paypalLink && (
              <a
                href={DONATION_CONFIG.paypalLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors"
              >
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">PP</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">PayPal</p>
                  <p className="text-xs text-gray-500">Quick and secure</p>
                </div>
                <svg aria-hidden className="w-5 h-5 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}

            {DONATION_CONFIG.venmoHandle && (
              <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-sm">V</span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Venmo</p>
                    <p className="text-xs text-gray-500">Direct payment</p>
                  </div>
                </div>
                <div className="text-sm">
                  <p className="text-gray-700">
                    <span className="text-gray-500">Handle:</span>{" "}
                    <code className="bg-white px-2 py-0.5 rounded text-purple-700">
                      {DONATION_CONFIG.venmoHandle}
                    </code>
                  </p>
                </div>
              </div>
            )}
          </div>

          <p className="text-center text-gray-400 text-xs mt-6">
            Thank you for your support!
          </p>
        </div>
      </div>
    </div>
  );
}
