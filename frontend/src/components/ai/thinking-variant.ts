"use client";

// thinking-variant (BeakerAI manager, 2026-06-12).
//
// Tiny dev-only store for which "thinking" indicator variant is live. The value
// is persisted in localStorage under THINKING_VARIANT_KEY (default "pulse") so a
// developer can flip pulse -> beaker -> blink and the choice survives reloads.
// This is DEV ONLY plumbing, the conversation always defaults to "pulse" so
// nothing non-default ever ships to a real user (the switcher that writes this
// key is gated behind process.env.NODE_ENV === "development").
//
// A small event-based subscription keeps every reader (the conversation line
// and the dev switcher button) in sync within the tab without pulling in a
// state library.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useSyncExternalStore } from "react";
import type { ThinkingVariant } from "./BeakerBotThinking";

export const THINKING_VARIANT_KEY = "beakerbot.thinkingVariant";
export const DEFAULT_THINKING_VARIANT: ThinkingVariant = "pulse";

export const THINKING_VARIANTS: readonly ThinkingVariant[] = [
  "pulse",
  "beaker",
  "blink",
];

const EVENT_NAME = "beakerbot:thinking-variant";

function isVariant(value: unknown): value is ThinkingVariant {
  return value === "pulse" || value === "beaker" || value === "blink";
}

/** Read the current variant from localStorage, defaulting to pulse. Safe on the
 *  server (no window) and on bad / missing values. */
export function readThinkingVariant(): ThinkingVariant {
  if (typeof window === "undefined") return DEFAULT_THINKING_VARIANT;
  try {
    const raw = window.localStorage.getItem(THINKING_VARIANT_KEY);
    return isVariant(raw) ? raw : DEFAULT_THINKING_VARIANT;
  } catch {
    return DEFAULT_THINKING_VARIANT;
  }
}

/** Persist the variant and notify in-tab subscribers. */
export function setThinkingVariant(variant: ThinkingVariant): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THINKING_VARIANT_KEY, variant);
  } catch {
    // Ignore write failures (private mode, full quota), the in-memory event
    // below still updates the live readers for this tab.
  }
  window.dispatchEvent(new Event(EVENT_NAME));
}

/** Advance pulse -> beaker -> blink -> pulse and return the new value. */
export function cycleThinkingVariant(): ThinkingVariant {
  const current = readThinkingVariant();
  const idx = THINKING_VARIANTS.indexOf(current);
  const next = THINKING_VARIANTS[(idx + 1) % THINKING_VARIANTS.length]!;
  setThinkingVariant(next);
  return next;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, callback);
  // Cross-tab edits fire a native storage event, mirror it into our readers.
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT_NAME, callback);
    window.removeEventListener("storage", callback);
  };
}

/** Reactive hook, re-renders when the variant changes in this tab (or another).
 *  Server snapshot is always the default so SSR and the first client paint
 *  agree. */
export function useThinkingVariant(): ThinkingVariant {
  return useSyncExternalStore(
    subscribe,
    readThinkingVariant,
    () => DEFAULT_THINKING_VARIANT,
  );
}
