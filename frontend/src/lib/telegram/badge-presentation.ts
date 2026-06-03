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
 * refreshes it. Other health states (`standby`, `retrying`, `auth_error`,
 * `conflict`, `idle`) take precedence over the stale overlay: those
 * carry more specific recovery semantics.
 *
 * Standby is the calm "another open tab is the active poller" state. Multiple
 * tabs are no longer a problem to warn about (one stable leader polls and the
 * inbound image lands in the shared local data every tab reads), so standby is
 * a neutral gray, not an amber warning — purely informational, no action
 * required. The user can click "Use this tab" in the badge to take over.
 */

import type { PollingHealth } from "./telegram-runtime";

export type BadgeTone = "ok" | "warn" | "error" | "idle" | "standby";

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
  standby: {
    // Neutral, not a warning: another open tab is handling Telegram and the
    // result lands in shared local data anyway, so there is nothing to fix.
    dot: "bg-gray-400",
    label: "another tab",
    tone: "standby",
    glow: false,
  },
  retrying: {
    dot: "bg-amber-400 animate-pulse",
    label: "retrying",
    tone: "warn",
    glow: false,
  },
  conflict: {
    // A 409 now means a genuinely separate client (another browser profile or
    // device), since our own tabs coordinate via the standby lock and never
    // double-poll. Brief overlaps during a leader handoff also self-heal.
    dot: "bg-amber-400",
    label: "another client is using this bot",
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
