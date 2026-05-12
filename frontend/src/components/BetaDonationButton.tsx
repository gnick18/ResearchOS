"use client";

import { useState } from "react";
import { DONATION_CONFIG, isDonationConfigured } from "@/lib/config/donation";

interface BetaDonationButtonProps {
  variant?: "floating" | "link";
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
          onClick={() => setShowModal(true)}
          className="text-slate-500 hover:text-white text-xs transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
          </svg>
          Support this project
        </button>

        {showModal && (
          <DonationModal onClose={() => setShowModal(false)} />
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-6 left-6 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center gap-2 z-40"
        title="Support this project"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
        </svg>
        <span className="hidden sm:inline">Support</span>
      </button>

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
            <h2 className="text-xl font-bold text-gray-900">Support ResearchOS</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <svg className="w-5 h-5 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
