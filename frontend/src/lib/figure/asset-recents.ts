// Recently-used + favorited icons for the Figure composer's asset picker. With a
// 30k-icon open library, people re-insert the same handful constantly (their
// organism, their assay glyph, their arrows); this keeps last-used + starred
// icons one click away instead of re-searching every time. Two layers:
//   - pure list reducers (pushRecent / toggleFavorite), unit-tested, no DOM,
//   - thin localStorage persistence that fails soft on SSR + privacy mode.
// We persist UIDs only; the picker resolves them against the loaded manifest, so
// a removed/renamed asset simply drops out of the tray (no dangling reference).

const RECENTS_KEY = "ros.figure.assetRecents.v1";
const FAVORITES_KEY = "ros.figure.assetFavorites.v1";

/** How many recents to keep; a couple scroll-rows in the compact tray. */
export const RECENTS_CAP = 24;
/** Favorites are intentional, so a generous ceiling that still bounds storage. */
export const FAVORITES_CAP = 100;

/** Move uid to the front, dedup, cap to the most-recent `cap`. Pure. */
export function pushRecent(list: string[], uid: string, cap = RECENTS_CAP): string[] {
  const next = [uid, ...list.filter((u) => u !== uid)];
  return next.slice(0, cap);
}

/** Toggle uid membership (newest-first on add), cap on add. Pure. */
export function toggleFavorite(list: string[], uid: string, cap = FAVORITES_CAP): string[] {
  if (list.includes(uid)) return list.filter((u) => u !== uid);
  return [uid, ...list].slice(0, cap);
}

function read(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Quota exceeded or privacy-mode blocked: silently skip, the tray just
    // won't persist. Never let a storage failure break an icon insert.
  }
}

/** Recently-inserted UIDs, newest first. */
export function getRecentUids(): string[] {
  return read(RECENTS_KEY);
}

/** Starred UIDs, newest first. */
export function getFavoriteUids(): string[] {
  return read(FAVORITES_KEY);
}

/** Record an insert; returns the updated recents list. */
export function recordRecent(uid: string): string[] {
  const next = pushRecent(read(RECENTS_KEY), uid);
  write(RECENTS_KEY, next);
  return next;
}

/** Toggle a favorite; returns the updated favorites list. */
export function setFavorite(uid: string): string[] {
  const next = toggleFavorite(read(FAVORITES_KEY), uid);
  write(FAVORITES_KEY, next);
  return next;
}
