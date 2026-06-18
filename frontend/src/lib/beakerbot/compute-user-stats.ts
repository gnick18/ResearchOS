// frontend/src/lib/beakerbot/compute-user-stats.ts
//
// Computes real per-user activity counts for the BeakerBot stats cache.
// Called once per session from AppShell and merged into UserStatsSummary
// so the NEXT launch's splash can display real facts.
//
// Design constraints:
//   - Each data source is wrapped in its own try/catch so a failing store
//     never blocks the others or rejects into the caller.
//   - Never fabricates or estimates. Fields are omitted when data is
//     unavailable (returns Partial<UserStatsSummary> with only the fields
//     it can compute cleanly).
//   - Do NOT set updatedAt, streakDays, or lastActivityAt here (the caller
//     owns those fields).
//   - SSR-safe: all reads go through local-api which guards FSA availability.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { UserStatsSummary } from "./entry-lines";
import { notesApi, projectsApi, tasksApi } from "@/lib/local-api";

// ─── Word count helper ────────────────────────────────────────────────────────

/** Split a string on whitespace and return the token count. */
function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

// ─── Date window helpers ──────────────────────────────────────────────────────

/** Returns true when an ISO date-or-datetime string falls within `windowMs`
 *  milliseconds before `now`. Missing or unparseable strings return false. */
function withinWindow(iso: string | null | undefined, now: number, windowMs: number): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  return ms >= now - windowMs && ms <= now;
}

/** Returns the ISO YYYY-MM string for the calendar month that contains `now`. */
function currentYearMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7); // "YYYY-MM"
}

// ─── Main export ─────────────────────────────────────────────────────────────

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Read live data stores and return a partial UserStatsSummary with only
 * the counts that can be derived cleanly from real records.
 *
 * Callers MUST merge the result with streakDays/lastActivityAt/updatedAt
 * before writing to the cache. This function never sets those fields.
 *
 * Fields populated (when data is available):
 *   experiments           -- tasks with task_type === "experiment"
 *   experimentsLast6Months -- those started within 180 days of `now`
 *   projects              -- total project count
 *   notes                 -- total note count
 *   wordsLastWeek         -- sum of whitespace-split word counts of note entries
 *                            whose updated_at falls within 7 days of `now`
 *   checkinsThisMonth     -- notes with note_kind === "meeting" whose created_at
 *                            falls within the current calendar month
 *
 * Each source is independently try/catch'd: one failing store omits its field
 * but does not prevent the others from computing.
 */
export async function computeUserStats(
  user: string,
  now: number,
): Promise<Partial<UserStatsSummary>> {
  const result: Partial<UserStatsSummary> = {};
  const yearMonth = currentYearMonth(now);

  // ── Tasks (experiments) ───────────────────────────────────────────────────
  try {
    const tasks = await tasksApi.listAllForUser(user);
    const experiments = tasks.filter((t) => t.task_type === "experiment");

    const totalExperiments = experiments.length;
    if (totalExperiments > 0) {
      result.experiments = totalExperiments;
    }

    const recentExperiments = experiments.filter((t) =>
      withinWindow(t.start_date, now, SIX_MONTHS_MS),
    ).length;
    if (recentExperiments > 0) {
      result.experimentsLast6Months = recentExperiments;
    }
  } catch {
    // Store unavailable or FSA not ready: omit experiment fields.
  }

  // ── Projects ──────────────────────────────────────────────────────────────
  try {
    const projects = await projectsApi.list();
    const count = projects.length;
    if (count > 0) {
      result.projects = count;
    }
  } catch {
    // Store unavailable: omit projects field.
  }

  // ── Notes, wordsLastWeek, checkinsThisMonth ───────────────────────────────
  try {
    const notes = await notesApi.list();
    const noteCount = notes.length;
    if (noteCount > 0) {
      result.notes = noteCount;
    }

    // wordsLastWeek: sum word counts of entries whose updated_at is within 7d.
    let words = 0;
    for (const note of notes) {
      for (const entry of note.entries ?? []) {
        if (withinWindow(entry.updated_at, now, SEVEN_DAYS_MS)) {
          words += countWords(entry.content ?? "");
        }
      }
    }
    if (words > 0) {
      result.wordsLastWeek = words;
    }

    // checkinsThisMonth: meeting notes (note_kind === "meeting") created this
    // calendar month, identified by the YYYY-MM prefix of their created_at.
    let checkins = 0;
    for (const note of notes) {
      if (
        note.note_kind === "meeting" &&
        typeof note.created_at === "string" &&
        note.created_at.startsWith(yearMonth)
      ) {
        checkins++;
      }
    }
    if (checkins > 0) {
      result.checkinsThisMonth = checkins;
    }
  } catch {
    // Store unavailable: omit notes/words/checkins fields.
  }

  return result;
}
