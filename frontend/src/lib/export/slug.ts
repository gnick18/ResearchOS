import { taskKey } from "@/lib/types";
import type { ExperimentExportPayload } from "./types";

const MAX_SLUG_LENGTH = 80;

/**
 * Lowercase, alphanumeric + dashes only, max 80 chars. Empty input or input
 * that slugifies to an empty string falls back to "experiment" so we always
 * produce a usable filename stem.
 */
export function slugify(name: string): string {
  const cleaned = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = cleaned.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  return truncated || "experiment";
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
