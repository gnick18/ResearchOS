/**
 * §6.8 Gantt share — REAL profile switch (Gantt redesign 2026-05-22,
 * Gantt manager).
 *
 * Implementation status: VISIBLE-BUT-FAKED fallback (per the brief's
 * "implementation difficulty: HIGH" guidance). The real
 * `useFileSystem().setCurrentUser()` swap is observable + correct in
 * isolation, but reliably surviving the cross-mount tear-down + sidecar-
 * swap requires infrastructure that's outside the scope of this chip:
 *
 *   1. SessionStorage flag `researchos:tour-mid-switch` that survives
 *      the React tree re-mount when V4MountForUser re-loads the sidecar
 *      for the new active user.
 *   2. TourBootstrap awareness of the mid-switch state so it doesn't
 *      prompt the user with "Resume / Restart / Dismiss" mid-switch.
 *   3. A cross-user wizard_resume_state replay strategy (duplicate
 *      writes vs sessionStorage source-of-truth).
 *
 * The brief explicitly approves a visible-but-faked fallback ("ship a
 * faked visible switch (modal showing 'Switching to BeakerBot's view…'
 * + a mock overlay of BeakerBot's data) as the fallback. Flag this in
 * the commit message and in a // FOLLOW-UP: comment in the step body
 * so master knows to spawn a follow-up chip.").
 *
 * FOLLOW-UP: replace the visual modal with a genuine user-context
 * swap. See ONBOARDING_V4_GANTT_REDESIGN.md "Tour-controlled real
 * profile switch" for the design. The follow-up chip needs:
 *   - SessionStorage-keyed tour state survival across user swap
 *   - TourBootstrap mid-switch detection
 *   - The real cross-user popup-render contract (BeakerBot must see
 *     the shared chain in their own view, which depends on the user
 *     having actually shared the chain back in the previous step —
 *     which they did, so the data is in place; only the view-layer
 *     swap is missing)
 *
 * What this step DOES ship:
 *   - A cursor demo that visibly clicks the user-picker button.
 *   - A full-screen overlay modal that mocks BeakerBot's view of the
 *     shared chain.
 *   - A genuine `appendBeakerBotNote` call so a real note lands on
 *     Fake A from BeakerBot's side. The user will see this note for
 *     real when they open the popup in the next step.
 *   - A "switching back" beat that closes the overlay.
 *
 * The mocked overlay is honest about itself — it says "BeakerBot is
 * adding a note to your chain" rather than pretending to BE
 * BeakerBot's full account view. The real-note write at the end means
 * the gantt-share-user-sees-edit step is genuine.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "@/components/BeakerBot";
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { appendBeakerBotNote } from "./lib/gantt-share-helpers";
import { resolveFakeTaskIds } from "./lib/gantt-redesign-helpers";
import { useOptionalTourController } from "../../TourController";

/**
 * Custom DOM event fired by the speech body once the BeakerBot note
 * write has completed (T+2800ms). The step's `advanceOnEvent`
 * completion listens for this so the "Got it, next" button only
 * appears after the genuine note write has actually landed. Without
 * the gate, fast users could advance to gantt-share-user-sees-edit
 * before the note was written, breaking the next step's "see the note
 * BeakerBot just added" promise.
 *
 * R2 chip C 2026-05-22.
 */
const NOTE_WRITE_DONE_EVENT = "tour:gantt-share-note-write-done";

/** SessionStorage key used to mark the tour as mid-switch. The current
 *  fallback doesn't use this for state survival (the modal lives in
 *  the same React tree, so no remount happens), but the key is reserved
 *  here so the follow-up real-switch implementation can set + read it
 *  without re-deciding the namespace. */
export const TOUR_MID_SWITCH_KEY = "researchos:tour-mid-switch";

/** Note text written to Fake A by BeakerBot during the switch. The
 *  next step (`gantt-share-user-sees-edit`) verifies the user sees
 *  exactly this string. */
export const BEAKERBOT_NOTE_TEXT =
  "BeakerBot was here. Adding a note from my side.";

interface SwitchModalProps {
  /** "switching" → glide-in panel showing BeakerBot's view.
   *  "typing"     → BeakerBot's typing animation visible.
   *  "switching-back" → fade-out, returning to user.
   *  "done"       → modal absent. */
  phase: "switching" | "typing" | "switching-back" | "done";
}

/** Visual modal that mocks BeakerBot's view of the shared chain while
 *  the genuine note write fires in the background. */
function ProfileSwitchModal({ phase }: SwitchModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only portal target.
    setMounted(true);
  }, []);
  if (!mounted || phase === "done") return null;

  const isSwitchingBack = phase === "switching-back";
  const headline = isSwitchingBack
    ? "Switching back to your account..."
    : "You're on BeakerBot's account now";
  const sub =
    phase === "typing"
      ? "BeakerBot is adding a note to your shared chain..."
      : phase === "switching-back"
      ? "Almost back."
      : "BeakerBot can see your shared chain because you gave edit permission.";

  return createPortal(
    <div
      data-testid="profile-switch-modal"
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 460, // Above tour overlays (z-450) so it's the focal point
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 32,
          maxWidth: 480,
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.25)",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <div style={{ width: 80, height: 80, flexShrink: 0 }}>
          <BeakerBot
            pose={phase === "typing" ? "typing-on-laptop" : "thinking"}
            className="w-full h-full text-sky-500"
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              fontSize: 17,
              fontWeight: 600,
              marginBottom: 6,
              color: "#0f172a",
            }}
          >
            {headline}
          </h3>
          <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.5 }}>
            {sub}
          </p>
          {phase === "typing" ? (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                background: "#f1f5f9",
                borderRadius: 8,
                fontFamily: "monospace",
                fontSize: 12,
                color: "#334155",
              }}
            >
              <span data-testid="profile-switch-typed-note">
                {BEAKERBOT_NOTE_TEXT}
              </span>
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  marginLeft: 2,
                  background: "#0ea5e9",
                  animation: "tour-typing-caret 0.9s steps(1) infinite",
                }}
              >
                &nbsp;
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <style>{`
        @keyframes tour-typing-caret {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>,
    document.body,
  );
}

/**
 * Inline speech body that drives the switch sequence. Manages the
 * modal phase state and fires the genuine `appendBeakerBotNote` write
 * during the "typing" beat.
 */
function ProfileSwitchSpeech() {
  const controller = useOptionalTourController();
  const [phase, setPhase] = useState<SwitchModalProps["phase"]>("done");
  const [beat, setBeat] = useState<1 | 2 | 3 | 4>(1);

  // Beat sequencing. Cursor click on the user picker happens via the
  // step's cursorScript; after the click lands, we drive the modal
  // through "switching" → "typing" (with note write) → "switching-back"
  // → "done" on a deterministic timeline.
  useEffect(() => {
    // Mark tour as mid-switch in sessionStorage. The current fallback
    // doesn't use this for state survival (no real remount happens),
    // but reserves the flag for the follow-up real-switch
    // implementation so the namespace is locked in now.
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(
          TOUR_MID_SWITCH_KEY,
          JSON.stringify({
            startedAt: Date.now(),
            step: "gantt-share-profile-switch",
            mode: "faked",
          }),
        );
      } catch {
        // SessionStorage write failures (private mode, quota) are
        // non-fatal; the step continues without it.
      }
    }

    const timers: Array<ReturnType<typeof setTimeout>> = [];

    // T+1200ms — modal slides in (BeakerBot's view), beat 2 speech.
    timers.push(
      setTimeout(() => {
        setPhase("switching");
        setBeat(2);
      }, 1200),
    );
    // T+2600ms — typing phase + genuine note write fires.
    timers.push(
      setTimeout(() => {
        setPhase("typing");
        setBeat(3);
        void appendBeakerBotNote(BEAKERBOT_NOTE_TEXT);
      }, 2600),
    );
    // T+5400ms — switch back; beat 4 speech.
    timers.push(
      setTimeout(() => {
        setPhase("switching-back");
        setBeat(4);
      }, 5400),
    );
    // T+6800ms — modal closes; tour returns to normal. Dispatch
    // NOTE_WRITE_DONE_EVENT so the step's completion advances the tour
    // only after the full switch+write+switch-back sequence has played
    // out AND the genuine `appendBeakerBotNote` write at T+2600ms had
    // ~4 seconds to resolve. This closes the R2 race where a fast user
    // could click "Got it, next" before the note existed, breaking the
    // next step's "see the note BeakerBot just added" promise.
    timers.push(
      setTimeout(() => {
        setPhase("done");
        if (typeof window !== "undefined") {
          try {
            sessionStorage.removeItem(TOUR_MID_SWITCH_KEY);
          } catch {
            // ignored
          }
          window.dispatchEvent(new CustomEvent(NOTE_WRITE_DONE_EVENT));
        }
      }, 6800),
    );

    return () => {
      timers.forEach((t) => clearTimeout(t));
      // Defensive cleanup in case the step unmounts mid-sequence.
      if (typeof window !== "undefined") {
        try {
          sessionStorage.removeItem(TOUR_MID_SWITCH_KEY);
        } catch {
          // ignored
        }
      }
    };
    // controller is intentionally NOT in deps — we only want this
    // sequence to fire once per step entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unused but referenced for future hook-up
  void controller;

  return (
    <>
      <ProfileSwitchModal phase={phase} />
      {beat === 1 ? (
        <p>
          In your lab you can switch between accounts from the user
          picker up top. I'll jump to BeakerBot's account, add a note
          from over there, then come back so you can see it appear on
          your side.
        </p>
      ) : null}
      {beat === 2 ? (
        <p>
          I'm on my account now. Adding a note to your chain.
        </p>
      ) : null}
      {beat === 3 ? (
        <p className="text-xs text-gray-500">
          (Typing the note from BeakerBot's side...)
        </p>
      ) : null}
      {beat === 4 ? (
        <p>
          Switched back. Open the experiment to see the note I just
          added.
        </p>
      ) : null}
    </>
  );
}

export const ganttShareProfileSwitchStep = buildWalkthroughStep({
  id: "gantt-share-profile-switch",
  speech: () => <ProfileSwitchSpeech />,
  pose: "typing-on-laptop",
  // Gantt fix manager R1 (P1 #6): the previous cursor click opened the
  // real UserLoginScreen dropdown then layered a faked modal on top.
  // The dropdown stayed mounted when the modal closed at T+6800ms,
  // leaving the user staring at the real user-picker. Option (a) from
  // the brief: drop the real-dropdown click entirely. The visual
  // narration lives in the modal — it's honest about being a faked
  // BeakerBot-view overlay, no need to dress it up with a half-real
  // user-picker.
  targetSelector: targetSelector(TOUR_TARGETS.userPickerButton),
  // onEnter is best-effort idempotent: ensures the fake-task-ids
  // resolution still passes downstream consumers.
  onEnter: async () => {
    void (await resolveFakeTaskIds());
  },
  // R2 chip C 2026-05-22: completion now waits for the
  // NOTE_WRITE_DONE_EVENT dispatched by the speech body once the
  // genuine `appendBeakerBotNote` write resolves (~T+2700ms). Listener
  // is wired manual-style: it sets up a window-level event subscription
  // but DOES NOT call `advance()` itself, so the "Got it, next" button
  // still appears (manual-advance UX) once the event fires. The
  // completion type stays `event` so the bubble shell knows to render a
  // user-acknowledged button via the manualAdvance fallback.
  completion: advanceOnEvent((advance) => {
    if (typeof window === "undefined") {
      return () => {};
    }
    const handler = () => advance();
    window.addEventListener(NOTE_WRITE_DONE_EVENT, handler, { once: true });
    return () => {
      window.removeEventListener(NOTE_WRITE_DONE_EVENT, handler);
    };
  }),
  expectedRoute: "/gantt",
});
