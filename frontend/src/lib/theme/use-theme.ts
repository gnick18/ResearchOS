"use client";

// Dark-mode preference hook (POC, see docs/proposals/dark-mode-toggle.md).
//
// Theme is a per-DEVICE display preference, not research data, so localStorage
// is the source of truth for instant, no-FOUC first paint. The no-FOUC inline
// script in app/layout.tsx applies the stored value before first paint; this
// hook keeps React in sync and writes changes back, plus reapplies the resolved
// theme live when the choice is "system" and the OS flips.
//
// CLOUD SYNC (additive, best-effort):
//   On login the hook GETs /api/account/theme once and, if the cloud value
//   differs from localStorage, adopts it (cross-device last-wins). On any
//   user-driven theme change the new value is PUT to the API, fire-and-forget.
//   localStorage is written first in both paths so the screen is never blocked
//   by the network. Any network/server failure is swallowed silently; the local
//   value always wins as the fallback.
//
// Anti-thrash: the hook tracks the last value it RECEIVED from the cloud in
// `cloudValue`. When writing back on change, it skips the PUT if the new value
// already matches the latest cloud value (so adopting a cloud value does not
// immediately echo it back, and a page reload doesn't POST on every hydration).
//
// StrictMode note: hydrated is STATE (not a ref) so apply() is gated correctly
// even under double-invoke. A ref-based "skip first run" guard gets defeated by
// StrictMode's second invoke, which is exactly the "Settings page blinks to
// light" flash.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSession } from "next-auth/react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "researchos-theme";
const VALID_THEMES: ReadonlySet<string> = new Set(["light", "dark", "system"]);

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

/** PUT theme to cloud, fire-and-forget. Swallows all errors. */
function pushThemeToCloud(theme: ThemeChoice): void {
  fetch("/api/account/theme", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme }),
  }).catch(() => {
    // Swallow: cloud is best-effort; localStorage is already written.
  });
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

  // Track the latest value received FROM the cloud so we do not echo it back
  // on the next change-driven PUT. Null until the cloud is first read.
  const cloudValueRef = useRef<ThemeChoice | null>(null);

  // Hydrate from storage on mount (server render is always the default).
  // After hydration, kick off a one-shot cloud sync if signed in.
  useEffect(() => {
    const local = readStored();
    setChoice(local);
    setHydrated(true);

    // Best-effort cloud read: run once after localStorage is loaded.
    // We check for a session before fetching to avoid a 401 noise on public pages.
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession();
        if (!session?.user?.email) return; // not signed in, skip
        if (cancelled) return;

        const res = await fetch("/api/account/theme");
        if (cancelled || !res.ok) return;

        const data = (await res.json()) as { theme?: unknown };
        const cloudTheme = data.theme;
        if (
          typeof cloudTheme === "string" &&
          VALID_THEMES.has(cloudTheme) &&
          cloudTheme !== local // only adopt when it differs from local
        ) {
          const t = cloudTheme as ThemeChoice;
          cloudValueRef.current = t;
          setChoice(t);
          // apply() happens via the choice + hydrated effect below.
        } else if (typeof cloudTheme === "string" && VALID_THEMES.has(cloudTheme)) {
          // Same as local — record it so we do not needlessly PUT on first change.
          cloudValueRef.current = cloudTheme as ThemeChoice;
        }
      } catch {
        // Swallow: cloud unavailable, localStorage value stays.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const setTheme = useCallback((next: ThemeChoice) => {
    setChoice(next);
    // Push to cloud on a real user-driven change. Fire-and-forget.
    // Skip the PUT if this value is already what the cloud has (including when
    // we just adopted it from the cloud), so there is no pointless round-trip.
    (async () => {
      try {
        const session = await getSession();
        if (!session?.user?.email) return; // not signed in
        if (cloudValueRef.current === next) return; // already synced
        cloudValueRef.current = next; // optimistic: assume success
        pushThemeToCloud(next);
      } catch {
        // Swallow: getSession failure is not a reason to refuse the change.
      }
    })();
  }, []);

  return { choice, resolved: resolve(choice), setTheme } as const;
}
