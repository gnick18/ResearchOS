import { redirect } from "next/navigation";

/**
 * Common-misspelling alias for the operator business tracker. "buisness" is an
 * easy typo for "business" and was hit often enough to land on a 404 with the
 * app gates firing over it, so this redirects to the real `/business` route
 * (which is operator-gated either way; the data lives behind /api/admin/business
 * on ADMIN_EMAILS). Redirect-only, no UI.
 */
export default function BuisnessTypoRedirect() {
  redirect("/business");
}
