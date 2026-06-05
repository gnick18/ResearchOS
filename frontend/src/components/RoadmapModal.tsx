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
  "in-progress": "bg-emerald-100 text-emerald-700",
  "building-next": "bg-sky-100 text-sky-700",
  "coming-soon": "bg-violet-100 text-violet-700",
  exploring: "bg-amber-100 text-amber-700",
  "on-the-horizon": "bg-slate-100 text-slate-600",
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-tight ${STATUS_CLS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Feature icons (inline SVG, no lucide, no emojis)                           */
/* -------------------------------------------------------------------------- */

/** Two overlapping cursor arrows — live collaboration. */
function CollabIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky-600"
    >
      {/* Cursor A */}
      <path d="M5 4l4.5 13.5 2.5-4.5 5 -0.5z" />
      {/* Cursor B, offset */}
      <path d="M13 10l4.5 13.5 2.5-4.5 5-0.5z" className="opacity-60" />
    </svg>
  );
}

/** Two people with an arrow between them — cross-lab sharing. */
function SharingIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky-600"
    >
      <circle cx="7" cy="9" r="3" />
      <path d="M1 22c0-4 2.5-6 6-6" />
      <circle cx="21" cy="9" r="3" />
      <path d="M27 22c0-4-2.5-6-6-6" />
      <path d="M10.5 14.5h7m-2.5-2.5l2.5 2.5-2.5 2.5" />
    </svg>
  );
}

/** A cloud with an up-arrow — NIH / Zenodo deposit. */
function CloudUploadIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky-600"
    >
      <path d="M20 18a5 5 0 000-10 7 7 0 00-13.5 2.5A4.5 4.5 0 006 20" />
      <polyline points="12 14 14 12 16 14" />
      <line x1="14" y1="12" x2="14" y2="20" />
    </svg>
  );
}

/** A barcode with a scan line — inventory / barcode scan. */
function BarcodeIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky-600"
    >
      {/* bars */}
      <line x1="5" y1="7" x2="5" y2="19" />
      <line x1="8" y1="7" x2="8" y2="19" strokeWidth="2.2" />
      <line x1="11" y1="7" x2="11" y2="19" />
      <line x1="14" y1="7" x2="14" y2="19" strokeWidth="2.2" />
      <line x1="17" y1="7" x2="17" y2="19" />
      <line x1="20" y1="7" x2="20" y2="19" strokeWidth="2.2" />
      <line x1="23" y1="7" x2="23" y2="19" />
      {/* scan line */}
      <line x1="3" y1="13" x2="25" y2="13" strokeWidth="1" strokeDasharray="2 1" className="text-emerald-500" stroke="currentColor" />
    </svg>
  );
}

/** A phone outline — mobile app. */
function PhoneIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky-600"
    >
      <rect x="8" y="3" width="12" height="22" rx="2" />
      <line x1="14" y1="20" x2="14" y2="20" strokeWidth="2" strokeLinecap="round" />
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
    title: "Live collaboration",
    status: "in-progress",
    description:
      "Google-Docs-style simultaneous editing on notes, methods, and experiments.",
    icon: <CollabIcon />,
  },
  {
    title: "Cross-lab sharing",
    status: "building-next",
    description:
      "Send a note, method, or project to anyone by email — even a different lab, no shared folder needed.",
    icon: <SharingIcon />,
  },
  {
    title: "NIH + Zenodo deposit",
    status: "coming-soon",
    description:
      "One-click deposit to Zenodo with your grant number and ORCID pre-filled. Supports your NIH Data Management Plan.",
    icon: <CloudUploadIcon />,
  },
  {
    title: "Lab inventory + barcode scan",
    status: "exploring",
    description:
      "Track reagents and consumables by scanning barcodes. Beta-requested; pairs with the mobile app.",
    icon: <BarcodeIcon />,
  },
  {
    title: "Mobile app",
    status: "on-the-horizon",
    description:
      "A full ResearchOS experience on iOS and Android, beyond the current Telegram bench-capture inbox.",
    icon: <PhoneIcon />,
  },
];

/* -------------------------------------------------------------------------- */
/* Feature card                                                                */
/* -------------------------------------------------------------------------- */

function FeatureCard({ feature, isLast }: { feature: Feature; isLast: boolean }) {
  return (
    <div className="relative flex flex-col gap-3">
      {/* Connector line between cards on desktop (not on the last card) */}
      {!isLast && (
        <div
          aria-hidden
          className="absolute left-full top-[28px] hidden w-6 -translate-y-1/2 border-t border-dashed border-[#d3deec] md:block"
          style={{ zIndex: 1 }}
        />
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-[#e3eaf3] bg-white p-5 shadow-[0_1px_3px_rgba(15,40,80,0.06)] transition-shadow hover:shadow-[0_4px_14px_rgba(15,40,80,0.10)]">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[#eef4fb]">
            {feature.icon}
          </div>
          <StatusBadge status={feature.status} />
        </div>
        <h3 className="text-[15px] font-bold leading-snug tracking-tight text-[#0e1726]">
          {feature.title}
        </h3>
        <p className="text-[13px] leading-relaxed text-[#475569]">
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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d3e8c8] bg-[#f0faf0] px-3 py-1.5 text-[12px] font-medium text-[#2d6a2d]">
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
  // Keyboard close + body scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Prevent body scroll while modal is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="What we're building"
    >
      {/* Modal panel — stop propagation so clicks inside don't close */}
      <div
        className="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_rgba(0,0,0,0.18)] ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-[#e8f0f8] px-6 py-4">
          <div>
            <h2 className="text-[18px] font-extrabold tracking-tight text-[#0e1726]">
              What we&apos;re building
            </h2>
            <p className="mt-0.5 text-[13px] text-[#8593a8]">
              Shaped by what labs ask for and built in the open.
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* ── Scrollable body ───────────────────────────────────────── */}
        <div className="max-h-[80vh] overflow-y-auto px-6 pb-6 pt-5">
          {/* Section A: upcoming features */}
          <div className="mb-5">
            <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#1283c9]">
              // upcoming
            </p>

            {/* Desktop: horizontal strip connected by dashed lines.
                On md+ we use a grid of equal columns. On mobile we stack. */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5 md:gap-0">
              {FEATURES.map((feature, i) => (
                <div
                  key={feature.title}
                  className={`relative ${
                    i < FEATURES.length - 1
                      ? "md:pr-6"
                      : ""
                  }`}
                >
                  {/* Dashed connector on desktop between cards */}
                  {i < FEATURES.length - 1 && (
                    <div
                      aria-hidden
                      className="absolute right-0 top-9 hidden h-px w-6 border-t border-dashed border-[#d3deec] md:block"
                    />
                  )}
                  <FeatureCard feature={feature} isLast={i === FEATURES.length - 1} />
                </div>
              ))}
            </div>
          </div>

          {/* Section B: recently shipped */}
          <div className="rounded-xl border border-[#e8f0f8] bg-[#f6fbf6] px-4 py-4">
            <p className="mb-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#2d6a2d]">
              // recently shipped
            </p>
            <div className="flex flex-wrap gap-2">
              {SHIPPED.map((label) => (
                <ShippedChip key={label} label={label} />
              ))}
            </div>
          </div>

          {/* Footer note */}
          <p className="mt-4 text-center text-[12px] leading-relaxed text-[#94a3b8]">
            Have a feature request?{" "}
            <a
              href="mailto:gnickles@wisc.edu"
              className="font-medium text-[#1283c9] underline underline-offset-2 hover:text-sky-700"
            >
              gnickles@wisc.edu
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
