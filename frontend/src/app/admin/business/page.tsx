import { redirect } from "next/navigation";

/**
 * Legacy `/admin/business` route. The operator business tracker moved to
 * `/business` (Grant 2026-06-10) for a cleaner path. This redirect preserves old
 * bookmarks and any already-sent email links. Both surfaces are operator-only
 * either way (the data is gated at /api/admin/business regardless of path).
 */
export default function LegacyBusinessRedirect() {
  redirect("/business");
}
