"use client";

import type { ReactNode } from "react";

import BeakerBot from "@/components/BeakerBot";

// The canonical ResearchOS lockup: the BeakerBot identity mark plus the
// "ResearchOS" wordmark, rendered identically everywhere it appears (the app
// header, the welcome page, the auth screens, the footer). Before this existed
// the pair was hand-rolled at each call site and had drifted into three
// different weights and blues. Centralizing it is what keeps the lockup on
// brand.
//
// Brand spec (brand/README.md): mark in brand-sky (#1AA0E6, the identity blue,
// never used for small text), wordmark in brand-ink (#111827) at weight 800
// (extrabold) with tight tracking.

type WordmarkSize = "sm" | "md" | "lg";

const SIZES: Record<WordmarkSize, { mark: string; text: string }> = {
  // Header chrome.
  sm: { mark: "h-6 w-6", text: "text-title" },
  // Welcome header, footer sign-off, auth screens.
  md: { mark: "h-8 w-8", text: "text-heading" },
  // Large standalone lockup (empty states, splash).
  lg: { mark: "h-11 w-11", text: "text-display" },
};

export interface WordmarkProps {
  /** Lockup scale. Default "md". */
  size?: WordmarkSize;
  /** Extra classes on the flex row wrapper. */
  className?: string;
  /** Render only the BeakerBot mark, no "ResearchOS" text. */
  markOnly?: boolean;
  /** Node rendered between the mark and the wordmark text (e.g. a streak
   *  badge in the app header). */
  aside?: ReactNode;
  /** Give the mark the gentle alive idle (decorative hero / splash use). */
  alive?: boolean;
  /** Opt the mark's pose animation in or out. Default true (matches the app
   *  header). Marketing surfaces that want a perfectly still logo pass false. */
  animated?: boolean;
  /** Mark click handler (e.g. the app-header heart egg + showcase unlock). */
  onMarkClick?: () => void;
  /** Mark click easter egg. Defaults to "heart" so the lockup stays playful;
   *  pass "none" for a purely decorative, inert mark. */
  markEasterEgg?: "heart" | "none";
  /** data-testid forwarded onto the mark wrapper. */
  markTestId?: string;
  /** Element used to render the wordmark text. Default "span"; the app header
   *  passes "h1" to keep its existing document outline. */
  textAs?: "span" | "h1";
  /** Accessible label for the mark. */
  ariaLabel?: string;
}

export default function Wordmark({
  size = "md",
  className,
  markOnly = false,
  aside,
  alive = false,
  animated = true,
  onMarkClick,
  markEasterEgg = "heart",
  markTestId,
  textAs = "span",
  ariaLabel = "ResearchOS BeakerBot logo",
}: WordmarkProps) {
  const s = SIZES[size];
  const TextTag = textAs;
  return (
    <div
      className={`flex items-center gap-1.5 leading-none ${className ?? ""}`.trim()}
    >
      <span
        onClick={onMarkClick}
        data-testid={markTestId}
        className="inline-flex shrink-0"
      >
        <BeakerBot
          pose="idle"
          alive={alive}
          animated={animated}
          ariaLabel={ariaLabel}
          easterEgg={markEasterEgg}
          className={`${s.mark} block shrink-0 text-brand-sky`}
        />
      </span>
      {aside}
      {!markOnly && (
        <TextTag
          className={`${s.text} font-extrabold tracking-tight text-brand-ink`}
        >
          ResearchOS
        </TextTag>
      )}
    </div>
  );
}
