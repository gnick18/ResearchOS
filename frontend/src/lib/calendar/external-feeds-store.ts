import { fileService } from "@/lib/file-system/file-service";
import type { CalendarFeed, CalendarFeedProvider } from "@/lib/types";

/**
 * Persistence layer for linked external calendar subscriptions (Google /
 * Outlook / iCloud / arbitrary public ICS URLs).
 *
 * Stored as a single JSON file `users/{username}/_calendar-feeds.json`,
 * mirroring the `_telegram.json` pattern. One file is fine — most users will
 * have at most a handful of feeds, so a directory-per-feed (`JsonStore`)
 * would be unnecessary I/O overhead.
 */

const SCHEMA_VERSION = 1;

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

async function readFile(username: string): Promise<FeedsFile> {
  const data = await fileService.readJson<FeedsFile>(feedsPath(username));
  if (!data) return { version: SCHEMA_VERSION, feeds: [], nextId: 1 };
  return {
    version: data.version ?? SCHEMA_VERSION,
    feeds: Array.isArray(data.feeds) ? data.feeds : [],
    nextId: typeof data.nextId === "number" ? data.nextId : (data.feeds?.length ?? 0) + 1,
  };
}

async function writeFile(username: string, data: FeedsFile): Promise<void> {
  await fileService.writeJson(feedsPath(username), data);
}

export async function listFeeds(username: string): Promise<CalendarFeed[]> {
  const file = await readFile(username);
  return file.feeds;
}

export interface CreateFeedInput {
  provider: CalendarFeedProvider;
  label: string;
  icsUrl: string;
  color: string;
  enabled?: boolean;
}

export async function createFeed(
  username: string,
  input: CreateFeedInput
): Promise<CalendarFeed> {
  const file = await readFile(username);
  const feed: CalendarFeed = {
    id: file.nextId,
    provider: input.provider,
    label: input.label,
    icsUrl: input.icsUrl,
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
  patch: Partial<Omit<CalendarFeed, "id">>
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
