import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LabSiteDashboard from "@/components/social/LabSiteDashboard";
import { LAB_SITES_ENABLED } from "@/lib/social/config";
import { isDemoLabSlug } from "@/lib/social/demo-lab";

/**
 * `/account/lab-site`, the lab head's companion-site authoring dashboard
 * (lab-domains Phase 3a, social lane).
 *
 * A logged-in surface for the paid lab to claim its slug and write/publish
 * markdown pages. Gated behind NEXT_PUBLIC_LAB_SITES so it ships dark, with the
 * flag off this route 404s like a missing page and the feature is byte-identical
 * to absent. The real authorization (session + ownership + entitlement) is
 * enforced server-side by /api/social/lab-site*; this client flag only hides the
 * UI. Phase 3a is deliberately minimal (textarea markdown, save-draft +
 * publish); the rich block editor is Phase 3b.
 *
 * Demo walkthrough (demo-lab-network Phase 2). `?demo=fakeyeast-lab` renders a
 * READ-ONLY tour of the wizard for the seeded demo lab. It never calls a write
 * endpoint and never touches the shared demo lab's rows, so a demo visitor can see
 * the authoring view safely. The query param is demo-slug-scoped (only the demo
 * slug turns it on), and the whole route is still behind NEXT_PUBLIC_LAB_SITES, so
 * this stays inert until that client flag is deliberately on.
 */
export const metadata: Metadata = {
  title: "Lab site",
  description: "Author your lab's public companion site on ResearchOS.",
};

export default async function LabSiteDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; siteOwnerKey?: string }>;
}) {
  if (!LAB_SITES_ENABLED) notFound();
  const { demo, siteOwnerKey } = await searchParams;
  // siteOwnerKey is supplied by the "Sites you can edit" Edit link when a
  // granted editor opens another PI's site. The dashboard threads it through
  // every load/save/publish call; the server re-checks isSiteEditor on each
  // write so a forged or revoked key never gains access.
  // Demo mode and editor mode are mutually exclusive: a granted editor never
  // enters the dashboard in demo mode (demo is a public, no-session walkthrough).
  const isDemoMode = !siteOwnerKey && isDemoLabSlug(demo ?? "");
  return (
    <LabSiteDashboard
      demoReadOnly={isDemoMode}
      siteOwnerKey={siteOwnerKey ?? undefined}
    />
  );
}
