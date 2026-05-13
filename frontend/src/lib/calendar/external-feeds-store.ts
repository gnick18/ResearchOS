import { fileService } from "@/lib/file-system/file-service";
import type {
  CalendarFeed,
  CalendarFeedKind,
  CalendarFeedProvider,
} from "@/lib/types";

/**
 * Persistence layer for linked external calendar subscriptions (Google /
 * Outlook / iCloud / arbitrary public ICS URLs, plus OAuth-backed
 * Google / Outlook accounts).
 *
 * Stored as a single JSON file `users/{username}/_calendar-feeds.json`,
 * mirroring the `_telegram.json` pattern. One file is fine — most users
 * will have at most a handful of feeds, so a directory-per-feed
 * (`JsonStore`) would be unnecessary I/O overhead.
 */

const SCHEMA_VERSION = 2;

interface FeedsFile {
  version: number;
  feeds: CalendarFeed[];
  /** Monotonically-increasing id source so deletes don't recycle ids and
   *  collide with cached React Query keys. */
  nextId: number;
}

function feedsPath(username: string): string {
  return `users/${username}/_calendar-feeds.json`;
}

/** Back-fill missing fields on feeds written before the OAuth schema bump.
 *  Older entries don't have `kind` or `oauthCalendarId`; assume they're
 *  ICS-backed since OAuth flows didn't exist yet. */
function normalizeFeed(raw: Partial<CalendarFeed> & { id: number }): CalendarFeed {
  const kind: CalendarFeedKind =
    raw.kind === "google" || raw.kind === "outlook" ? raw.kind : "ics";
  return {
    id: raw.id,
    provider: (raw.provider ?? "other") as CalendarFeedProvider,
    kind,
    label: raw.label ?? "(unnamed)",
    icsUrl: raw.icsUrl ?? null,
    oauthCalendarId: raw.oauthCalendarId ?? null,
    color: raw.color ?? "#3b82f6",
    enabled: raw.enabled ?? true,
    lastSyncAt: raw.lastSyncAt ?? null,
  };
}

async function readFile(username: string): Promise<FeedsFile> {
  const data = await fileService.readJson<FeedsFile>(feedsPath(username));
  if (!data) return { version: SCHEMA_VERSION, feeds: [], nextId: 1 };
  const rawFeeds: Array<Partial<CalendarFeed> & { id: number }> = Array.isArray(
    data.feeds,
  )
    ? (data.feeds as Array<Partial<CalendarFeed> & { id: number }>)
    : [];
  return {
    version: SCHEMA_VERSION,
    feeds: rawFeeds.map(normalizeFeed),
    nextId: typeof data.nextId === "number" ? data.nextId : (rawFeeds.length ?? 0) + 1,
  };
}

async function writeFile(username: string, data: FeedsFile): Promise<void> {
  await fileService.writeJson(feedsPath(username), data);
}

export async function listFeeds(username: string): Promise<CalendarFeed[]> {
  const file = await readFile(username);
  return file.feeds;
}

/** Input shape for adding an ICS-subscription feed. */
export interface CreateIcsFeedInput {
  provider: CalendarFeedProvider;
  label: string;
  icsUrl: string;
  color: string;
  enabled?: boolean;
}

/** Input shape for adding an OAuth-backed feed (Google / Outlook). */
export interface CreateOAuthFeedInput {
  kind: "google" | "outlook";
  /** Display category — for an OAuth feed this almost always equals `kind`,
   *  but kept separate so a future "Google Workspace" rebrand or similar
   *  stays a 1-line cosmetic change. */
  provider: CalendarFeedProvider;
  label: string;
  oauthCalendarId: string;
  color: string;
  enabled?: boolean;
}

export async function createFeed(
  username: string,
  input: CreateIcsFeedInput,
): Promise<CalendarFeed>;
export async function createFeed(
  username: string,
  input: CreateOAuthFeedInput,
): Promise<CalendarFeed>;
export async function createFeed(
  username: string,
  input: CreateIcsFeedInput | CreateOAuthFeedInput,
): Promise<CalendarFeed> {
  const file = await readFile(username);
  const isOAuth = "kind" in input;
  const feed: CalendarFeed = isOAuth
    ? {
        id: file.nextId,
        provider: input.provider,
        kind: input.kind,
        label: input.label,
        icsUrl: null,
        oauthCalendarId: input.oauthCalendarId,
        color: input.color,
        enabled: input.enabled ?? true,
        lastSyncAt: null,
      }
    : {
        id: file.nextId,
        provider: input.provider,
        kind: "ics",
        label: input.label,
        icsUrl: input.icsUrl,
        oauthCalendarId: null,
        color: input.color,
        enabled: input.enabled ?? true,
        lastSyncAt: null,
      };
  await writeFile(username, {
    version: SCHEMA_VERSION,
    feeds: [...file.feeds, feed],
    nextId: file.nextId + 1,
  });
  return feed;
}

export async function updateFeed(
  username: string,
  id: number,
  patch: Partial<Omit<CalendarFeed, "id">>,
): Promise<CalendarFeed | null> {
  const file = await readFile(username);
  const idx = file.feeds.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  const next: CalendarFeed = { ...file.feeds[idx], ...patch };
  const feeds = [...file.feeds];
  feeds[idx] = next;
  await writeFile(username, { ...file, feeds });
  return next;
}

export async function deleteFeed(username: string, id: number): Promise<boolean> {
  const file = await readFile(username);
  const filtered = file.feeds.filter((f) => f.id !== id);
  if (filtered.length === file.feeds.length) return false;
  await writeFile(username, { ...file, feeds: filtered });
  return true;
}

export async function markFeedSynced(username: string, id: number): Promise<void> {
  await updateFeed(username, id, { lastSyncAt: new Date().toISOString() });
}
