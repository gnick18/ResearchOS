// Cross-boundary sharing, the relay budget constants (single source of truth).
//
// The relay enforces two independent ceilings on a recipient's mailbox, a
// pending-share COUNT cap and a total stored-BYTES budget, plus a fixed TTL
// after which a pending share is removed. The Settings "Inbox and storage"
// display and the send route's enforcement both read these exact values, so
// what a user sees and what the server enforces can never drift.
//
// These are the FINAL numbers (Grant, 2026-06-03). The generous 5 GB budget is
// paired with the operator usage tracker (scripts/relay-usage.mjs) so real
// consumption can be watched and the budget adjusted later. Changing a number
// here changes both the enforcement and the display in one place.

/**
 * Maximum pending shares a single recipient mailbox may hold at once. Counting
 * both confirmed and reserved-but-pending rows (see countInboxByRecipient) so a
 * burst of unconfirmed sends cannot slip past before the grace-window sweep.
 */
export const PENDING_SHARE_CAP = 100;

/**
 * Free total stored-bytes budget per recipient mailbox, 5 GB. The relay sums the
 * sizeBytes of a recipient's non-expired pending rows and rejects a new send when
 * the incoming bundle would push the total over this budget. The display in
 * Settings shows the same total against this same number.
 */
export const FREE_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Pending-share lifetime, 30 days in milliseconds. After this a pending share is
 * past its TTL, hidden from a listing, and swept. Quoted verbatim in the Settings
 * policy copy ("held for 30 days, then removed").
 */
export const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The 30-day TTL expressed in whole days, for copy that names the number. */
export const TTL_DAYS = 30;

/**
 * Maximum non-expired pending invites a single sender may hold at once. This is
 * a secondary per-sender ceiling alongside the Upstash invite rate limiter (10
 * per day), so a sender cannot park an unbounded backlog of unaccepted invites.
 * The same 30-day TTL sweeps an unaccepted invite, freeing the slot.
 */
export const PENDING_INVITE_CAP = 50;

/**
 * Grace window (seconds) for an unconfirmed pending invite, comfortably beyond
 * the presigned-PUT lifetime so an in-flight upload is never swept. An invite
 * that reserves a row but never confirms (a closed tab) is reclaimed after this.
 */
export const INVITE_PENDING_GRACE_SECONDS = 15 * 60;
