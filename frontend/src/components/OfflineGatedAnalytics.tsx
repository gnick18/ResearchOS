"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { useAppStore } from "@/lib/store";

// Offline Mode (security affordance #2, d164fd2b) promises zero outbound when
// the toggle is on. Returning null here unmounts BOTH Vercel telemetry
// wrappers so neither the Web Analytics script (va.vercel-scripts.com) NOR the
// Speed Insights script (vitals.vercel-insights.com) is injected and no
// beacons fire. Speed Insights was added 2026-05-28; it ships Core Web Vitals
// the same way Analytics ships page-view pings, so it rides the exact same
// offline gate. Toggling the setting re-mounts/unmounts; both underlying
// scripts handle a fresh load cleanly when offline mode flips off.
export default function OfflineGatedAnalytics() {
  const offlineMode = useAppStore((s) => s.offlineMode);
  if (offlineMode) return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
