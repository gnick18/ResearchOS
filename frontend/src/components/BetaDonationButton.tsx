"use client";

import { useState } from "react";
import { DONATION_CONFIG, isDonationConfigured } from "@/lib/config/donation";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";

interface BetaDonationButtonProps {
  variant?: "floating" | "link";
  /**
   * Color tone for the `link` variant. "dark" (default) suits the dark
   * onboarding / login screens; "light" suits light surfaces like Settings.
   */
  tone?: "dark" | "light";
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

export default function BetaDonationButton({
  variant = "floating",
  tone = "dark",
}: BetaDonationButtonProps) {
  const [showModal, setShowModal] = useState(false);

  if (!DONATION_CONFIG.enabled || !isDonationConfigured()) {
    return null;
  }

  if (variant === "link") {
    const toneCls =
      tone === "light"
        ? "text-foreground-muted hover:text-rose-600 focus-visible:ring-offset-white"
        : "text-foreground-muted hover:text-white focus-visible:ring-offset-slate-900";
    return (
      <>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className={`${toneCls} text-meta transition-colors inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 rounded`}
        >
          <HeartIcon className="w-3.5 h-3.5" />
          Support this project
        </button>

        <DonationModal open={showModal} onClose={() => setShowModal(false)} />
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

      <DonationModal open={showModal} onClose={() => setShowModal(false)} />
    </>
  );
}

function DonationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    // pointer-events-auto wrapper (Grant 2026-05-27): DonationModal is
    // rendered inside AppShell's floating-cluster div which has
    // `pointer-events-none` so the cluster's bounding box doesn't eat
    // clicks on the underlying page. Without re-enabling pointer events the
    // LivingPopup scrim + X would silently no-op (the property inherits
    // through the DOM). The LivingPopup root is `fixed inset-0`, so this
    // wrapper has no layout box of its own.
    <div className="pointer-events-auto">
      <LivingPopup
        open={open}
        onClose={onClose}
        label="Support ResearchOS"
        widthClassName="max-w-md"
        card={false}
      >
        <div className="relative bg-surface-raised rounded-2xl ros-popup-card-shadow w-full overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-heading font-bold text-foreground flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300">
                  <HeartIcon className="w-4 h-4" />
                </span>
                Support ResearchOS
              </h2>
            </div>

          <p className="text-foreground-muted text-body mb-5">
            {DONATION_CONFIG.message}
          </p>

          <div className="rounded-xl border border-border bg-surface-sunken p-4 mb-5">
            <p className="mb-3 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              How ResearchOS stays free
            </p>
            <ul className="space-y-2.5 text-body text-foreground">
              <li>
                <span className="font-semibold text-foreground">
                  Free for every lab.
                </span>{" "}
                The hosted app and self-hosting are both free, with no paid tiers
                and no per-seat fees.
              </li>
              <li>
                <span className="font-semibold text-foreground">
                  Free by design.
                </span>{" "}
                ResearchOS is open source and local-first, so there are no servers
                to fund and nothing to pay to use it.
              </li>
              <li>
                <span className="font-semibold text-foreground">
                  Voluntary support, later.
                </span>{" "}
                Down the road, labs that come to rely on it and can afford to
                chip in keep it running, which is what keeps it free for the labs
                that cannot.
              </li>
              <li>
                <span className="font-semibold text-foreground">
                  Open source, yours to keep.
                </span>{" "}
                You can always run ResearchOS yourself from the public repo, even
                if the hosted version ever goes away.
              </li>
            </ul>
          </div>

          <p className="text-body text-foreground-muted">
            There is nothing to pay, not now and never as a requirement. The best
            way to support ResearchOS today is to use it, tell another lab about
            it, and send us feedback.
          </p>
          </div>
        </div>
      </LivingPopup>
    </div>
  );
}
