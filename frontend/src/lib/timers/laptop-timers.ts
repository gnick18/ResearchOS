"use client";

// Laptop lab timers (Phase 3, the net-new laptop half of the notebook
// integrations). Start a countdown on the laptop, watch it tick down, and get
// the alarm overlay when it fires. The phone half already shipped
// (mobile/lib/timers.ts); this mirrors its model in the web app and adds the
// origin field the cross-device sync needs.
//
// Persistence is localStorage, NOT the data folder and NOT collab. Timers are
// ephemeral, per-device bench tools. The absolute endsAt survives a refresh.
//
// A single module-level 1s tick drives every countdown re-render and flips
// elapsed timers to done. It no-ops when nothing is running, so a closed panel
// with no timers costs nothing.
//
// Sync (chunks 3-6) layers on top: the store also ingests phone timers from the
// "timers" snapshot and applies phone create/dismiss commands. See
// docs/proposals/MOBILE_TIMER_SYNC_PHASE3.md. House style: no em-dashes, no
// emojis, no mid-sentence colons.

import { create } from "zustand";

const STORAGE_KEY = "researchos.laptop-timers.v1";

export type TimerStatus = "running" | "done";

export interface LabTimer {
  /** Globally unique, origin-prefixed (lap_ here, phn_ for phone timers). */
  id: string;
  /** Optional label the user typed. Empty string when none was given. */
  label: string;
  /** Total duration in seconds. */
  durationSec: number;
  /** Epoch ms when the timer started. */
  startedAt: number;
  /** Epoch ms when it should finish (startedAt + durationSec * 1000). The
   *  absolute end time is what keeps both devices in lockstep with no drift. */
  endsAt: number;
  status: TimerStatus;
  /** Which device created it. "phone" timers are mirrored in from the sync. */
  origin: "laptop" | "phone";
}

// Per-process counter so two timers made in the same millisecond still get
// distinct ids. Unique within a run, the timestamp prefix handles cross-run.
let idCounter = 0;

function makeId(): string {
  idCounter += 1;
  return `lap_${Date.now().toString(36)}_${idCounter}`;
}

function isStatus(v: unknown): v is TimerStatus {
  return v === "running" || v === "done";
}

function isTimer(v: unknown): v is LabTimer {
  if (!v || typeof v !== "object") return false;
  const t = v as LabTimer;
  return (
    typeof t.id === "string" &&
    typeof t.label === "string" &&
    typeof t.durationSec === "number" &&
    typeof t.startedAt === "number" &&
    typeof t.endsAt === "number" &&
    isStatus(t.status) &&
    (t.origin === "laptop" || t.origin === "phone")
  );
}

function load(): LabTimer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTimer);
  } catch {
    return [];
  }
}

function save(timers: LabTimer[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
  } catch {
    // Quota or privacy mode. The in-memory list still works for this session.
  }
}

// Flip any running timer whose endsAt has passed to done. Returns the next list
// plus whether anything changed, so the tick can skip a needless write.
function reconcile(
  timers: LabTimer[],
  now: number,
): { next: LabTimer[]; changed: boolean } {
  let changed = false;
  const next = timers.map((t) => {
    if (t.status === "running" && now >= t.endsAt) {
      changed = true;
      return { ...t, status: "done" as const };
    }
    return t;
  });
  return { next, changed };
}

interface TimerState {
  timers: LabTimer[];
  /** Bumped every second by the tick so live countdowns re-render. */
  now: number;
  /** Start a laptop timer. Returns the created row. */
  add: (label: string, durationSec: number) => LabTimer;
  /** Cancel (remove) a timer by id. A no-op if it is already gone. */
  cancel: (id: string) => void;
  /** Drop every finished timer, keeping the running ones. */
  clearFinished: () => void;
  /** Internal 1s tick. Updates now + flips elapsed timers to done. */
  _tick: () => void;
}

export const useLaptopTimerStore = create<TimerState>((set, get) => ({
  timers: load(),
  now: typeof window === "undefined" ? 0 : Date.now(),

  add: (label, durationSec) => {
    const dur = Math.max(1, Math.round(durationSec));
    const startedAt = Date.now();
    const timer: LabTimer = {
      id: makeId(),
      label: label.trim(),
      durationSec: dur,
      startedAt,
      endsAt: startedAt + dur * 1000,
      status: "running",
      origin: "laptop",
    };
    // Newest first so the freshest timer sits at the top of the list.
    const next = [timer, ...get().timers];
    save(next);
    set({ timers: next });
    return timer;
  },

  cancel: (id) => {
    const next = get().timers.filter((t) => t.id !== id);
    save(next);
    set({ timers: next });
  },

  clearFinished: () => {
    const next = get().timers.filter((t) => t.status === "running");
    save(next);
    set({ timers: next });
  },

  _tick: () => {
    const { timers } = get();
    // Nothing running means no countdown to advance and nothing to flip, so
    // skip the re-render entirely.
    if (!timers.some((t) => t.status === "running")) return;
    const now = Date.now();
    const { next, changed } = reconcile(timers, now);
    if (changed) save(next);
    set({ now, timers: changed ? next : timers });
  },
}));

// One shared interval for the whole app, started at module load on the client.
// _tick no-ops when nothing is running, so this is free while idle.
if (typeof window !== "undefined") {
  window.setInterval(() => useLaptopTimerStore.getState()._tick(), 1000);
}

// ── Selectors ───────────────────────────────────────────────────────────────

/** Count of running timers, for the header button badge. */
export function useRunningTimerCount(): number {
  return useLaptopTimerStore((s) =>
    s.timers.reduce((n, t) => (t.status === "running" ? n + 1 : n), 0),
  );
}

/** Seconds left on a timer, clamped at zero. Recomputed against the store now. */
export function remainingSec(timer: LabTimer, now: number): number {
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

/** Render seconds as H:MM:SS when an hour or more, else MM:SS. Mirrors the
 *  phone's formatClock so both devices read the same. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}
