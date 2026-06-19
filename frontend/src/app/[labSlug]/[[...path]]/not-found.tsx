import NotFoundPage from "@/components/NotFoundPage";

/**
 * Generic public 404 for the top-level optional-catch-all route. Because
 * [labSlug] is the segment that catches any path with no matching static route,
 * this renders for BOTH a missing lab companion page AND any unknown or retired
 * top-level path (a typo, an old bookmark, the retired /welcome route, ...), so
 * the copy is deliberately generic.
 *
 * Renders the shared branded NotFoundPage so this catch-all and the root
 * app/not-found.tsx (which catches explicit notFound() calls from static
 * routes) stay byte-identical.
 */
export default function MarketingNotFound() {
  return <NotFoundPage />;
}
