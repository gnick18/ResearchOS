"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import { tabsForFeaturePicks } from "@/lib/onboarding/feature-picks-tabs";
import { getNavItem, HOME_HREF } from "@/lib/nav";
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
 *   - "Give me a tour of my features" (primary button, calls `controller.advance`).
 *     Advances the tour graph to the next applicable step. For a fresh
 *     user that is `home-create-project`, the start of the in-product
 *     walkthrough; gated steps are skipped via the existing step-machine
 *     filtering. Default CTA because the whole point of v4 onboarding is
 *     the walkthrough of the features the user just configured; making
 *     "Go to home" the visually-dominant button (the prior default) just
 *     encouraged people to skip the tour. v4 setup wrap-up default-CTA
 *     manager 2026-05-25.
 *   - "Skip for now" (secondary link). Calls `controller.exitTour` to
 *     end the tour, then pushes the router to `/`. End-state same as if
 *     the user had clicked "Skip walkthrough" on any setup question.
 *     Quieter styling because exiting before the tour is the off-path
 *     option, not the recommended one.
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
  // what the user will see in the top nav. We then apply the same
  // account-type carve-outs AppShell layers on top of NAV_ITEMS so a
  // lab-head user sees "Lab Overview" inserted right after Home and
  // "Purchases" removed (covered by the LabPurchasesWidget on Lab
  // Overview). Without these carve-outs the wrap-up listed Purchases
  // that isn't actually in a lab-head's top nav and dropped Lab Overview
  // that is. Source of truth: AppShell's `navItemsWithOverview` memo
  // (account_type === "lab_head" branch). (panel mechanical fixes,
  // 2026-05-26)
  const visibleTabHrefs = useMemo(
    () => applyAccountTypeCarveouts(tabsForFeaturePicks(picks) ?? [], picks),
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

  // Copy-alignment manager 2026-05-26: wrap-up now offers a Back link
  // alongside the two forward CTAs so the user can re-review the prior
  // setup picks the same way they can from any other Q-step. Body owns
  // the affordance because the shell footer is hidden via
  // `hideFooter: true` on this step's descriptor.
  const handleBack = () => {
    controller.goBack();
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
          value={formatAccountType(picks)}
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
          onClick={handleTour}
          data-tour-next="setup-wrapup-tour"
          className="w-full px-5 py-3 text-sm font-semibold bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
        >
          Give me a tour of my features
        </button>
        <button
          type="button"
          onClick={handleHome}
          data-tour-next="setup-wrapup-home"
          className="w-full px-5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Skip for now, take me to home
        </button>
        <button
          type="button"
          onClick={handleBack}
          data-tour-back="setup-wrapup"
          className="self-start mt-1 text-xs font-medium text-gray-500 hover:text-gray-700 underline"
        >
          Back
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center leading-relaxed">
        The tour is tailored to the features you just turned on, with
        BeakerBot as your guide. You can re-run it any time from Settings.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Render the Account type summary. For lab accounts, the optional
 *  `lab_head` follow-up (Q1c) is surfaced as a "you are the lab head"
 *  addendum so the wrap-up echoes back the full Q1+Q1c answer. Solo
 *  accounts never see Q1c (the step-machine gates it on
 *  `account_type === "lab"`) and never carry the `lab_head` field.
 *
 *  FeaturePicks.lab_head field manager 2026-05-24: Option A wiring.
 *  The field already exists on FeaturePicks and Q1c persists it; this
 *  renderer is the missing read-side for the wrap-up confirmation beat.
 *  Option B (read account_type from `_user_settings.json` via
 *  useAccountType) was considered but rejected because Q1c's answer
 *  semantically belongs to the setup-question pile the wrap-up is
 *  echoing back, and the `_user_settings.account_type` field uses a
 *  different enum ("member" / "lab_head") than FeaturePicks.account_type
 *  ("solo" / "lab"); mixing the two on one row would muddy the source
 *  of truth. */
function formatAccountType(picks: FeaturePicks | null): string {
  if (picks?.account_type === "lab") {
    if (picks.lab_head === true) {
      return "Lab (shared folder, multiple users). You run this lab.";
    }
    if (picks.lab_head === false) {
      return "Lab (shared folder, multiple users). You are a member.";
    }
    // Q1c was skipped or never reached. Fall back to the bare lab line
    // so the row still reads cleanly.
    return "Lab (shared folder, multiple users)";
  }
  if (picks?.account_type === "solo") {
    return "Solo (just you on this account)";
  }
  return "Not set";
}

/** Apply AppShell's account-type carve-outs on top of the
 *  feature_picks-derived href list. Lab-head users get "/lab-overview"
 *  spliced in right after Home and "/purchases" filtered out (the
 *  LabPurchasesWidget on Lab Overview covers their workflow). Solo + lab
 *  member users get the picks-derived list unchanged. Mirrors the
 *  navItemsWithOverview useMemo in AppShell.tsx so the wrap-up summary
 *  matches what the user is about to see in the top nav.
 *  (panel mechanical fixes, 2026-05-26) */
function applyAccountTypeCarveouts(
  hrefs: readonly string[],
  picks: FeaturePicks | null,
): string[] {
  const isLabHead = picks?.account_type === "lab" && picks.lab_head === true;
  let next = [...hrefs];
  if (isLabHead) {
    next = next.filter((href) => href !== "/purchases");
    // Slot /lab-overview right after Home. tabsForFeaturePicks always
    // includes Home at index 0, so a splice at index 1 is safe.
    const homeIdx = next.indexOf(HOME_HREF);
    const insertAt = homeIdx >= 0 ? homeIdx + 1 : 0;
    next.splice(insertAt, 0, "/lab-overview");
  }
  return next;
}

/** Render the visible tab list as a comma-joined human-readable string.
 *  Uses the NAV_ITEMS label for each href, plus the synthetic
 *  `/lab-overview` entry (not in NAV_ITEMS but appended by AppShell for
 *  lab heads) so the line matches what AppShell will show in the top
 *  nav.
 *
 *  Copy-alignment manager 2026-05-26: the `/links` per-account-type
 *  override is gone (master called "Links" everywhere). The `picks`
 *  param stays in the signature so future account-type-aware copy can
 *  land without re-threading the wrap-up render path. */
function formatTabList(
  hrefs: readonly string[],
  picks: FeaturePicks | null,
): string {
  void picks;
  const labels = hrefs
    .map((href) => {
      // /lab-overview is not a NAV_ITEMS entry (AppShell appends it
      // dynamically for lab heads), so resolve the label here.
      if (href === "/lab-overview") return "Lab Overview";
      const nav = getNavItem(href);
      if (!nav) return null;
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
      return "Lean prompt (balanced size)";
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
