"use client";

import MadeInMadison from "@/components/MadeInMadison";
import Wordmark from "@/components/Wordmark";

/**
 * Shared site footer, intentionally minimal (Grant 2026-06-11): just the legal
 * entity sign-off, the wordmark, "ResearchOS LLC, a registered Wisconsin
 * company", and the Built-in-Madison line, aligned to the bottom-right like a
 * quiet credit. The University origin credit (ResearchOS grew out of a
 * UW-Madison Distinguished Research Fellowship) lives on the welcome and login
 * pages, not in this shared footer, and the privacy policy stays reachable from
 * the landing, settings, and the pricing page header.
 *
 * Voice rules: no em-dashes, no emojis. Pass `className` (e.g. "mt-auto") so a
 * flex-column parent can pin it to the bottom of a short page.
 */
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
      className={`relative border-t border-border bg-surface-raised py-3 ${className}`}
    >
      {/* Brand rainbow hairline along the top edge: the BeakerBot liquid ramp,
          the same gradient as the banner + avatars, used as a quiet brand
          signature on the footer. */}
      <div
        aria-hidden
        className="brand-rainbow-bg absolute inset-x-0 top-0 h-[3px]"
      />
      {/* Minimal: just the legal entity sign-off, aligned to the bottom-right. */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-x-2 gap-y-1 px-6 text-meta text-foreground-muted">
        <Wordmark
          size="sm"
          textOnly={hideMark}
          animated={false}
          markEasterEgg="none"
          textClassName="text-foreground"
        />
        <span data-testid="app-footer-author">
          LLC, a registered Wisconsin company
        </span>
        <span aria-hidden="true">·</span>
        <MadeInMadison variant="line" tone="soft" />
      </div>
    </footer>
  );
}
