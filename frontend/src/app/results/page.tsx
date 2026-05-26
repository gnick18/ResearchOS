"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The /results route was killed per docs/proposals/done/RESULTS_PAGE_PROPOSAL.md (commit
// ba8d10f4). Completed experiments now live in /workbench's "Earlier"
// archive section, completed purchases in /purchases' "Earlier"
// accordion, and per-project completed work appears on the project
// popup's "Recently completed" line. Old bookmarks land here and
// bounce forward silently. Client-side replace mirrors the
// /experiments → /workbench pattern.
export default function ResultsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workbench");
  }, [router]);
  return null;
}
