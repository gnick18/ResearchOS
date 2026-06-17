// Shared "page boot" framework. Local-first pages (Data Hub, figures, phylo)
// load heavy things in the browser for snappiness + zero server cost; the cost
// is a wait when you open the page. A blank/frozen-looking wait is bad UX, so we
// run that load behind a BeakerBot loader with an HONEST progress bar: each page
// declares its real loading steps as weighted tasks, we aggregate true progress,
// finish exactly when the work finishes, and (on repeat visits) show a real ETA
// from cached timings. See docs + BeakerBotLoader for the UI.
//
// This module is the PURE core (no React, no DOM beyond an injectable timing
// store) so the progress + ETA math is unit-tested.

/** One real loading step. `run` should call `onProgress(0..1)` for steps that
 *  can report sub-progress (e.g. a byte-streamed download); opaque steps (WASM
 *  init, parsing) just resolve when done and contribute their full weight then. */
export interface BootTask {
  id: string;
  label: string;
  /** Relative weight in the overall bar. Defaults to 1 if omitted. */
  weight?: number;
  run: (onProgress: (frac: number) => void) => Promise<void>;
}

export interface BootState {
  /** True aggregate progress, 0..100. Never exceeds 100 until phase === "done". */
  pct: number;
  /** Current step label (the last started, not-yet-finished task). */
  label: string;
  /** Estimated ms remaining, or null when we have no prior timing to estimate from. */
  etaMs: number | null;
  phase: "running" | "done" | "error";
  error?: unknown;
}

/** Per-page cache of how long each task took last time, for the ETA. Injectable
 *  so tests use an in-memory store and the app uses localStorage. */
export interface TimingStore {
  get(pageId: string): Record<string, number> | null;
  set(pageId: string, timings: Record<string, number>): void;
}

/** Canonical "Why the wait?" wiki page. One source of truth so every loader's
 *  link points at the same local-first explainer. */
export const PAGE_BOOT_WHY_HREF = "/wiki/getting-started/why-pages-load";

const weightOf = (t: BootTask) => (t.weight && t.weight > 0 ? t.weight : 1);

/** True aggregate percent (0..100) given the running state. Pure. */
export function computePct(
  tasks: BootTask[],
  currentIndex: number,
  currentFrac: number,
): number {
  const total = tasks.reduce((a, t) => a + weightOf(t), 0);
  if (total <= 0) return 100;
  let acc = 0;
  for (let i = 0; i < tasks.length; i++) {
    if (i < currentIndex) acc += weightOf(tasks[i]);
    else if (i === currentIndex) acc += weightOf(tasks[i]) * Math.max(0, Math.min(1, currentFrac));
  }
  return Math.min(100, (acc / total) * 100);
}

/** Estimated ms remaining from prior per-task timings, or null if we lack a full
 *  set (first visit, or a task changed). Pure. */
export function estimateEtaMs(
  tasks: BootTask[],
  priorTimings: Record<string, number> | null,
  currentIndex: number,
  currentFrac: number,
): number | null {
  if (!priorTimings) return null;
  // Need a timing for every task, else the estimate would be misleading.
  if (!tasks.every((t) => typeof priorTimings[t.id] === "number")) return null;
  let remaining = 0;
  for (let i = currentIndex; i < tasks.length; i++) {
    const dur = priorTimings[tasks[i].id];
    remaining += i === currentIndex ? dur * (1 - Math.max(0, Math.min(1, currentFrac))) : dur;
  }
  return Math.max(0, remaining);
}

/** localStorage-backed timing store. Safe in non-browser/SSR (no-ops). */
export function createLocalTimingStore(prefix = "ros.pageboot."): TimingStore {
  const key = (pageId: string) => `${prefix}${pageId}`;
  return {
    get(pageId) {
      try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key(pageId)) : null;
        return raw ? (JSON.parse(raw) as Record<string, number>) : null;
      } catch {
        return null;
      }
    },
    set(pageId, timings) {
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(key(pageId), JSON.stringify(timings));
      } catch {
        // storage full / disabled — ETA just won't be available next time.
      }
    },
  };
}

export interface RunBootOptions {
  pageId: string;
  onUpdate: (state: BootState) => void;
  timingStore?: TimingStore;
  /** Injectable clock for tests; defaults to performance.now / Date.now. */
  now?: () => number;
}

/**
 * Run a page's boot tasks sequentially, emitting honest progress + ETA, and
 * recording per-task durations for next time. Resolves when every task is done;
 * rejects (and emits phase "error") if a task throws, leaving the caller to show
 * a retry. Tasks run in array order (most boots are dependent).
 */
export async function runBoot(tasks: BootTask[], opts: RunBootOptions): Promise<void> {
  const now = opts.now ?? (typeof performance !== "undefined" ? () => performance.now() : () => Date.now());
  const store = opts.timingStore;
  const prior = store ? store.get(opts.pageId) : null;
  const durations: Record<string, number> = {};

  const emit = (index: number, frac: number, phase: BootState["phase"], error?: unknown) => {
    opts.onUpdate({
      pct: phase === "done" ? 100 : computePct(tasks, index, frac),
      label: tasks[Math.min(index, tasks.length - 1)]?.label ?? "",
      etaMs: phase === "done" ? 0 : estimateEtaMs(tasks, prior, index, frac),
      phase,
      error,
    });
  };

  emit(0, 0, "running");
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const started = now();
    let frac = 0;
    emit(i, 0, "running");
    try {
      await task.run((f) => {
        frac = Math.max(0, Math.min(1, f));
        emit(i, frac, "running");
      });
    } catch (error) {
      emit(i, frac, "error", error);
      throw error;
    }
    durations[task.id] = now() - started;
  }
  if (store) store.set(opts.pageId, durations);
  emit(tasks.length - 1, 1, "done");
}
