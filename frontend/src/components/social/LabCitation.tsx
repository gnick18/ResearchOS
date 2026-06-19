"use client";

// Lab citation block (Phase 1, lab-site network presence).
//
// A copyable citation for the lab's public presence. The lab page IS the lab's
// citable network address, so one-click copy reinforces "this URL is the lab's
// address". No session, no server, no network. Pure client.
//
// For a paper-companion page a second citation line includes the page title so a
// reader can cite the specific companion. The lab URL uses the current page
// origin so the citation is accurate before and after the .com cutover.
//
// Cookie isolation: no session, no folder. Safe on the .com origin.
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { DemoLabCard } from "@/lib/social/demo-lab";

export default function LabCitation({
  card,
  pageTitle,
  pagePath,
}: {
  card: DemoLabCard;
  /**
   * Title of the currently-displayed page. Used to add a per-paper citation
   * line when the page is a companion (path starts with "papers/"). When the
   * home or people page is active, only the lab-level citation is shown.
   */
  pageTitle: string;
  /** The normalized path of the current page (empty string = home). */
  pagePath: string;
}) {
  const [copied, setCopied] = useState(false);

  // Build the URL from the current window location so the citation always
  // reflects the actual serving origin (app-origin before the .com cutover,
  // subdomain after). SSR-safe: the copy button is client-only.
  const buildCitation = useCallback((): string => {
    const labUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/${card.slug}`
        : `https://research-os.app/${card.slug}`;

    const isCompanion =
      pagePath === "papers" || pagePath.startsWith("papers/");
    const piLine = `${card.pi.name} (PI). @${card.pi.handle}`;
    const labLine = `${card.name}. ResearchOS. ${labUrl}`;

    if (isCompanion && pageTitle) {
      const pageUrl = `${labUrl}/${pagePath}`;
      return `${pageTitle}. ${piLine}. ${labLine} (${pageUrl})`;
    }
    return `${piLine}. ${labLine}`;
  }, [card, pagePath, pageTitle]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildCitation());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked (e.g., non-secure context in some old browsers).
      // Silently no-op; the button just does not flash. The citation text is
      // still readable by a user who wants to copy it manually.
    }
  }, [buildCitation]);

  return (
    <section aria-labelledby="citation-heading" className="mt-10">
      <h2
        id="citation-heading"
        className="mb-2 text-sm font-semibold text-foreground"
      >
        Cite this lab
      </h2>
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
        <p className="flex-1 font-mono text-[12px] leading-relaxed text-foreground-muted">
          {buildCitation()}
        </p>
        <Tooltip label={copied ? "Copied" : "Copy citation"}>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy citation"
            className="mt-0.5 shrink-0 rounded-lg p-1.5 text-foreground-muted transition hover:bg-surface hover:text-foreground"
          >
            <Icon
              name={copied ? "check" : "copy"}
              className="h-4 w-4"
            />
          </button>
        </Tooltip>
      </div>
    </section>
  );
}
