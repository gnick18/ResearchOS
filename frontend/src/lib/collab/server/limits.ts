// Collab persistence budget constants.
//
// The Neon-backed per-update and per-doc write gates (MAX_UPDATE_BYTES,
// MAX_DOC_BYTES, CollabBudgetError) have been removed now that the Cloudflare
// Durable Object owns collab persistence. What remains here are the constants
// still consumed by the billing layer and the /admin capacity gauge.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

const MB = 1024 * 1024;

/**
 * Largest total a single owner may persist across every doc they own, 40 MB.
 * This is the fairness wall used by getOwnerQuotaBytes (lib/collab/server/db.ts)
 * when billing is off, so one owner cannot fill Neon with many small docs even
 * while each one stays under a per-doc cap. Ten full owners reach the collab
 * soft budget below.
 */
export const MAX_OWNER_BYTES = 40 * MB;

/**
 * Soft global ceiling for collab's slice of Neon, 400 MB of the 0.5 GB free
 * tier. This is NOT enforced on writes. It is the threshold the /admin survival
 * banner watches, leaving about 100 MB of headroom on the tier for the
 * directory, relay, email, and event tables that share the same database.
 */
export const COLLAB_NEON_BUDGET_BYTES = 400 * MB;
