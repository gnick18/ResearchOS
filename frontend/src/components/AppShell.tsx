"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import DailyTasksSidebar from "./DailyTasksSidebar";
import CalendarSidebar from "./CalendarSidebar";
import TelegramStatusBadge from "./TelegramStatusBadge";
import InboxBadge from "./InboxBadge";
import InboxToast from "./InboxToast";
import NotificationBadge from "./NotificationBadge";
import ReminderRunner from "./ReminderRunner";
import { NAV_ITEMS, HOME_HREF } from "@/lib/nav";
import { useAppStore } from "@/lib/store";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useUserColor } from "@/hooks/useUserColor";
import { headerGradient } from "@/lib/colors";

const SETTINGS_HREF = "/settings";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const visibleTabs = useAppStore((s) => s.visibleTabs);
  const { currentUser } = useFileSystem();
  const baseColor = useUserColor(currentUser ?? "");

  // Home is always shown so the user has a guaranteed safe landing tab even
  // if they hide everything else (or if Settings was wiped). Settings itself
  // is rendered as a gear icon, never as part of NAV_ITEMS.
  const filtered = NAV_ITEMS.filter(
    (item) => item.href === HOME_HREF || visibleTabs.includes(item.href),
  );

  // When a user is signed in, paint the whole header with their full-opacity
  // two-stop gradient. Text legibility is preserved by wrapping every
  // interactive element (wordmark, nav links, gear) in its own floating
  // white pill — the gradient lives behind the pills, never under text.
  const [stop1, stop2] = headerGradient(baseColor);
  const hasUser = !!currentUser;
  const headerStyle = hasUser
    ? { background: `linear-gradient(to right, ${stop1}, ${stop2})` }
    : undefined;

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header
        className={`px-4 py-2.5 flex items-center gap-2 ${
          hasUser ? "shadow-sm" : "bg-white border-b border-gray-200"
        }`}
        style={headerStyle}
      >
        <PillWrap on={hasUser}>
          <h1 className="text-base font-bold text-gray-900 tracking-tight">
            ResearchOS
          </h1>
        </PillWrap>

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          {filtered.map((item) => {
            const isActive = pathname === item.href;
            if (hasUser) {
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
          <NotificationBadge />
          <InboxBadge />
          <TelegramStatusBadge />
          <Link
            href={SETTINGS_HREF}
            aria-label="Settings"
            title="Settings"
            className={`p-1.5 rounded-full transition-colors ${
              hasUser
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
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
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
