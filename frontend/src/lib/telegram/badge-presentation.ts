/**
 * Pure resolver for the header Telegram badge's visual presentation.
 *
 * Splits the (paired, polling-health, stale-signal) triple into a single
 * presentation record so the component file can stay focused on JSX.
 * Lives in `lib/telegram` next to `staleness.ts` because the stale
 * overlay only affects the `ok` state — the resolver is the contract
 * between the staleness pub/sub and the badge UI.
 *
 * Stale rule: when the user is paired and polling-health is the healthy
 * `ok` steady-state but the staleness signal fires, swap the emerald
 * breathing-glow dot for a flat amber dot. Yellow (not red) because the
 * polling didn't fail — the cursor just drifted and one inbound message
 * refreshes it. Other health states (`retrying`, `auth_error`,
 * `conflict`, `idle`) take precedence over the stale overlay: those
 * carry more specific recovery semantics.
 */

import type { PollingHealth } from "./telegram-runtime";

export type BadgeTone = "ok" | "warn" | "error" | "idle";

export interface BadgePresentation {
  dot: string;
  label?: string;
  tone: BadgeTone;
  /** Render the expanding-halo breathing animation around the dot.
   *  Only the healthy `ok` steady-state earns the glow — every other
   *  state (including stale) uses a flat dot so it stands out. */
  glow: boolean;
}

const HEALTH_PRESENTATION: Record<PollingHealth, BadgePresentation> = {
  ok: { dot: "bg-emerald-500", tone: "ok", glow: true },
  retrying: {
    dot: "bg-amber-400 animate-pulse",
    label: "retrying",
    tone: "warn",
    glow: false,
  },
  conflict: {
    dot: "bg-amber-400",
    label: "another tab is polling",
    tone: "warn",
    glow: false,
  },
  auth_error: {
    dot: "bg-red-500",
    label: "re-pair needed",
    tone: "error",
    glow: false,
  },
  idle: { dot: "bg-gray-300", tone: "idle", glow: false },
};

const STALE_PRESENTATION: BadgePresentation = {
  dot: "bg-amber-400",
  tone: "warn",
  glow: false,
};

export interface BadgePresentationInput {
  paired: boolean;
  health: PollingHealth;
  isStale: boolean;
}

export function resolveBadgePresentation(
  input: BadgePresentationInput,
): BadgePresentation {
  if (!input.paired) return HEALTH_PRESENTATION.idle;
  if (input.health === "ok" && input.isStale) return STALE_PRESENTATION;
  return HEALTH_PRESENTATION[input.health];
}
