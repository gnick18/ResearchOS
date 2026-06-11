"use client";

import Image from "next/image";
import Link from "next/link";

import MadeInMadison from "@/components/MadeInMadison";
import Wordmark from "@/components/Wordmark";

/**
 * Shared site footer, mirroring the landing page's footer so the credit
 * reads identically wherever it appears (Settings today; the landing page
 * keeps its own inline copy for now). Centered layout: the official
 * UW-Madison RISE logo on top, a "funded by RISE, free and open source on
 * GitHub" line, then the author credit.
 *
 * Voice rules: no em-dashes, no emojis (every glyph is text or the
 * official PNG). Pass `className` (e.g. "mt-auto") so a flex-column parent
 * can pin it to the bottom of a short page and fill the empty tail.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";

export default function AppFooter({
  className = "",
  hideMark = false,
}: {
  className?: string;
  /** Render the footer wordmark as plain text, no BeakerBot mark. Used by the
   *  maintenance holding page. Default false, so every other call site keeps
   *  the mark. */
  hideMark?: boolean;
}) {
  return (
    <footer
      data-testid="app-footer"
      className={`relative border-t border-border bg-surface-raised py-10 ${className}`}
    >
      {/* Brand rainbow hairline along the top edge: the BeakerBot liquid ramp,
          the same gradient as the banner + avatars, used as a quiet brand
          signature on the footer. */}
      <div
        aria-hidden
        className="brand-rainbow-bg absolute inset-x-0 top-0 h-[3px]"
      />
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 text-center">
        {/* Product brand sign-off, then the RISE funder credit below it. */}
        {/* The footer now themes via tokens, so the wordmark uses the foreground
            token (dark ink in light, light in dark) instead of a pinned ink. */}
        <Wordmark
          size="md"
          textOnly={hideMark}
          animated={false}
          markEasterEgg="none"
          textClassName="text-foreground"
        />
        {/* White backing chip stays white in both themes so the dark RISE logo
            PNG reads on the dark footer too. */}
        <div className="rounded bg-white p-0.5">
          <Image
            src="/credentials/uw-rise-logo.png"
            alt="Wisconsin RISE Initiative (Wisconsin Research, Innovation and Scholarly Excellence)"
            width={260}
            height={69}
            unoptimized
            className="h-12 w-auto"
          />
        </div>
        <p className="text-body text-foreground-muted">
          Funded by the UW-Madison RISE Initiative. Free and open source on{" "}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-action underline-offset-2 hover:underline"
            data-testid="app-footer-github"
          >
            GitHub
          </a>
          .
        </p>
        <p className="text-meta text-foreground-muted" data-testid="app-footer-author">
          Built by Dr. Grant R. Nickles, PhD.
        </p>
        {/* Wisconsin LLC identity line: sits between the author credit and the
            trust/credits link row, compact enough not to dominate the footer. */}
        <MadeInMadison variant="line" tone="soft" />
        {/* Subtle credit + trust links: the /open-source page thanks the
            community and carries the full attribution; the /transparency page
            shows our bioinformatic tools checked against Biopython and primer3
            on every code change. */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-meta text-foreground-muted">
          <Link
            href="/open-source"
            className="underline-offset-2 hover:text-foreground hover:underline"
            data-testid="app-footer-open-source"
          >
            Built on open source
          </Link>
          <span aria-hidden="true">·</span>
          <Link
            href="/thanks"
            className="underline-offset-2 hover:text-foreground hover:underline"
            data-testid="app-footer-thanks"
          >
            Sponsors and thanks
          </Link>
          <span aria-hidden="true">·</span>
          <Link
            href="/transparency"
            className="underline-offset-2 hover:text-foreground hover:underline"
            data-testid="app-footer-transparency"
          >
            Transparency of tests
          </Link>
          <span aria-hidden="true">·</span>
          <Link
            href="/privacy"
            className="underline-offset-2 hover:text-foreground hover:underline"
            data-testid="app-footer-privacy"
          >
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
