import NotFoundPage from "@/components/NotFoundPage";

/**
 * Root 404. Next.js renders this for any notFound() call from a static route
 * that does NOT fall into the top-level optional-catch-all (e.g. /network when
 * the social layer ships dark, per lib/social/config). Without it, those states
 * fall back to the raw default black 404, inconsistent with the branded 404 the
 * catch-all shows for unknown paths.
 *
 * Renders the SAME shared branded NotFoundPage as
 * app/[labSlug]/[[...path]]/not-found.tsx, on the public marketing chrome with
 * no AppShell or connected-folder assumptions, so every notFound() state shows
 * one consistent branded page.
 */
export default function RootNotFound() {
  return <NotFoundPage />;
}
