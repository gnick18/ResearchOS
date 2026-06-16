"use client";

import { useMemo, useState } from "react";
import type { FetchedImage, MissingInlineImage } from "@/lib/import/eln/types";
import { buildDevToolsFetchScript } from "@/lib/labarchives/devtools-script";
import ManualImageDropPanel from "./ManualImageDropPanel";

interface Props {
  missing: MissingInlineImage[];
  /** Friendly notebook label used in the generated ZIP filename. */
  notebookLabel?: string;
  /** Fired as the user-staged set of matches changes. Empty map = nothing
   *  staged yet. */
  onMatchesChange: (byUrl: Map<string, FetchedImage>) => void;
}

/**
 * The "generate a script, paste it in DevTools, drop the resulting ZIP"
 * path. For users who don't have institutional API credentials but ARE
 * willing to run a one-liner in their browser console.
 */
export default function DevToolsScriptPanel({
  missing,
  notebookLabel,
  onMatchesChange,
}: Props) {
  const script = useMemo(
    () => buildDevToolsFetchScript({ images: missing, notebookLabel }),
    [missing, notebookLabel],
  );

  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2_000);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2_500);
    }
  };

  return (
    <div className="space-y-3">
      {notebookLabel && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-meta text-blue-900">
          <span className="font-medium">Fetching {missing.length} image
          {missing.length === 1 ? "" : "s"} from:</span>{" "}
          <span className="font-mono">{notebookLabel}</span>
        </div>
      )}

      <p className="text-meta text-gray-600">
        No API credentials? You can still pull your images down by pasting
        a short script into your browser&apos;s DevTools while signed into
        LabArchives. The script uses your existing browser session, packages
        the {missing.length} image{missing.length === 1 ? "" : "s"} into a
        ZIP, and triggers a single download — drop the ZIP back here.
      </p>

      <ol className="text-meta text-gray-700 list-decimal pl-5 space-y-1">
        <li>
          Open <strong>any</strong> page on{" "}
          <code className="text-meta">labarchives.com</code> in a separate
          tab and make sure you&apos;re signed in. You do <strong>not</strong>{" "}
          need to navigate to the specific notebook — your session cookies
          authenticate the fetches regardless of which page is loaded.
        </li>
        <li>
          Press <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded text-meta">F12</kbd>{" "}
          (or{" "}
          <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded text-meta">
            Cmd+Opt+J
          </kbd>{" "}
          on macOS) and switch to the <strong>Console</strong> tab.
        </li>
        <li>Copy the script below and paste it in the console, then hit Enter.</li>
        <li>
          When the download lands, drop the <code className="text-meta">.zip</code> into
          the drop zone underneath.
        </li>
      </ol>

      <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 bg-white">
          <p className="text-meta text-gray-600">
            Generated for {missing.length} image{missing.length === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className="ros-btn-raise text-meta px-2.5 py-1 bg-brand-action hover:bg-brand-action/90 text-white rounded-md"
          >
            {copyState === "copied"
              ? "Copied!"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy script"}
          </button>
        </div>
        <pre className="text-[10px] leading-snug px-3 py-2 max-h-44 overflow-auto font-mono text-gray-800 whitespace-pre">
          {script}
        </pre>
      </div>

      <p className="text-meta text-gray-500">
        The script runs entirely in your own browser and only fetches images
        you can already see in your notebook — it doesn&apos;t send your
        credentials anywhere, and ResearchOS never receives anything until
        you drop the ZIP below.
      </p>

      <ManualImageDropPanel
        missing={missing}
        onMatchesChange={onMatchesChange}
        promptText="Drop the generated .zip here"
      />
    </div>
  );
}
