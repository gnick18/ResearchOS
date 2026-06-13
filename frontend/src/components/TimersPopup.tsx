"use client";

// Timers popup (Phase 3, chunk 2). Opened from the header alarm-clock button.
// A LivingPopup over the current page with a running list, a new-timer composer
// (quick-start presets + a custom H:M:S entry), and a finished list. Mirrors the
// shipped phone timers screen (mobile/app/(tabs)/timers.tsx) in the web app's
// language. Local only here; cross-device sync + the alarm overlay land in later
// chunks. House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";

import HeaderPopover from "@/components/ui/HeaderPopover";
import { Icon } from "@/components/icons";
import { useTimersPopup } from "@/lib/ui/timers-popup-store";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import {
  readUserSettings,
  patchUserSettings,
} from "@/lib/settings/user-settings";
import {
  useLaptopTimerStore,
  remainingSec,
  formatClock,
  type LabTimer,
} from "@/lib/timers/laptop-timers";

const PRESETS: { label: string; sec: number }[] = [
  { label: "1 min", sec: 60 },
  { label: "5 min", sec: 300 },
  { label: "10 min", sec: 600 },
  { label: "30 min", sec: 1800 },
  { label: "1 hr", sec: 3600 },
];

function TimerRow({
  timer,
  now,
  onCancel,
}: {
  timer: LabTimer;
  now: number;
  onCancel: (id: string) => void;
}) {
  const running = timer.status === "running";
  const left = remainingSec(timer, now);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised shadow-sm px-3.5 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-body font-semibold text-foreground truncate">
          {timer.label.length > 0 ? timer.label : "Lab timer"}
        </div>
        {running ? (
          <div className="text-3xl font-extrabold text-sky-500 tabular-nums leading-tight">
            {formatClock(left)}
          </div>
        ) : (
          <div className="text-meta text-foreground-muted mt-0.5">
            {formatClock(timer.durationSec)} total
          </div>
        )}
        {timer.origin === "phone" ? (
          <div className="flex items-center gap-1 text-meta text-foreground-muted mt-0.5">
            <Icon name="phone" className="w-3 h-3" />
            from iPhone
          </div>
        ) : null}
      </div>
      {running ? (
        <button
          type="button"
          onClick={() => onCancel(timer.id)}
          className="text-body font-semibold text-sky-500 hover:text-sky-600 flex-shrink-0"
        >
          Cancel
        </button>
      ) : (
        <span className="text-meta font-semibold px-2.5 py-1 rounded-full bg-green-500/12 text-green-600 flex-shrink-0">
          Done
        </span>
      )}
    </div>
  );
}

function NewTimer() {
  const add = useLaptopTimerStore((s) => s.add);
  const [h, setH] = useState("");
  const [m, setM] = useState("");
  const [s, setS] = useState("");

  const total =
    (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);

  const start = () => {
    if (total <= 0) return;
    add("", total);
    setH("");
    setM("");
    setS("");
  };

  const field = (
    value: string,
    set: (v: string) => void,
    label: string,
    max: number,
  ) => (
    <div className="flex-1">
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder="00"
        aria-label={label}
        className="w-full text-center text-2xl font-extrabold text-sky-500 tabular-nums bg-surface-raised border border-border rounded-lg py-2 focus:outline-none focus:border-sky-500"
      />
      <div className="text-center text-[10px] font-semibold tracking-wide text-foreground-muted mt-1">
        {label}
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl border border-border bg-surface-sunken p-3.5">
      <div className="text-body font-extrabold text-foreground mb-3">
        New timer
      </div>

      <div className="text-[10px] font-bold tracking-wide text-foreground-muted mb-2">
        QUICK START
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {PRESETS.map((p) => (
          <button
            key={p.sec}
            type="button"
            onClick={() => add("", p.sec)}
            className="text-body font-bold text-sky-500 bg-surface-raised border border-border rounded-full px-3.5 py-1.5 hover:bg-brand-action/10"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="text-[10px] font-bold tracking-wide text-foreground-muted mb-2">
        OR SET A CUSTOM TIME
      </div>
      <div className="flex items-end gap-2">
        {field(h, setH, "hours", 99)}
        {field(m, setM, "min", 59)}
        {field(s, setS, "sec", 59)}
        <button
          type="button"
          onClick={start}
          disabled={total <= 0}
          className="text-body font-extrabold text-white rounded-lg px-4 py-2.5 bg-gradient-to-br from-sky-500 to-purple-600 disabled:opacity-40 disabled:cursor-default self-stretch"
        >
          Start
        </button>
      </div>
    </div>
  );
}

// Per-device laptop alarm setting (Phase 3 chunk 6). Reads + writes
// laptopAlarmMode. The phone keeps its own sound/vibration settings.
function AlarmModeSetting() {
  const { currentUser } = useFileSystem();
  const [mode, setMode] = useState<"sound-visual" | "visual-only">(
    "sound-visual",
  );

  useEffect(() => {
    let active = true;
    if (!currentUser) return;
    void readUserSettings(currentUser).then((s) => {
      if (active) setMode(s.laptopAlarmMode);
    });
    return () => {
      active = false;
    };
  }, [currentUser]);

  const choose = (next: "sound-visual" | "visual-only") => {
    setMode(next);
    if (currentUser) {
      void patchUserSettings(currentUser, { laptopAlarmMode: next });
    }
  };

  const opt = (
    value: "sound-visual" | "visual-only",
    icon: "alarmClock" | "eye",
    label: string,
  ) => {
    const on = mode === value;
    return (
      <button
        type="button"
        onClick={() => choose(value)}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-meta font-semibold transition-colors ${
          on
            ? "bg-sky-500 text-white"
            : "bg-surface-raised text-foreground-muted hover:text-foreground"
        }`}
      >
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label}
      </button>
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-sunken p-3.5">
      <div className="text-body font-semibold text-foreground">Laptop alarm</div>
      <div className="text-meta text-foreground-muted mb-2.5">
        How this laptop alerts when a timer finishes. Your phone keeps its own
        sound settings.
      </div>
      <div className="flex gap-2">
        {opt("sound-visual", "alarmClock", "Sound + visual")}
        {opt("visual-only", "eye", "Visual only")}
      </div>
    </div>
  );
}

export default function TimersPopup() {
  const isOpen = useTimersPopup((s) => s.isOpen);
  const origin = useTimersPopup((s) => s.origin);
  const close = useTimersPopup((s) => s.close);

  const timers = useLaptopTimerStore((s) => s.timers);
  const now = useLaptopTimerStore((s) => s.now);
  const cancel = useLaptopTimerStore((s) => s.cancel);
  const clearFinished = useLaptopTimerStore((s) => s.clearFinished);

  const running = timers
    .filter((t) => t.status === "running")
    .sort((a, b) => b.startedAt - a.startedAt);
  const finished = timers
    .filter((t) => t.status !== "running")
    .sort((a, b) => b.endsAt - a.endsAt);

  return (
    <HeaderPopover
      open={isOpen}
      origin={origin}
      onClose={close}
      label="Timers"
      widthClassName="max-w-sm"
    >
        <div className="flex items-center gap-2 px-5 pt-5 pb-3">
          <Icon name="alarmClock" className="w-5 h-5 text-sky-500" />
          <h2 className="text-title font-semibold text-foreground">Timers</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="ml-auto p-1.5 rounded-lg text-foreground-muted hover:bg-surface-sunken"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 space-y-2.5">
          {running.length > 0 ? (
            <>
              <div className="text-[11px] font-bold tracking-wide text-foreground-muted uppercase pt-1">
                Running
              </div>
              {running.map((t) => (
                <TimerRow key={t.id} timer={t} now={now} onCancel={cancel} />
              ))}
            </>
          ) : null}

          <NewTimer />

          {finished.length > 0 ? (
            <>
              <div className="flex items-center text-[11px] font-bold tracking-wide text-foreground-muted uppercase pt-1">
                Finished
                <button
                  type="button"
                  onClick={clearFinished}
                  className="ml-auto text-sky-500 font-bold normal-case tracking-normal hover:text-sky-600"
                >
                  Clear
                </button>
              </div>
              {finished.map((t) => (
                <TimerRow key={t.id} timer={t} now={now} onCancel={cancel} />
              ))}
            </>
          ) : null}

          <AlarmModeSetting />
        </div>
    </HeaderPopover>
  );
}
