import type { Metadata } from "next";
import OpenSourceCredits from "@/components/open-source/OpenSourceCredits";

/**
 * Standalone `/open-source` route: "Built on open source".
 *
 * A public, heartfelt thank-you to the open-source and scientific community,
 * plus the formal attribution ResearchOS owes the projects it builds on
 * (MIT/BSD keep attribution; Apache-2.0 wants a NOTICE). The curated
 * highlights, vendored-code credits, and scientific references are rendered
 * from the generated data file public/open-source/credits.json, which is
 * produced by scripts/build-open-source-credits.mjs straight off the installed
 * dependency tree so it never drifts.
 *
 * This is an informational / legal page, not a documented app feature, so it
 * is intentionally excluded from the wiki-coverage map (a marketing page),
 * and it renders without the AppShell or a connected data folder so anyone can
 * read it.
 */
export const metadata: Metadata = {
  title: "Built on open source",
  description:
    "ResearchOS is built on open-source software and on published science. A thank-you to the community, and the full attribution for the projects we depend on.",
};

export default function OpenSourcePage() {
  return <OpenSourceCredits />;
}
