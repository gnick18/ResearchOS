"use client";

import Link from "@/components/FixtureLink";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import DailyTasksSidebar from "./DailyTasksSidebar";
import CalendarSidebar from "./CalendarSidebar";
import CustomizableSidebar from "./lab-overview/CustomizableSidebar";
import TelegramStatusBadge from "./TelegramStatusBadge";
import InboxBadge from "./InboxBadge";
import InboxToast from "./InboxToast";
import NoteDeleteUndoToast from "./NoteDeleteUndoToast";
import NotificationBadge from "./NotificationBadge";
import ReminderRunner from "./ReminderRunner";
import TelegramRecoveryPrompt from "./TelegramRecoveryPrompt";
import TelegramEncryptedRecoveryPrompt from "./TelegramEncryptedRecoveryPrompt";
import IdlePasswordWipe from "./IdlePasswordWipe";
import Tooltip from "./Tooltip";
import UserAvatar from "./UserAvatar";
import FeedbackButton from "./FeedbackButton";
import BetaDonationButton from "./BetaDonationButton";
import DevTestNotificationButton from "./DevTestNotificationButton";
import DevDemoToggleButton from "./DevDemoToggleButton";
import DevBeakerBotGalleryButton from "./DevBeakerBotGalleryButton";
import DevForceWalkthroughButton from "./DevForceWalkthroughButton";
import DataSetupScreen from "./DataSetupScreen";
import UserLoginScreen from "./UserLoginScreen";
import FeedbackModal from "./FeedbackModal";
import BeakerBot from "./BeakerBot";
import StreakBadge from "./StreakBadge";
import { installStreakActivityTracking } from "@/lib/streak/streak-activity-bootstrap";
import { NAV_ITEMS, HOME_HREF } from "@/lib/nav";
import { HELP_HREF, appRouteToWikiRoute } from "@/lib/wiki/nav";
import { useAppStore } from "@/lib/store";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useUserColors } from "@/hooks/useUserColor";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import { useLateNightCoffeeTrigger } from "@/hooks/useLateNightCoffeeTrigger";
import { useFeaturePicks } from "@/hooks/useFeaturePicks";
import { useAccountType } from "@/hooks/useAccountType";
import { deriveVisibleTabs } from "@/lib/onboarding/feature-picks-tabs";
import { headerGradient } from "@/lib/colors";
import { useOptionalTourController } from "@/components/onboarding/v4/TourController";
import EditSessionBanner from "@/components/EditSessionBanner";
import EditSessionTopNavChip from "@/components/EditSessionTopNavChip";

const SETTINGS_HREF = "/settings";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const visibleTabs = useAppStore((s) => s.visibleTabs);
  const coloredHeader = useAppStore((s) => s.coloredHeader);
  // PI Home migration (pi-home-migration, 2026-05-29): lab-head opt-back-in
  // for the Home tab. Read from the store so a Settings flip reflects live.
  const showHomeForLabHead = useAppStore((s) => s.showHomeForLabHead);
  const { currentUser } = useFileSystem();
  const userColors = useUserColors(currentUser ?? "");
  const baseColor = userColors.primary;
  // Onboarding v3 §10: feature_picks is the primary tab-visibility
  // source. `deriveVisibleTabs` returns settings.visibleTabs as-is when
  // picks are null (existing-user invariant L1/L22) and otherwise lets
  // settings additionally hide — but not unhide — relative to picks.
  // See `frontend/src/lib/onboarding/feature-picks-tabs.ts` for the
  // full contract + Settings UI carve-out note. `undefined` (loading)
  // is treated the same as `null` so first-paint never flickers.
  const featurePicks = useFeaturePicks(currentUser);
  const effectiveVisibleTabs = useMemo(
    () => deriveVisibleTabs(featurePicks ?? null, visibleTabs),
    [featurePicks, visibleTabs],
  );

  // Floating-cluster state lives in AppShell so the cluster is available
  // on every AppShell-wrapped route — no per-page duplication.
  const [showDataSetup, setShowDataSetup] = useState(false);
  const [showUserSwitch, setShowUserSwitch] = useState(false);

  // Phase S2 bootstrap (Streak-and-Milestones, see proposal §4.2 / §5).
  // `installStreakActivityTracking` is idempotent — it registers the
  // file-write observer + beforeunload flusher exactly once even when
  // AppShell remounts (route changes don't unmount AppShell on this
  // app, but a future provider-stack tweak could). Mounting from the
  // shell rather than from the provider stack keeps the bootstrap in
  // the same surface that hosts the badge: any code path that renders
  // the AppShell gets streak tracking. Pre-login / data-setup screens
  // that don't render AppShell don't tick streaks, which matches the
  // "no active user, no tracking" contract.
  useEffect(() => {
    installStreakActivityTracking();
  }, []);
  // Late-night coffee BeakerBot trigger: fires the CoffeeRefill scene
  // at most once per crossed hour while local time is in [23, 0, 1, 2].
  // Mounted at AppShell (not Providers) so it only runs once the user
  // is past the login screen — pre-login surfaces aren't "work" worth
  // an easter egg. TODO: gate on a global "animations disabled" pref
  // when one lands (today only `prefers-reduced-motion` is honored,
  // inside the scene component itself).
  useLateNightCoffeeTrigger();
  const {
    showBugReport,
    showErrorToast,
    currentError,
    openBugReport,
    closeBugReport,
    reportCurrentError,
    dismissErrorToast,
  } = useErrorReporting();

  // The `?` help button routes to the wiki page that documents whatever
  // view the user is currently looking at, and stashes the return path
  // so the wiki's "Back to app" button can drop them back exactly where
  // they were rather than the app home.
  const helpHref = useMemo(() => {
    const path = pathname ?? "/";
    const wikiPath = appRouteToWikiRoute(path);
    const qs = searchParams?.toString();
    const returnPath = path + (qs ? `?${qs}` : "");
    return `${wikiPath}?return=${encodeURIComponent(returnPath)}`;
  }, [pathname, searchParams]);

  // Lab Head Phase 1 (lab head Phase 1 manager, 2026-05-23): append a
  // "Lab Inbox" nav entry when the active user has `settings.account_type
  // === "lab_head"`. The entry is account-type-gated rather than
  // feature-picks-gated because being a PI is a per-user role, not a
  // workspace shape — multiple users in the same lab can hold lab_head
  // (co-PIs). `useAccountType` returns `undefined` while the settings
  // read is in flight; we treat that the same as "not lab_head" so the
  // entry never flickers in for a regular member on first paint.
  //
  // Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): also show
  // the tab for ordinary lab members in lab-mode workspaces, so they can
  // see PI announcements. Solo accounts (feature_picks.account_type ===
  // "solo") have no lab to belong to and never get the tab. The composer
  // + metrics gate themselves internally on account_type === "lab_head".
  //
  // Lab Overview rename (lab overview rename manager, 2026-05-23):
  // promote the entry from the right-edge of the top-nav into the
  // second slot (immediately right of Home) since the surface now hosts
  // announcements + comments + metrics + roster + audit notices and is
  // the primary lab-mode landing surface alongside Home. The label
  // changes from "Lab Inbox" to "Lab Overview"; the route directory
  // moved to /lab-overview (legacy /lab-inbox redirects).
  //
  // Home canvas migration (Home canvas migration manager, 2026-05-23):
  // /lab-overview is retired for lab MEMBERS — the same announcements
  // + comments + lab-activity signals now live on the Home page via
  // the new customizable home canvas. Lab heads keep /lab-overview
  // as the PI dashboard. The nav entry is therefore lab-head-only
  // post-migration; members never see it. (The /lab-overview route
  // itself still exists and the page-level guard redirects members
  // to "/" if they navigate there directly.) Solo accounts continue
  // to never see the tab.
  const accountType = useAccountType(currentUser ?? null);
  // isLabWorkspace was previously used to surface /lab-overview for
  // lab MEMBERS (so they could see PI announcements). Kept as a
  // variable in case a future chip needs to gate something else by
  // workspace shape; the underscore-prefixed alias signals "computed
  // but intentionally unused in the current gate".
  const _isLabWorkspace = featurePicks?.account_type === "lab";
  void _isLabWorkspace;
  const showLabOverview = accountType === "lab_head";

  // PI Home migration (pi-home-migration, 2026-05-29): for lab_head (PI)
  // accounts the Home page duplicates Lab Overview (which already surfaces
  // announcements + comments + lab-activity + metrics via its widgets), so
  // the Home top-nav tab is HIDDEN by default. The PI can opt back in via
  // Settings → Lab Mode → PI → "Show Home page" (settings.showHomeForLabHead
  // / store.showHomeForLabHead).
  //
  // Members are unaffected — Home is always shown for them. The Home ROUTE
  // ("/") is never removed: hiding the tab only drops the nav entry. Direct
  // navigation to "/" (including the v4 onboarding walkthrough, which pushes
  // routes via the Next router rather than clicking the tab) keeps working
  // for everyone, hidden tab or not.
  //
  // `accountType === undefined` (settings read in flight) is treated the
  // same as "not lab_head" → Home stays shown, so the tab never flickers
  // OUT for a member on first paint. The worst case for a PI is a one-frame
  // flash of the Home tab before the read resolves, which is the safe
  // direction (a guaranteed-reachable tab, never a missing one).
  const showHomeTab = accountType !== "lab_head" || showHomeForLabHead;

  // Home is normally shown so the user has a guaranteed safe landing tab even
  // if they hide everything else (or if Settings was wiped). The lab-head
  // Home migration above is the sole exception. Settings itself is rendered
  // as a gear icon, never as part of NAV_ITEMS.
  const filtered = NAV_ITEMS.filter((item) => {
    if (item.href === HOME_HREF) return showHomeTab;
    return effectiveVisibleTabs.includes(item.href);
  });
  // Widget catalog cleanup (widget catalog cleanup manager, 2026-05-23):
  // for lab_head accounts the /purchases top-nav entry is hidden because
  // the LabPurchasesWidget on Lab Overview now covers their workflow
  // (pending approvals + recent purchases + funding rollup). The route
  // itself stays alive, so a lab head who types /purchases directly still
  // gets the full page, and members keep the nav entry unchanged.
  const navItemsWithOverview = useMemo(() => {
    let next = [...filtered];
    if (accountType === "lab_head") {
      next = next.filter((i) => i.href !== "/purchases");
    }
    if (showLabOverview) {
      // Slot the entry right after Home. When the Home tab is shown
      // (PI opted back in via showHomeForLabHead, or a member), Home is
      // at index 0 of `filtered` and Lab Overview lands at index 1. When
      // the Home tab is hidden (the PI default post-migration), homeIdx
      // is -1 and Lab Overview becomes the leftmost tab — the intended
      // primary landing surface for a PI.
      const homeIdx = next.findIndex((item) => item.href === HOME_HREF);
      const insertAt = homeIdx >= 0 ? homeIdx + 1 : 0;
      next.splice(insertAt, 0, { href: "/lab-overview", label: "Lab Overview" });
    }
    return next;
  }, [filtered, showLabOverview, accountType]);

  // Onboarding v4 L23: while the in-product walkthrough is active, the
  // top-nav tabs are visually disabled + onClick-suppressed so the user
  // can't navigate away from the step's anchor. BeakerBot's cursor uses
  // `useRouter().push()` for programmatic navigation, which bypasses the
  // DOM click event and so still works under the gate. `useOptionalTourController`
  // returns `null` when the provider isn't mounted (the production state
  // until P4+P11 land), so this is a strict no-op until the tour
  // controller activates.
  const tourController = useOptionalTourController();
  const navDisabledByTour =
    tourController?.tourMode === "in-product-walkthrough" &&
    !tourController.paused;

  // Header is tinted only when (a) a user is signed in, AND (b) the user
  // has opted into a colored header in Settings → Profile. Either off →
  // the classic white header. On the tinted variant, every interactive
  // element lives inside a floating white pill so text never sits
  // directly on the gradient.
  //
  // Stop selection: when the user has opted into a 2-color gradient
  // (`color_secondary` set) we render those two stops directly so the
  // header matches the avatar exactly. Otherwise we derive a darker,
  // deeper gradient from the single primary color via `headerGradient()`
  // — the same behavior pre-gradient users get today.
  const [stop1, stop2] = userColors.secondary
    ? [baseColor, userColors.secondary]
    : headerGradient(baseColor);
  const tinted = !!currentUser && coloredHeader;
  const headerStyle = tinted
    ? { background: `linear-gradient(to right, ${stop1}, ${stop2})` }
    : undefined;

  return (
    // `data-app-shell-mounted` is the static DOM marker the v4 tour
    // bootstrap uses to detect whether the underlying app rendered
    // (vs Next.js 404 fallback, error boundary, pre-login screen, etc).
    // Onboarding v4 P12 follow-up: when Grant restarts the dev server
    // and the root route compiles into a 404, the v4 Resume modal
    // still portals onto document.body but `controller.start` + the
    // expectedRoute push silently no-op because there is no AppShell
    // to render the next step into. TourBootstrap queries for this
    // attribute on Resume; if it's missing it hard-reloads the target
    // route instead of soft-locking the user on the 404. Keep this
    // static (not state-derived) so it is present immediately on first
    // paint — the selector must resolve synchronously from the very
    // first render.
    <div data-app-shell-mounted className="h-screen flex flex-col bg-gray-50">
      <TelegramRecoveryPrompt />
      <TelegramEncryptedRecoveryPrompt />
      <IdlePasswordWipe />
      {/* Header */}
      <header
        className={`px-4 py-2.5 flex items-center gap-2 ${
          tinted ? "shadow-sm" : "bg-white border-b border-gray-200"
        }`}
        style={headerStyle}
      >
        <PillWrap on={tinted}>
          <div className="flex items-center gap-1.5 leading-none">
            {/* Small static BeakerBot brand-mark accent. No animation;
                the idle bob is reserved for the onboarding wizard.
                Click triggers the heart easter egg (the default since
                2026-05-25). */}
            <BeakerBot
              pose="idle"
              ariaLabel="ResearchOS BeakerBot logo"
              className="w-6 h-6 text-sky-500 shrink-0 block"
              easterEgg="heart"
            />
            {/* Streak badge sits between brand mark and wordmark per
                proposal §6.1. Hidden when current_count is 0, when the
                user has disabled streaks in Settings, or pre-login. */}
            <StreakBadge username={currentUser} />
            <h1 className="text-base font-bold text-gray-900 tracking-tight leading-none">
              ResearchOS
            </h1>
          </div>
        </PillWrap>

        {/* Navigation */}
        <nav
          className="flex items-center gap-1"
          data-tour-nav-disabled={navDisabledByTour ? "true" : undefined}
        >
          {navItemsWithOverview.map((item) => {
            const isActive = pathname === item.href;
            // Onboarding v4 §6.12+ walkthrough anchors. Each top-nav
            // item gets a `data-tour-target` keyed off its route
            // (purchases-tab, calendar-tab, etc.) so cursor demos can
            // hover over it without depending on label text. New
            // routes flow through here automatically.
            const tourTarget =
              item.href === HOME_HREF
                ? "home-nav-tab"
                : item.href === "/purchases"
                  ? "purchases-tab"
                  : item.href === "/calendar"
                    ? "calendar-tab"
                    : item.href === "/links"
                      ? "lab-links-nav-tab"
                      : item.href === "/lab-overview"
                        ? "lab-overview-nav-tab"
                        : undefined;
            // Copy-alignment manager 2026-05-26: tab now reads "Links"
            // for every account type (formerly "Lab Links" for lab
            // accounts). The label sits on NAV_ITEMS now, so the
            // account-type override here is gone. Visibility gate
            // (`picks.links === "yes"`) still lives in deriveVisibleTabs.
            const displayLabel = item.label;
            // Onboarding v4 L23: when an in-product walkthrough is
            // running, render each nav-item as a non-Link button that
            // visually grays out + suppresses click. Cursor-driven
            // programmatic navigation (via Next router) still works,
            // since it bypasses the DOM click event entirely.
            if (navDisabledByTour) {
              // Keep the active-tab indicator even when nav clicks are
              // disabled during a walkthrough. Grant flagged that the
              // current route was visually indistinguishable from the
              // others while the cursor was driving, so the user had no
              // anchor for "where am I." Active stays full-opacity with
              // its normal selected styling; inactive dims to opacity-50.
              const inactiveStyle = tinted
                ? "px-3 py-1.5 text-sm rounded-full shadow-sm bg-white/75 text-gray-700 opacity-50"
                : "px-3 py-1.5 text-sm rounded-lg text-gray-500 opacity-50";
              const activeStyle = tinted
                ? "px-3 py-1.5 text-sm rounded-full shadow-sm bg-white text-gray-900 font-medium"
                : "px-3 py-1.5 text-sm rounded-lg bg-blue-50 text-blue-700 font-medium";
              return (
                <button
                  key={item.href}
                  type="button"
                  disabled
                  aria-disabled="true"
                  aria-current={isActive ? "page" : undefined}
                  data-tour-nav-item={item.href}
                  data-tour-target={tourTarget}
                  className={`${isActive ? activeStyle : inactiveStyle} transition-colors cursor-not-allowed`}
                  onClick={(e) => {
                    // Defensive: <button disabled> already no-ops click in
                    // the browser, but a synthetic-event test or a future
                    // refactor that swaps the element off `disabled` would
                    // start firing onClick. preventDefault + stopPropagation
                    // make the gate explicit either way.
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  {displayLabel}
                </button>
              );
            }
            if (tinted) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-tour-target={tourTarget}
                  className={`px-3 py-1.5 text-sm rounded-full transition-colors shadow-sm ${
                    isActive
                      ? "bg-white text-gray-900 font-medium"
                      : "bg-white/75 text-gray-700 hover:bg-white"
                  }`}
                >
                  {displayLabel}
                </Link>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                data-tour-target={tourTarget}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {displayLabel}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          {/* Lab head UX polish manager Bug 2 (2026-05-24): persistent
              countdown chip for an active lab-head edit session. Renders
              nothing when no session is active. Placed first in the badge
              cluster so the amber chip is the most prominent thing once
              the PI unlocks — they can't miss it from any page. */}
          <EditSessionTopNavChip />
          <NotificationBadge pill={tinted} />
          <InboxBadge />
          <TelegramStatusBadge />
          <Tooltip label="Help & documentation" placement="bottom">
          <Link
            href={helpHref}
            aria-label="Open the ResearchOS wiki"
            data-tour-target="wiki-nav-tab"
            className={`p-1.5 rounded-full transition-colors ${
              tinted
                ? pathname?.startsWith(HELP_HREF)
                  ? "bg-white text-gray-900 shadow-sm"
                  : "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
                : pathname?.startsWith(HELP_HREF)
                ? "bg-blue-50 text-blue-700"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </Link>
          </Tooltip>
          {/* VCP R1 trash MVP notes (2026-05-26): small Settings-area
              trash-can link. Lives between Help and Settings so it's
              easy to reach but not part of the main NAV_ITEMS strip
              (per the proposal — trash is admin-area, not first-class
              navigation). The icon stays neutral grey; restore /
              permanent-delete affordances live on the route itself. */}
          <Tooltip label="Trash" placement="bottom">
            <Link
              href="/trash"
              aria-label="Open trash"
              className={`p-1.5 rounded-full transition-colors ${
                tinted
                  ? pathname === "/trash"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
                  : pathname === "/trash"
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </Link>
          </Tooltip>
          <Tooltip label="Account & app settings" placement="bottom">
          {/* Onboarding v4 L23 (break-bot B P1-2): the Settings gear icon
              must follow the same gate as the top-nav tabs. Without this,
              a mid-walkthrough click on the gear did a soft Next.js nav
              to /settings, the spotlight went dark, and the tour parked.
              The Help / `?` icon next to it is intentionally NOT gated —
              the wiki-pointer cluster step 3 wants the user to click it.
              Visual styling mirrors the top-nav disabled treatment:
              opacity-50 + cursor-not-allowed, no hover affordance. */}
          {navDisabledByTour ? (
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label="Account & app settings (disabled during walkthrough)"
              data-tour-nav-item={SETTINGS_HREF}
              className={`p-1.5 rounded-full transition-colors cursor-not-allowed opacity-50 ${
                tinted
                  ? "bg-white/75 text-gray-700"
                  : "text-gray-500"
              }`}
              onClick={(e) => {
                // Defensive: <button disabled> already no-ops in the
                // browser, but a synthetic-event test or a future
                // refactor swapping off `disabled` would start firing
                // onClick. preventDefault + stopPropagation make the
                // gate explicit either way (matches top-nav pattern).
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          ) : (
            <Link
              href={SETTINGS_HREF}
              className={`p-1.5 rounded-full transition-colors ${
                tinted
                  ? pathname === SETTINGS_HREF
                    ? "bg-white text-gray-900 shadow-sm"
                    : "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
                  : pathname === SETTINGS_HREF
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-transform duration-300 group-hover:rotate-90"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
          )}
          </Tooltip>
        </div>
      </header>

      {/* PI Phase 5 (PI Phase 5 manager, 2026-05-23): global
          edit-session banner. Visible across every route while a session
          is unlocked so the PI sees the countdown after navigating away
          from the record popup they unlocked on (decision #4 — session
          survives navigation). Renders nothing when no session is
          active; no scoping (the popup-level banners further refine to
          the active record). */}
      <EditSessionBanner />

      {/* Main content with route-specific sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {pathname === "/calendar" ? (
          <CalendarSidebar />
        ) : pathname === "/lab-overview" ? (
          /* Lab Overview owns its own customizable widget rail via
           *  SidebarWidgetRail rendered inside the page body. Render
           *  nothing here so we don't double-stack two sidebars on
           *  that route (Grant 2026-05-23 — R2 widget framework). */
          null
        ) : accountType === "lab_head" ? (
          /* Customizable PI sidebar (#146 customizable PI sidebar
           *  manager, 2026-05-23): lab heads get the always-on
           *  customizable widget rail in place of the default
           *  DailyTasksSidebar. The two carve-outs above
           *  (/calendar + /lab-overview) take priority — calendar
           *  keeps its own sidebar, and /lab-overview renders its
           *  rail in-page. Members fall through to DailyTasksSidebar
           *  unchanged. */
          <CustomizableSidebar />
        ) : (
          <DailyTasksSidebar />
        )}
        <main className="flex-1 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>

      <InboxToast />
      {/* Lab head UX polish manager Bug 3 (2026-05-24): global Undo
       *  toast for soft-deleted notes. Mounted once at the shell so
       *  every notesApi.delete call site can pop a "Deleted X — Undo"
       *  toast via emitNoteDeleted without prop-drilling its own
       *  handler. */}
      <NoteDeleteUndoToast />
      <ReminderRunner />

      {/* Universal floating utility cluster — a single fixed flex row at
          bottom-right, ordered right-to-left by expected frequency:
          Support (rightmost), Report Bug, User Switch, Data folder. The
          flex container owns the fixed positioning and z-index; each
          button inside just declares size/color/shape, so spacing stays
          uniform regardless of how many buttons live here.

          UI affordance fix (break-bot Bug 1, 2026-05-24): the container
          is now `pointer-events-none` so its bounding box (which can
          extend several pixels above the visible button circles via the
          flex line-box + tooltip portals + invisible dev FABs) cannot
          intercept clicks on the content underneath. Each interactive
          button explicitly re-enables `pointer-events-auto` via the
          `pointer-events-auto` utility on the button element (the
          per-button wrappers in `Tooltip` pass that class through to
          the cloned trigger via `composeRefs` — but we set it directly
          on each button below for belt-and-suspenders, because Tooltip
          doesn't propagate utility classes from the container.) */}
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 pointer-events-none">
        <DevBeakerBotGalleryButton />

        <DevForceWalkthroughButton inline />

        <DevTestNotificationButton />

        <DevDemoToggleButton />

        <Tooltip label="Data folder · connect or switch" placement="top">
          <button
            onClick={() => setShowDataSetup(true)}
            aria-label="Open data folder settings"
            className="pointer-events-auto w-12 h-12 rounded-full bg-white border border-gray-200 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-gray-600 hover:text-gray-900"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
        </Tooltip>

        <Tooltip
          label={`Switch user${currentUser ? ` (now: ${currentUser})` : ""}`}
          placement="top"
        >
          <button
            onClick={() => setShowUserSwitch(true)}
            aria-label="Switch user"
            data-tour-target="user-picker-button"
            className="pointer-events-auto w-12 h-12 rounded-full bg-white border border-gray-200 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
          >
            {currentUser ? (
              <UserAvatar username={currentUser} size="sm" />
            ) : (
              <span className="text-gray-500 text-sm font-semibold">?</span>
            )}
          </button>
        </Tooltip>

        <FeedbackButton onClick={openBugReport} />

        <BetaDonationButton />
      </div>

      {/* Modals owned by the cluster */}
      <DataSetupScreen
        isOpen={showDataSetup}
        onClose={() => setShowDataSetup(false)}
      />

      {showUserSwitch && (
        <UserLoginScreen
          onLogin={() => {
            setShowUserSwitch(false);
            queryClient.invalidateQueries();
          }}
        />
      )}

      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />

      {/* Auto-error confirm dialog used to mount here; it moved to
          lib/providers.tsx (via AutoErrorConfirmHost) so it renders on
          pre-login surfaces too (UserLoginScreen, DataSetupScreen,
          ResearchFolderSetupNew). The hook's auto-error confirm state
          is now backed by a global store, so any callsite's
          useErrorReporting() reads the same flag. (feedback polish R1) */}

      {/* Error toast — stacks above the cluster on the right edge so it
          doesn't collide with any of the four icon buttons at bottom-6. */}
      {showErrorToast && currentError && (
        <div className="fixed bottom-24 right-6 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3 max-w-sm">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">An error occurred</p>
            <p className="text-xs opacity-90 truncate">{currentError.message}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={reportCurrentError}
              className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded transition-colors"
            >
              Report
            </button>
            <button
              onClick={dismissErrorToast}
              aria-label="Dismiss error toast"
              className="text-xs hover:bg-white/20 px-1 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Wrap children in a floating white pill only when a colored gradient
 *  header is active. Pre-login the wordmark stays naked on bg-white. */
function PillWrap({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className="bg-white rounded-full px-3.5 py-1.5 shadow-sm">{children}</div>
  );
}
