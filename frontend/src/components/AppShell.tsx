"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import DailyTasksSidebar from "./DailyTasksSidebar";
import CalendarSidebar from "./CalendarSidebar";
import TelegramStatusBadge from "./TelegramStatusBadge";
import InboxBadge from "./InboxBadge";
import InboxToast from "./InboxToast";
import ReminderRunner from "./ReminderRunner";
import { NAV_ITEMS, HOME_HREF } from "@/lib/nav";
import { useAppStore } from "@/lib/store";

const SETTINGS_HREF = "/settings";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const visibleTabs = useAppStore((s) => s.visibleTabs);

  // Home is always shown so the user has a guaranteed safe landing tab even
  // if they hide everything else (or if Settings was wiped). Settings itself
  // is rendered as a gear icon, never as part of NAV_ITEMS.
  const filtered = NAV_ITEMS.filter(
    (item) => item.href === HOME_HREF || visibleTabs.includes(item.href),
  );

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-6 py-3 flex items-center gap-6">
        <h1 className="text-lg font-bold text-gray-900 tracking-tight">
          ResearchOS
        </h1>

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          {filtered.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                pathname === item.href
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <InboxBadge />
          <TelegramStatusBadge />
          <Link
            href={SETTINGS_HREF}
            aria-label="Settings"
            title="Settings"
            className={`p-1.5 rounded-lg transition-colors ${
              pathname === SETTINGS_HREF
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
