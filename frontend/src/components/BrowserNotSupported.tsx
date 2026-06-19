"use client";

import Link from "next/link";
import { detectUnsupportedBrowser } from "@/lib/file-system/file-system-context";

/**
 * Full-screen takeover shown when the browser lacks the File System Access
 * API that ResearchOS is built on. The copy is browser-specific so a Brave
 * user (who we used to tell was supported) gets a straight answer instead of
 * a screen that contradicts itself. Shared by `providers.tsx` and
 * `FolderConnectGate.tsx` so the two gates never drift apart.
 */
const COPY: Record<
  ReturnType<typeof detectUnsupportedBrowser>,
  { heading: string; body: string }
> = {
  brave: {
    heading: "Brave can't run ResearchOS",
    body: "Brave deliberately disables the File System Access API that ResearchOS uses to read and write your data folder, and there is no reliable way to turn it back on. Please open ResearchOS in Chrome or Edge instead.",
  },
  safari: {
    heading: "Safari can't run ResearchOS",
    body: "Safari doesn't let websites open a folder on your computer, which is how ResearchOS stores your data with no server. Please open ResearchOS in Chrome or Edge instead.",
  },
  firefox: {
    heading: "Firefox can't run ResearchOS",
    body: "Firefox doesn't let websites open a folder on your computer, which is how ResearchOS stores your data with no server. Please open ResearchOS in Chrome or Edge instead.",
  },
  other: {
    heading: "Browser not supported",
    body: "ResearchOS needs the File System Access API to read and write your data folder. That's only available in Chrome and Edge (and most other Chromium browsers). Please switch to one of those.",
  },
};

export default function BrowserNotSupported() {
  const { heading, body } = COPY[detectUnsupportedBrowser()];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-lg mx-4 p-6 bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20">
        <h2 className="text-heading font-bold text-white mb-4">{heading}</h2>
        <p className="text-slate-300 mb-4">{body}</p>
        <Link
          href="/wiki/getting-started/browser-requirements"
          className="inline-block text-body font-medium text-blue-300 hover:text-blue-200 underline"
        >
          Read the browser requirements guide →
        </Link>
      </div>
    </div>
  );
}
