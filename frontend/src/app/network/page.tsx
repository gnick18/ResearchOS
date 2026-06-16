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
    "Find researchers on ResearchOS. Search by name or institution, confirm verified institutional identities, and open shareable profiles. Listed by choice, no email ever shown.",
};

export default function NetworkPage() {
  if (!SOCIAL_LAYER_ENABLED) notFound();
  return <NetworkLanding />;
}
