import { fileService } from "@/lib/file-system/file-service";

// Per-user write queue serializes read-modify-write operations on each
// `_onboarding.json` so concurrent callers don't race the underlying
// atomic-write pattern (.tmp create + write + move). The race surfaced
// as "Failed to move _onboarding.json.tmp. A FileSystemHandle cannot be
// moved while it is locked" when Grant switched users mid-walkthrough
// and the tour's pending step-transition write overlapped a teardown
// write on the same path. Mirrors the queue in
// frontend/src/lib/file-system/user-metadata.ts, which addressed the
// identical symptom on `_user_metadata.json`. Keyed by username so
// distinct users don't serialize against each other. Tab-scoped (does
// NOT protect against cross-tab or cross-process writes).
const onboardingWriteQueues = new Map<string, Promise<unknown>>();
function enqueueOnboardingWrite<T>(
  username: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = onboardingWriteQueues.get(username) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Swallow errors on the queue chain so a single failed write doesn't
  // poison every subsequent write. Caller still receives the original
  // rejection via the returned promise.
  onboardingWriteQueues.set(
    username,
    next.catch(() => {}),
  );
  return next;
}

/**
 * Per-user onboarding sidecar at `users/<u>/_onboarding.json`.
 *
 * Mirrors `_telegram.json` / `_calendar-feeds.json` / `_labarchives.json`,
 * one JSON blob per user that captures where this user is in the
 * onboarding v3 walkthrough and which feature picks they made at Phase 1.
 *
 * Schema history:
 *  - v1 (2026-05-14): initial. active_seconds + last_tip_at + tips map +
 *    tips_off + shown_count.
 *  - v2 (2026-05-14): adds `mode`. Welcome-modal pick:
 *    `tutorial | suggestions | silenced | null`.
 *  - v3 (2026-05-20): adds the Onboarding v2 wizard fields (`use_cases`,
 *    `wizard_completed_at`, `wizard_skipped_at`, then `other_use_case`,
 *    then `telegram_decision` / `calendar_decision` / `ai_helper_decision`,
 *    then `wizard_force_show`). All additive on the v2 shape.
 *  - v4 (2026-05-20): Onboarding v3.0 migration. The whole v1/v2 tip
 *    system (`mode`, `tips`, `last_tip_at`, `shown_count`, `tips_off`)
 *    is removed, along with the v2 wizard taxonomy fields (`use_cases`,
 *    `other_use_case`) and the three integration decision fields
 *    (`telegram_decision`, `calendar_decision`, `ai_helper_decision`).
 *    Adds the v3.0 walkthrough fields: `feature_picks` (nullable; the
 *    Phase 1 setup-question outcomes), `wizard_resume_state` (nullable;
 *    mid-walkthrough resume snapshot), `lab_tour_pending`, and
 *    `lab_tour_dismissed_at`. Retains `wizard_completed_at`,
 *    `wizard_skipped_at`, `wizard_force_show`, `first_seen_at`,
 *    `active_seconds`. Migration rule for existing users with a
 *    v1/v2/v3 record: `feature_picks = null` and `wizard_force_show =
 *    false` so existing users get nothing automatic (L1/L22). Tab
 *    visibility falls back to settings.json visibleTabs while
 *    feature_picks is null. See ONBOARDING_V3_PROPOSAL.md §10 + §11.
 */

const SCHEMA_VERSION = 4;

/** Phase 1 setup-question outcomes. Populated by the v3 wizard's Phase
 *  1 (Welcome + Q1 solo/lab + Q1a/Q1b storage + Q2-Q6 feature picks).
 *  `null` on the parent sidecar field means the user has not been
 *  through Phase 1; tab visibility falls back to settings.json
 *  visibleTabs in that case. See ONBOARDING_V3_PROPOSAL.md §10. */
export interface FeaturePicks {
  account_type: "solo" | "lab";
  /** Lab accounts only. `"deferred"` means user picked lab but chose to
   *  set up storage later. */
  lab_storage?: "local" | "google_drive" | "onedrive" | "box" | "deferred";
  /** Q2-Q6 picks are OPTIONAL. Absent means the user has not yet
   *  explicitly answered. The wizard sets account_type at Q1 and leaves
   *  Q2-Q6 fields undefined until the user picks; that way the radios
   *  on Q2-Q5 don't show a "Maybe later" pre-selection on first encounter.
   *  Downstream readers must handle undefined (e.g. `=== "yes"` already
   *  evaluates false for undefined, so most existing checks are safe). */
  purchases?: "yes" | "no" | "maybe";
  calendar?: "yes" | "no" | "maybe";
  goals?: "yes" | "no" | "maybe";
  telegram?: "yes" | "no" | "maybe";
  ai_helper?: "full" | "medium" | "minimal" | "no" | "maybe";
}

/** One artifact the v3 wizard created on the user's real account. The
 *  Phase 4 cleanup selector iterates these to render the keep/discard
 *  grid. `cleanup_default` matches L24: all items pre-checked as keep. */
export interface WizardArtifact {
  /** Domain category: "project", "method", "experiment", "purchase",
   *  "goal", "calendar_feed", "telegram_link", "lab_user", "lab_task",
   *  "settings_change", "hybrid_edit", etc. Free-form string so the
   *  Phase 4 UI can group/sort without coupling to a fixed enum. */
  type: string;
  /** Domain-specific identifier (project id, task id, feed id, etc.).
   *  The Phase 4 cleanup code uses this to delete / restore the
   *  artifact via the matching domain's API. */
  id: string;
  cleanup_default: "keep" | "discard";
}

/** Mid-walkthrough snapshot. The wizard writes this on each step so a
 *  mid-close → next open can offer Restart / Resume / Discard (L10). */
export interface WizardResumeState {
  /** Step id the user was on: "W3", "L4", "phase4-cleanup", etc. */
  current_step: string;
  /** Step ids the user used "skip this step" on (L9). */
  skipped_steps: string[];
  /** Artifacts created so far (populated as the walkthrough progresses). */
  artifacts_created: WizardArtifact[];
}

export interface OnboardingSidecar {
  version: number;
  /** ISO timestamp of the first time THIS USER opened this folder under
   *  a build that had the onboarding system. Pure record-keeping;
   *  retained from v3 so resume-state heuristics still have a baseline. */
  first_seen_at: string;
  /** Total wall-clock seconds the user has spent with at least one
   *  ResearchOS tab visible-and-focused. Retained from v3; the v3
   *  walkthrough may still consult active-time for resume-state nudges. */
  active_seconds: number;
  /** Phase 1 outcome. `null` = the user has not been through the v3
   *  wizard (migrated user OR fresh user pre-Phase-1 completion).
   *  Populated by the v3 wizard's Phase 1 with the full object shape. */
  feature_picks: FeaturePicks | null;
  /** ISO timestamp of wizard completion (Continue on the final step
   *  of Phase 4 cleanup). Mutually exclusive with `wizard_skipped_at`. */
  wizard_completed_at: string | null;
  /** ISO timestamp of wizard skip ("I've got it from here" link on any
   *  step, L8). Mutually exclusive with `wizard_completed_at`. */
  wizard_skipped_at: string | null;
  /** One-shot gate-bypass flag. Set to `true` by the Settings
   *  "Re-run welcome tour" button (via `clearWizardCompletion()`); the
   *  wizard's onComplete / onSkip handlers clear it back to `false`. */
  wizard_force_show: boolean;
  /** Mid-walkthrough snapshot. `null` when no walkthrough is in
   *  flight (the user never started, completed, or skipped wholesale). */
  wizard_resume_state: WizardResumeState | null;
  /** True when the user finished Phase 2 with a "later" pick on the
   *  Lab Mode tour offer (L18). Cleared when the user takes the tour
   *  on a natural Lab Mode entry, or when they pick Dismiss. */
  lab_tour_pending: boolean;
  /** ISO timestamp set when the user picked Dismiss on the natural-
   *  entry Lab Mode tour offer. Permanent — no further auto-firing. */
  lab_tour_dismissed_at: string | null;
}

function sidecarPath(username: string): string {
  return `users/${username}/_onboarding.json`;
}

function makeDefault(): OnboardingSidecar {
  return {
    version: SCHEMA_VERSION,
    first_seen_at: new Date().toISOString(),
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
  };
}

/** Migration-aware normalizer. Accepts a v1/v2/v3/v4 raw record and
 *  produces a v4-shaped output. All removed v3 fields are stripped
 *  silently. Existing users (any v1/v2/v3 record) carry
 *  `feature_picks = null` and `wizard_force_show = false` so they get
 *  nothing automatic (L1/L22). Tab visibility falls back to
 *  settings.json visibleTabs while feature_picks is null. */
function normalize(raw: Partial<OnboardingSidecar> | null): OnboardingSidecar {
  if (!raw) return makeDefault();
  const r = raw as Record<string, unknown>;

  const first_seen_at =
    typeof r.first_seen_at === "string"
      ? (r.first_seen_at as string)
      : new Date().toISOString();
  const active_seconds =
    typeof r.active_seconds === "number" && r.active_seconds >= 0
      ? (r.active_seconds as number)
      : 0;

  const wizard_completed_at =
    typeof r.wizard_completed_at === "string"
      ? (r.wizard_completed_at as string)
      : null;
  const wizard_skipped_at =
    typeof r.wizard_skipped_at === "string"
      ? (r.wizard_skipped_at as string)
      : null;

  // Existing-user invisibility invariant (L1/L22): any pre-v4 record
  // normalizes with feature_picks=null AND wizard_force_show=false. The
  // tab-visibility consumer (P1+) treats feature_picks=null as "use
  // settings.json visibleTabs as-is", which preserves the user's
  // existing tab set. A v4 record carries through the persisted
  // feature_picks object as long as it has the required keys; any
  // partial / malformed object normalizes back to null so we never
  // half-trust a corrupt write.
  const existingVersion =
    typeof r.version === "number" ? (r.version as number) : 0;
  const isPreV4Record = existingVersion < SCHEMA_VERSION;
  const feature_picks = isPreV4Record
    ? null
    : parseFeaturePicks(r.feature_picks);

  const wizard_force_show = isPreV4Record
    ? false
    : r.wizard_force_show === true;

  const wizard_resume_state = parseWizardResumeState(r.wizard_resume_state);

  const lab_tour_pending = r.lab_tour_pending === true;
  const lab_tour_dismissed_at =
    typeof r.lab_tour_dismissed_at === "string"
      ? (r.lab_tour_dismissed_at as string)
      : null;

  return {
    version: SCHEMA_VERSION,
    first_seen_at,
    active_seconds,
    feature_picks,
    wizard_completed_at,
    wizard_skipped_at,
    wizard_force_show,
    wizard_resume_state,
    lab_tour_pending,
    lab_tour_dismissed_at,
  };
}

const ACCOUNT_TYPES: ReadonlySet<string> = new Set(["solo", "lab"]);
const LAB_STORAGES: ReadonlySet<string> = new Set([
  "local",
  "google_drive",
  "onedrive",
  "box",
  "deferred",
]);
const YES_NO_MAYBE: ReadonlySet<string> = new Set(["yes", "no", "maybe"]);
const AI_HELPER_VALUES: ReadonlySet<string> = new Set([
  "full",
  "medium",
  "minimal",
  "no",
  "maybe",
]);

function parseFeaturePicks(raw: unknown): FeaturePicks | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // account_type is the only required field — without it we can't gate
  // any step. Q2-Q6 keys are optional (sidecar.ts FeaturePicks marks them
  // `?`) so a sidecar persisted between Q1 and Q2 has a valid picks
  // object with only `account_type` set. Live-test R5 (2026-05-22)
  // found this parser was rejecting that partial shape, returning null,
  // which the Q1a/Q1b/Q2-Q6 handlers' `if (!cur.feature_picks) return cur`
  // short-circuit then no-op'd. Cascade: every conditional walkthrough
  // and the entire lab cluster gated out because picks stayed null
  // across the whole tour.
  if (typeof o.account_type !== "string" || !ACCOUNT_TYPES.has(o.account_type)) {
    return null;
  }
  const picks: FeaturePicks = {
    account_type: o.account_type as FeaturePicks["account_type"],
  };
  // Validate-if-present pattern for every Q2-Q6 field. Unknown values
  // (legacy sidecars with stale strings) get dropped silently rather
  // than nuking the whole record.
  if (typeof o.purchases === "string" && YES_NO_MAYBE.has(o.purchases)) {
    picks.purchases = o.purchases as FeaturePicks["purchases"];
  }
  if (typeof o.calendar === "string" && YES_NO_MAYBE.has(o.calendar)) {
    picks.calendar = o.calendar as FeaturePicks["calendar"];
  }
  if (typeof o.goals === "string" && YES_NO_MAYBE.has(o.goals)) {
    picks.goals = o.goals as FeaturePicks["goals"];
  }
  if (typeof o.telegram === "string" && YES_NO_MAYBE.has(o.telegram)) {
    picks.telegram = o.telegram as FeaturePicks["telegram"];
  }
  if (typeof o.ai_helper === "string" && AI_HELPER_VALUES.has(o.ai_helper)) {
    picks.ai_helper = o.ai_helper as FeaturePicks["ai_helper"];
  }
  if (typeof o.lab_storage === "string" && LAB_STORAGES.has(o.lab_storage)) {
    picks.lab_storage = o.lab_storage as FeaturePicks["lab_storage"];
  }
  return picks;
}

function parseWizardResumeState(raw: unknown): WizardResumeState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.current_step !== "string") return null;
  const skipped: string[] = Array.isArray(o.skipped_steps)
    ? (o.skipped_steps as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  const artifacts: WizardArtifact[] = Array.isArray(o.artifacts_created)
    ? (o.artifacts_created as unknown[]).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const e = entry as Record<string, unknown>;
        if (typeof e.type !== "string" || typeof e.id !== "string") return [];
        const cleanup =
          e.cleanup_default === "discard" ? "discard" : "keep";
        return [
          {
            type: e.type,
            id: e.id,
            cleanup_default: cleanup,
          },
        ];
      })
    : [];
  return {
    current_step: o.current_step,
    skipped_steps: skipped,
    artifacts_created: artifacts,
  };
}

/** Read the user's onboarding sidecar. Returns a freshly-defaulted
 *  record if the file is missing — callers shouldn't have to special-
 *  case the first-read. Does NOT persist the default; that happens
 *  lazily on the first `writeOnboarding()` so a tab that only reads
 *  doesn't dirty the folder. */
export async function readOnboarding(
  username: string,
): Promise<OnboardingSidecar> {
  const raw = await fileService.readJson<Partial<OnboardingSidecar>>(
    sidecarPath(username),
  );
  return normalize(raw);
}

/** Persist the full sidecar. Callers should pass the complete object;
 *  partial updates happen via `patchOnboarding()`. Routed through the
 *  per-user write queue so a writeOnboarding cannot overlap a pending
 *  patchOnboarding on the same path. */
export async function writeOnboarding(
  username: string,
  data: OnboardingSidecar,
): Promise<void> {
  await enqueueOnboardingWrite(username, async () => {
    await fileService.writeJson(sidecarPath(username), {
      ...data,
      version: SCHEMA_VERSION,
    });
  });
}

/** Read-modify-write helper. The `patch` callback receives the current
 *  sidecar (or a default) and returns the next one. Single I/O cycle
 *  per call. The read AND write share the same queue slot so two
 *  concurrent patches against the same user serialize cleanly (without
 *  the queue, two patches that read in parallel would each compute a
 *  next-state against the same stale current and the later writer
 *  would clobber the earlier one — plus the .tmp move would race). */
export async function patchOnboarding(
  username: string,
  patch: (current: OnboardingSidecar) => OnboardingSidecar,
): Promise<OnboardingSidecar> {
  return enqueueOnboardingWrite(username, async () => {
    const current = await readOnboarding(username);
    const next = patch(current);
    await fileService.writeJson(sidecarPath(username), {
      ...next,
      version: SCHEMA_VERSION,
    });
    return next;
  });
}

/** Reset the wizard's "user has been through it" state so the v3
 *  wizard mounts again on the next orchestrator read. Used by the
 *  Settings "Re-run welcome tour" button.
 *
 *  Sets:
 *    - wizard_completed_at = null
 *    - wizard_skipped_at   = null
 *    - wizard_force_show   = true  (the gate-bypass flag; the wizard
 *      mounts even for an existing user whose fresh-folder probe
 *      would otherwise return false)
 *    - lab_tour_pending = false       (P3b, master-locked: a stale
 *      Later flag from a prior run is wiped so the re-run lab-prompt
 *      starts clean. The user re-picks Now / Later / Dismiss as part
 *      of the re-run flow.)
 *    - lab_tour_dismissed_at = null   (P3b, master-locked: a
 *      permanent Dismiss on the natural-Lab-Mode-entry prompt is
 *      undone here so a Settings re-run can re-surface the lab tour
 *      offer. Without this, a user who dismissed the resume modal
 *      would never see the lab tour again, even after re-running.)
 *
 *  Semantic: re-run = fresh start across all wizard surfaces,
 *  including the lab tour deferral state. The wizard's onComplete
 *  and onSkip handlers clear `wizard_force_show` back to false after
 *  the re-run finishes. */
export async function clearWizardCompletion(
  username: string,
): Promise<OnboardingSidecar> {
  return patchOnboarding(username, (cur) => ({
    ...cur,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: true,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
  }));
}

/** No-op kept for the brief P0→P7 window so legacy Settings tip cards
 *  that still call this don't break the build. P7 deletes the calling
 *  surface entirely. */
export async function replayOnboarding(
  username: string,
): Promise<OnboardingSidecar> {
  return readOnboarding(username);
}
