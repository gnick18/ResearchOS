import type { Metadata } from "next";
import type { ReactNode } from "react";
import WikiSidebar from "@/components/wiki/WikiSidebar";

export const metadata: Metadata = {
  title: "ResearchOS Wiki",
  description: "Help and documentation for ResearchOS.",
};

/** Wiki uses its own shell — no AppShell, no DailyTasksSidebar, no
 *  FileSystem auth gate. This lets brand-new visitors read the setup
 *  guide before they ever pick a folder. */
export default function WikiLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-gray-900 lg:flex">
      <WikiSidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
