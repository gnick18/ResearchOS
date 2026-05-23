import { fileService } from "@/lib/file-system/file-service";
import type {
  CalendarFeed,
  CalendarFeedProvider,
} from "@/lib/types";

/**
 * Persistence layer for linked external calendar subscriptions (Google /
 * Outlook / iCloud / arbitrary public ICS URLs).
 *
 * Stored as a single JSON file `users/{username}/_calendar-feeds.json`,
 * mirroring the `_telegram.json` pattern. One file is fine — most users
 * will have at most a handful of feeds, so a directory-per-feed
 * (`JsonStore`) would be unnecessary I/O overhead.
 *
 * Schema history:
 *   - v1: ICS-only feeds.
 *   - v2: Added OAuth-backed `kind: "google" | "outlook"` feeds.
 *   - v3 (2026-05-14): OAuth integrations removed. Legacy OAuth feeds
 *     written under v2 are silently filtered out on read — they reference
 *     OAuth tokens that no longer exist. Users with OAuth feeds need to
 *     resubscribe via the ICS URL flow.
 */

const SCHEMA_VERSION = 3;

// Per-user write queue serializes read-modify-write operations on each
// `_calendar-feeds.json` so concurrent callers don't race the underlying
// atomic-write pattern (.tmp create + write + move). The race surfaced
// as "Failed to move _calendar-feeds.json.tmp. A FileSystemHandle cannot
// be moved while it is locked" when the `useExternalEvents` poller fired
// `markFeedSynced` (lastSyncAt write) concurrently with a user toggle or
// recolor. Both flows do read-modify-write on the same path; without
// serialization, the second `createWritable` acquires a lock on `.tmp`
// while the first call's `move()` is still pending. Mirrors the queue
// pattern in `lib/file-system/user-metadata.ts` and
// `lib/onboarding/sidecar.ts`. Keyed by username so distinct users don't
// serialize against each other. Tab-scoped (does NOT protect against
// cross-tab or cross-process writes).
const feedsWriteQueues = new Map<string, Promise<unknown>>();
function enqueueFeedsWrite<T>(
  username: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = feedsWriteQueues.get(username) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Swallow errors on the queue chain so a single failed write doesn't
  // poison every subsequent write. Caller still receives the original
  // rejection via the returned promise.
  feedsWriteQueues.set(
    username,
    next.catch(() => {}),
  );
  return next;
}

interface FeedsFile {
  version: number;
  feeds: CalendarFeed[];
  /** Monotonically-increasing id source so deletes don't recycle ids and
   *  collide with cached React Query keys. */
  nextId: number;
}

/** Raw record shape we accept when reading older files. v2 added
 *  `kind` + `oauthCalendarId`; we tolerate both. */
interface LegacyFeedRecord {
  id: number;
  provider?: CalendarFeedProvider;
  /** v2 may have written "google" or "outlook" for OAuth feeds. We treat
   *  anything other than "ics" as a legacy OAuth feed and skip it. */
  kind?: string;
  label?: string;
  icsUrl?: string | null;
  /** v2-only field — ignored on read. */
  oauthCalendarId?: string | null;
  color?: string;
  enabled?: boolean;
  lastSyncAt?: string | null;
}

/** Back-fill missing fields on feeds written before the v3 schema bump.
 *  Returns `null` for legacy OAuth-backed feeds (kind === "google" |
 *  "outlook"), which the caller filters out. */
function normalizeFeed(raw: LegacyFeedRecord): CalendarFeed | null {
  // Legacy OAuth feeds carry kind === "google" | "outlook" and reference
  // OAuth tokens that no longer exist. Drop them silently — the user's
  // record file is orphaned but their ICS subscriptions still work.
  if (raw.kind && raw.kind !== "ics") return null;
  // Need an ICS URL to be useful.
  if (!raw.icsUrl) return null;
  return {
    id: raw.id,
    provider: (raw.provider ?? "other") as CalendarFeedProvider,
    kind: "ics",
    label: raw.label ?? "(unnamed)",
    icsUrl: raw.icsUrl,
    color: raw.color ?? "#3b82f6",
    enabled: raw.enabled ?? true,
    lastSyncAt: raw.lastSyncAt ?? null,
  };
}

async function readFile(username: string): Promise<FeedsFile> {
  const data = await fileService.readJson<FeedsFile>(feedsPath(username));
  if (!data) return { version: SCHEMA_VERSION, feeds: [], nextId: 1 };
  const rawFeeds: LegacyFeedRecord[] = Array.isArray(data.feeds)
    ? (data.feeds as LegacyFeedRecord[])
    : [];
  const normalized: CalendarFeed[] = [];
  for (const r of rawFeeds) {
    const f = normalizeFeed(r);
    if (f) normalized.push(f);
  }
  return {
    version: SCHEMA_VERSION,
    feeds: normalized,
    nextId: typeof data.nextId === "number" ? data.nextId : (rawFeeds.length ?? 0) + 1,
  };
}

function feedsPath(username: string): string {
  return `users/${username}/_calendar-feeds.json`;
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

export async function createFeed(
  username: string,
  input: CreateIcsFeedInput,
): Promise<CalendarFeed> {
  return enqueueFeedsWrite(username, async () => {
    const file = await readFile(username);
    const feed: CalendarFeed = {
      id: file.nextId,
      provider: input.provider,
      kind: "ics",
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
  });
}

export async function updateFeed(
  username: string,
  id: number,
  patch: Partial<Omit<CalendarFeed, "id">>,
): Promise<CalendarFeed | null> {
  return enqueueFeedsWrite(username, async () => {
    const file = await readFile(username);
    const idx = file.feeds.findIndex((f) => f.id === id);
    if (idx === -1) return null;
    const next: CalendarFeed = { ...file.feeds[idx], ...patch };
    const feeds = [...file.feeds];
    feeds[idx] = next;
    await writeFile(username, { ...file, feeds });
    return next;
  });
}

export async function deleteFeed(username: string, id: number): Promise<boolean> {
  return enqueueFeedsWrite(username, async () => {
    const file = await readFile(username);
    const filtered = file.feeds.filter((f) => f.id !== id);
    if (filtered.length === file.feeds.length) return false;
    await writeFile(username, { ...file, feeds: filtered });
    return true;
  });
}

export async function markFeedSynced(username: string, id: number): Promise<void> {
  await updateFeed(username, id, { lastSyncAt: new Date().toISOString() });
}
