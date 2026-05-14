import { taskKey } from "@/lib/types";
import type { ExperimentExportPayload } from "./types";

const MAX_SLUG_LENGTH = 80;

// Windows reserves these filenames (case-insensitive, with or without
// extension). A file literally named `aux.pdf` or `con.html` fails to open
// on Windows even though POSIX is fine with it. Append `-task` when the
// slug exactly matches one so cross-platform receivers can open the export.
// See: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * Lowercase, alphanumeric + dashes only, max 80 chars. Empty input or input
 * that slugifies to an empty string falls back to "experiment" so we always
 * produce a usable filename stem. A slug that exactly matches a Windows
 * reserved name (CON, PRN, AUX, NUL, COM1-9, LPT1-9) gets `-task` appended
 * so the resulting filename is openable on Windows.
 */
export function slugify(name: string): string {
  const cleaned = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = cleaned.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  const result = truncated || "experiment";
  if (WINDOWS_RESERVED_NAMES.has(result)) return `${result}-task`;
  return result;
}

/**
 * Return a parallel array of unique slugs for the given payloads. When two
 * payloads slugify to the same base (e.g. "cell-culture"), every colliding
 * entry gets `-{taskKey}` appended so receivers can disambiguate by owner +
 * task id (matches the convention in EXPORT_REVAMP_PLAN.md §3).
 */
export function resolveCollidingFilenames(
  payloads: ExperimentExportPayload[]
): string[] {
  const bases = payloads.map((p) => slugify(p.task.name));
  const counts = new Map<string, number>();
  for (const b of bases) counts.set(b, (counts.get(b) ?? 0) + 1);

  return payloads.map((payload, i) => {
    const base = bases[i];
    if ((counts.get(base) ?? 0) <= 1) return base;
    const keySuffix = slugify(
      taskKey({
        id: payload.task.id,
        owner: payload.task.owner,
        is_shared_with_me: payload.task.is_shared_with_me,
      })
    );
    return `${base}-${keySuffix}`;
  });
}
