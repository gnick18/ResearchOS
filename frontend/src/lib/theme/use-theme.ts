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

import { useCallback, useEffect, useRef, useState } from "react";

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

  // Hydrate from storage on mount (server render is always the default).
  useEffect(() => {
    setChoice(readStored());
  }, []);

  // Persist + apply only on REAL changes, never on the initial default-"light"
  // mount. The mount run would otherwise write "light" to localStorage and strip
  // data-theme BEFORE hydration reads the stored value, flipping the whole app to
  // light and clobbering the saved preference. This bit hard when a SECOND
  // useTheme mounts (e.g. the Settings modal): its mount-time "light" write raced
  // the live theme and flipped everything to light. Skipping the first run leaves
  // the no-FOUC-applied theme intact and only repaints on an actual choice change.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, choice);
    apply(resolve(choice));
  }, [choice]);

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
