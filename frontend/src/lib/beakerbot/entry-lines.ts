// frontend/src/lib/beakerbot/entry-lines.ts
//
// Pure dialog library for BeakerBot on entry / login screens.
// No React, no DOM, no side-effects. Everything here is deterministic
// given the input context so it is directly unit-testable.
//
// Two tiers of lines:
//   TIER A  -- buildEntryGreetingLines -- pre-connect, no numbers, no name.
//   TIER B  -- buildReturningLines    -- post-connect, real facts + optional name.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

// ─── Shared types ────────────────────────────────────────────────────────────

/**
 * Snapshot of per-user activity stats stored in localStorage (Unit 2).
 * All stat fields are optional so callers only provide what they have.
 * All numeric fields represent counts or measures (never negative by
 * the writing rules; callers MUST skip zero-value fields before storing).
 */
export interface UserStatsSummary {
  /** Unix ms timestamp of when this snapshot was written. */
  updatedAt: number;
  /** Number of active experiments in the folder. */
  experiments?: number;
  /** Total note count. */
  notes?: number;
  /** Number of projects on the bench. */
  projects?: number;
  /** Number of open / active tasks. */
  tasks?: number;
  /** Number of 1:1 check-ins logged this calendar month. */
  checkinsThisMonth?: number;
  /** Approximate word count written in the last 7 days. */
  wordsLastWeek?: number;
  /** Number of consecutive days with at least one note entry. */
  streakDays?: number;
  /** Experiments started in the rolling 6-month window. */
  experimentsLast6Months?: number;
  /** Unix ms timestamp of the most recent recorded activity (write/open). */
  lastActivityAt?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Time-of-day greeting from a 0-23 hour value. */
function timeGreeting(hour: number): string {
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

/** Format a number with locale-aware thousands separators (US English). */
function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

// ─── TIER A: pre-connect, no numbers, no name ────────────────────────────────

/**
 * Builds an ordered list of warm, number-free greeting lines for BeakerBot
 * on the sign-in / entry screen, before the user has connected a folder.
 *
 * Pure and deterministic given ctx. Callers that want per-visit variety
 * should pick a random start index AFTER mount (in an effect), not here.
 */
export function buildEntryGreetingLines(ctx: {
  hour: number;
  returning?: boolean;
}): string[] {
  // A deliberately TIGHT, non-redundant set. The bubble shows lines
  // sparingly (long silences between them), so a handful of distinct lines
  // reads better than a long carousel of near-duplicates. One greeting, one
  // warm opener, one value line, one ready line, one playful line.
  const lines: string[] = [];

  // Greeting (time-of-day) plus one warm opener.
  lines.push(timeGreeting(ctx.hour));
  lines.push(ctx.returning ? "Welcome back." : "Hi there.");

  // One value line (the punchiest), one invitation, one playful line.
  lines.push("Your lab, your data, your machine.");
  lines.push("Ready when you are.");
  lines.push("I kept the beakers warm for you.");

  return lines;
}

// ─── TIER B: post-connect, real facts + optional name ────────────────────────

/**
 * Builds an ordered list of speech-bubble lines for a returning user after
 * their folder is connected. Includes real stats when available, skipping
 * any field that is absent or zero (mirrors buildGreetingFacts ordering).
 *
 * Pure and deterministic given ctx. Returns at minimum a greeting line plus
 * a warm fallback when no stats are available.
 */
export function buildReturningLines(ctx: {
  name?: string;
  /**
   * The user's preferred / greeting name, if set. Wins over `name` so BeakerBot
   * greets "Grant" rather than a display-name first word. Optional; when absent
   * the greeting uses `name` (which callers already honorific-strip).
   */
  preferredName?: string;
  hour: number;
  stats: UserStatsSummary | null;
  now: number;
}): string[] {
  const lines: string[] = [];

  // 1. Greeting line first (time-of-day + name when known). An explicit preferred
  // name wins over the passed-in display name.
  const greetName = ctx.preferredName?.trim() || ctx.name;
  const greeting = greetName
    ? `${timeGreeting(ctx.hour).replace(".", ",")} ${greetName}.`
    : timeGreeting(ctx.hour);
  lines.push(greeting);

  const stats = ctx.stats;

  if (!stats) {
    lines.push("Good to have you back.");
    return lines;
  }

  // 2. "What changed" line when there is a derivable days-since.
  if (
    typeof stats.lastActivityAt === "number" &&
    Number.isFinite(stats.lastActivityAt)
  ) {
    const ms = ctx.now - stats.lastActivityAt;
    const days = Math.floor(ms / 86_400_000);
    if (days >= 1) {
      lines.push(
        `It has been ${days} ${days === 1 ? "day" : "days"}. Good to see you.`,
      );
    }
  }

  // 3. Standing facts -- include only when present AND > 0.
  const factLines: string[] = [];

  if (typeof stats.experiments === "number" && stats.experiments > 0) {
    factLines.push(`You have ${fmt(stats.experiments)} experiments going.`);
  }

  if (
    typeof stats.experimentsLast6Months === "number" &&
    stats.experimentsLast6Months > 0
  ) {
    factLines.push(
      `You started ${fmt(stats.experimentsLast6Months)} experiments in the last 6 months.`,
    );
  }

  if (typeof stats.notes === "number" && stats.notes > 0) {
    factLines.push(`${fmt(stats.notes)} notes and counting.`);
  }

  if (typeof stats.projects === "number" && stats.projects > 0) {
    factLines.push(`${fmt(stats.projects)} projects on the bench.`);
  }

  if (typeof stats.wordsLastWeek === "number" && stats.wordsLastWeek > 0) {
    factLines.push(
      `You wrote about ${fmt(stats.wordsLastWeek)} words last week.`,
    );
  }

  if (
    typeof stats.checkinsThisMonth === "number" &&
    stats.checkinsThisMonth > 0
  ) {
    factLines.push(`${fmt(stats.checkinsThisMonth)} check-ins this month.`);
  }

  if (typeof stats.streakDays === "number" && stats.streakDays > 0) {
    factLines.push(`${fmt(stats.streakDays)}-day writing streak. Nice.`);
  }

  if (factLines.length > 0) {
    lines.push(...factLines);
  } else {
    // 4. Fallback when all stat fields are absent or zero.
    lines.push("Good to have you back.");
  }

  return lines;
}
