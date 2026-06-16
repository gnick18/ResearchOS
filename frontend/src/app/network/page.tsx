import type { Metadata } from "next";
import { notFound } from "next/navigation";

import NetworkLanding from "@/components/social/NetworkLanding";
import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";

/**
 * Public `/network` route: the researcher-network discovery hub.
 *
 * Marketing + discovery surface for the people side of ResearchOS (a public,
 * login-free researcher search). Rendered without the AppShell or a connected
 * folder, on the same chrome as /library. Gated behind NEXT_PUBLIC_SOCIAL_LAYER
 * so the whole social layer ships dark until it is turned on; with the flag off
 * the route 404s like any non-existent page.
 */
export const metadata: Metadata = {
  title: "Researcher network | ResearchOS",
  description:
    "Send your work to any researcher, in one step. The shortest path from your data to a collaborator, share a method, sequence, dataset, or figure straight to them, in your department or across the world, with no files or email needed.",
};

export default function NetworkPage() {
  if (!SOCIAL_LAYER_ENABLED) notFound();
  return <NetworkLanding />;
}
