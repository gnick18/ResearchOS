"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import DailyTasksSidebar from "./DailyTasksSidebar";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/experiments", label: "Experiments" },
  { href: "/gantt", label: "GANTT" },
  { href: "/methods", label: "Methods" },
  { href: "/purchases", label: "Purchases" },
  { href: "/results", label: "Results" },
  { href: "/calendar", label: "Calendar" },
  { href: "/search", label: "Search" },
  { href: "/links", label: "Lab Links" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-6 py-3 flex items-center gap-6">
        <h1 className="text-lg font-bold text-gray-900 tracking-tight">
          ResearchOS
        </h1>

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
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
      </header>

      {/* Main content with daily tasks sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <DailyTasksSidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
