import type { Metadata } from "next";
import type { ReactNode } from "react";
import WikiSidebar from "@/components/wiki/WikiSidebar";
import WikiTopBar from "@/components/wiki/WikiTopBar";
import SponsorStrip from "@/components/SponsorStrip";

export const metadata: Metadata = {
  title: "ResearchOS Wiki",
  description: "Help and documentation for ResearchOS.",
};

/** Wiki uses its own shell. No AppShell, no DailyTasksSidebar, no
 *  FileSystem auth gate. This lets brand-new visitors read the setup
 *  guide before they ever pick a folder. A slim WikiTopBar gives a
 *  one-click route back into the app from anywhere in the docs. */
export default function WikiLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <WikiTopBar />
      <div className="flex-1 lg:flex">
        <WikiSidebar />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
      {/* Site-wide sponsor recognition. Renders nothing until a real Lab or
          Institute sponsor exists, so the wiki footer stays clean today. */}
      <SponsorStrip variant="wiki-footer" />
    </div>
  );
}
