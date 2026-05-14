/**
 * Demo-lab date rebasing.
 *
 * The on-disk demo lab (and the in-memory wiki-capture fixture) ship with
 * hard-coded fake dates anchored at the generator's `BASE_DATE`
 * (2026-05-13). As real time marches forward those dates fall into the
 * past: every "upcoming experiment" looks overdue, the gantt scrolls off
 * the left edge, the calendar empties out. To keep the demo feeling
 * fresh, every time a user connects to a demo lab (or fixture mode
 * loads), we shift every scheduling-flavored date by
 * `today - last_rebased_at` days so the demo's "now" lines up with the
 * user's real "now."
 *
 * The shift is idempotent: re-running on the same day yields a no-op,
 * running a week later shifts everything by 7 days. The marker file
 * persists the last-rebased anchor so we always know how far behind the
 * disk is.
 *
 * ## Scope
 *
 * In scope (shifted): task `start_date`/`end_date`, goal
 * `start_date`/`end_date`, event `start_date`/`end_date`, project
 * `created_at`, `_shared_with_me.json` `shared_at` per entry.
 *
 * Out of scope (intentionally frozen): method timestamps, PCR
 * timestamps, note timestamps, lab-link `created_at`,
 * `_user_metadata.json` `created_at`, purchase items (no dates), file
 * sidecars. These all represent "history" rather than "schedule" and
 * should stay put.
 *
 * ## Safety
 *
 * The caller must verify `_demo_marker.json` has `is_demo: true`
 * BEFORE invoking this function. There is no internal check — by the
 * time `rebaseDemoDates` runs we're already committed to writing. The
 * pure separation makes it easy to unit-test against an in-memory
 * mock without spinning up the FSA layer.
 *
 * Note: if a user has edited a demo task's date themselves, the rebase
 * will shift their edit too. That's acceptable — the demo is meant as
 * a sandbox, not a stable database.
 */

/** Storage interface — dependency-injected so the same logic works
 *  against both `fileService` (on-disk FSA writes) and the
 *  wiki-capture-mock's in-memory store. */
export interface RebaseStorage {
  readJson<T>(path: string): Promise<T | null>;
  writeJson<T>(path: string, data: T): Promise<void>;
  listFiles(dirPath: string): Promise<string[]>;
  listDirectories(dirPath: string): Promise<string[]>;
}

/** Marker file shape — only the fields we care about. The marker file
 *  may carry other generator metadata we leave alone. */
export interface DemoMarker {
  is_demo?: boolean;
  /** ISO date (YYYY-MM-DD) the demo was last rebased to. Defaults to
   *  the generator's `BASE_DATE` (2026-05-13) when missing. */
  last_rebased_at?: string;
  generated_at?: string;
  [key: string]: unknown;
}

/** Default anchor: matches the `BASE_DATE`/`TODAY` constant in
 *  `scripts/generate-demo-data.mjs`. Used as a fallback when the marker
 *  has no `last_rebased_at` yet (first-time rebase after upgrade). */
const DEFAULT_BASE_DATE = "2026-05-13";

/** Returns the number of whole days between two ISO date strings
 *  (YYYY-MM-DD). Positive when `to > from`. UTC-anchored so DST
 *  transitions don't shift the count by ±1. */
export function dayDelta(fromIso: string, toIso: string): number {
  const from = parseIsoUtc(fromIso);
  const to = parseIsoUtc(toIso);
  if (!from || !to) return 0;
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / 86_400_000);
}

/** Adds N days to an ISO date string, returning a new ISO date string.
 *  UTC-anchored, handles month/year rollover correctly. Returns the
 *  input unchanged if it doesn't parse. */
export function shiftIsoDate(iso: string, days: number): string {
  if (!iso || typeof iso !== "string") return iso;
  const d = parseIsoUtc(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return formatIsoUtc(d);
}

/** Same as `shiftIsoDate` but preserves the time-of-day on ISO-with-time
 *  strings (`2026-05-13T08:00:00Z`). Used for `shared_at` and
 *  `created_at` fields that carry timestamps. */
export function shiftIsoDateTime(iso: string, days: number): string {
  if (!iso || typeof iso !== "string") return iso;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() + days);
  // Preserve original suffix style: if the input had a Z, keep one.
  if (iso.endsWith("Z")) return d.toISOString();
  return d.toISOString();
}

function parseIsoUtc(iso: string): Date | null {
  if (!iso) return null;
  // Accept both "2026-05-13" and "2026-05-13T08:00:00Z" — anchor the
  // date-only form at midnight UTC so the delta math doesn't drift
  // across local timezone offsets.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const ms = Date.parse(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function formatIsoUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO date string for today in UTC (YYYY-MM-DD). Pulled out so tests
 *  can inject a fixed date. */
export function todayIsoUtc(now: Date = new Date()): string {
  return formatIsoUtc(new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )));
}

interface RebaseResult {
  /** Number of days the rebase shifted by. 0 means no-op. */
  delta: number;
  /** Count of files that were rewritten. 0 when delta === 0. */
  filesWritten: number;
  /** The new `last_rebased_at` written to the marker. */
  newAnchor: string;
}

/** Walks the demo lab tree and shifts schedule-flavored dates by
 *  `today - last_rebased_at` days. Idempotent — re-running on the same
 *  day is a no-op (delta = 0, no writes). The marker file is updated
 *  LAST so a crash mid-rebase doesn't lose the offset (the next run
 *  will just see the same stale anchor and try again).
 *
 *  @param storage Read/write/list primitives. Inject `fileService` for
 *    the on-disk path or the wiki-capture mock for the in-memory path.
 *  @param now Optional override for "today" (UTC midnight). Tests can
 *    pin this to a fixed date.
 */
export async function rebaseDemoDates(
  storage: RebaseStorage,
  now: Date = new Date(),
): Promise<RebaseResult> {
  const today = todayIsoUtc(now);

  const marker = (await storage.readJson<DemoMarker>("_demo_marker.json")) ?? {};
  const anchor = normalizeAnchor(marker.last_rebased_at)
    ?? normalizeAnchor(marker.generated_at)
    ?? DEFAULT_BASE_DATE;

  const delta = dayDelta(anchor, today);
  if (delta === 0) {
    return { delta: 0, filesWritten: 0, newAnchor: anchor };
  }

  let filesWritten = 0;

  // Walk every user's directory in parallel — each user is independent.
  const usernames = await storage.listDirectories("users");
  await Promise.all(
    usernames.map(async (username) => {
      // Skip the reserved cross-user roots; they have no schedule-flavored
      // dates worth shifting. The `public` dir holds method/PCR templates
      // (intentionally frozen). The `lab` dir holds funding accounts (no
      // schedule dates).
      if (username === "public" || username === "lab") return;
      const written = await rebaseUser(storage, username, delta);
      filesWritten += written;
    }),
  );

  // Write marker LAST so an abort partway through leaves the disk in a
  // recoverable state — next boot sees the same stale anchor and just
  // does the residual shift.
  const newMarker: DemoMarker = { ...marker, last_rebased_at: today };
  await storage.writeJson("_demo_marker.json", newMarker);
  filesWritten += 1;

  return { delta, filesWritten, newAnchor: today };
}

/** Reads a date string from the marker and normalizes it to YYYY-MM-DD.
 *  Returns null for unparseable / missing values so the caller can fall
 *  through to the next candidate. */
function normalizeAnchor(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const d = parseIsoUtc(value);
  if (!d) return null;
  return formatIsoUtc(d);
}

async function rebaseUser(
  storage: RebaseStorage,
  username: string,
  delta: number,
): Promise<number> {
  let written = 0;

  // Tasks: start_date + end_date.
  written += await shiftCollection(
    storage,
    `users/${username}/tasks`,
    (json: Record<string, unknown>) => {
      let dirty = false;
      if (typeof json.start_date === "string") {
        json.start_date = shiftIsoDate(json.start_date, delta);
        dirty = true;
      }
      if (typeof json.end_date === "string") {
        json.end_date = shiftIsoDate(json.end_date, delta);
        dirty = true;
      }
      return dirty;
    },
  );

  // Goals: start_date + end_date. (Leave `created_at` alone — the goal
  // was set in the past; only the schedule window matters.)
  written += await shiftCollection(
    storage,
    `users/${username}/goals`,
    (json: Record<string, unknown>) => {
      let dirty = false;
      if (typeof json.start_date === "string") {
        json.start_date = shiftIsoDate(json.start_date, delta);
        dirty = true;
      }
      if (typeof json.end_date === "string") {
        json.end_date = shiftIsoDate(json.end_date, delta);
        dirty = true;
      }
      return dirty;
    },
  );

  // Events: start_date + end_date.
  written += await shiftCollection(
    storage,
    `users/${username}/events`,
    (json: Record<string, unknown>) => {
      let dirty = false;
      if (typeof json.start_date === "string") {
        json.start_date = shiftIsoDate(json.start_date, delta);
        dirty = true;
      }
      if (typeof json.end_date === "string") {
        json.end_date = shiftIsoDate(json.end_date, delta);
        dirty = true;
      }
      return dirty;
    },
  );

  // Projects: created_at only. The age of the project (gantt header
  // "Started X weeks ago") drifts with today, so keep the offset
  // believable.
  written += await shiftCollection(
    storage,
    `users/${username}/projects`,
    (json: Record<string, unknown>) => {
      if (typeof json.created_at === "string") {
        json.created_at = shiftIsoDateTime(json.created_at, delta);
        return true;
      }
      return false;
    },
  );

  // _shared_with_me.json: per-entry `shared_at` timestamps. Single file
  // with nested arrays, not a collection — handle inline.
  const sharedPath = `users/${username}/_shared_with_me.json`;
  const shared = await storage.readJson<{
    projects?: Array<Record<string, unknown>>;
    tasks?: Array<Record<string, unknown>>;
    methods?: Array<Record<string, unknown>>;
  }>(sharedPath);
  if (shared) {
    let dirty = false;
    for (const key of ["projects", "tasks", "methods"] as const) {
      const list = shared[key];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (typeof entry.shared_at === "string") {
          entry.shared_at = shiftIsoDateTime(entry.shared_at, delta);
          dirty = true;
        }
      }
    }
    if (dirty) {
      await storage.writeJson(sharedPath, shared);
      written += 1;
    }
  }

  return written;
}

/** Read every `*.json` in `dir`, apply `mutate` (returns true if the
 *  record was changed), write back. Skips the meta files
 *  (`_counters.json`, `_shared_with_me.json`, etc.) — those are
 *  handled inline or intentionally untouched. */
async function shiftCollection(
  storage: RebaseStorage,
  dir: string,
  mutate: (json: Record<string, unknown>) => boolean,
): Promise<number> {
  const files = await storage.listFiles(dir);
  let written = 0;
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    if (file.startsWith("_")) continue;
    const path = `${dir}/${file}`;
    const data = await storage.readJson<Record<string, unknown>>(path);
    if (!data || typeof data !== "object") continue;
    if (mutate(data)) {
      await storage.writeJson(path, data);
      written += 1;
    }
  }
  return written;
}

/** Convenience predicate for callers that need a belt-and-suspenders
 *  check before rebasing real-world data. Returns true only when the
 *  marker file is present AND `is_demo === true`. Reads via the
 *  injected storage so it works in both fixture mode and on-disk. */
export async function isDemoLab(storage: RebaseStorage): Promise<boolean> {
  try {
    const marker = await storage.readJson<DemoMarker>("_demo_marker.json");
    return marker?.is_demo === true;
  } catch {
    return false;
  }
}
