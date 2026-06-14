"use client";

/**
 * RoadmapModal — "What we're building" popup.
 *
 * Shows a horizontal roadmap strip of upcoming features (Section A) plus a
 * compact "recently shipped" row (Section B). Pure client component. No auth
 * hooks, no session, no server state.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons. Warm, contractions
 * OK. Every icon is an inline SVG. Palette matches WelcomePage.
 */

import { useEffect, type ReactNode } from "react";

import LivingPopup from "@/components/ui/LivingPopup";
import Tooltip from "@/components/Tooltip";

/* -------------------------------------------------------------------------- */
/* Status badge config                                                         */
/* -------------------------------------------------------------------------- */

type Status =
  | "in-progress"
  | "building-next"
  | "coming-soon"
  | "exploring"
  | "on-the-horizon";

const STATUS_LABEL: Record<Status, string> = {
  "in-progress": "In progress",
  "building-next": "Building next",
  "coming-soon": "Coming soon",
  exploring: "Exploring",
  "on-the-horizon": "On the horizon",
};

const STATUS_CLS: Record<Status, string> = {
  "in-progress": "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "building-next": "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "coming-soon": "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300",
  exploring: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "on-the-horizon": "bg-surface-sunken text-foreground-muted",
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-meta font-semibold leading-tight ${STATUS_CLS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Feature icons (inline SVG, no lucide, no emojis)                           */
/* -------------------------------------------------------------------------- */

/** Document going up into a repository — NIH / Zenodo deposit. */
function CloudUploadIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky-600 dark:text-sky-300"
    >
      <path d="M12 15V3m0 0l-3 3m3-3l3 3" />
      <path d="M8 19H5a2 2 0 01-2-2v-1" />
      <path d="M16 19h3a2 2 0 002-2v-1" />
      <rect x="6" y="17" width="12" height="4" rx="1" />
    </svg>
  );
}

/** Barcode with corner brackets — lab inventory and barcode scan. */
function BarcodeIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky-600 dark:text-sky-300"
    >
      <path d="M4 7V5h3" />
      <path d="M17 5h3v2" />
      <path d="M4 17v2h3" />
      <path d="M17 19h3v-2" />
      <line x1="7" y1="8" x2="7" y2="16" />
      <line x1="10" y1="8" x2="10" y2="16" strokeWidth="2.5" />
      <line x1="13" y1="8" x2="13" y2="16" />
      <line x1="16" y1="8" x2="16" y2="16" strokeWidth="2.5" />
    </svg>
  );
}

/** Clean phone outline with home indicator — mobile app. */
function PhoneIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky-600 dark:text-sky-300"
    >
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <line x1="12" y1="18" x2="12" y2="18" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="9" y1="6" x2="15" y2="6" />
    </svg>
  );
}

/** Two-way sync arrows — connecting an existing ordering tool (Quartzy). */
function SyncIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky-600 dark:text-sky-300"
    >
      <path d="M4 9a8 8 0 0 1 13.7-4.3L20 7" />
      <path d="M20 4v3h-3" />
      <path d="M20 15a8 8 0 0 1-13.7 4.3L4 17" />
      <path d="M4 20v-3h3" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Feature card data                                                           */
/* -------------------------------------------------------------------------- */

interface Feature {
  title: string;
  status: Status;
  description: string;
  icon: ReactNode;
}

const FEATURES: Feature[] = [
  {
    title: "One-click Zenodo deposit",
    status: "coming-soon",
    description:
      "Publish straight to Zenodo from the browser with your grant number and ORCID pre-filled, so the DOI comes back without leaving the app. Guided deposit ships today.",
    icon: <CloudUploadIcon />,
  },
  {
    title: "Barcode scanning",
    status: "exploring",
    description:
      "Scan reagent and consumable barcodes to track them in your existing inventory. Beta-requested; pairs with the phone app.",
    icon: <BarcodeIcon />,
  },
  {
    title: "Quartzy ordering sync",
    status: "exploring",
    description:
      "Connect your free Quartzy account so orders, receipts, and inventory flow both ways, no need to leave the ordering tools your lab already uses.",
    icon: <SyncIcon />,
  },
  {
    title: "Mobile app",
    status: "on-the-horizon",
    description:
      "A full ResearchOS experience on iOS and Android. The phone companion app (bench capture, quick notes, today glance) is the first step.",
    icon: <PhoneIcon />,
  },
];

/* -------------------------------------------------------------------------- */
/* Feature card                                                                */
/* -------------------------------------------------------------------------- */

function FeatureCard({ feature, isLast }: { feature: Feature; isLast: boolean }) {
  return (
    <div className="relative flex h-full flex-col gap-3">
      {/* Connector line between cards on desktop (not on the last card) */}
      {!isLast && (
        <div
          aria-hidden
          className="absolute left-full top-[28px] hidden w-6 -translate-y-1/2 border-t border-dashed border-[#d3deec] md:block"
          style={{ zIndex: 1 }}
        />
      )}

      <div className="flex h-full flex-col gap-3 rounded-2xl border border-[#e3eaf3] bg-surface-raised p-5 shadow-[0_1px_3px_rgba(15,40,80,0.06)] transition-shadow hover:shadow-[0_4px_14px_rgba(15,40,80,0.10)]">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[#eef4fb]">
            {feature.icon}
          </div>
          <StatusBadge status={feature.status} />
        </div>
        <h3 className="text-body font-bold leading-snug tracking-tight text-[#0e1726]">
          {feature.title}
        </h3>
        <p className="text-meta leading-relaxed text-[#475569]">
          {feature.description}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Recently shipped chips                                                      */
/* -------------------------------------------------------------------------- */

const SHIPPED = [
  "Version history and 24h undo",
  "91 protocols from major biotech",
  "Built-in lab calculators",
  "Smart reordering in Purchases",
];

function ShippedChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d3e8c8] bg-[#f0faf0] px-3 py-1.5 text-meta font-medium text-[#2d6a2d]">
      {/* Small checkmark */}
      <svg
        width="11"
        height="11"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M2 6.5l2.5 2.5L10 3" />
      </svg>
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Close button                                                                */
/* -------------------------------------------------------------------------- */

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip label="Close">
      <button
        type="button"
        onClick={onClick}
        aria-label="Close roadmap"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-[#8593a8] transition-colors hover:bg-[#eef4fb] hover:text-[#0e1726]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M3 3l10 10M13 3L3 13" />
        </svg>
      </button>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/* RoadmapModal                                                                */
/* -------------------------------------------------------------------------- */

export interface RoadmapModalProps {
  open: boolean;
  onClose: () => void;
}

export default function RoadmapModal({ open, onClose }: RoadmapModalProps) {
  // Body scroll lock while open. LivingPopup owns the scrim, the zoom, the X,
  // and closing on Escape / click-outside.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="What we're building"
      widthClassName="max-w-5xl"
      card={false}
    >
      {/* This marketing card brings its own white chrome (card=false above). */}
      <div className="relative w-full overflow-hidden rounded-2xl bg-surface-overlay border border-border shadow-[0_24px_64px_rgba(0,0,0,0.18)] ring-1 ring-black/5">
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-[#e8f0f8] px-6 py-4">
          <div>
            <h2 className="text-title font-extrabold tracking-tight text-[#0e1726]">
              What we&apos;re building
            </h2>
            <p className="mt-0.5 text-meta text-[#8593a8]">
              Shaped by what labs ask for and built in the open.
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* ── Scrollable body ───────────────────────────────────────── */}
        <div className="max-h-[80vh] overflow-y-auto px-8 pb-8 pt-6">
          {/* Section A: upcoming features */}
          <div className="mb-6">
            <p className="mb-4 font-mono text-meta font-semibold uppercase tracking-[0.1em] text-[#1283c9]">
              {"// upcoming"}
            </p>

            {/* Desktop: horizontal strip connected by dashed lines.
                On md+ we use a grid of equal columns. On mobile we stack. */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4 md:auto-rows-fr md:gap-0">
              {FEATURES.map((feature, i) => (
                <div
                  key={feature.title}
                  className={`relative ${
                    i < FEATURES.length - 1
                      ? "md:pr-5"
                      : ""
                  }`}
                >
                  {/* Dashed connector on desktop between cards */}
                  {i < FEATURES.length - 1 && (
                    <div
                      aria-hidden
                      className="absolute right-0 top-9 hidden h-px w-5 border-t border-dashed border-[#d3deec] md:block"
                    />
                  )}
                  <FeatureCard feature={feature} isLast={i === FEATURES.length - 1} />
                </div>
              ))}
            </div>
          </div>

          {/* Section B: recently shipped */}
          <div className="rounded-xl border border-[#e8f0f8] bg-[#f6fbf6] px-5 py-5">
            <p className="mb-3 font-mono text-meta font-semibold uppercase tracking-[0.1em] text-[#2d6a2d]">
              {"// recently shipped"}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {SHIPPED.map((label) => (
                <ShippedChip key={label} label={label} />
              ))}
            </div>
          </div>

          {/* Feature request button */}
          <div className="mt-6 flex justify-center">
            <a
              href="mailto:gnickles@wisc.edu?subject=ResearchOS%20feature%20request"
              className="inline-flex items-center gap-2 rounded-xl border border-[#d3deec] bg-surface-raised px-5 py-2.5 text-body font-semibold text-[#0e1726] shadow-sm transition-all hover:border-[#1283c9] hover:text-[#1283c9] hover:shadow-md"
            >
              Request a feature
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden>
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </a>
          </div>
          <p className="mt-2 text-center text-meta text-[#b0bac8]">
            Shaped by what labs ask for. We read every request.
          </p>
        </div>
      </div>
    </LivingPopup>
  );
}
