// Typed step-model API for the onboarding wizard shell.
//
// A track is an ordered list of steps. Each step carries the chrome the shell
// needs to render (label, whether Back/Skip are allowed) and the content is
// supplied by the host via a render function. The shell is content-agnostic: it
// owns navigation (next / back / skip / close) and the progress math, the steps
// own what is inside the frame.
//
// This module is pure (no React), so the navigation reducer can be unit-tested
// without rendering. The shell wraps it.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { ReactNode } from "react";

/**
 * Where the shell's persistent canonical mascot anchors for a given step. The
 * mascot is the SAME size on every step; only this anchor changes, so the shell
 * slides him between positions as the user advances rather than resizing him.
 * Defaults to "top-center".
 */
export type WizardMascotAnchor = "top-center" | "top-right" | "top-left";

/** A single step in a track. */
export interface WizardStep {
  /** Stable id for the step (used as a React key and for step lookups). */
  id: string;
  /** Short label shown in the progress indicator (e.g. "Sign in", "Handle"). */
  label: string;
  /**
   * Anchor for the shell's persistent mascot on this step. Omitting it keeps him
   * top-center. Varying it across steps makes him slide between positions.
   */
  mascotAnchor?: WizardMascotAnchor;
  /**
   * Whether this step may be skipped. The shell shows a Skip link only when
   * true. The skip rules come from the spec's per-step skip table; a step that
   * is required (sign in, handle, org name) sets this false.
   */
  skippable?: boolean;
  /**
   * Render the step body. The shell passes a controller so the body can drive
   * navigation itself (e.g. a folder picker advances on a successful connect, a
   * form's Continue button calls next()). Errors and validation live in the
   * body, not the shell.
   */
  render: (controls: WizardStepControls) => ReactNode;
}

/** A track is a named, ordered list of steps. */
export interface WizardTrack {
  /** Stable id for the track (e.g. "solo-free", "pi-create", "org-dept"). */
  id: string;
  /** Human label for the track, shown in the progress indicator header. */
  label: string;
  steps: WizardStep[];
}

/** Controls handed to each step body so it can drive navigation. */
export interface WizardStepControls {
  /** Advance to the next step (or finish if this is the last step). */
  next: () => void;
  /** Go back one step. No-op on the first step. */
  back: () => void;
  /** Skip this step (advances like next; only meaningful on skippable steps). */
  skip: () => void;
  /** Close the wizard, dropping the user to the track's safe landing state. */
  close: () => void;
  /** Zero-based index of the current step. */
  index: number;
  /** Total number of steps in the track. */
  total: number;
}

/** Pure navigation state. */
export interface WizardNavState {
  /** Zero-based index of the active step. */
  index: number;
  /** True once the user has advanced past the last step (finished). */
  done: boolean;
  /** True once the user has closed the wizard before finishing. */
  closed: boolean;
}

export type WizardNavAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "skip" }
  | { type: "close" }
  | { type: "goto"; index: number };

export function initWizardNav(): WizardNavState {
  return { index: 0, done: false, closed: false };
}

/**
 * Pure navigation reducer. `total` is the step count of the active track.
 *
 * next/skip from the last step set done=true (the host then runs the track's
 * finish handler). back is clamped at the first step (never goes negative).
 * close sets closed=true. goto clamps into [0, total-1].
 *
 * Once done or closed, the state is terminal: further actions are ignored, so a
 * double-fire (e.g. a fast double click on Continue) cannot over-advance.
 */
export function wizardNavReducer(
  state: WizardNavState,
  action: WizardNavAction,
  total: number,
): WizardNavState {
  if (state.done || state.closed) return state;

  switch (action.type) {
    case "next":
    case "skip": {
      const nextIndex = state.index + 1;
      if (nextIndex >= total) {
        return { ...state, done: true };
      }
      return { ...state, index: nextIndex };
    }
    case "back": {
      if (state.index === 0) return state;
      return { ...state, index: state.index - 1 };
    }
    case "close": {
      return { ...state, closed: true };
    }
    case "goto": {
      const clamped = Math.max(0, Math.min(total - 1, action.index));
      return { ...state, index: clamped };
    }
    default:
      return state;
  }
}

/**
 * Progress math for the indicator. Returns a 1-based current position and the
 * total, plus a boolean for whether the counter should render at all (hidden for
 * single-step tracks per the spec). Pure so it is unit-testable.
 */
export function wizardProgress(index: number, total: number): {
  current: number;
  total: number;
  showCounter: boolean;
} {
  const safeTotal = Math.max(1, total);
  const current = Math.max(1, Math.min(safeTotal, index + 1));
  return { current, total: safeTotal, showCounter: safeTotal > 1 };
}
