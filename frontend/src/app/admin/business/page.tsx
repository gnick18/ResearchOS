import { redirect } from "next/navigation";

/**
 * Legacy `/admin/business` route. The operator finances now live inside the
 * unified operator console at `/admin` (Finances group). This redirect
 * preserves old bookmarks and any already-sent email links. The data is gated
 * at /api/admin/business regardless of path, so this leaks nothing.
 */
export default function LegacyAdminBusinessRedirect() {
  redirect("/admin#finances");
}
