"use client";

// Laptop timer alarm (Phase 3 chunk 5). Mounted once. Watches the laptop timer
// store and, when a timer flips to done, rings: a BeakerBot eureka celebration,
// a looping Chime (WebAudio, gated on the per-device laptopAlarmMode setting and
// the browser autoplay policy), and a persistent dismiss card. Dismiss silences
// it and emits a unified dismiss so the phone's copy clears too.
//
// The visual ALWAYS plays. The sound is best-effort: browsers block audio until
// a user gesture, so an AudioContext is primed on the first interaction. If the
// page was never touched the alarm is silent but still shows.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import BeakerBotEurekaScene from "@/components/BeakerBotEurekaScene";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { readUserSettings } from "@/lib/settings/user-settings";
import {
  useLaptopTimerStore,
  formatClock,
  type LabTimer,
} from "@/lib/timers/laptop-timers";

// ── Chime (synthesized, no asset) ─────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function ensureAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function playChime(): void {
  const ctx = ensureAudio();
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  // A short C-E-G arpeggio, pleasant but attention-getting.
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.16;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TimerAlarm() {
  const { currentUser } = useFileSystem();
  const timers = useLaptopTimerStore((s) => s.timers);
  const cancel = useLaptopTimerStore((s) => s.cancel);

  // Timers we have already rung, so a reload (which loads persisted done timers)
  // never re-rings, and each timer rings once.
  const alarmedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const [queue, setQueue] = useState<LabTimer[]>([]);
  const [eurekaActive, setEurekaActive] = useState(false);

  // Prime the AudioContext on the first user gesture so a later alarm can play.
  useEffect(() => {
    const prime = () => ensureAudio();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  // Detect newly-done timers and enqueue them to ring.
  useEffect(() => {
    if (!seededRef.current) {
      timers.forEach((t) => {
        if (t.status === "done") alarmedRef.current.add(t.id);
      });
      seededRef.current = true;
      return;
    }
    const newlyDone = timers.filter(
      (t) => t.status === "done" && !alarmedRef.current.has(t.id),
    );
    if (newlyDone.length === 0) return;
    newlyDone.forEach((t) => alarmedRef.current.add(t.id));
    setQueue((q) => [...q, ...newlyDone]);
    setEurekaActive(true);
  }, [timers]);

  // Ring the chime in a loop while something is alarming, gated on the setting.
  const alarming = queue.length > 0;
  useEffect(() => {
    if (!alarming) return;
    let cancelled = false;
    let loop: ReturnType<typeof setInterval> | null = null;

    (async () => {
      if (!currentUser) return;
      let mode: "sound-visual" | "visual-only" = "sound-visual";
      try {
        mode = (await readUserSettings(currentUser)).laptopAlarmMode;
      } catch {
        // Default to the full experience.
      }
      if (cancelled || mode !== "sound-visual") return;
      playChime();
      loop = setInterval(() => playChime(), 1800);
    })();

    return () => {
      cancelled = true;
      if (loop) clearInterval(loop);
    };
  }, [alarming, currentUser]);

  if (!alarming) {
    // Keep the eureka scene mounted so its onComplete can fire even after the
    // card closes.
    return (
      <BeakerBotEurekaScene
        active={eurekaActive}
        onComplete={() => setEurekaActive(false)}
      />
    );
  }

  const current = queue[0];
  const dismiss = () => {
    // Unified dismiss: drop the timer (a phone-origin one tombstones so the
    // phone clears its copy too), then advance to the next ringing timer.
    cancel(current.id);
    setQueue((q) => q.slice(1));
  };

  return (
    <>
      <BeakerBotEurekaScene
        active={eurekaActive}
        onComplete={() => setEurekaActive(false)}
      />
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center p-5 bg-black/45 backdrop-blur-sm"
        role="alertdialog"
        aria-label="Timer finished"
      >
        <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-surface-raised ros-popup-card-shadow px-7 pt-7 pb-6 text-center">
          <div
            className="absolute inset-x-0 top-0 h-1.5"
            style={{
              background:
                "linear-gradient(90deg,#FFD2B0,#FFF1A8,#B7EBB1,#A6D2F4,#D6B5F0)",
            }}
          />
          <div className="mx-auto mb-4 mt-1 flex h-24 w-24 items-center justify-center rounded-full bg-sky-500/12">
            <Icon name="alarmClock" className="h-11 w-11 text-sky-500" />
          </div>
          <div className="text-meta font-extrabold uppercase tracking-wider text-sky-500">
            Time is up
          </div>
          <div className="mt-1 text-title font-extrabold text-foreground">
            {current.label.length > 0 ? current.label : "Lab timer"}
          </div>
          <div className="mb-5 text-meta text-foreground-muted">
            {formatClock(current.durationSec)} timer
            {current.origin === "phone" ? ", started on your phone" : ""}
            {queue.length > 1 ? ` (+${queue.length - 1} more)` : ""}
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-2xl bg-gradient-to-br from-sky-500 to-purple-600 py-3.5 text-base font-extrabold text-white"
          >
            Dismiss
          </button>
          <div className="mt-3 flex items-center justify-center gap-1.5 text-meta text-foreground-muted">
            <Icon name="phone" className="h-3.5 w-3.5" />
            Silencing here silences your phone too
          </div>
        </div>
      </div>
    </>
  );
}
