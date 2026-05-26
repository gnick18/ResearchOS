"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The `/experiments` route was renamed to `/workbench` per the standalone
 * redesign (docs/proposals/done/EXPERIMENTS_STANDALONE_PROPOSAL.md). Old bookmarks land here
 * and bounce forward. Using a client-side `router.replace` mirrors the
 * pattern used elsewhere in this app (no server redirects today, no
 * next.config rewrites for client-only routes).
 */
export default function ExperimentsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workbench");
  }, [router]);
  return null;
}
