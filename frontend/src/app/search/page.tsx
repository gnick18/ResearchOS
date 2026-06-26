"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The standalone `/search` page is retired (UX clawback, 2026-06-26). It
 * searched ONLY tasks — strictly narrower than the Cmd-K BeakerSearch palette
 * that fed it, which already searches all seven object kinds inline. Its one
 * unique capability, the multi-select experiment EXPORT (zip / save-to-disk /
 * combined-PDF), moved to the Workbench Experiments surface
 * (components/workbench/WorkbenchExperimentsPanel.tsx via
 * components/export/useExperimentExport.ts). Old bookmarks land here and bounce
 * to `/workbench`. Client-side `router.replace` mirrors `/experiments` and
 * `/sponsors` (no server redirects today, no next.config rewrites for
 * client-only routes).
 */
export default function SearchRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workbench");
  }, [router]);
  return null;
}
