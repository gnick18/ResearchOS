// Phase 3c: collab persistence budget constants (single source of truth).
//
// Collab stores a shared note's Loro document on Neon Postgres as a compacted
// snapshot (collab_docs.latest_snapshot) plus an append-only update log
// (collab_doc_updates.update_bytes). Unlike the relay bundles, which live on
// Cloudflare R2 (10 GB free, cheap to scale), this content sits on Neon, whose
// free tier is only 0.5 GB and whose first paid step is the most expensive of
// any service ResearchOS runs on (Launch plan, about $19/month, verify current
// pricing). Neon is therefore the binding, expensive tier, so collab needs a
// real budget before it reaches users.
//
// These are SELF-IMPOSED budgets, the same role relay/limits.ts plays for the
// inbox. They are distinct from capacity-shared.ts FREE_TIER, which records the
// providers' published ceilings. Changing a number here changes both the
// enforcement (appendUpdate rejects past it) and the /admin gauge in one place.
//
// All four are runway knobs, not hard physical walls. A shared note's snapshot
// is on the order of tens of KB, so these ceilings are generous for real
// collaborative editing and only bite on abuse or a runaway client.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

const MB = 1024 * 1024;

/**
 * Largest single Loro update the push route will persist, 1 MB. A real text
 * edit produces a delta measured in bytes to kilobytes, so an update above this
 * is almost certainly a bug or abuse, not a legitimate keystroke batch. Rejected
 * before it ever reaches the append.
 */
export const MAX_UPDATE_BYTES = 1 * MB;

/**
 * Largest a single shared doc may grow on the server, 10 MB. This counts the
 * compacted snapshot plus the outstanding (un-compacted) update log for one
 * doc. A snapshot of tens of KB means 10 MB is an extreme outlier for one note,
 * so this caps a single runaway document without constraining normal use.
 */
export const MAX_DOC_BYTES = 10 * MB;

/**
 * Largest total a single owner may persist across every doc they own, 40 MB.
 * This is the fairness wall that protects the shared 0.5 GB tier, so one owner
 * cannot fill Neon with many small docs even while each one stays under the
 * per-doc cap. Ten full owners reach the collab soft budget below.
 */
export const MAX_OWNER_BYTES = 40 * MB;

/**
 * Soft global ceiling for collab's slice of Neon, 400 MB of the 0.5 GB free
 * tier. This is NOT enforced on writes (the per-doc and per-owner caps do
 * that). It is the threshold the /admin survival banner watches, leaving about
 * 100 MB of headroom on the tier for the directory, relay, email, and event
 * tables that share the same database. Ten full 40 MB owners reach it.
 */
export const COLLAB_NEON_BUDGET_BYTES = 400 * MB;

/** Which ceiling a budget rejection hit, so the route can report it precisely. */
export type CollabBudgetScope = "update" | "doc" | "owner";

/**
 * Thrown by appendUpdate when a write would push past one of the budgets above.
 * The push route catches this and returns a 413 rather than letting Neon fill
 * silently. `scope` says which ceiling was hit so the client and logs can tell
 * a single oversized edit apart from a full account.
 */
export class CollabBudgetError extends Error {
  readonly scope: CollabBudgetScope;
  constructor(scope: CollabBudgetScope, message: string) {
    super(message);
    this.name = "CollabBudgetError";
    this.scope = scope;
  }
}
