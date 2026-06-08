// Cross-boundary sharing, the relay budget constants (single source of truth).
//
// The relay enforces two independent ceilings on a recipient's mailbox, a
// pending-share COUNT cap and a total stored-BYTES budget, plus a fixed TTL
// after which a pending share is removed. The Settings "Inbox and storage"
// display and the send route's enforcement both read these exact values, so
// what a user sees and what the server enforces can never drift.
//
// These numbers are paired with the operator usage tracker
// (scripts/relay-usage.mjs) so real consumption can be watched and the budget
// adjusted later. Changing a number here changes both the enforcement and the
// display in one place.
//
// The per-inbox byte budget was lowered from 5 GB to 1 GB (Grant, 2026-06-05).
// The bundles live on Cloudflare R2, whose free tier is 10 GB, so a 5 GB
// per-inbox cap meant just two full inboxes exhausted the free tier. 1 GB is
// still generous for UNIMPORTED pending shares (the inbox is a staging area,
// not storage) and stretches the free tier to roughly ten full inboxes before
// any paid R2 is needed. R2 storage is cheap (about $0.015/GB-month, no egress)
// so this is runway, not a hard wall.

/**
 * Maximum pending shares a single recipient mailbox may hold at once. Counting
 * both confirmed and reserved-but-pending rows (see countInboxByRecipient) so a
 * burst of unconfirmed sends cannot slip past before the grace-window sweep.
 */
export const PENDING_SHARE_CAP = 100;

/**
 * Free total stored-bytes budget per recipient mailbox, 1 GB. The relay sums the
 * sizeBytes of a recipient's non-expired pending rows and rejects a new send when
 * the incoming bundle would push the total over this budget. The display in
 * Settings shows the same total against this same number. See the file header
 * for why this is 1 GB and not 5 GB.
 */
export const FREE_STORAGE_BYTES = 1 * 1024 * 1024 * 1024;

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
 * Free total stored-bytes budget per RECIPIENT email hash on the invite path,
 * 256 MB. The invite send route sums the sizeBytes of a recipient hash's
 * non-expired invite rows (across all senders) and rejects a new invite when the
 * incoming bundle would push the total over this budget, mirroring the send
 * path's FREE_STORAGE_BYTES ceiling but smaller on purpose.
 *
 * Why a dedicated, smaller budget and not FREE_STORAGE_BYTES (1 GB). The invite
 * path has weaker economics, the recipient is NOT a ResearchOS user yet, so an
 * invited bundle may never be accepted and can sit on R2 for the full 30-day TTL
 * with no chance of pickup until/unless that person signs up. A registered
 * recipient's mailbox (the send path) is far more likely to be drained on pickup,
 * so it earns the larger ceiling. 256 MB is still generous for the KB-MB sealed
 * notes/methods that dominate invites, while keeping the free R2 tier safe even
 * if many invites are abandoned (Grant, 2026-06-08).
 *
 * Keyed per-RECIPIENT (not per-sender) to match the send path's abuse model. R2
 * cost accrues per parked object under a recipient hash, so bounding the total
 * sealed bytes parked FOR one address (across every sender that targets it) is
 * the meaningful ceiling. The per-sender axis (PENDING_INVITE_CAP plus the 10/day
 * rate limiter) is unchanged, this is the orthogonal per-recipient byte axis.
 */
export const INVITE_FREE_STORAGE_BYTES = 256 * 1024 * 1024;

/**
 * Grace window (seconds) for an unconfirmed pending invite, comfortably beyond
 * the presigned-PUT lifetime so an in-flight upload is never swept. An invite
 * that reserves a row but never confirms (a closed tab) is reclaimed after this.
 */
export const INVITE_PENDING_GRACE_SECONDS = 15 * 60;
