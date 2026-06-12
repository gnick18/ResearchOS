"use client";

// The OAuth-first unified landing (entry-flow redesign, 2026-06-11). One light
// "marketing-deck title slide" intro shown to every visitor who is not already
// signed in with a connected folder. Replaces the StartScreen start-chooser when
// NEXT_PUBLIC_OAUTH_FIRST_LOGIN is on.
//
// Faithful to docs/mockups/2026-06-10-entry-flow-oauth-first.html (.deckscreen):
//   - light radial background, rainbow bars top and bottom,
//   - the animated bubble BeakerBot (shared <BeakerBot> via IntroBubbleBot),
//   - the <Wordmark>, the tagline "Own your research. Try it today.",
//   - the Dr. Grant Nickles signature in the UPPER-LEFT (pip + name),
//   - three route-pill buttons in one row (See the tour, Open the live demo
//     /demo, Check our math /transparency),
//   - Create account + Sign in.
//
// "See the tour" scrolls DOWN in-surface to the embedded WelcomePage rather than
// navigating to a route (the standalone /welcome route stays for the wiki /
// settings links). The whole thing is permanently light (the marketing surface
// rule), so it pins the light palette regardless of the user's dark setting.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";

import BeakerBot from "@/components/BeakerBot";
import LightOnly from "@/components/LightOnly";
import MadeInMadison from "@/components/MadeInMadison";
import Wordmark from "@/components/Wordmark";
import WelcomePage from "@/components/welcome/WelcomePage";
import { Icon } from "@/components/icons";
import { IntroBubbleBot } from "./IntroBubbleBot";
import styles from "./OAuthFirstLanding.module.css";

export interface OAuthFirstLandingProps {
  /** Open the three-tier account chooser (Create account). */
  onCreateAccount: () => void;
  /** Open the Welcome-back sign-in screen (Sign in). */
  onSignIn: () => void;
}

// A floating BeakerBot mark, faded, used as deck-style background decoration.
function FloatBot({ className }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute opacity-10 ${className ?? ""}`} aria-hidden>
      <BeakerBot
        pose="idle"
        animated={false}
        ariaLabel=""
        className="w-full text-brand-sky"
      />
    </div>
  );
}

export function OAuthFirstLanding({
  onCreateAccount,
  onSignIn,
}: OAuthFirstLandingProps) {
  const startRef = useRef<HTMLElement>(null);
  const welcomeRef = useRef<HTMLElement>(null);
  // Scroll-reactive sticky top bar, hidden over the entry hero, fades in once
  // the user scrolls into the marketing content.
  const [scrolled, setScrolled] = useState(false);
  // Cursor parallax for the decorative layer (auroras, beakers, bubbles).
  const fxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = fxRef.current;
    if (!layer) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const dx = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
        const dy =
          (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
        layer.style.transform = `translate(${(-dx * 12).toFixed(1)}px, ${(-dy * 10).toFixed(1)}px)`;
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const scrollTo = (ref: React.RefObject<HTMLElement | null>) =>
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <LightOnly>
      <div
        className="h-screen overflow-y-auto snap-y snap-proximity"
        onScroll={(e) =>
          setScrolled(e.currentTarget.scrollTop > window.innerHeight * 0.6)
        }
      >
        {/* Scroll-reactive sticky top bar. Hidden over the entry hero, fades in
            as you scroll into the content, so there is a consistent header and a
            way back to sign in. Replaces the WelcomePage nav (embedded). */}
        <header
          className={`fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-border bg-surface-raised/85 px-5 py-2.5 backdrop-blur-md transition-all duration-300 ${
            scrolled
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-full opacity-0"
          }`}
        >
          <Wordmark size="sm" textClassName="text-brand-ink" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-lg px-3.5 py-1.5 text-xs font-bold text-foreground transition-colors hover:text-brand-action"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={onCreateAccount}
              className="rounded-lg px-4 py-1.5 text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #1283c9, #5B47D6)" }}
            >
              Create account
            </button>
          </div>
        </header>
        {/* Section 1: the deck-style intro landing. */}
        <section
          ref={startRef}
          className="relative min-h-screen w-full snap-start overflow-hidden flex flex-col items-center justify-center px-6 py-16 text-center"
          style={{
            background:
              "radial-gradient(560px 360px at 50% 6%, #ffffff 0%, #f6f9ff 55%, #eef4ff 100%)",
          }}
        >
          {/* Dot-grid stage behind the hero (static, masked to fade at edges). */}
          <div aria-hidden className={styles.dotgrid} />

          {/* Parallax decorative layer: drifting auroras, floating beakers, and
              the rising bubble field. Shifts slightly opposite the cursor. */}
          <div ref={fxRef} className={styles.parallaxLayer} aria-hidden>
            <div className={`${styles.aurora} ${styles.a1}`} />
            <div className={`${styles.aurora} ${styles.a2}`} />
            <div className={`${styles.aurora} ${styles.a3}`} />
            <div className={`${styles.aurora} ${styles.a4}`} />
            <FloatBot className={`${styles.floaty} top-[12%] left-[7%] w-20`} />
            <FloatBot className={`${styles.floaty} ${styles.s2} bottom-[15%] left-[11%] w-14`} />
            <FloatBot className={`${styles.floaty} ${styles.s3} top-[15%] right-[8%] w-16`} />
            <FloatBot className={`${styles.floaty} ${styles.s4} bottom-[13%] right-[6%] w-24`} />
          </div>

          {/* Rainbow bars, top and bottom. */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[7px] z-[2] brand-rainbow-bg"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[7px] z-[2] brand-rainbow-bg"
          />

          {/* The Dr. Grant Nickles signature, upper-left. */}
          <div className="absolute left-5 top-4 z-[4] inline-flex items-center gap-2 text-[10px] font-medium text-slate-500">
            <span
              aria-hidden
              className="block h-[7px] w-[7px] rounded-full"
              style={{
                // Brand pip, solid beaker blue (brand-sky), matching the beaker.
                backgroundColor: "#1AA0E6",
              }}
            />
            Dr. Grant Nickles, University of Wisconsin-Madison
          </div>

          <div
            className={`relative z-[1] flex flex-col items-center ${styles.enter}`}
          >
            <IntroBubbleBot size="xl" className="mb-5" />

            <Wordmark
              textOnly
              size="lg"
              textClassName="text-brand-ink !text-5xl sm:!text-6xl"
              className="!gap-0"
            />
            <p className="mt-3 text-lg font-semibold text-brand-action sm:text-xl">
              Own your research. Try it today.
            </p>

            {/* Create account + Sign in. */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
              <button
                type="button"
                onClick={onCreateAccount}
                className="rounded-xl px-7 py-3 text-base font-bold text-white"
                style={{
                  background: "linear-gradient(135deg, #1283c9, #5B47D6)",
                }}
              >
                Create account
              </button>
              <button
                type="button"
                onClick={onSignIn}
                className="rounded-xl border border-border bg-surface-raised px-7 py-3 text-base font-bold text-foreground hover:border-foreground-muted transition-colors"
              >
                Sign in
              </button>
            </div>

            {/* Route pills, one row. */}
            <div className="mt-6 flex flex-nowrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => scrollTo(welcomeRef)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface-sunken px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-surface-raised hover:border-foreground-muted transition-colors"
              >
                <Icon name="map" className="h-3.5 w-3.5 text-brand-action" />
                See the tour
              </button>
              <a
                href="/demo"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface-sunken px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-surface-raised hover:border-foreground-muted transition-colors"
              >
                <Icon name="eye" className="h-3.5 w-3.5 text-brand-action" />
                Open the live demo
                <code className="font-mono text-[10px] text-brand-action">/demo</code>
              </a>
              <a
                href="/transparency"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface-sunken px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-surface-raised hover:border-foreground-muted transition-colors"
              >
                <Icon name="scale" className="h-3.5 w-3.5 text-brand-action" />
                Check our math
                <code className="font-mono text-[10px] text-brand-action">
                  /transparency
                </code>
              </a>
            </div>

            {/* Pillars strip (brand refresh change 1). States the positioning
                instead of implying it. */}
            <div className="mt-7 grid w-full max-w-2xl grid-cols-3 gap-3">
              {[
                ["Ownership", "Your data in a folder you own."],
                ["One Workspace", "Notebook, chemistry, stats. Free."],
                ["Trust", "Open source, validated in public."],
              ].map(([title, desc]) => (
                <div
                  key={title}
                  className="rounded-xl border border-border bg-surface-raised/70 px-3.5 py-3 text-left backdrop-blur-sm"
                >
                  <p className="text-[12.5px] font-extrabold text-brand-ink">
                    {title}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-foreground-muted">
                    {desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Made in Madison badge + fellowship credit (brand refresh change
                2). MadeInMadison renders the real Wisconsin state mark with the
                gold Madison star. */}
            <div className="mt-5 flex flex-col items-center gap-2 border-t border-dashed border-border pt-4">
              <MadeInMadison variant="line" tone="soft" />
              <p className="max-w-sm text-center text-[10px] leading-relaxed text-foreground-muted">
                Supported by a UW Distinguished Research Fellowship at UW-Madison
                (Office of the Vice Chancellor for Research, with funding from the
                Wisconsin Alumni Research Foundation).
              </p>
            </div>
          </div>

          {/* Bouncing scroll-down affordance to the welcome section. */}
          <button
            type="button"
            onClick={() => scrollTo(welcomeRef)}
            aria-label="Learn what ResearchOS is"
            className="absolute bottom-6 left-1/2 z-[1] flex -translate-x-1/2 animate-bounce flex-col items-center gap-1.5 text-foreground-muted hover:text-brand-action transition-colors"
          >
            <span className="text-xs font-medium">What is ResearchOS?</span>
            <span className="block h-3 w-3 rotate-45 border-b-2 border-r-2 border-current" />
          </button>
        </section>

        {/* Section 2: the embedded welcome / sell page, with a snap-up arrow. */}
        <section ref={welcomeRef} className="relative snap-start">
          <button
            type="button"
            onClick={() => scrollTo(startRef)}
            aria-label="Back to get started"
            className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 animate-bounce flex-col items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-brand-action shadow-sm backdrop-blur hover:text-brand-ink transition-colors"
          >
            <span className="block h-3 w-3 rotate-45 border-t-2 border-l-2 border-current" />
            <span className="text-xs font-medium">Back to get started</span>
          </button>
          <WelcomePage embedded />
        </section>
      </div>
    </LightOnly>
  );
}

export default OAuthFirstLanding;
