"use client";

import { useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { useFileSystem } from "@/lib/file-system/file-system-context";

const DISMISS_KEY = "researchOS.demoLabBannerDismissed";

type DemoMarker = {
  is_demo?: boolean;
  lab_title?: string;
  version?: string;
};

/**
 * Thin persistent warning bar that appears across every page when the
 * `_demo_marker.json` file exists at the connected folder's root. Detection
 * runs whenever the folder connection changes; result is cached in component
 * state. Dismissal is sessionStorage-scoped so each new tab re-surfaces it.
 */
export default function DemoLabBanner() {
  const { isConnected, directoryName } = useFileSystem();
  const [isDemo, setIsDemo] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const ss = typeof window !== "undefined" ? window.sessionStorage : null;
      setDismissed(ss?.getItem(DISMISS_KEY) === "1");
    } catch {
      // sessionStorage can throw in privacy modes — leave dismissed=false.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isConnected) {
      setIsDemo(false);
      return;
    }
    (async () => {
      try {
        const marker = await fileService.readJson<DemoMarker>("_demo_marker.json");
        if (!cancelled) setIsDemo(!!marker?.is_demo);
      } catch {
        if (!cancelled) setIsDemo(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, directoryName]);

  if (!isDemo || dismissed) return null;

  const onDismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignore.
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="w-full bg-amber-100 border-b border-amber-300 text-amber-950 text-sm px-4 py-2 flex items-center gap-3"
    >
      <span className="text-base leading-none" aria-hidden="true">🧪</span>
      <span className="flex-1">
        <strong className="font-semibold">You&apos;re viewing the Demo Lab.</strong>{" "}
        This data is fake, generated for tutorial purposes. Connect a different
        folder to use ResearchOS for real research.{" "}
        <a
          href="/wiki/getting-started/connecting-your-folder"
          className="underline font-medium hover:text-amber-900"
        >
          Learn more →
        </a>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs px-2 py-1 rounded border border-amber-400/60 hover:bg-amber-200 transition-colors"
        aria-label="Dismiss demo lab banner for this session"
      >
        Dismiss
      </button>
    </div>
  );
}
