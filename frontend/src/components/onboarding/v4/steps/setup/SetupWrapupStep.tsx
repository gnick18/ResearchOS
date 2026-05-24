"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import { tabsForFeaturePicks } from "@/lib/onboarding/feature-picks-tabs";
import { getNavItem } from "@/lib/nav";
import { useTourController } from "../../TourController";
import type { SetupStepProps } from "./types";

/**
 * setup-wrapup — the confirmation beat that sits between the last setup
 * question (Q7) and the in-product walkthrough (home-create-project).
 * Added by the v4 setup wrap-up step manager 2026-05-24 to materialize
 * the README + wiki's longstanding "Step 7: confirmation. Each setup
 * decision is echoed back, with an optional feature tour link before
 * 'Go to home.'" promise that previously had no implementation.
 *
 * The step is purely confirmatory. It does not write any new data: the
 * Q1-Q7 bodies already persisted everything to `feature_picks`. It only
 * READS the sidecar and renders a summary, plus two CTAs:
 *
 *   - "Take the feature tour" (secondary link, calls `controller.advance`).
 *     Advances the tour graph to the next applicable step. For a fresh
 *     user that is `home-create-project`, the start of the in-product
 *     walkthrough; gated steps are skipped via the existing step-machine
 *     filtering.
 *   - "Go to home" (primary button). Calls `controller.exitTour` to end
 *     the tour, then pushes the router to `/`. End-state same as if the
 *     user had clicked "Skip walkthrough" on any setup question, just
 *     framed as accomplishment instead of escape.
 *
 * The shell's Back / Next / Skip / Skip-walkthrough footer is HIDDEN
 * here via the descriptor's `hideFooter` flag because the body owns its
 * own CTAs. Back into Q7 is still reachable via the shell's Back button
 * being hidden (intentional: once a user reaches the wrap-up, the
 * picks are saved; revisiting Q7 by accident would be a regression
 * vector). If a future design needs a Back affordance, it can be added
 * to the body without re-introducing the shell footer.
 *
 * Why this step is modal-contained (NOT in-product): the user has not
 * yet been to the home page on a fresh install. Rendering the summary
 * over a possibly-empty surface would feel hollow. Keeping it modal
 * mirrors the Q1-Q7 chrome the user just spent five minutes inside, so
 * the moment reads as the natural conclusion of that flow.
 *
 * NO em-dashes. NO emojis. Inline SVGs only.
 */
export default function SetupWrapupStep({
  sidecar,
  setNextDisabled,
}: SetupStepProps) {
  const controller = useTourController();
  const router = useRouter();
  const picks = sidecar?.feature_picks ?? null;

  useEffect(() => {
    // The shell's Next button is hidden via the descriptor's hideFooter
    // flag, so this is informational only. Leaving it false keeps the
    // shell agnostic about whether a body wired a Next gate.
    setNextDisabled(false);
  }, [setNextDisabled]);

  // Pre-compute the visible-tab summary from the picks. The same
  // helper drives AppShell's nav so the wrap-up echoes back exactly
  // what the user will see in the top nav.
  const visibleTabHrefs = useMemo(
    () => tabsForFeaturePicks(picks) ?? [],
    [picks],
  );

  const handleTour = () => {
    controller.advance();
  };

  const handleHome = () => {
    controller.exitTour();
    try {
      router.push("/");
    } catch (err) {
      console.warn("[setup-wrapup] router.push failed", err);
    }
  };

  return (
    <div data-step-id="setup-wrapup" className="space-y-5">
      <p className="text-sm text-gray-700 leading-relaxed">
        You&apos;re all set. Here&apos;s what you picked, and what
        we&apos;ll have ready for you on the home page. You can change any
        of this later in Settings.
      </p>

      <div className="rounded-lg border border-gray-200 bg-gray-50 divide-y divide-gray-200 overflow-hidden">
        <SummaryRow
          icon={<AccountIcon />}
          label="Account type"
          value={
            picks?.account_type === "lab"
              ? "Lab (shared folder, multiple users)"
              : picks?.account_type === "solo"
                ? "Solo (just you on this account)"
                : "Not set"
          }
          settingsHref="/settings"
          settingsLabel="Change in Settings"
        />
        <SummaryRow
          icon={<TabsIcon />}
          label="Visible tabs"
          value={
            visibleTabHrefs.length > 0
              ? formatTabList(visibleTabHrefs, picks)
              : "Home only (you can enable more in Settings)"
          }
          settingsHref="/settings"
          settingsLabel="Edit in Settings"
        />
        <SummaryRow
          icon={<IntegrationsIcon />}
          label="Integrations"
          value={formatIntegrations(picks)}
          settingsHref="/settings"
          settingsLabel="Manage in Settings"
        />
        <SummaryRow
          icon={<AiHelperIcon />}
          label="AI Helper"
          value={formatAiHelper(picks?.ai_helper)}
          settingsHref="/settings"
          settingsLabel="Manage in Settings"
        />
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <button
          type="button"
          onClick={handleHome}
          data-tour-next="setup-wrapup-home"
          className="w-full px-5 py-3 text-sm font-semibold bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
        >
          Go to home
        </button>
        <button
          type="button"
          onClick={handleTour}
          data-tour-next="setup-wrapup-tour"
          className="w-full px-5 py-2.5 text-sm font-medium text-sky-700 hover:text-sky-900 hover:bg-sky-50 rounded-lg transition-colors"
        >
          Take the feature tour first
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center leading-relaxed">
        The tour walks you through every page with BeakerBot. You can
        also re-run it any time from Settings.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Render the visible tab list as a comma-joined human-readable string.
 *  Uses the NAV_ITEMS label for each href, with the account-type-aware
 *  override for `/links` (Links vs Lab Links) so the line matches what
 *  AppShell will show in the top nav. */
function formatTabList(
  hrefs: readonly string[],
  picks: FeaturePicks | null,
): string {
  const labels = hrefs
    .map((href) => {
      const nav = getNavItem(href);
      if (!nav) return null;
      // AppShell renames /links to "Links" for solo accounts and keeps
      // "Lab Links" for labs. Mirror that here so the summary matches.
      if (href === "/links" && picks?.account_type === "solo") {
        return "Links";
      }
      return nav.label;
    })
    .filter((label): label is string => label !== null);
  return labels.join(", ");
}

/** Render the integrations summary. Lists every integration the user
 *  opted into during setup; renders "None set up yet" if all three are
 *  off / maybe / undefined. Telegram and Calendar are the two
 *  integrations the setup phase asks about directly; the AI Helper is
 *  rendered separately because it has more sub-states. */
function formatIntegrations(picks: FeaturePicks | null): string {
  if (!picks) return "Not set up yet";
  const enabled: string[] = [];
  if (picks.telegram === "yes") enabled.push("Telegram image inbox");
  if (picks.calendar === "yes") enabled.push("Calendar feeds");
  if (picks.goals === "yes") enabled.push("Goal tracking");
  if (enabled.length === 0) {
    return "None set up yet (you can add them in Settings)";
  }
  return enabled.join(", ");
}

/** Render the AI Helper sizing summary. The five-state enum (full /
 *  medium / minimal / no / maybe) maps to a short, friendly line. */
function formatAiHelper(value: FeaturePicks["ai_helper"]): string {
  switch (value) {
    case "full":
      return "Full prompt (most context, biggest paste)";
    case "medium":
      return "Medium prompt (balanced size)";
    case "minimal":
      return "Minimal prompt (smallest paste)";
    case "no":
      return "Off (no AI Helper)";
    case "maybe":
      return "Skipped for now (turn on in Settings)";
    default:
      return "Skipped for now (turn on in Settings)";
  }
}

// ---------------------------------------------------------------------
// SummaryRow + inline SVG icons
// ---------------------------------------------------------------------

interface SummaryRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  settingsHref: string;
  settingsLabel: string;
}

function SummaryRow({
  icon,
  label,
  value,
  settingsHref,
  settingsLabel,
}: SummaryRowProps) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div aria-hidden className="flex-shrink-0 mt-0.5 text-sky-600">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {label}
        </p>
        <p className="text-sm text-gray-800 leading-snug mt-0.5">
          {value}
        </p>
      </div>
      <Link
        href={settingsHref}
        className="flex-shrink-0 self-center text-xs font-medium text-sky-700 hover:text-sky-900 hover:underline whitespace-nowrap"
      >
        {settingsLabel}
      </Link>
    </div>
  );
}

function AccountIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function TabsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IntegrationsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function AiHelperIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 6 0v-1a3 3 0 0 0 0-6V5a3 3 0 0 0-3-3z" />
      <path d="M5 13v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 21v-3" />
    </svg>
  );
}
