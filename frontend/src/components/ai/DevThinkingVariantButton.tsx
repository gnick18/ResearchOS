"use client";

// DevThinkingVariantButton (BeakerAI manager, 2026-06-12).
//
// Dev-only control to flip the live "BeakerBot is thinking" indicator between
// its three variants (pulse -> beaker -> blink) without writing any code. It
// writes the localStorage key the conversation reads, so the running panel
// updates immediately. Hard-gated on process.env.NODE_ENV === "development" so
// the whole body becomes dead code in production builds (same pattern as
// DevDemoToggleButton / DevTestNotificationButton). Default variant is pulse,
// so nothing non-default ever ships to a real user.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  cycleThinkingVariant,
  useThinkingVariant,
} from "./thinking-variant";

const IS_DEV = process.env.NODE_ENV === "development";

export default function DevThinkingVariantButton() {
  const variant = useThinkingVariant();
  if (!IS_DEV) return null;

  return (
    <button
      type="button"
      data-testid="dev-thinking-variant"
      onClick={() => cycleThinkingVariant()}
      title="Dev only. Cycle the BeakerBot thinking indicator (pulse, beaker, blink)."
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised px-2 py-1 text-meta text-foreground-muted hover:text-foreground"
    >
      Thinking style, {variant}
    </button>
  );
}
