// BeakerBot job store (method phone projection reformatter, Phase 2 phone
// trigger, 2026-06-14).
//
// A single, transient, app-wide "BeakerBot is working" job, surfaced by the
// persistent working-bubble overlay and its tap-to-expand card. Right now the
// only job is the method reformat (phone "make phone-friendly"), but the shape is
// generic so other metered-AI jobs (PDF reproduce, summaries) can reuse the same
// bubble later.
//
// Pattern mirrors the app's other cross-screen stores (mascot-prefs / success-
// burst): an in-memory cache + a Set of listeners + a hook. It is deliberately
// NOT persisted, since a job is a live, in-flight thing that should not survive an
// app restart.
//
// No em-dashes, no emojis, no mid-sentence colons.
import { useEffect, useState } from 'react';

export type BeakerBotJobStatus = 'idle' | 'working' | 'done' | 'error';

export interface BeakerBotJob {
  status: BeakerBotJobStatus;
  /** Which kind of job, for the bubble caption. */
  kind: 'reformat-method' | null;
  /** Correlation id matched against the laptop's ai-job status. */
  jobId: string | null;
  /** Short human label (the method name) shown in the expanded card. */
  label: string;
  /** The target, so the watcher can refetch the right screen on done. */
  methodId: number | null;
  taskId: number | null;
  /** epoch ms the job started on the phone (drives the local countdown). */
  startedAt: number;
  /** initial ETA estimate in seconds (the phone counts this down locally). */
  etaSeconds: number;
  /** Final total tokens, known only when the laptop reports done. */
  tokens: number | null;
  /** On done: did the body actually get tidied, or did the guardrail keep the
   *  plain deterministic steps. */
  outcome: 'reformatted' | 'kept-plain' | null;
  /** On error: a short reason key (no_body / out_of_credits / failed). */
  errorReason: string | null;
}

const IDLE: BeakerBotJob = {
  status: 'idle',
  kind: null,
  jobId: null,
  label: '',
  methodId: null,
  taskId: null,
  startedAt: 0,
  etaSeconds: 0,
  tokens: null,
  outcome: null,
  errorReason: null,
};

let cache: BeakerBotJob = IDLE;
const listeners = new Set<(j: BeakerBotJob) => void>();

export function getBeakerBotJob(): BeakerBotJob {
  return cache;
}

export function setBeakerBotJob(patch: Partial<BeakerBotJob>): BeakerBotJob {
  cache = { ...cache, ...patch };
  for (const fn of listeners) {
    try {
      fn(cache);
    } catch {
      // a listener error must never break the job pipeline
    }
  }
  return cache;
}

/** Begin a fresh job, replacing any prior one (last job wins; there is only ever
 *  one bubble). */
export function startBeakerBotJob(
  init: Pick<BeakerBotJob, 'kind' | 'jobId' | 'label' | 'methodId' | 'taskId' | 'etaSeconds'> &
    { startedAt: number },
): void {
  setBeakerBotJob({
    ...IDLE,
    ...init,
    status: 'working',
    tokens: null,
    outcome: null,
    errorReason: null,
  });
}

/** Clear the job back to idle (hides the bubble). */
export function clearBeakerBotJob(): void {
  setBeakerBotJob({ ...IDLE });
}

export function subscribeBeakerBotJob(cb: (j: BeakerBotJob) => void): () => void {
  listeners.add(cb);
  cb(cache);
  return () => {
    listeners.delete(cb);
  };
}

export function useBeakerBotJob(): BeakerBotJob {
  const [job, setJob] = useState<BeakerBotJob>(cache);
  useEffect(() => subscribeBeakerBotJob(setJob), []);
  return job;
}

// ── Method refresh nudge ────────────────────────────────────────────────────
// When a reformat lands, the laptop republishes the method snapshot, but the
// phone only refetches on screen focus. So the job watcher fires this event and
// the open method-detail screen reloads in place, without the user navigating
// away and back.
const refreshListeners = new Set<() => void>();

export function fireMethodRefresh(): void {
  for (const fn of refreshListeners) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}

export function subscribeMethodRefresh(cb: () => void): () => void {
  refreshListeners.add(cb);
  return () => {
    refreshListeners.delete(cb);
  };
}
