// Network feed + follow graph, Neon persistence (social lane, Build 2).
//
// Two additive idempotent tables:
//   feed_events    public activity events (published site, work shared, lab join).
//                  NO private content. Emitted fire-and-forget so a feed write
//                  failure never breaks the source action.
//   follow_edges   the follower / followee relationship. Primary key on both keys
//                  so a follow is an idempotent upsert.
//
// Conventions: lazy Neon singleton from DATABASE_URL (never evaluated at module
// load, so tsc and unit tests require no connection string), idempotent CREATE
// TABLE IF NOT EXISTS schema creation, parameterized tagged-template queries.
// Mirrors lib/social/lab-site-db.ts and lib/collab/server/db.ts exactly.
//
// ORCHESTRATOR TODO (publish emitter):
// When integrating with Build 1 (feat/builder-deploy-history), add the
// following call inside the publishPage() function in
// frontend/src/lib/social/lab-site-db.ts, AFTER the page row is updated:
//
//   void emitFeedEvent({
//     actorOwnerKey: labOwnerKey,
//     kind: "site_published",
//     subjectType: "page",
//     subjectId: path,
//     subjectLabel: title,
//     targetSlug: labSlug,
//   });
//
// (Import emitFeedEvent from "@/lib/social/network-feed-db".)
// Build 2 does NOT touch lab-site-db.ts since Build 1 owns that file.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Lazy singleton
// ---------------------------------------------------------------------------

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The network-feed store cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** Replace the singleton with a test double. Pass null to restore lazy-construct. */
export function _testSetSql(
  fake: NeonQueryFunction<false, false> | null,
): void {
  sqlSingleton = fake;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export async function ensureNetworkFeedSchema(): Promise<void> {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS feed_events (
      id              TEXT PRIMARY KEY,
      actor_owner_key TEXT NOT NULL,
      kind            TEXT NOT NULL,
      subject_type    TEXT,
      subject_id      TEXT,
      subject_label   TEXT,
      target_slug     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS feed_events_created_at_idx
    ON feed_events (created_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS follow_edges (
      follower_owner_key TEXT NOT NULL,
      followee_owner_key TEXT NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (follower_owner_key, followee_owner_key)
    )
  `;
}

// ---------------------------------------------------------------------------
// Feed event types
// ---------------------------------------------------------------------------

export type FeedEventKind =
  | "site_published"
  | "work_shared"
  | "lab_joined";

export interface EmitFeedEventArgs {
  actorOwnerKey: string;
  kind: FeedEventKind | string;
  subjectType?: string;
  subjectId?: string;
  subjectLabel?: string;
  targetSlug?: string;
  id?: string;
}

export async function emitFeedEvent(args: EmitFeedEventArgs): Promise<void> {
  const {
    actorOwnerKey,
    kind,
    subjectType = null,
    subjectId = null,
    subjectLabel = null,
    targetSlug = null,
  } = args;

  const id = args.id ?? crypto.randomUUID();

  try {
    const sql = getSql();
    await ensureNetworkFeedSchema();
    await sql`
      INSERT INTO feed_events
        (id, actor_owner_key, kind, subject_type, subject_id, subject_label, target_slug)
      VALUES
        (${id}, ${actorOwnerKey}, ${kind}, ${subjectType}, ${subjectId}, ${subjectLabel}, ${targetSlug})
      ON CONFLICT (id) DO NOTHING
    `;
  } catch (err) {
    console.warn("[network-feed] emitFeedEvent failed (fire-and-forget, swallowed):", err);
  }
}

// ---------------------------------------------------------------------------
// Follow graph writes
// ---------------------------------------------------------------------------

export async function followResearcher(
  followerOwnerKey: string,
  followeeOwnerKey: string,
): Promise<void> {
  if (followerOwnerKey === followeeOwnerKey) return;
  const sql = getSql();
  await ensureNetworkFeedSchema();
  await sql`
    INSERT INTO follow_edges (follower_owner_key, followee_owner_key)
    VALUES (${followerOwnerKey}, ${followeeOwnerKey})
    ON CONFLICT (follower_owner_key, followee_owner_key) DO NOTHING
  `;
}

export async function unfollowResearcher(
  followerOwnerKey: string,
  followeeOwnerKey: string,
): Promise<void> {
  const sql = getSql();
  await ensureNetworkFeedSchema();
  await sql`
    DELETE FROM follow_edges
    WHERE follower_owner_key = ${followerOwnerKey}
      AND followee_owner_key = ${followeeOwnerKey}
  `;
}

export async function isFollowing(
  followerOwnerKey: string,
  followeeOwnerKey: string,
): Promise<boolean> {
  const sql = getSql();
  await ensureNetworkFeedSchema();
  const rows = await sql`
    SELECT 1 FROM follow_edges
    WHERE follower_owner_key = ${followerOwnerKey}
      AND followee_owner_key = ${followeeOwnerKey}
    LIMIT 1
  ` as unknown[];
  return rows.length > 0;
}

export async function listFollowing(ownerKey: string): Promise<string[]> {
  const sql = getSql();
  await ensureNetworkFeedSchema();
  const rows = await sql`
    SELECT followee_owner_key FROM follow_edges
    WHERE follower_owner_key = ${ownerKey}
    ORDER BY created_at DESC
  ` as Array<{ followee_owner_key: string }>;
  return rows.map((r) => r.followee_owner_key);
}

// ---------------------------------------------------------------------------
// Feed reads
// ---------------------------------------------------------------------------

export interface FeedEventCard {
  id: string;
  actorOwnerKey: string;
  actorHandle: string | null;
  actorDisplayName: string | null;
  kind: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectLabel: string | null;
  targetSlug: string | null;
  createdAt: string;
}

export async function getNetworkFeed(
  viewerOwnerKey: string,
  limit = 30,
): Promise<FeedEventCard[]> {
  const sql = getSql();
  await ensureNetworkFeedSchema();

  const followCountRows = await sql`
    SELECT COUNT(*)::int AS cnt FROM follow_edges
    WHERE follower_owner_key = ${viewerOwnerKey}
  ` as Array<{ cnt: number }>;
  const followCount = followCountRows[0]?.cnt ?? 0;

  let rows: Array<{
    id: string;
    actor_owner_key: string;
    kind: string;
    subject_type: string | null;
    subject_id: string | null;
    subject_label: string | null;
    target_slug: string | null;
    created_at: string;
    handle: string | null;
    display_name: string | null;
  }>;

  if (followCount > 0) {
    rows = await sql`
      SELECT
        fe.id,
        fe.actor_owner_key,
        fe.kind,
        fe.subject_type,
        fe.subject_id,
        fe.subject_label,
        fe.target_slug,
        fe.created_at::text,
        ap.handle,
        ap.display_name
      FROM feed_events fe
      LEFT JOIN account_profiles ap ON ap.owner_key = fe.actor_owner_key
      WHERE fe.actor_owner_key = ${viewerOwnerKey}
         OR fe.actor_owner_key IN (
           SELECT followee_owner_key FROM follow_edges
           WHERE follower_owner_key = ${viewerOwnerKey}
         )
      ORDER BY fe.created_at DESC
      LIMIT ${limit}
    ` as typeof rows;
  } else {
    rows = await sql`
      SELECT
        fe.id,
        fe.actor_owner_key,
        fe.kind,
        fe.subject_type,
        fe.subject_id,
        fe.subject_label,
        fe.target_slug,
        fe.created_at::text,
        ap.handle,
        ap.display_name
      FROM feed_events fe
      LEFT JOIN account_profiles ap ON ap.owner_key = fe.actor_owner_key
      ORDER BY fe.created_at DESC
      LIMIT ${limit}
    ` as typeof rows;
  }

  return rows.map((r) => ({
    id: r.id,
    actorOwnerKey: r.actor_owner_key,
    actorHandle: r.handle ?? null,
    actorDisplayName: r.display_name ?? null,
    kind: r.kind,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    subjectLabel: r.subject_label,
    targetSlug: r.target_slug,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Follow suggestions
// ---------------------------------------------------------------------------

export interface FollowSuggestion {
  ownerKey: string;
  handle: string;
  displayName: string | null;
  affiliation: string | null;
}

export async function getFollowSuggestions(
  viewerOwnerKey: string,
  limit = 8,
): Promise<FollowSuggestion[]> {
  const sql = getSql();
  await ensureNetworkFeedSchema();

  const viewerRows = await sql`
    SELECT affiliation FROM account_profiles
    WHERE owner_key = ${viewerOwnerKey}
    LIMIT 1
  ` as Array<{ affiliation: string | null }>;
  const viewerAffiliation = viewerRows[0]?.affiliation ?? null;

  // Only suggest researchers who opted INTO the public directory (listed). The
  // public feed (getNetworkFeed) and the public researcher search
  // (searchPublicProfiles) both restrict to the same set, so a suggestion never
  // surfaces someone the rest of /network would not. The "listed" gate lives on
  // directory_profiles.unlisted (default false = listed), keyed by the Ed25519
  // fingerprint. account_profiles is keyed by owner_key (the peppered email hash,
  // ownerKeyForEmail), which equals directory_identities.email_hash, so the bridge
  // from an account to its directory listing is:
  //   account_profiles.owner_key
  //     -> directory_identities.email_hash (carries the current fingerprint)
  //       -> directory_profiles.fingerprint WHERE unlisted = false
  // The two joins are INNER, so an account with no directory binding or no listed
  // profile (never published into the directory, or opted out) is excluded, never
  // leaking an unlisted researcher's handle + name into "People you may know".
  const rows = await sql`
    SELECT
      ap.owner_key,
      ap.handle,
      ap.display_name,
      ap.affiliation
    FROM account_profiles ap
    JOIN directory_identities di ON di.email_hash = ap.owner_key
    JOIN directory_profiles dp
      ON dp.fingerprint = di.fingerprint
     AND dp.unlisted = false
    WHERE ap.owner_key <> ${viewerOwnerKey}
      AND ap.owner_key NOT IN (
        SELECT followee_owner_key FROM follow_edges
        WHERE follower_owner_key = ${viewerOwnerKey}
      )
    ORDER BY
      CASE
        WHEN ${viewerAffiliation} IS NOT NULL
          AND ap.affiliation IS NOT NULL
          AND lower(ap.affiliation) = lower(${viewerAffiliation ?? ""})
        THEN 0
        ELSE 1
      END ASC,
      ap.updated_at DESC
    LIMIT ${limit}
  ` as Array<{
    owner_key: string;
    handle: string;
    display_name: string | null;
    affiliation: string | null;
  }>;

  return rows.map((r) => ({
    ownerKey: r.owner_key,
    handle: r.handle,
    displayName: r.display_name,
    affiliation: r.affiliation,
  }));
}
