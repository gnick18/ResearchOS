import type { Metadata } from "next";

import TransparencyView from "@/components/transparency/TransparencyView";

/**
 * Public `/transparency` route: "Our science, checked against the tools you
 * already trust".
 *
 * Shows ResearchOS's built-in bioinformatic calculations (primer Tm today;
 * alignment, restriction digest, and translation to follow) side by side with
 * the established third-party reference implementations (Biopython, primer3).
 * Every comparison on the page is produced by `buildTransparencyReport()` and
 * enforced by a vitest gate (`lib/transparency/report.test.ts`) that runs on
 * every push, so the page can never quietly drift from the truth.
 *
 * Informational / trust page, not a documented app feature, so it is
 * intentionally excluded from the wiki-coverage map (alongside /welcome and
 * /open-source) and renders without the AppShell or a connected data folder so
 * anyone can read it.
 */
export const metadata: Metadata = {
  title: "Method validation | ResearchOS",
  description:
    "Bioinformatic calculations in ResearchOS (melting temperature, alignment, restriction digest, translation) compared against Biopython and primer3 reference implementations, recomputed on every commit.",
};

export default function TransparencyPage() {
  return <TransparencyView />;
}
