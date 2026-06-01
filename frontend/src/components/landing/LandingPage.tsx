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
import BeakerBotMouseWaveScene from "../BeakerBotMouseWaveScene";
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
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{children}</p>
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
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
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
      <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
        {eyebrow}
      </span>
      <h3 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
        {title}
      </h3>
      <p className="mt-3 text-base leading-relaxed text-gray-600">{children}</p>
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
            <span className="text-sm leading-relaxed text-gray-700">
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
      <span className="mt-0.5 inline-block flex-shrink-0 whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
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

/** One row of the LabArchives comparison. The ResearchOS column is tinted;
 *  both columns carry checks where each tool genuinely has the capability,
 *  so the table reads as an honest side-by-side rather than a hit piece. */
function ComparisonRow({
  label,
  us,
  them,
}: {
  label: string;
  us: Cell;
  them: Cell;
}) {
  return (
    <tr className="border-b border-gray-100 align-top last:border-0">
      <td className="px-4 py-3 text-sm font-medium text-gray-900">{label}</td>
      <td className="bg-sky-50/60 px-4 py-3 text-sm text-gray-800">
        <span className="flex items-start gap-2">
          <MarkIcon mark={us.mark} />
          <span>{us.text}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        <span className="flex items-start gap-2">
          <MarkIcon mark={them.mark} />
          <span>{them.text}</span>
        </span>
      </td>
    </tr>
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

  // Hi-wave greeting: fires once on mount from the bottom-right corner.
  const [waveActive, setWaveActive] = useState(true);

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

  return (
    <div
      data-testid="landing-page"
      className="min-h-screen w-full overflow-y-auto bg-white text-gray-900"
    >
      {/* Hi-wave greeting. Anchored bottom-right, fires once on mount. */}
      <BeakerBotMouseWaveScene
        active={waveActive}
        onComplete={() => setWaveActive(false)}
      />

      {/* Subtle "scroll for more" cue at the bottom of the first screen. */}
      <ScrollHint />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <header className="relative isolate overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 px-6 py-20 text-center md:py-28">
          <div aria-hidden className="drop-shadow-[0_8px_24px_rgba(56,189,248,0.25)]">
            <BeakerBot pose="waving" className="h-32 w-32 text-sky-400 md:h-40 md:w-40" />
          </div>
          <div className="flex flex-col items-center gap-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-medium tracking-wide text-sky-200">
              A free, local-first lab notebook
            </span>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white md:text-5xl">
              Your research notebook. On your machine. Yours to keep.
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
              ResearchOS is a free electronic lab notebook that lives as a plain
              folder on your own computer. No account, no cloud lock-in, no
              per-seat fees. Just your data, version-controlled and private, with
              a friendly guide to walk you through all of it.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleGetStarted}
              data-testid="landing-get-started"
              className="rounded-xl bg-sky-500 px-7 py-3 text-base font-semibold text-white shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-400 hover:shadow-xl"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={handleTryDemo}
              data-testid="landing-try-demo"
              className="rounded-xl border border-white/20 bg-white/5 px-7 py-3 text-base font-semibold text-white transition-all hover:bg-white/10"
            >
              Try the demo
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-slate-400">
            <Link
              href="/wiki/getting-started"
              data-testid="landing-read-docs"
              className="font-medium text-sky-300 underline-offset-4 hover:text-sky-200 hover:underline"
            >
              Read the docs
            </Link>
            <span aria-hidden className="text-slate-600">
              •
            </span>
            <Link
              href="/wiki/security"
              data-testid="landing-how-private"
              className="font-medium text-sky-300 underline-offset-4 hover:text-sky-200 hover:underline"
            >
              How it stays private
            </Link>
          </div>

          <VersionBadge tone="onDark" className="mt-2" />
        </div>
      </header>

      {/* ── Trust pillars ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">
            A different deal than a cloud notebook
          </h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Most electronic lab notebooks rent you space on their servers.
            ResearchOS flips that. You pick where your data lives, which is why
            you can always run it for free and why your privacy isn&apos;t ours
            to leak.
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
            is free for everyone while we are in beta.
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
            <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
              The features that set us apart
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
              Two features you would expect to pay for
            </h2>
            <p className="mt-3 text-base leading-relaxed text-gray-600">
              These are not on a roadmap or behind a paywall. They are built in,
              free, and running on your own machine.
            </p>
          </div>
          <div className="flex flex-col gap-16 md:gap-24">
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
                "From NEB, Thermo Fisher, Bio-Rad, QIAGEN, Promega, and Takara",
                "The original vendor insert is bundled with every one",
              ]}
            >
              We have built a structured template library for the major
              molecular biology kits: the PCR and qPCR master mixes,
              polymerases, and cloning and prep kits from NEB, Thermo Fisher,
              Bio-Rad, QIAGEN, Promega, and Takara. Drop one into your protocol
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
            <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
              Everything a working lab needs
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
              One place for the whole project
            </h2>
            <p className="mt-3 text-base leading-relaxed text-gray-600">
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
              Link your iCloud, Google, or Outlook calendars and see meetings
              and deadlines right alongside your experiments and cultures.
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
            <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
              Built for the whole lab
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
              Run your lab together, not seat by seat
            </h2>
            <p className="mt-3 text-base leading-relaxed text-gray-600">
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

      {/* ── How we compare to LabArchives (features + price) ─────────── */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
              Open source vs per-seat
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
              How we compare to LabArchives
            </h2>
            <p className="mt-3 text-base leading-relaxed text-gray-600">
              LabArchives is the incumbent most labs are leaving. Here is the
              honest side-by-side on the things that matter most.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="w-[28%] px-4 py-3 text-sm font-semibold text-gray-500">
                      <span className="sr-only">Capability</span>
                    </th>
                    <th className="w-[36%] bg-sky-50 px-4 py-3 text-sm font-bold text-sky-700">
                      ResearchOS
                    </th>
                    <th className="w-[36%] px-4 py-3 text-sm font-semibold text-gray-700">
                      LabArchives (Professional)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <ComparisonRow
                    label="Price"
                    us={{
                      mark: "win",
                      text: "Free and open source; hosted free in beta",
                    }}
                    them={{
                      mark: "none",
                      text: "$330+ per user, per year; limited free tier",
                    }}
                  />
                  <ComparisonRow
                    label="Per-seat fees"
                    us={{ mark: "win", text: "No per-seat fees, ever" }}
                    them={{ mark: "none", text: "Charged per user, every year" }}
                  />
                  <ComparisonRow
                    label="Where your data lives"
                    us={{ mark: "win", text: "A folder on your own machine" }}
                    them={{ mark: "none", text: "On LabArchives' cloud servers" }}
                  />
                  <ComparisonRow
                    label="File formats"
                    us={{
                      mark: "win",
                      text: "Open Markdown and your original files",
                    }}
                    them={{ mark: "none", text: "Proprietary cloud store" }}
                  />
                  <ComparisonRow
                    label="Own your data, no lock-in"
                    us={{ mark: "win", text: "You own the folder outright" }}
                    them={{
                      mark: "none",
                      text: "The live copy is theirs while you pay",
                    }}
                  />
                  <ComparisonRow
                    label="Bench tools (PCR, plates, LC, Gantt, purchasing)"
                    us={{ mark: "win", text: "Built in, first-class" }}
                    them={{
                      mark: "have",
                      text: "Widgets and third-party add-ons",
                    }}
                  />
                  <ComparisonRow
                    label="Move in from LabArchives"
                    us={{
                      mark: "win",
                      text: "Imports your Offline Notebook ZIP directly",
                    }}
                    them={{ mark: "none", text: "Not applicable" }}
                  />
                  <ComparisonRow
                    label="Per-entry revision history"
                    us={{
                      mark: "soon",
                      text: "Append-only audit log now; per-entry revert roadmapped",
                    }}
                    them={{
                      mark: "have",
                      text: "Full revision history on every entry",
                    }}
                  />
                  <ComparisonRow
                    label="Repository deposit + DOI"
                    us={{
                      mark: "soon",
                      text: "Export and deposit to a repository yourself",
                    }}
                    them={{
                      mark: "have",
                      text: "Built-in Figshare export and DOI",
                    }}
                  />
                  <ComparisonRow
                    label="Security certifications"
                    us={{
                      mark: "none",
                      text: "None by design; published security audit instead",
                    }}
                    them={{
                      mark: "have",
                      text: "FedRAMP, SOC 2, ISO 27001, 21 CFR Part 11",
                    }}
                  />
                  <ComparisonRow
                    label="Managed backups + browser support"
                    us={{
                      mark: "none",
                      text: "Your own cloud drive; Chrome, Edge, or Brave",
                    }}
                    them={{
                      mark: "have",
                      text: "Vendor-managed backups; any modern browser",
                    }}
                  />
                </tbody>
              </table>
            </div>
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-gray-500">
            No electronic notebook is &ldquo;NIH certified&rdquo; (no such
            thing exists). Want the row-by-row detail?{" "}
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
          <span className="text-sm font-semibold uppercase tracking-wide text-sky-100">
            Built for grant-funded labs
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            Supports your NIH Data Management and Sharing Plan
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-sky-50">
            No electronic notebook is &ldquo;NIH certified&rdquo; (there is no
            such thing), and the big cloud vendors charge enterprise prices for
            security badges a grantee lab does not need. ResearchOS gives you
            what the policy actually asks for: organized records you own, real
            version history, and clean exports, without the enterprise price tag.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/wiki/compliance/nih-data-management"
              data-testid="landing-nih-compliance"
              className="rounded-xl bg-white px-6 py-3 text-base font-semibold text-sky-700 shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-50"
            >
              How ResearchOS supports NIH compliance
            </Link>
            <Link
              href="/wiki/compliance/labarchives-comparison"
              className="rounded-xl border border-white/40 px-6 py-3 text-base font-semibold text-white transition-all hover:bg-white/10"
            >
              Compare to LabArchives
            </Link>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
            Up and running in three steps
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
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
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-base font-bold text-white">
                {step.n}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
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
            <span className="text-sm font-semibold uppercase tracking-wide text-sky-600">
              Built in the open
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
              What we are building
            </h2>
            <p className="mt-3 text-base leading-relaxed text-gray-600">
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
              <ul className="space-y-3 text-sm leading-relaxed text-gray-700">
                <li>
                  <span className="font-semibold text-gray-900">
                    Version history
                  </span>{" "}
                  on every record, with one-click restore and a 24-hour undo.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    Bulletproof templates
                  </span>{" "}
                  that travel with the original vendor PDF, so you can check any
                  value against the source it came from.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    Built-in calculators
                  </span>{" "}
                  for molarity, dilutions, primer Tm, DNA and RNA, and buffers.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    Smarter reordering
                  </span>{" "}
                  in Purchases: one-tap quick-reorder, one-click buy-again, and
                  reminders that learn your cadence. No extra logging.
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
              <ul className="space-y-3 text-sm leading-relaxed text-gray-700">
                <li>
                  <span className="font-semibold text-gray-900">
                    More structured protocols
                  </span>{" "}
                  like Western blot and Nanodrop readings, beyond today&apos;s
                  method types.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    A bigger template library
                  </span>{" "}
                  across immunology, microbiology, and protein work.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Ready when you are
          </h2>
          <p className="max-w-xl text-base leading-relaxed text-slate-300">
            It is free to use, it is yours, and you can leave any time. Pick a
            folder and BeakerBot will take it from there.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleGetStarted}
              className="rounded-xl bg-sky-500 px-7 py-3 text-base font-semibold text-white shadow-lg transition-all hover:scale-[1.02] hover:bg-sky-400 hover:shadow-xl"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={handleTryDemo}
              className="rounded-xl border border-white/20 bg-white/5 px-7 py-3 text-base font-semibold text-white transition-all hover:bg-white/10"
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
