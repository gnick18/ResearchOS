"use client";

/**
 * DemoLoop: a self-contained, performance-minded autoplay video loop for the
 * video-driven welcome page (`/welcome-preview`). Implements the launch-page
 * research's settled <video> pattern (research doc section 2):
 *
 *  - `<video autoPlay muted loop playsInline preload="none" poster=...>` with
 *    the MP4 source inside. `muted` is mandatory (browsers block unmuted
 *    autoplay); `playsInline` is mandatory for iOS Safari; `preload="none"`
 *    keeps below-the-fold loops from fetching bytes until they scroll in.
 *  - IntersectionObserver plays the clip when at least 25% is in view and
 *    pauses it when it scrolls out. This is the main performance lever on a
 *    multi-loop page: only the visible loop is decoding. The observer is wired
 *    in a useEffect and torn down on unmount.
 *  - prefers-reduced-motion: when the OS asks for reduced motion we do NOT
 *    autoplay. We render the poster image only (no <video> element at all), so
 *    the section still paints the same frame with zero motion. The media query
 *    is read through window.matchMedia inside an effect (SSR-safe: the server
 *    and first client render assume "motion allowed", then the effect corrects
 *    it after mount, avoiding a hydration mismatch).
 *  - The poster paints instantly so there is no layout shift while the clip
 *    loads, and it doubles as the reduced-motion still.
 *
 * The optional `framed` prop wraps the loop in a tasteful browser-chrome
 * mockup (traffic-light dots + a faint monospace URL bar), matching the hero
 * frame in the chosen aesthetic mock (tools/welcome-mock/index.html).
 *
 * For clips that are not recorded yet, render <DemoLoopPlaceholder> instead of
 * pointing <DemoLoop> at a missing file: it shows a soft "demo coming soon"
 * box carrying the same claim, so nothing ever renders a broken <video>.
 *
 * Voice rules apply here too: no emojis, every glyph is an inline SVG.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Reads the user's reduced-motion preference, SSR-safe.
 *  Returns false on the server and the first client render (so the markup
 *  matches), then flips to the real value after mount via matchMedia, and
 *  tracks live changes to the setting. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    // addEventListener is the modern API; older Safari only has addListener.
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);
  return reduced;
}

/** Browser-chrome wrapper: traffic-light dots + a faint monospace URL bar,
 *  matching the mock's hero frame. Purely decorative, so aria-hidden on the
 *  chrome bits. `url` defaults to a believable in-app path. */
function ChromeFrame({
  url = "research-os.app/workbench",
  children,
}: {
  url?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#0c1322] shadow-[0_30px_80px_rgba(2,8,20,0.45)]">
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#131c2e] px-4 py-3">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div
          className="mx-auto flex max-w-[460px] flex-1 items-center gap-2 rounded-lg border border-white/10 bg-[#0d1220] px-3 py-1.5 font-mono text-[12.5px] text-slate-500"
          aria-hidden
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            className="flex-none"
          >
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" />
          </svg>
          {url}
        </div>
      </div>
      {children}
    </div>
  );
}

export interface DemoLoopProps {
  /** Path to the MP4 loop, served from /welcome-demos/... */
  src: string;
  /** Poster still (the .poster.jpg sibling). Paints instantly and doubles as
   *  the reduced-motion fallback. */
  poster: string;
  /** Descriptive label for the loop. Used as the video's aria-label and the
   *  reduced-motion poster's alt text (WCAG: every loop carries a text
   *  description alongside its adjacent claim). */
  label: string;
  /** Wrap the loop in a browser-chrome mockup (hero treatment). */
  framed?: boolean;
  /** URL string shown in the chrome bar when `framed`. */
  frameUrl?: string;
  /** Extra classes on the media element / aspect box. */
  className?: string;
}

/**
 * The autoplay loop. Renders an aspect-ratio box that holds either the poster
 * still (reduced motion) or the IntersectionObserver-gated <video>.
 */
export default function DemoLoop({
  src,
  poster,
  label,
  framed = false,
  frameUrl,
  className,
}: DemoLoopProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reduced = usePrefersReducedMotion();

  // Play on scroll-in (>=25% visible), pause on scroll-out. Skipped entirely
  // under reduced motion (no <video> rendered). Cleaned up on unmount.
  useEffect(() => {
    if (reduced) return;
    const el = videoRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // play() returns a promise that can reject if the tab is
            // backgrounded or the browser blocks it; swallow it so an
            // autoplay rejection never bubbles as an unhandled rejection.
            void el.play().catch(() => {});
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced]);

  const media = reduced ? (
    // Reduced motion: poster only, no <video>, no autoplay. Same frame, no
    // motion. Native <img> (not next/image) so it needs no width/height props
    // and never triggers the optimizer on a static public asset.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={poster}
      alt={label}
      className="block h-full w-full object-cover object-top"
    />
  ) : (
    <video
      ref={videoRef}
      autoPlay
      muted
      loop
      playsInline
      preload="none"
      poster={poster}
      aria-label={label}
      className="block h-full w-full object-cover object-top"
    >
      <source src={src} type="video/mp4" />
    </video>
  );

  const aspectBox = (
    <div
      className={`relative aspect-[16/10] w-full overflow-hidden bg-[#0c1424] ${
        framed ? "" : "rounded-2xl border border-white/10"
      } ${className ?? ""}`}
    >
      {media}
    </div>
  );

  if (framed) {
    return <ChromeFrame url={frameUrl}>{aspectBox}</ChromeFrame>;
  }
  return aspectBox;
}

export interface DemoLoopPlaceholderProps {
  /** The claim this not-yet-recorded clip will carry, shown in the box. */
  claim: string;
  /** Short uppercase tag for the placeholder (e.g. "Gibson cloning"). */
  tag?: string;
  /** Wrap in the browser-chrome mockup, same as DemoLoop. */
  framed?: boolean;
  frameUrl?: string;
  className?: string;
}

/**
 * A soft "demo coming soon" box for clips that are not recorded yet. Renders a
 * tasteful poster-style panel with a play glyph and the claim, never a broken
 * <video>. Matches the loop boxes' dark treatment so the bento grid reads
 * evenly whether a cell has a real clip or a stand-in.
 */
export function DemoLoopPlaceholder({
  claim,
  tag,
  framed = false,
  frameUrl,
  className,
}: DemoLoopPlaceholderProps) {
  const box = (
    <div
      className={`relative flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 overflow-hidden bg-gradient-to-br from-[#101a2d] to-[#0c1424] px-6 text-center ${
        framed ? "" : "rounded-2xl border border-white/10"
      } ${className ?? ""}`}
    >
      <svg
        width="34"
        height="34"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-slate-500"
        aria-hidden
      >
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M10 9l5 3-5 3V9Z" fill="currentColor" stroke="none" />
      </svg>
      {tag ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-sky-300/80">
          {tag}
        </span>
      ) : null}
      <span className="font-mono text-[12px] uppercase tracking-[0.06em] text-slate-400">
        Demo coming soon
      </span>
      <span className="max-w-[34ch] text-[13.5px] leading-relaxed text-slate-300">
        {claim}
      </span>
    </div>
  );

  if (framed) {
    return <ChromeFrame url={frameUrl}>{box}</ChromeFrame>;
  }
  return box;
}
