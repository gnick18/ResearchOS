"use client";

import Link from "@/components/FixtureLink";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import DailyTasksSidebar from "./DailyTasksSidebar";
import CalendarSidebar from "./CalendarSidebar";
import TelegramStatusBadge from "./TelegramStatusBadge";
import InboxBadge from "./InboxBadge";
import InboxToast from "./InboxToast";
import NotificationBadge from "./NotificationBadge";
import ReminderRunner from "./ReminderRunner";
import DemoLabBanner from "./DemoLabBanner";
import TelegramRecoveryPrompt from "./TelegramRecoveryPrompt";
import TelegramEncryptedRecoveryPrompt from "./TelegramEncryptedRecoveryPrompt";
import IdlePasswordWipe from "./IdlePasswordWipe";
import Tooltip from "./Tooltip";
import UserAvatar from "./UserAvatar";
import FeedbackButton from "./FeedbackButton";
import BetaDonationButton from "./BetaDonationButton";
import DevTestNotificationButton from "./DevTestNotificationButton";
import DevForceTipButton from "./DevForceTipButton";
import DevDemoToggleButton from "./DevDemoToggleButton";
import DataSetupScreen from "./DataSetupScreen";
import UserLoginScreen from "./UserLoginScreen";
import FeedbackModal from "./FeedbackModal";
import BeakerBot from "./BeakerBot";
import { NAV_ITEMS, HOME_HREF } from "@/lib/nav";
import { HELP_HREF, appRouteToWikiRoute } from "@/lib/wiki/nav";
import { useAppStore } from "@/lib/store";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useUserColor } from "@/hooks/useUserColor";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import { useFeaturePicks } from "@/hooks/useFeaturePicks";
import { deriveVisibleTabs } from "@/lib/onboarding/feature-picks-tabs";
import { headerGradient } from "@/lib/colors";
import { useOptionalTourController } from "@/components/onboarding/v4/TourController";

const SETTINGS_HREF = "/settings";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const visibleTabs = useAppStore((s) => s.visibleTabs);
  const coloredHeader = useAppStore((s) => s.coloredHeader);
  const { currentUser } = useFileSystem();
  const baseColor = useUserColor(currentUser ?? "");
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

  // Home is always shown so the user has a guaranteed safe landing tab even
  // if they hide everything else (or if Settings was wiped). Settings itself
  // is rendered as a gear icon, never as part of NAV_ITEMS.
  const filtered = NAV_ITEMS.filter(
    (item) =>
      item.href === HOME_HREF || effectiveVisibleTabs.includes(item.href),
  );

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
  const [stop1, stop2] = headerGradient(baseColor);
  const tinted = !!currentUser && coloredHeader;
  const headerStyle = tinted
    ? { background: `linear-gradient(to right, ${stop1}, ${stop2})` }
    : undefined;

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <DemoLabBanner />
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
          <div className="flex items-center gap-1.5">
            {/* Small static BeakerBot brand-mark accent. No animation — the
                idle bob is reserved for the onboarding wizard; a moving
                mascot next to the word-mark would compete with nav. */}
            <BeakerBot
              pose="idle"
              ariaLabel="ResearchOS BeakerBot logo"
              className="w-6 h-6 text-sky-500 shrink-0"
            />
            <h1 className="text-base font-bold text-gray-900 tracking-tight">
              ResearchOS
            </h1>
          </div>
        </PillWrap>

        {/* Navigation */}
        <nav
          className="flex items-center gap-1"
          data-tour-nav-disabled={navDisabledByTour ? "true" : undefined}
        >
          {filtered.map((item) => {
            const isActive = pathname === item.href;
            // Onboarding v4 L23: when an in-product walkthrough is
            // running, render each nav-item as a non-Link button that
            // visually grays out + suppresses click. Cursor-driven
            // programmatic navigation (via Next router) still works,
            // since it bypasses the DOM click event entirely.
            if (navDisabledByTour) {
              const baseStyle = tinted
                ? "px-3 py-1.5 text-sm rounded-full transition-colors shadow-sm bg-white/75 text-gray-700"
                : "px-3 py-1.5 text-sm rounded-lg transition-colors text-gray-500";
              return (
                <button
                  key={item.href}
                  type="button"
                  disabled
                  aria-disabled="true"
                  data-tour-nav-item={item.href}
                  className={`${baseStyle} opacity-50 cursor-not-allowed`}
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
                  {item.label}
                </button>
              );
            }
            if (tinted) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 text-sm rounded-full transition-colors shadow-sm ${
                    isActive
                      ? "bg-white text-gray-900 font-medium"
                      : "bg-white/75 text-gray-700 hover:bg-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <NotificationBadge pill={tinted} />
          <InboxBadge />
          <TelegramStatusBadge />
          <Tooltip label="Help & documentation" placement="bottom">
          <Link
            href={helpHref}
            aria-label="Open the ResearchOS wiki"
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
          <Tooltip label="Account & app settings" placement="bottom">
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
          </Tooltip>
        </div>
      </header>

      {/* Main content with route-specific sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {pathname === "/calendar" ? <CalendarSidebar /> : <DailyTasksSidebar />}
        <main className="flex-1 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>

      <InboxToast />
      <ReminderRunner />

      {/* Universal floating utility cluster — a single fixed flex row at
          bottom-right, ordered right-to-left by expected frequency:
          Support (rightmost), Report Bug, User Switch, Data folder. The
          flex container owns the fixed positioning and z-index; each
          button inside just declares size/color/shape, so spacing stays
          uniform regardless of how many buttons live here. */}
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        <DevTestNotificationButton />

        <DevDemoToggleButton />

        <DevForceTipButton />

        <Tooltip label="Data folder · connect or switch" placement="top">
          <button
            onClick={() => setShowDataSetup(true)}
            aria-label="Open data folder settings"
            className="w-12 h-12 rounded-full bg-white border border-gray-200 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-gray-600 hover:text-gray-900"
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
            className="w-12 h-12 rounded-full bg-white border border-gray-200 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
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
