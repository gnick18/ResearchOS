import type { Metadata } from "next";

import AssetLibraryLanding from "@/components/library/AssetLibraryLanding";

/**
 * Public `/library` route: the open scientific-asset library landing.
 *
 * Marketing + discovery surface for the openly licensed icon library (a
 * BioRender alternative). Live browse/search over the CDN manifest, with the
 * full provenance + citation on every asset. Rendered without the AppShell or a
 * connected folder so anyone can browse before signing in.
 */
export const metadata: Metadata = {
  title: "Open scientific icon library",
  description:
    "Around 30,000 openly licensed scientific icons and silhouettes, free to use and remix. Search, recolor, and drop them into a figure with citations handled for you. CC0, CC-BY, and CC-BY-SA only.",
};

export default function LibraryPage() {
  return <AssetLibraryLanding />;
}
