"use client";

import { Analytics } from "@vercel/analytics/next";
import { useAppStore } from "@/lib/store";

// Offline Mode (security affordance #2, d164fd2b) promises zero outbound when
// the toggle is on. Returning null here unmounts the Vercel Web Analytics
// wrapper so the Analytics script (va.vercel-scripts.com) is not injected and
// no page-view beacons fire. Toggling the setting re-mounts/unmounts; the
// underlying script handles a fresh load cleanly when offline mode flips off.
//
// Speed Insights was removed 2026-06-07: the paid Speed Insights product was
// disabled in Vercel to save cost (app perf was already excellent, RES 100),
// so the <SpeedInsights /> wrapper was dropped to avoid loading a dead script.
export default function OfflineGatedAnalytics() {
  const offlineMode = useAppStore((s) => s.offlineMode);
  if (offlineMode) return null;
  return <Analytics />;
}
