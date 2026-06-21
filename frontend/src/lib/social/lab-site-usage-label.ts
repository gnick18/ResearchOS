// Pure site-key label humanizer used by the PI storage + analytics route.
//
// Converts a stored site_key value into a short human-readable label for the
// dashboard. The keys are the same ones stored by the metering and analytics
// writers (see proposal 2026-06-20-lab-site-storage-metering-analytics.md).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/**
 * Maps a site_key (or null for untagged legacy assets) to a short human label
 * suitable for a table or list in the PI dashboard.
 *
 * Convention:
 *   null        -> "Other"         (legacy / untagged rows with no site_key)
 *   "home"      -> "Home page"     (the lab's main landing page, path "")
 *   "byo"       -> "Uploaded site" (the BYO static-site zip upload)
 *   any string  -> the value as-is (a companion page path, e.g. "people")
 */
export function humanizeSiteKey(siteKey: string | null): string {
  if (siteKey === null) return "Other";
  if (siteKey === "home") return "Home page";
  if (siteKey === "byo") return "Uploaded site";
  return siteKey;
}
