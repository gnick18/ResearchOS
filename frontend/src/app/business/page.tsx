import { redirect } from "next/navigation";

/**
 * Legacy `/business` route. The operator-only LLC finances now live inside the
 * unified operator console at `/admin` (Finances group), merged with the user
 * metrics so the operator sees the whole picture in one shell (2026-06-14).
 *
 * This redirect preserves old bookmarks and any already-sent email links. Both
 * surfaces are operator-only either way (the data is gated at
 * /api/admin/business regardless of path), so loading this leaks nothing.
 */
export default function LegacyBusinessRedirect() {
  redirect("/admin#finances");
}
