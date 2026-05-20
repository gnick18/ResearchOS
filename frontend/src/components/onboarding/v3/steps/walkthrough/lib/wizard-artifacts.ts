import type {
  OnboardingSidecar,
  WizardArtifact,
} from "@/lib/onboarding/sidecar";

/**
 * Pure helpers the W1-W9 step bodies use to track the artifacts they
 * create on the user's real account, and to record auto-created
 * prerequisites when a Skip-this-step earlier in the flow leaves a
 * downstream dependency unsatisfied.
 *
 * No sidecar.ts schema change: the v4 `WizardArtifact` shape carries
 * only `type / id / cleanup_default`. Where the brief sketches extra
 * fields (`source: "placeholder" | "user-file"` on W2 methods,
 * `from / to` on W6 settings_change), this module encodes them in the
 * `id` string with a `:` separator. Phase 4 cleanup can parse the
 * structured ids back out; the alternative was a sidecar.ts shape bump,
 * which the brief explicitly told us to flag rather than ship
 * unilaterally.
 *
 * Auto-prerequisite sentinel format: when a step downstream of a
 * skipped W1/W2/W3 silently auto-creates the missing artifact, it
 * appends `auto:<skipped-step-id>` to `wizard_resume_state.skipped_steps`
 * alongside the original skipped id. Phase 4 reads both: the bare id
 * means the user clicked Skip, the `auto:` prefix means the downstream
 * step silently filled in. Combined with the matching artifact's
 * `cleanup_default: "discard"`, this gives the cleanup grid enough
 * signal to render the "(auto-created)" tag without an `auto_created`
 * field on the artifact itself.
 */

/** Build the auto-prerequisite sentinel string for `skipped_steps`. */
export function autoSentinel(skippedStepId: string): string {
  return `auto:${skippedStepId}`;
}

/** True iff this entry in `skipped_steps` is an auto-prereq sentinel. */
export function isAutoSentinel(entry: string): boolean {
  return entry.startsWith("auto:");
}

/** True iff the user clicked Skip-this-step on `stepId`. The wizard
 *  shell writes the bare id; the auto-prereq machinery writes the
 *  `auto:` form. This predicate only matches the bare form. */
export function wasUserSkipped(
  sidecar: OnboardingSidecar | null,
  stepId: string,
): boolean {
  const entries = sidecar?.wizard_resume_state?.skipped_steps ?? [];
  return entries.includes(stepId);
}

/** First artifact of the requested type, or `null`. Walkthrough steps
 *  use this to short-circuit re-creating a resource the user (or the
 *  auto-prereq helper) already made on an earlier step. */
export function findArtifact(
  sidecar: OnboardingSidecar | null,
  type: WizardArtifact["type"],
): WizardArtifact | null {
  const entries = sidecar?.wizard_resume_state?.artifacts_created ?? [];
  for (const entry of entries) {
    if (entry.type === type) return entry;
  }
  return null;
}

/** Compose a fresh `wizard_resume_state` block from `cur`, appending
 *  one artifact and optionally one or more skipped-step sentinel
 *  entries. Idempotent on both: an artifact whose `(type, id)` already
 *  exists is not duplicated, and a sentinel already in
 *  `skipped_steps` is not duplicated. */
export function appendArtifact(
  cur: OnboardingSidecar,
  artifact: WizardArtifact,
  sentinelsToAdd: string[] = [],
): OnboardingSidecar {
  const existing = cur.wizard_resume_state ?? {
    current_step: "",
    skipped_steps: [],
    artifacts_created: [],
  };
  const artifactKey = `${artifact.type}:${artifact.id}`;
  const hasArtifact = existing.artifacts_created.some(
    (a) => `${a.type}:${a.id}` === artifactKey,
  );
  const nextArtifacts = hasArtifact
    ? existing.artifacts_created
    : [...existing.artifacts_created, artifact];
  const nextSkipped = sentinelsToAdd.reduce<string[]>(
    (acc, s) => (acc.includes(s) ? acc : [...acc, s]),
    [...existing.skipped_steps],
  );
  return {
    ...cur,
    wizard_resume_state: {
      ...existing,
      artifacts_created: nextArtifacts,
      skipped_steps: nextSkipped,
    },
  };
}

/** Convenience: encode the W2 method `source` (placeholder vs user-file)
 *  into the artifact id. Phase 4 parses with {@link decodeMethodSource}.
 *  Format: `"<numeric-method-id>:<source>"`. */
export function encodeMethodId(
  methodId: number,
  source: "placeholder" | "user-file",
): string {
  return `${methodId}:${source}`;
}

export function decodeMethodSource(
  id: string,
): { methodId: number; source: "placeholder" | "user-file" } | null {
  const [rawId, source] = id.split(":", 2);
  const methodId = Number(rawId);
  if (!Number.isFinite(methodId)) return null;
  if (source !== "placeholder" && source !== "user-file") return null;
  return { methodId, source };
}

/** Encode a settings_change artifact id as `"<field>:<from>→<to>"`. The
 *  `→` is the only U+2192 in the codebase; Phase 4's restore path
 *  splits on it. Plain ASCII `->` would collide with theme tokens. */
export function encodeSettingsChangeId(
  field: string,
  from: string,
  to: string,
): string {
  return `${field}:${from}→${to}`;
}

/** Encode a telegram_image artifact id as `"<filename>:<location>"`. The
 *  location is either `"inbox"` (the file still lives at
 *  `users/<u>/inbox/Images/<filename>`) or `"task-<taskId>"` (the
 *  user clicked "Attach to my experiment" and the file moved into the
 *  experiment's results folder). Phase 4 cleanup splits on the colon to
 *  pick the right base path before deleting. */
export function encodeTelegramImageId(
  filename: string,
  location: "inbox" | { taskId: number },
): string {
  if (location === "inbox") return `${filename}:inbox`;
  return `${filename}:task-${location.taskId}`;
}

export function decodeTelegramImageLocation(
  id: string,
): { filename: string; location: "inbox" | { taskId: number } } | null {
  const lastColon = id.lastIndexOf(":");
  if (lastColon < 0) return null;
  const filename = id.slice(0, lastColon);
  const loc = id.slice(lastColon + 1);
  if (loc === "inbox") return { filename, location: "inbox" };
  if (loc.startsWith("task-")) {
    const taskId = Number(loc.slice(5));
    if (!Number.isFinite(taskId)) return null;
    return { filename, location: { taskId } };
  }
  return null;
}

/** Encode a calendar_feed artifact id as `"<feed-id>:<ics-url>"` so
 *  Phase 4 can show the user the feed URL it&apos;s about to delete
 *  without re-reading `_calendar-feeds.json`. The feed-id portion is
 *  the integer id returned by `createFeed`. */
export function encodeCalendarFeedId(feedId: number, icsUrl: string): string {
  return `${feedId}:${icsUrl}`;
}

export function decodeCalendarFeedId(
  id: string,
): { feedId: number; icsUrl: string } | null {
  const firstColon = id.indexOf(":");
  if (firstColon < 0) return null;
  const feedId = Number(id.slice(0, firstColon));
  if (!Number.isFinite(feedId)) return null;
  const icsUrl = id.slice(firstColon + 1);
  if (!icsUrl) return null;
  return { feedId, icsUrl };
}
