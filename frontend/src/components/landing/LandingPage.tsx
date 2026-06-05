"use client";

/**
 * First-time-visitor landing ("sell") page.
 *
 * Shown ONLY to a genuinely-new visitor before the connect-folder screen
 * (gated by shouldShowLanding in lib/landing/landing-gate.ts). Returning
 * visitors never reach it. The page sells the trust flip versus a cloud ELN:
 * your data, your machine, free, with a friendly guide (BeakerBot).
 *
 * Two render modes:
 *   - Inline-gate mode (AppContent passes `onGetStarted`): the primary CTA
 *     dismisses the landing in place and reveals the connect-folder screen.
 *   - Standalone `/welcome` route (no `onGetStarted`): the primary CTA marks
 *     the landing seen and navigates to /?connect=1 so a connected user lands
 *     back in the app and a truly-new visitor lands on the connect screen
 *     (never looping back here).
 *
 * BeakerBot is the only mascot. The hi-wave (MouseWave) fires once on mount
 * as a greeting. The scene honors prefers-reduced-motion internally. The
 * landing is pre-login, so there is no per-user animation setting to read yet;
 * we lean on the reduced-motion guard the scene already implements.
 *
 * Voice rules: no em-dashes, no emojis. Every icon is an inline SVG.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import BeakerBot from "../BeakerBot";
import BetaNotice from "../BetaNotice";
import VersionBadge from "../VersionBadge";
import AppFooter from "../AppFooter";
import Tooltip from "../Tooltip";
import { markLandingSeen } from "@/lib/landing/landing-gate";

interface LandingPageProps {
  /** Inline-gate mode: called when "Get Started" is clicked to dismiss the
   *  landing and reveal the connect-folder screen. When omitted (the
   *  standalone /welcome route), Get Started navigates to /?connect=1. */
  onGetStarted?: () => void;
}

/** A screenshot the lightbox can expand. */
interface LightboxImage {
  src: string;
  alt: string;
}

/** A single trust pillar: inline-SVG icon, title, blurb. */
function Pillar({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
        {icon}
      </div>
      <h3 className="text-title font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-body leading-relaxed text-gray-600">{children}</p>
    </div>
  );
}

/** A feature-showcase card: a privacy-safe fixture screenshot over a title
 *  and one-line blurb. Screenshots come from the wiki capture pipeline
 *  (public/wiki/screenshots), so they only ever show fabricated demo data. */
function FeatureCard({
  src,
  alt,
  title,
  children,
  onExpand,
}: {
  src: string;
  alt: string;
  title: string;
  children: ReactNode;
  onExpand: (image: LightboxImage) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* The screenshot is a button: clicking it opens the lightbox so the
          reader can see the detail without leaving the page. */}
      <button
        type="button"
        onClick={() => onExpand({ src, alt })}
        aria-label={`Expand image: ${alt}`}
        className="group relative block aspect-[16/10] w-full cursor-zoom-in overflow-hidden border-b border-gray-100 bg-slate-100"
      >
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
          className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {/* Hover affordance: a faint veil + a zoom-in chip so it reads as
            clickable. pointer-events-none so the button stays the target. */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-900/0 transition-colors duration-200 group-hover:bg-slate-900/20">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-gray-800 opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-3.5-3.5M11 8.5v5M8.5 11h5"
              />
            </svg>
          </span>
        </span>
      </button>
      <div className="p-5">
        <h3 className="text-title font-semibold text-gray-900">{title}</h3>
        <p className="mt-1.5 text-body leading-relaxed text-gray-600">
          {children}
        </p>
      </div>
    </div>
  );
}

/** A large image-plus-text "hero" band for a flagship feature: a big
 *  expandable screenshot on one side, an eyebrow + headline + prose + a short
 *  proof list on the other. Bands alternate which side the image sits on via
 *  `imageSide`; on mobile the image always stacks above the text. The
 *  screenshot reuses the same lightbox-expand affordance as FeatureCard so a
 *  reader can open it full size. */
function HeroBand({
  eyebrow,
  title,
  src,
  alt,
  imageSide,
  points,
  onExpand,
  children,
}: {
  eyebrow: string;
  title: string;
  src: string;
  alt: string;
  imageSide: "left" | "right";
  points: string[];
  onExpand: (image: LightboxImage) => void;
  children: ReactNode;
}) {
  const image = (
    <button
      type="button"
      onClick={() => onExpand({ src, alt })}
      aria-label={`Expand image: ${alt}`}
      className="group relative block aspect-[16/10] w-full cursor-zoom-in overflow-hidden rounded-2xl border border-gray-200 bg-slate-100 shadow-sm"
    >
      <Image
        src={src}
        alt={alt}
        fill
        unoptimized
        sizes="(max-width: 768px) 100vw, 50vw"
        className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
      />
      {/* Same hover veil + zoom chip as FeatureCard so it reads as clickable. */}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-900/0 transition-colors duration-200 group-hover:bg-slate-900/20">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-gray-800 opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-3.5-3.5M11 8.5v5M8.5 11h5"
            />
          </svg>
        </span>
      </span>
    </button>
  );

  const text = (
    <div className="flex flex-col justify-center">
      <span className="text-body font-semibold uppercase tracking-wide text-sky-600">
        {eyebrow}
      </span>
      <h3 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-display">
        {title}
      </h3>
      <p className="mt-3 text-title leading-relaxed text-gray-600">{children}</p>
      <ul className="mt-5 flex flex-col gap-2.5">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2.5">
            <svg
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-600"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-body leading-relaxed text-gray-700">
              {point}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
      {/* Mobile: image always first (stacked above the text). On md+ the
          order flips so alternating bands sit the image left or right. The
          text column carries an explicit order so it pairs with its image
          regardless of source order. */}
      <div className={imageSide === "left" ? "md:order-1" : "md:order-2"}>
        {image}
      </div>
      <div className={imageSide === "left" ? "md:order-2" : "md:order-1"}>
        {text}
      </div>
    </div>
  );
}

/**
 * Modal lightbox for expanding a feature screenshot. Opens centered with a
 * margin (never full-bleed), dims and blurs the page behind it, and closes on
 * Escape, the close button, or a click on the backdrop. Clicking the image
 * itself does not close. Renders through a portal so it sits above the page
 * and locks body scroll while open. A subtle fade + zoom entrance (skipped
 * under prefers-reduced-motion) gives it a modern feel.
 */
function ImageLightbox({
  image,
  onClose,
}: {
  image: LightboxImage | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock background scroll while the lightbox is open; restore on close.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [image, onClose]);

  if (!image) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      onClick={onClose}
      className="lb-backdrop fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm md:p-10"
    >
      <style>{`
        @keyframes lb-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lb-zoom { from { opacity: 0; transform: scale(0.96) } to { opacity: 1; transform: scale(1) } }
        .lb-backdrop { animation: lb-fade 150ms ease-out; }
        .lb-figure { animation: lb-zoom 180ms ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .lb-backdrop, .lb-figure { animation: none; }
        }
      `}</style>
      <div className="lb-figure relative" onClick={(e) => e.stopPropagation()}>
        <Tooltip label="Close" placement="left">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close expanded image"
            className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-lg backdrop-blur transition-colors hover:bg-white"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 6l12 12M18 6L6 18"
              />
            </svg>
          </button>
        </Tooltip>
        <Image
          src={image.src}
          alt={image.alt}
          width={1600}
          height={1000}
          unoptimized
          className="block h-auto max-h-[85vh] w-auto max-w-[88vw] rounded-xl object-contain shadow-2xl ring-1 ring-white/10"
        />
      </div>
    </div>,
    document.body,
  );
}

/** How a comparison cell is marked. `win` is an emerald check (a clear
 *  advantage), `have` is a muted gray check (the column genuinely has or
 *  leads on this), `soon` is a "Coming soon" pill (roadmapped for
 *  ResearchOS), and `none` is plain text (does not have it). */
type CellMark = "win" | "have" | "soon" | "none";

/** Renders the leading mark for a comparison cell. A fixed-width slot keeps
 *  text aligned across rows whether or not a check is present. */
function MarkIcon({ mark }: { mark: CellMark }) {
  if (mark === "soon") {
    return (
      <span className="mt-0.5 inline-block flex-shrink-0 whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-meta font-semibold text-sky-700">
        Coming soon
      </span>
    );
  }
  if (mark === "win" || mark === "have") {
    return (
      <svg
        className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
          mark === "win" ? "text-emerald-600" : "text-gray-400"
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  // `none`: reserve the check slot so text stays aligned with checked rows.
  return <span className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />;
}

interface Cell {
  mark: CellMark;
  text: string;
}

/** One row of the comparison. The ResearchOS column is tinted; every column
 *  carries checks where each tool genuinely has the capability, so the table
 *  reads as an honest three-way side-by-side rather than a hit piece. The
 *  third column (SnapGene) is optional so legacy two-column rows still work,
 *  but every row in the live table now passes all three. */
function ComparisonRow({
  label,
  us,
  labarchives,
  snapgene,
}: {
  label: string;
  us: Cell;
  labarchives: Cell;
  snapgene?: Cell;
}) {
  return (
    <tr className="border-b border-gray-100 align-top last:border-0">
      <td className="px-4 py-3 text-body font-medium text-gray-900">{label}</td>
      <td className="bg-sky-50/60 px-4 py-3 text-body text-gray-800">
        <span className="flex items-start gap-2">
          <MarkIcon mark={us.mark} />
          <span>{us.text}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-body text-gray-600">
        <span className="flex items-start gap-2">
          <MarkIcon mark={labarchives.mark} />
          <span>{labarchives.text}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-body text-gray-600">
        {snapgene ? (
          <span className="flex items-start gap-2">
            <MarkIcon mark={snapgene.mark} />
            <span>{snapgene.text}</span>
          </span>
        ) : (
          <span className="text-gray-400" aria-hidden>
            &middot;
          </span>
        )}
      </td>
    </tr>
  );
}

/** Brand wordmark for the top nav: the BeakerBot mark beside a bold
 *  "ResearchOS", mirroring the AppShell brand lockup. Visually static (no idle
 *  motion) so it reads as a logo, but clicking the mark still pops the heart
 *  easter egg, the playful touch carries everywhere BeakerBot shows up. */
function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <BeakerBot
        pose="idle"
        animated={false}
        easterEgg="heart"
        ariaLabel="ResearchOS BeakerBot logo"
        className="h-7 w-7 shrink-0 text-sky-500"
      />
      <span className="text-lg font-bold tracking-tight text-gray-900">
        ResearchOS
      </span>
    </div>
  );
}

/** The Google "G" mark as an inline multi-color SVG (no emoji, no icon font). */
function GoogleMark() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 010-4.2V7.06H2.18a11 11 0 000 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

/** The GitHub mark as an inline SVG (currentColor so it inherits text tint). */
function GitHubMark() {
  return (
    <svg
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 1.5a10.5 10.5 0 00-3.32 20.47c.52.1.71-.23.71-.5v-1.76c-2.89.63-3.5-1.4-3.5-1.4-.47-1.2-1.15-1.52-1.15-1.52-.94-.64.07-.63.07-.63 1.04.07 1.59 1.07 1.59 1.07.93 1.59 2.43 1.13 3.02.86.1-.67.36-1.13.66-1.39-2.31-.26-4.74-1.16-4.74-5.14 0-1.14.4-2.06 1.07-2.79-.11-.26-.46-1.32.1-2.75 0 0 .87-.28 2.85 1.06a9.9 9.9 0 015.2 0c1.98-1.34 2.85-1.06 2.85-1.06.56 1.43.21 2.49.1 2.75.67.73 1.07 1.65 1.07 2.79 0 3.99-2.43 4.87-4.75 5.13.37.32.7.95.7 1.92v2.85c0 .28.19.61.71.5A10.5 10.5 0 0012 1.5z" />
    </svg>
  );
}

/** The LinkedIn mark as an inline SVG. Uses the brand-standard blue fill
 *  (#0A66C2) so it reads correctly on any background color — callers style
 *  the button's background, not the mark itself. */
function LinkedInMark() {
  return (
    <svg
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        fill="#ffffff"
        d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"
      />
    </svg>
  );
}

/** A Google, GitHub, and LinkedIn sign-in row plus a "Continue without signing
 *  in" link, used at the hero and in the sharing section. The OAuth buttons
 *  thread the chosen provider to the connect screen via `?signIn=google/github/
 *  linkedin`. The local-only link routes to `/?connect=1` with no signIn param.
 *  The framing makes clear the notebook itself needs no account. */
function SignInRow({
  onSignInGoogle,
  onSignInGitHub,
  onSignInLinkedIn,
  onContinueLocal,
  tone = "light",
}: {
  onSignInGoogle: () => void;
  onSignInGitHub: () => void;
  onSignInLinkedIn: () => void;
  onContinueLocal: () => void;
  tone?: "light" | "dark";
}) {
  const isDark = tone === "dark";
  const base =
    "inline-flex items-center justify-center gap-2.5 rounded-xl border px-5 py-2.5 text-body font-semibold transition-all hover:scale-[1.02]";
  const cls = isDark
    ? `${base} border-white/25 bg-white/10 text-white hover:bg-white/15`
    : `${base} border-gray-200 bg-white text-gray-800 shadow-sm hover:border-gray-300 hover:shadow`;
  const linkedInCls =
    `${base} border-[#0A66C2] bg-[#0A66C2] text-white hover:bg-[#004182]`;
  const localLinkCls = isDark
    ? "text-meta text-white/60 hover:text-white/90 underline underline-offset-2 transition-colors"
    : "text-meta text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors";
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={onSignInGoogle}
          data-testid="landing-signin-google"
          className={cls}
        >
          <GoogleMark />
          Continue with Google
        </button>
        <button
          type="button"
          onClick={onSignInGitHub}
          data-testid="landing-signin-github"
          className={isDark ? cls : `${cls} text-gray-900`}
        >
          <GitHubMark />
          Continue with GitHub
        </button>
        <button
          type="button"
          onClick={onSignInLinkedIn}
          data-testid="landing-signin-linkedin"
          className={linkedInCls}
        >
          <LinkedInMark />
          Continue with LinkedIn
        </button>
      </div>
      <button
        type="button"
        onClick={onContinueLocal}
        data-testid="landing-continue-local"
        className={localLinkCls}
      >
        Use locally without an account
      </button>
    </div>
  );
}

/** A non-photo flagship band: an eyebrow + headline + prose + proof list on
 *  one side, and a tasteful inline-SVG illustration (no screenshot) on the
 *  other, framed in the rainbow/brand palette. Used for flagship features
 *  that do not yet have a privacy-safe fixture screenshot, so nothing ever
 *  renders a broken <Image>. Mirrors HeroBand's alternating layout. */
function IllustratedBand({
  eyebrow,
  title,
  imageSide,
  points,
  illustration,
  children,
}: {
  eyebrow: string;
  title: string;
  imageSide: "left" | "right";
  points: string[];
  illustration: ReactNode;
  children: ReactNode;
}) {
  const text = (
    <div className="flex flex-col justify-center">
      <span className="text-body font-semibold uppercase tracking-wide text-sky-600">
        {eyebrow}
      </span>
      <h3 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-display">
        {title}
      </h3>
      <p className="mt-3 text-title leading-relaxed text-gray-600">{children}</p>
      <ul className="mt-5 flex flex-col gap-2.5">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2.5">
            <svg
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-600"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-body leading-relaxed text-gray-700">
              {point}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
      <div className={imageSide === "left" ? "md:order-1" : "md:order-2"}>
        {illustration}
      </div>
      <div className={imageSide === "left" ? "md:order-2" : "md:order-1"}>
        {text}
      </div>
    </div>
  );
}

/** Inline-SVG illustration for the Sequence Editor band: a stylized circular
 *  plasmid map with colored feature arcs and a couple of annotation ticks,
 *  drawn in the rainbow/brand palette. Decorative, so aria-hidden. */
function PlasmidIllustration() {
  return (
    <div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-sky-50 via-white to-purple-50 shadow-sm">
      <svg
        viewBox="0 0 200 200"
        className="h-[78%] w-auto"
        fill="none"
        aria-hidden
      >
        {/* Backbone circle */}
        <circle cx="100" cy="100" r="64" stroke="#CBD5E1" strokeWidth="2" />
        {/* Feature arcs in the brand rainbow */}
        <path d="M100 36 A64 64 0 0 1 155 68" stroke="#FFD2B0" strokeWidth="9" strokeLinecap="round" />
        <path d="M158 74 A64 64 0 0 1 158 126" stroke="#B7EBB1" strokeWidth="9" strokeLinecap="round" />
        <path d="M150 136 A64 64 0 0 1 100 164" stroke="#A6D2F4" strokeWidth="9" strokeLinecap="round" />
        <path d="M88 163 A64 64 0 0 1 42 120" stroke="#D6B5F0" strokeWidth="9" strokeLinecap="round" />
        <path d="M40 112 A64 64 0 0 1 64 52" stroke="#FFF1A8" strokeWidth="9" strokeLinecap="round" />
        {/* Restriction tick marks */}
        <line x1="100" y1="28" x2="100" y2="44" stroke="#94A3B8" strokeWidth="2" />
        <line x1="172" y1="100" x2="156" y2="100" stroke="#94A3B8" strokeWidth="2" />
        <line x1="100" y1="172" x2="100" y2="156" stroke="#94A3B8" strokeWidth="2" />
        {/* Center label */}
        <text x="100" y="96" textAnchor="middle" className="fill-gray-500" fontSize="12" fontWeight="600">
          plasmid
        </text>
        <text x="100" y="112" textAnchor="middle" className="fill-gray-400" fontSize="9">
          5,184 bp
        </text>
      </svg>
    </div>
  );
}

/** Inline-SVG illustration for the cross-boundary sharing band: two simple
 *  user avatars with a sealed-envelope transfer arcing between them, framed
 *  in the brand palette. The padlock badge signals the encrypted relay.
 *  Decorative, so aria-hidden. */
function ShareTransferIllustration() {
  return (
    <div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-purple-50 via-white to-sky-50 shadow-sm">
      <svg viewBox="0 0 280 160" className="h-[78%] w-auto" fill="none" aria-hidden>
        {/* Sender avatar */}
        <circle cx="46" cy="80" r="26" fill="#A6D2F4" />
        <circle cx="46" cy="71" r="9" fill="#fff" />
        <path d="M30 96 a16 16 0 0 1 32 0 z" fill="#fff" />
        {/* Recipient avatar */}
        <circle cx="234" cy="80" r="26" fill="#D6B5F0" />
        <circle cx="234" cy="71" r="9" fill="#fff" />
        <path d="M218 96 a16 16 0 0 1 32 0 z" fill="#fff" />
        {/* Transfer arc */}
        <path
          d="M78 66 Q140 24 202 66"
          stroke="#94A3B8"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
        {/* Sealed envelope at the arc midpoint */}
        <g>
          <rect x="122" y="30" width="36" height="26" rx="4" fill="#fff" stroke="#1AA0E6" strokeWidth="2" />
          <path d="M122 34 L140 47 L158 34" stroke="#1AA0E6" strokeWidth="2" fill="none" />
          {/* Padlock badge */}
          <circle cx="158" cy="30" r="9" fill="#1AA0E6" />
          <rect x="154.5" y="28" width="7" height="5" rx="1" fill="#fff" />
          <path d="M156 28 v-1.5 a2 2 0 0 1 4 0 V28" stroke="#fff" strokeWidth="1.2" fill="none" />
        </g>
      </svg>
    </div>
  );
}

/**
 * Subtle "there is more below" cue on the first screen: two faint gray
 * down-chevrons tucked into the lower-left and lower-right corners (off
 * center, clear of the centered hero content) that gently pulse (shrink and
 * expand) so visitors, especially less tech-savvy ones, realize the page
 * continues past the fold. Fades out the moment the visitor scrolls and does
 * not return. Honors prefers-reduced-motion (static, no pulse) and is
 * pointer-events-none so it never intercepts a click.
 */
function ScrollHint() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(true);
    // capture:true so a scroll on the landing's inner overflow-y-auto
    // container is caught too: scroll events do not bubble, but they do fire
    // during the capture phase, so a capturing window listener sees both the
    // document scroll and any nested-scroller scroll.
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("scroll", onScroll, opts);
    return () => window.removeEventListener("scroll", onScroll, opts);
  }, []);

  const chevron = (
    <svg
      className="scrollhint-chevron h-7 w-7 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 6l7 6 7-6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l7 6 7-6" />
    </svg>
  );

  return (
    <div
      aria-hidden
      data-testid="landing-scroll-hint"
      className={`pointer-events-none fixed inset-x-0 bottom-8 z-30 flex justify-between px-[10%] transition-opacity duration-500 md:px-[14%] ${
        scrolled ? "opacity-0" : "opacity-100"
      }`}
    >
      <style>{`
        @keyframes scrollhint-pulse {
          0%, 100% { transform: translateY(0) scale(0.9); opacity: 0.4; }
          50% { transform: translateY(3px) scale(1.12); opacity: 0.8; }
        }
        .scrollhint-chevron { animation: scrollhint-pulse 1.9s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .scrollhint-chevron { animation: none; opacity: 0.5; }
        }
      `}</style>
      {/* Two chevrons, one tucked toward each lower corner via justify-between
          + symmetric horizontal inset. The <style> above is display:none (UA
          stylesheet), so flex sees exactly the two chevrons. */}
      {chevron}
      {chevron}
    </div>
  );
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const router = useRouter();

  // Hi-wave greeting: the hero BeakerBot waves on landing, then settles into
  // its alive idle. waveActive drives the hero pose; a one-shot timer ends it.
  const [waveActive, setWaveActive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setWaveActive(false), 2600);
    return () => clearTimeout(t);
  }, []);

  // Expandable-screenshot lightbox: null when closed, the image when open.
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  const handleGetStarted = () => {
    if (onGetStarted) {
      onGetStarted();
      return;
    }
    markLandingSeen();
    router.push("/?connect=1");
  };

  const handleTryDemo = () => {
    // Note: deliberately does NOT mark the landing seen. Trying the demo is
    // exploration, not "I'm done with the sell" — leaving the demo should
    // return the visitor to the landing, same as the docs / comparison links.
    // Only "Get Started" (entering folder setup) marks the landing seen.
    router.push("/demo");
  };

  // Google / GitHub sign-in. The landing is a pre-login surface, so we thread
  // the chosen provider through the connect screen via the `signIn` query
  // param rather than calling next-auth's signIn directly (which would require
  // a SessionProvider this page cannot assume wraps it). ResearchFolderSetupNew
  // reads `?signIn=google` or `?signIn=github` after folder setup completes
  // and triggers the OAuth redirect then. A visitor who prefers to stay local
  // can use "Continue without signing in" which skips the param entirely.
  const handleSignInGoogle = () => {
    markLandingSeen();
    router.push("/?connect=1&signIn=google");
  };

  const handleSignInGitHub = () => {
    markLandingSeen();
    router.push("/?connect=1&signIn=github");
  };

  const handleSignInLinkedIn = () => {
    markLandingSeen();
    router.push("/?connect=1&signIn=linkedin");
  };

  return (
    <div
      data-testid="landing-page"
      className="min-h-screen w-full overflow-y-auto bg-white text-gray-900"
    >
      {/* Subtle "scroll for more" cue at the bottom of the first screen. */}
      <ScrollHint />

      {/* ── Hero ──────────────────────────────────────────────────────────
          Light + rainbow brand direction (approved): a thin rainbow ribbon
          across the very top, a soft rainbow radial bloom behind a centered
          waving BeakerBot, the wordmark in the top nav, the headline, the two
          CTAs, a Google/GitHub sign-in row, and the audience line. */}
      <header className="relative isolate overflow-hidden bg-white">
        {/* Thin rainbow ribbon pinned to the very top edge. */}
        <div
          aria-hidden
          className="h-1.5 w-full"
          style={{
            background:
              "linear-gradient(90deg, #FFD2B0 0%, #FFF1A8 25%, #B7EBB1 50%, #A6D2F4 75%, #D6B5F0 100%)",
          }}
        />

        {/* Soft rainbow radial bloom behind the mascot. Sits behind content
            (-z-10) and fades to transparent so the page stays bright + light. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-24 -z-10 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full opacity-70 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(255,210,176,0.55) 0%, rgba(255,241,168,0.45) 22%, rgba(183,235,177,0.4) 45%, rgba(166,210,244,0.45) 68%, rgba(214,181,240,0.4) 88%, rgba(255,255,255,0) 100%)",
          }}
        />

        {/* Top nav: wordmark left, quiet text links right. */}
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Wordmark />
          <div className="hidden items-center gap-6 text-body font-medium text-gray-600 sm:flex">
            <Link
              href="/wiki/getting-started"
              data-testid="landing-read-docs"
              className="hover:text-sky-600"
            >
              Docs
            </Link>
            <Link href="/wiki/security" className="hover:text-sky-600">
              Privacy
            </Link>
            <button
              type="button"
              onClick={handleGetStarted}
              className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:bg-sky-400"
            >
              Get started
            </button>
          </div>
        </nav>

        <div className="mx-auto flex max-w-4xl flex-col items-center gap-7 px-6 pb-20 pt-8 text-center md:pb-28 md:pt-12">
          <div
            aria-hidden
            className="drop-shadow-[0_10px_28px_rgba(26,160,230,0.22)]"
          >
            <BeakerBot
              pose={waveActive ? "waving" : "idle"}
              alive
              className="h-28 w-28 text-sky-500 md:h-36 md:w-36"
            />
          </div>
          <div className="flex flex-col items-center gap-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-meta font-semibold tracking-wide text-sky-700">
              Free and open, built by a researcher for academic labs
            </span>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-gray-900 md:text-5xl">
              Your whole lab, in a notebook you actually own
            </h1>
            <p className="max-w-2xl text-title leading-relaxed text-gray-600 md:text-lg">
              Plan experiments, run protocols, design plasmids, and write it all
              up in one workspace. It is free and local-first, so your data
              lives as a plain folder on your machine, private and yours to
              keep.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleGetStarted}
              data-testid="landing-get-started"
              className="rounded-xl bg-sky-500 px-7 py-3 text-title font-semibold text-white shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-400 hover:shadow-xl"
            >
              Get started
            </button>
            <button
              type="button"
              onClick={handleTryDemo}
              data-testid="landing-try-demo"
              className="rounded-xl border border-gray-200 bg-white px-7 py-3 text-title font-semibold text-gray-800 shadow-sm transition-all hover:scale-[1.02] hover:border-gray-300 hover:shadow"
            >
              Try the demo
            </button>
          </div>

          {/* Headline-level sign-in row. The notebook needs no account; this
              is only for sharing across labs, made explicit in the label. */}
          <div className="flex flex-col items-center gap-2.5">
            <p className="text-body text-gray-500">
              No account needed to keep your notebook. Or sign in to share
              across labs.
            </p>
            <SignInRow
              onSignInGoogle={handleSignInGoogle}
              onSignInGitHub={handleSignInGitHub}
              onSignInLinkedIn={handleSignInLinkedIn}
              onContinueLocal={handleGetStarted}
              tone="light"
            />
          </div>

          <p className="max-w-xl text-body leading-relaxed text-gray-500">
            Made for the people who actually run the science, the grad students
            and postdocs at the bench, the PIs keeping an eye on the whole lab,
            and the small groups and core facilities with no IT department to
            lean on.
          </p>

          <VersionBadge className="mt-1" />
        </div>
      </header>

      {/* ── Trust pillars ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-display font-bold tracking-tight text-gray-900">
            A different deal than a cloud notebook
          </h2>
          <p className="mt-3 text-title leading-relaxed text-gray-600">
            ResearchOS was built by a researcher with support from the
            UW-Madison RISE Initiative, not a venture-backed company. Most
            electronic lab notebooks rent you space on their servers. This one
            flips that. You pick where your data lives, which is why you can
            always run it for free and why your privacy isn&apos;t ours to leak.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Pillar
            title="Free and open source"
            icon={
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 9.5h18M3 9.5l1.2 9a2 2 0 002 1.8h11.6a2 2 0 002-1.8l1.2-9M3 9.5l2.2-4.4A2 2 0 017 4h10a2 2 0 011.8 1.1L21 9.5M12 13.5v3.5"
                />
              </svg>
            }
          >
            Built by a researcher with support from the UW-Madison RISE
            Initiative, not a venture-backed company. ResearchOS is open source,
            so you can run it yourself for free, forever, and the hosted version
            is free for every lab, with no paid tiers and no per-seat fees.
          </Pillar>
          <Pillar
            title="Local-first"
            icon={
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM8 20h8M12 16v4"
                />
              </svg>
            }
          >
            Your notebook is a folder on your own machine. It works offline,
            opens instantly, and never touches a server you do not control.
          </Pillar>
          <Pillar
            title="No lock-in"
            icon={
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 10V7a5 5 0 019.6-2M6 10h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1zM12 14.5v2.5"
                />
              </svg>
            }
          >
            Everything is plain Markdown and ordinary files you already own,
            with real git-backed version history. Walk away any time and take
            all of it with you.
          </Pillar>
          <Pillar
            title="A friendly guide"
            icon={<BeakerBot pose="waving" className="h-7 w-7 text-sky-600" />}
          >
            BeakerBot walks you through setup and every feature, so you are
            never staring at a blank screen wondering what to do next.
          </Pillar>
        </div>
      </section>

      {/* ── Flagship feature heroes ──────────────────────────────────────
          Two large image-plus-text bands for the two features that most set
          ResearchOS apart from a cloud ELN: full version history on your own
          machine, and a structured template library that ships the original
          vendor source PDF bundled with each protocol. They lead the feature
          story; the FeatureCard grid below fills in the rest. */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <span className="text-body font-semibold uppercase tracking-wide text-sky-600">
              The features that set us apart
            </span>
            <h2 className="mt-2 text-display font-bold tracking-tight text-gray-900">
              Features you would expect to pay for
            </h2>
            <p className="mt-3 text-title leading-relaxed text-gray-600">
              These are not on a roadmap or behind a paywall. They are built in,
              free, and running on your own machine.
            </p>
          </div>
          <div className="flex flex-col gap-16 md:gap-24">
            <IllustratedBand
              eyebrow="Sequence editor"
              title="A plasmid editor, right inside your notebook"
              imageSide="left"
              illustration={<PlasmidIllustration />}
              points={[
                "Import SnapGene .dna, GenBank, and FASTA, then view and edit with annotated features",
                "Find where restriction enzymes cut, and design primers with nearest-neighbor Tm",
                "In-silico cloning, from Gibson and NEBuilder HiFi overlap to Golden Gate and Gateway",
              ]}
            >
              The kind of sequence work you would open SnapGene or Benchling for
              now lives in the same place as your protocols and results. Bring
              in your SnapGene files, edit and annotate, scan for restriction
              sites, design primers, and assemble constructs in silico with a
              review step before anything is saved. It is part of the notebook,
              not a separate subscription.
            </IllustratedBand>
            <HeroBand
              eyebrow="Version history"
              title="Every change is kept, and you can roll it back"
              src="/wiki/screenshots/version-history-diff.png"
              alt="The per-editor version-history diff on a note in ResearchOS"
              imageSide="left"
              onExpand={setLightbox}
              points={[
                "A full, restorable edit history on your notes, tasks, and projects",
                "Per-editor diffs show exactly who changed what, and when",
                "A 24-hour undo window if a restore was the wrong call",
              ]}
            >
              On your records, every save is kept. Open the timeline beside a
              note, task, or project, see a per-editor diff of what changed, and
              restore any earlier version in a click. This is the thing most
              cloud notebooks gate behind a paid tier or leave on a roadmap.
              Here it is built in, free, and on your own machine.
            </HeroBand>
            <HeroBand
              eyebrow="Prebuilt kit library"
              title="A prebuilt library of the major lab kits"
              src="/wiki/screenshots/method-catalog-source-pdf.png"
              alt="The ResearchOS prebuilt library of molecular biology kit templates"
              imageSide="right"
              onExpand={setLightbox}
              points={[
                "Templates for the major PCR, qPCR, cloning, and prep kits",
                "From NEB, Thermo Fisher, Bio-Rad, QIAGEN, Promega, Takara, and Roche/KAPA",
                "The original vendor insert is bundled with every one",
              ]}
            >
              We have built a structured template library for the major
              molecular biology kits: the PCR and qPCR master mixes,
              polymerases, and cloning and prep kits from NEB, Thermo Fisher,
              Bio-Rad, QIAGEN, Promega, Takara, and Roche/KAPA. Drop one into
              your protocol
              and the reaction setup is already filled in, with the original
              vendor insert bundled alongside it so any value can be checked
              against the source it came from.
            </HeroBand>
          </div>
        </div>
      </section>

      {/* ── Feature showcase ─────────────────────────────────────────── */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-body font-semibold uppercase tracking-wide text-sky-600">
              Everything a working lab needs
            </span>
            <h2 className="mt-2 text-display font-bold tracking-tight text-gray-900">
              One place for the whole project
            </h2>
            <p className="mt-3 text-title leading-relaxed text-gray-600">
              Plan it, run it, write it up, and pay for it, without juggling
              five different tools.
            </p>
          </div>
          {/* Centered flex-wrap (not a fixed-column grid) so the row count
              flexes with the number of cards: a trailing partial row centers
              instead of orphaning to the left. basis math: 3-up on lg, 2-up
              on sm, 1-up on mobile, each minus its share of the gap. */}
          <div className="flex flex-wrap justify-center gap-6 [&>*]:basis-full sm:[&>*]:basis-[calc(50%_-_0.75rem)] lg:[&>*]:basis-[calc(33.333%_-_1rem)]">
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/gantt-overview.png"
              alt="A Gantt timeline of experiments in ResearchOS"
              title="Plan on a timeline"
            >
              Lay experiments out on a Gantt chart and see at a glance what is
              running, blocked, or due.
            </FeatureCard>
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/methods-library.png"
              alt="The protocol and methods library in ResearchOS"
              title="Recipes that do the math"
            >
              PCR and qPCR protocols scale your reaction mix for you, so the
              per-tube volumes are worked out before you reach for a pipette.
            </FeatureCard>
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/workbench-experiments.png"
              alt="The experiment workbench and lab notebook in ResearchOS"
              title="A real lab notebook"
            >
              Write up experiments in Markdown, drop in gels and images, and
              keep a tidy record of what you actually did.
            </FeatureCard>
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/purchases-unified-scroll.png"
              alt="The purchasing and spending dashboard in ResearchOS"
              title="Track every dollar"
            >
              Log purchases against grants and watch spending against your
              budget on a live dashboard.
            </FeatureCard>
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/search-results.png"
              alt="Search across the whole notebook in ResearchOS"
              title="Find anything, fast"
            >
              Search across projects, notes, methods, and results from one
              box.
            </FeatureCard>
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/calendar-month.png"
              alt="The calendar view in ResearchOS"
              title="One calendar for everything"
            >
              Subscribe to any calendar over ICS, from iCloud to Google to
              Outlook, and see meetings and deadlines right alongside your
              experiments and cultures.
            </FeatureCard>
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/telegram-inbox.png"
              alt="The Telegram capture inbox in ResearchOS"
              title="Snap it from the bench"
            >
              Send photos and notes from your phone over Telegram and they land
              in your notebook inbox, ready to attach to an experiment.
            </FeatureCard>
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/import-eln-format-pick.png"
              alt="Importing a LabArchives notebook into ResearchOS"
              title="Bring your old notebook"
            >
              Switching from LabArchives? Import an Offline Notebook ZIP and
              pick up where you left off, no retyping.
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* ── Built for the whole lab (sharing + PI mode) ──────────────── */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-body font-semibold uppercase tracking-wide text-sky-600">
              Built for the whole lab
            </span>
            <h2 className="mt-2 text-display font-bold tracking-tight text-gray-900">
              Run your lab together, not seat by seat
            </h2>
            <p className="mt-3 text-title leading-relaxed text-gray-600">
              Share a shared folder and your whole lab works from it. No
              per-seat pricing, no admin licenses to buy. Members keep their own
              accounts; the PI gets the bird&apos;s-eye view.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/sharing-method-share-dialog.png"
              alt="Sharing a protocol with a labmate in ResearchOS"
              title="Share with your team"
            >
              Share a project, experiment, or protocol with anyone in your lab.
              They see your updates while you keep ownership.
            </FeatureCard>
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/lab-overview-pi-default.png"
              alt="The PI lab-overview dashboard in ResearchOS"
              title="A view built for the PI"
            >
              Lab Overview gives the PI a live picture of every member&apos;s
              projects, funding, and progress on one configurable dashboard.
            </FeatureCard>
            <FeatureCard
              onExpand={setLightbox}
              src="/wiki/screenshots/lab-inbox-comments-thread.png"
              alt="A comment thread on an experiment in ResearchOS"
              title="Talk in context"
            >
              Comment threads with @mentions keep the conversation right next to
              the data it is about, instead of buried in email.
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* ── Cross-boundary sharing ────────────────────────────────────── */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <span className="text-body font-semibold uppercase tracking-wide text-sky-600">
              Share beyond your folder
            </span>
            <h2 className="mt-2 text-display font-bold tracking-tight text-gray-900">
              Send work to anyone, even a different lab
            </h2>
            <p className="mt-3 text-title leading-relaxed text-gray-600">
              A shared folder is great for your own lab. For everyone else,
              ResearchOS can send a note, method, experiment, or whole project
              to someone who does not share your folder at all.
            </p>
          </div>
          <IllustratedBand
            eyebrow="Cross-boundary sharing"
            title="A note, a method, or a whole project, sent to anyone"
            imageSide="right"
            illustration={<ShareTransferIllustration />}
            points={[
              "Reach a collaborator by email, with no shared folder and no copy of their data on our side",
              "An encrypted transfer that never permanently stores your data, swept after 30 days if unopened",
              "Identity is verified by signing in with Google or GitHub, the one place an account is used",
            ]}
          >
            Pick what you want to send and address it to a collaborator by
            email. The data rides through an encrypted relay that holds it only
            until they pick it up, then lets it go. Nothing is kept permanently
            on our side. A pending transfer is held for up to 30 days and then
            swept if no one opens it. This is the only part of ResearchOS that
            uses an account, and only to prove who is on each end.
          </IllustratedBand>
          <div className="mt-10 flex flex-col items-center gap-2.5">
            <p className="text-body text-gray-500">
              Sign in once to share across labs. Your notebook still needs no
              account.
            </p>
            <SignInRow
              onSignInGoogle={handleSignInGoogle}
              onSignInGitHub={handleSignInGitHub}
              onSignInLinkedIn={handleSignInLinkedIn}
              onContinueLocal={handleGetStarted}
              tone="light"
            />
          </div>
        </div>
      </section>

      {/* ── How we compare (features + price) ────────────────────────── */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-body font-semibold uppercase tracking-wide text-sky-600">
              A full lab suite vs the point tools
            </span>
            <h2 className="mt-2 text-display font-bold tracking-tight text-gray-900">
              How we compare to LabArchives and SnapGene
            </h2>
            <p className="mt-3 text-title leading-relaxed text-gray-600">
              LabArchives is the notebook most labs are leaving and SnapGene is
              the sequence tool many of them also pay for. Here is the honest
              three-way on the things that matter most.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="w-[24%] px-4 py-3 text-body font-semibold text-gray-500">
                      <span className="sr-only">Capability</span>
                    </th>
                    <th className="w-[28%] bg-sky-50 px-4 py-3 text-body font-bold text-sky-700">
                      ResearchOS
                    </th>
                    <th className="w-[24%] px-4 py-3 text-body font-semibold text-gray-700">
                      LabArchives (Professional)
                    </th>
                    <th className="w-[24%] px-4 py-3 text-body font-semibold text-gray-700">
                      SnapGene
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <ComparisonRow
                    label="Price"
                    us={{
                      mark: "win",
                      text: "Free and open source; hosted free too",
                    }}
                    labarchives={{
                      mark: "none",
                      text: "$330+ per user, per year; limited free tier",
                    }}
                    snapgene={{
                      mark: "none",
                      text: "Paid license per seat; free viewer only",
                    }}
                  />
                  <ComparisonRow
                    label="Per-seat fees"
                    us={{ mark: "win", text: "No per-seat fees, ever" }}
                    labarchives={{
                      mark: "none",
                      text: "Charged per user, every year",
                    }}
                    snapgene={{
                      mark: "none",
                      text: "Per-seat license to edit",
                    }}
                  />
                  <ComparisonRow
                    label="Where your data lives"
                    us={{ mark: "win", text: "A folder on your own machine" }}
                    labarchives={{
                      mark: "none",
                      text: "On LabArchives' cloud servers",
                    }}
                    snapgene={{
                      mark: "have",
                      text: "Files on your machine",
                    }}
                  />
                  <ComparisonRow
                    label="File formats"
                    us={{
                      mark: "win",
                      text: "Open Markdown and your original files",
                    }}
                    labarchives={{ mark: "none", text: "Proprietary cloud store" }}
                    snapgene={{
                      mark: "have",
                      text: "Reads .dna, GenBank, and FASTA",
                    }}
                  />
                  <ComparisonRow
                    label="A full lab suite"
                    us={{
                      mark: "win",
                      text: "Notebook, planning, purchasing, sequences, all in one",
                    }}
                    labarchives={{
                      mark: "have",
                      text: "Notebook plus widgets and add-ons",
                    }}
                    snapgene={{
                      mark: "none",
                      text: "Sequences only, not a notebook",
                    }}
                  />
                  <ComparisonRow
                    label="Sequence editing and annotation"
                    us={{
                      mark: "have",
                      text: "Import, edit, annotate, find restriction sites",
                    }}
                    labarchives={{
                      mark: "none",
                      text: "No native sequence editor",
                    }}
                    snapgene={{
                      mark: "win",
                      text: "The deepest editor and visualization here",
                    }}
                  />
                  <ComparisonRow
                    label="Cloning and primer design"
                    us={{
                      mark: "have",
                      text: "Gibson, NEBuilder, Golden Gate, Gateway, with nearest-neighbor Tm",
                    }}
                    labarchives={{
                      mark: "none",
                      text: "Not applicable",
                    }}
                    snapgene={{
                      mark: "win",
                      text: "Industry-leading cloning and primer tools",
                    }}
                  />
                  <ComparisonRow
                    label="Per-entry version history"
                    us={{
                      mark: "win",
                      text: "Full history with one-click restore, built in",
                    }}
                    labarchives={{
                      mark: "have",
                      text: "Full revision history on every entry",
                    }}
                    snapgene={{
                      mark: "none",
                      text: "Per-file saves, no notebook history",
                    }}
                  />
                  <ComparisonRow
                    label="Move in from LabArchives"
                    us={{
                      mark: "win",
                      text: "Imports your Offline Notebook ZIP directly",
                    }}
                    labarchives={{ mark: "none", text: "Not applicable" }}
                    snapgene={{ mark: "none", text: "Not applicable" }}
                  />
                  <ComparisonRow
                    label="Security certifications"
                    us={{
                      mark: "none",
                      text: "None by design; published security audit instead",
                    }}
                    labarchives={{
                      mark: "have",
                      text: "FedRAMP, SOC 2, ISO 27001, 21 CFR Part 11",
                    }}
                    snapgene={{
                      mark: "none",
                      text: "Desktop tool, not a hosted service",
                    }}
                  />
                  <ComparisonRow
                    label="Managed backups + browser support"
                    us={{
                      mark: "none",
                      text: "Your own cloud drive; Chrome or Edge",
                    }}
                    labarchives={{
                      mark: "have",
                      text: "Vendor-managed backups; any modern browser",
                    }}
                    snapgene={{
                      mark: "none",
                      text: "Local files you back up yourself",
                    }}
                  />
                </tbody>
              </table>
            </div>
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-center text-body leading-relaxed text-gray-500">
            SnapGene genuinely leads on deep cloning and sequence
            visualization. ResearchOS wins on price and ownership, and it folds
            sequence work into a full lab suite instead of a separate tool. No
            electronic notebook is &ldquo;NIH certified&rdquo; (no such thing
            exists). Want the row-by-row detail?{" "}
            <Link
              href="/wiki/compliance/labarchives-comparison"
              data-testid="landing-compare-full"
              className="font-semibold text-sky-600 underline-offset-2 hover:text-sky-700 hover:underline"
            >
              See the full, honest comparison
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ── NIH data-management compliance highlight ─────────────────── */}
      <section className="bg-gradient-to-br from-sky-600 to-sky-700 py-20 text-white">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <span className="text-body font-semibold uppercase tracking-wide text-sky-100">
            Built for grant-funded labs
          </span>
          <h2 className="mt-2 text-display font-bold tracking-tight md:text-4xl">
            Supports your NIH Data Management and Sharing Plan
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-title leading-relaxed text-sky-50">
            You are a research lab, not an enterprise. No electronic notebook is
            &ldquo;NIH certified&rdquo; (there is no such thing), yet the big
            cloud vendors charge enterprise prices for compliance badges your
            grant never asked you to buy. ResearchOS is shaped around how an
            academic lab actually works and gives you what the policy really
            wants: organized records you own, with real version history and
            clean exports, minus the enterprise price tag.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/wiki/compliance/nih-data-management"
              data-testid="landing-nih-compliance"
              className="rounded-xl bg-white px-6 py-3 text-title font-semibold text-sky-700 shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-50"
            >
              How ResearchOS supports NIH compliance
            </Link>
            <Link
              href="/wiki/compliance/labarchives-comparison"
              className="rounded-xl border border-white/40 px-6 py-3 text-title font-semibold text-white transition-all hover:bg-white/10"
            >
              Compare to LabArchives
            </Link>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <span className="text-body font-semibold uppercase tracking-wide text-sky-600">
            Up and running in three steps
          </span>
          <h2 className="mt-2 text-display font-bold tracking-tight text-gray-900">
            BeakerBot does the heavy lifting
          </h2>
        </div>
        <ol className="grid gap-8 md:grid-cols-3">
          {[
            {
              n: "1",
              title: "Pick a folder",
              body: "Choose any folder on your computer, or make a fresh one. That folder becomes your notebook.",
            },
            {
              n: "2",
              title: "BeakerBot shows you around",
              body: "A guided walkthrough sets up your account and points out every feature as you go.",
            },
            {
              n: "3",
              title: "Start your first experiment",
              body: "Plan it, run it, write it up. Everything saves straight to your folder as you work.",
            },
          ].map((step) => (
            <li key={step.n} className="flex flex-col items-start">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-title font-bold text-white">
                {step.n}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900">
                {step.title}
              </h3>
              <p className="mt-2 text-body leading-relaxed text-gray-600">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Roadmap (what we are building) ───────────────────────────── */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-body font-semibold uppercase tracking-wide text-sky-600">
              Built in the open
            </span>
            <h2 className="mt-2 text-display font-bold tracking-tight text-gray-900">
              What we are building
            </h2>
            <p className="mt-3 text-title leading-relaxed text-gray-600">
              ResearchOS is shaped by what real labs ask for. Here is what has
              landed recently and what we are working on next. A roadmap is not
              a promise, but this is honestly where the effort is going.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <svg
                  aria-hidden
                  className="h-5 w-5 text-emerald-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.5l2 2 4-4.5M12 21a9 9 0 100-18 9 9 0 000 18z"
                  />
                </svg>
                Recently shipped
              </h3>
              <ul className="space-y-3 text-body leading-relaxed text-gray-700">
                <li>
                  <span className="font-semibold text-gray-900">
                    A built-in Sequence Editor
                  </span>{" "}
                  in the SnapGene and Benchling vein. Import SnapGene .dna,
                  GenBank, and FASTA files, view and edit with annotations,
                  design primers with nearest-neighbor Tm, find where
                  restriction enzymes cut, and export.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    In-silico cloning
                  </span>{" "}
                  with four chemistries, overlap (Gibson and NEBuilder HiFi),
                  restriction and ligation, Golden Gate, and Gateway. It designs
                  the junction primers and shows a review step before anything
                  is saved.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    Bulk sequence import
                  </span>{" "}
                  drag in a whole folder of SnapGene files at once, straight into
                  a project collection.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    A calmer, curated workspace
                  </span>{" "}
                  with your projects, notes, tasks, and sequences in one focused
                  home instead of a page you have to assemble.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    Version history
                  </span>{" "}
                  on every record, with one-click restore and a 24-hour undo.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    Built-in calculators
                  </span>{" "}
                  for molarity, dilutions, primer Tm, DNA and RNA, and buffers.
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <svg
                  aria-hidden
                  className="h-5 w-5 text-sky-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 9l3 3-3 3M8 12h8M12 21a9 9 0 100-18 9 9 0 000 18z"
                  />
                </svg>
                Coming next
              </h3>
              <ul className="space-y-3 text-body leading-relaxed text-gray-700">
                <li>
                  <span className="font-semibold text-gray-900">
                    Primer specificity checks
                  </span>{" "}
                  building on the primer designer that already ships, with a
                  one-click handoff to NCBI Primer-BLAST and clearer dimer
                  warnings.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    Repository deposit and DOI
                  </span>{" "}
                  deposit a dataset straight to Zenodo from the notebook and get
                  a citable DOI back, no manual export step.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    A bigger template library
                  </span>{" "}
                  across more techniques, like Western blot and Nanodrop readings.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 text-center">
          <h2 className="text-display font-bold tracking-tight text-white md:text-4xl">
            Ready when you are
          </h2>
          <p className="max-w-xl text-title leading-relaxed text-slate-300">
            It is free to use, it is yours, and you can leave any time. Pick a
            folder and BeakerBot will take it from there.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleGetStarted}
              className="rounded-xl bg-sky-500 px-7 py-3 text-title font-semibold text-white shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-400 hover:shadow-xl"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={handleTryDemo}
              className="rounded-xl border border-white/20 bg-white/5 px-7 py-3 text-title font-semibold text-white transition-all hover:bg-white/10"
            >
              Try the demo
            </button>
          </div>
          <BetaNotice className="mt-4 max-w-xl" />
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <AppFooter />

      {/* Expandable-screenshot lightbox. Renders nothing while closed. */}
      <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
