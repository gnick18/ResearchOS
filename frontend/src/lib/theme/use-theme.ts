"use client";

// Dark-mode preference hook (POC, see docs/proposals/dark-mode-toggle.md).
//
// Theme is a per-DEVICE display preference, not research data, so localStorage
// is the source of truth (it is also the only store available on the public
// pages, welcome / wiki / auth, where no research folder is open). The no-FOUC
// inline script in app/layout.tsx applies the stored value before first paint;
// this hook keeps React in sync and writes changes back, plus reapplies the
// resolved theme live when the choice is "system" and the OS flips.
//
// Future: mirror the resolved choice into users/<u>/settings.json when a folder
// is open, as a cross-device convenience (localStorage stays authoritative).

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "researchos-theme";

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** The concrete theme to paint given a choice (resolves "system"). */
function resolve(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

/** Apply a resolved theme to <html> (mirrors the inline no-FOUC script). */
function apply(resolved: "light" | "dark") {
  const el = document.documentElement;
  if (resolved === "dark") el.setAttribute("data-theme", "dark");
  else el.removeAttribute("data-theme");
  el.style.colorScheme = resolved;
}

function readStored(): ThemeChoice {
  if (typeof window === "undefined") return "light";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "dark" || v === "light" || v === "system" ? v : "light";
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("light");
  // Hydration is tracked as STATE (not a ref) so the apply effect below is gated
  // correctly even under React StrictMode, which double-invokes mount effects in
  // dev. A ref-based "skip first run" guard gets defeated by that double-invoke
  // (the second invoke sees the ref already flipped and runs apply("light")),
  // which is exactly the "first time you open Settings the whole site blinks to
  // light" flash: a freshly-mounted useTheme (the lazy Settings chunk) momentarily
  // strips data-theme before hydration. Gating on `hydrated` state means apply()
  // never runs until the stored choice is loaded, in dev or prod.
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from storage on mount (server render is always the default).
  useEffect(() => {
    setChoice(readStored());
    setHydrated(true);
  }, []);

  // Persist + apply only AFTER hydration, so the initial default-"light" render
  // never writes "light" or strips data-theme. The no-FOUC script in layout.tsx
  // owns the first paint; this only repaints on a real choice change.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, choice);
    apply(resolve(choice));
  }, [choice, hydrated]);

  // When following the system, repaint live if the OS theme flips.
  useEffect(() => {
    if (choice !== "system" || typeof window === "undefined" || !window.matchMedia)
      return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(resolve("system"));
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [choice]);

  const setTheme = useCallback((next: ThemeChoice) => setChoice(next), []);

  return { choice, resolved: resolve(choice), setTheme } as const;
}
