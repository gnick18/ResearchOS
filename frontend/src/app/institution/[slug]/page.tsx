import type { Metadata } from "next";
import { notFound } from "next/navigation";

import InstitutionPublicProfile from "@/components/social/InstitutionPublicProfile";
import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";
import { humanizeInstitutionSlug } from "@/lib/social/institution";
import { resolveInstitution } from "@/lib/social/institution-registry";

/**
 * Public `/institution/[slug]` route: the institution discovery page (social
 * layer, Phase B foundation). Distinct from the sign-in-gated `/institution`
 * admin portal (exact route) and `/institution/join`; this dynamic segment is
 * the public, login-free institution profile with the listed-member directory.
 *
 * Rendered without the AppShell or a connected folder (it inherits the existing
 * folderless `/institution` bypass in providers.tsx). Gated behind
 * NEXT_PUBLIC_SOCIAL_LAYER so the whole social layer ships dark until turned on;
 * with the flag off this 404s. The canonical name + member directory come from
 * Popup's directory endpoint (B2); until then the page shows a humanized-slug
 * name and a "coming online" placeholder.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Prefer the canonical ROR registry name; fall back to the humanized slug
  // when the domain is unknown. The live endpoint name (when Popup returns one)
  // still wins at render time inside InstitutionPublicProfile.
  const name =
    (await resolveInstitution(slug))?.canonicalName ??
    humanizeInstitutionSlug(slug);
  return {
    title: `${name} | ResearchOS`,
    description: `Researchers at ${name} on ResearchOS. A public, opt-in directory of listed researchers with verified institutional identities, never an email address.`,
  };
}

export default async function InstitutionPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!SOCIAL_LAYER_ENABLED) notFound();
  const { slug } = await params;
  // Resolve the canonical name server-side (the registry asset is server-only)
  // and hand it to the client profile as the name fallback. Precedence at
  // render: live endpoint name > this registry name > humanized slug.
  const registry = await resolveInstitution(slug);
  return (
    <InstitutionPublicProfile
      slug={slug}
      registryName={registry?.canonicalName ?? null}
    />
  );
}
