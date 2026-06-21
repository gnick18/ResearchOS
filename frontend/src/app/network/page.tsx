import type { Metadata } from "next";
import { notFound } from "next/navigation";

import NetworkLanding from "@/components/social/NetworkLanding";
import NetworkAppShell from "@/components/social/NetworkAppShell";
import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";
import { auth } from "@/lib/sharing/auth";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";

/**
 * Public `/network` route: the researcher-network discovery hub.
 *
 * Marketing + discovery surface for the people side of ResearchOS (a public,
 * login-free researcher search). Rendered without the AppShell or a connected
 * folder, on the same chrome as /library. Gated behind NEXT_PUBLIC_SOCIAL_LAYER
 * so the whole social layer ships dark until it is turned on; with the flag off
 * the route 404s like any non-existent page.
 *
 * Session-aware split (2026-06-20):
 *   - No session: byte-identical public NetworkLanding (unchanged).
 *   - Session present: NetworkAppShell with left rail, "Sites you can edit",
 *     and a feed placeholder. The social shell reads the Auth.js session
 *     server-side, so no cross-origin handshake is needed (same .app origin).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Researcher network",
  description:
    "Send your work to any researcher, in one step. The shortest path from your data to a collaborator, share a method, sequence, dataset, or figure straight to them, in your department or across the world, with no files or email needed.",
};

export default async function NetworkPage() {
  if (!SOCIAL_LAYER_ENABLED) notFound();

  const session = await auth();
  const email = session?.user?.email ?? null;

  // No session (or ORCID-only without a bound email): public discovery, unchanged.
  if (!email) {
    return <NetworkLanding />;
  }

  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) {
    // Pepper missing server-side; fall back to public view rather than 500.
    return <NetworkLanding />;
  }

  return <NetworkAppShell ownerKey={ownerKey} sessionEmail={email} />;
}
