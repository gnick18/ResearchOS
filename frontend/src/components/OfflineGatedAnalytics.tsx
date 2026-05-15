"use client";

import { Analytics } from "@vercel/analytics/next";
import { useAppStore } from "@/lib/store";

// Offline Mode (security affordance #2, d164fd2b) promises zero outbound when
// the toggle is on. Returning null here unmounts the <Analytics /> wrapper so
// the va.vercel-scripts.com script tag is never injected and no beacons fire.
// Toggling the setting re-mounts/unmounts; the underlying script handles a
// fresh load cleanly when offline mode flips off.
export default function OfflineGatedAnalytics() {
  const offlineMode = useAppStore((s) => s.offlineMode);
  if (offlineMode) return null;
  return <Analytics />;
}
