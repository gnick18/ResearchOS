import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LabSiteDashboard from "@/components/social/LabSiteDashboard";
import { LAB_SITES_ENABLED } from "@/lib/social/config";

/**
 * `/account/lab-site` — the lab head's companion-site authoring dashboard
 * (lab-domains Phase 3a, social lane).
 *
 * A logged-in surface for the paid lab to claim its slug and write/publish
 * markdown pages. Gated behind NEXT_PUBLIC_LAB_SITES so it ships dark, with the
 * flag off this route 404s like a missing page and the feature is byte-identical
 * to absent. The real authorization (session + ownership + entitlement) is
 * enforced server-side by /api/social/lab-site*; this client flag only hides the
 * UI. Phase 3a is deliberately minimal (textarea markdown, save-draft +
 * publish); the rich block editor is Phase 3b.
 */
export const metadata: Metadata = {
  title: "Lab site | ResearchOS",
  description: "Author your lab's public companion site on ResearchOS.",
};

export default function LabSiteDashboardPage() {
  if (!LAB_SITES_ENABLED) notFound();
  return <LabSiteDashboard />;
}
