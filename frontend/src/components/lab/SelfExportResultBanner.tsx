"use client";

// Post-disconnect confirmation for a labmate self-export. The SelfExportModal
// disconnects from the shared folder the instant the export succeeds (so the app
// cannot re-create a ghost users/<me>/), which unmounts the modal. This banner,
// mounted at the app root, reads the stashed result and tells the user exactly
// where their new folder is and how to open it. Dismiss clears the stash.
//
// House style: no emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

export const SELF_EXPORT_RESULT_KEY = "ros_selfexport_result";

interface StashedResult {
  username: string;
  folderName: string;
  bundlePath: string;
  trashPath: string;
}

function read(): StashedResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SELF_EXPORT_RESULT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v.username === "string" && typeof v.bundlePath === "string") return v as StashedResult;
  } catch {
    /* ignore */
  }
  return null;
}

export default function SelfExportResultBanner() {
  // Lazy initial read (client-only; null on the server) so the connect screen
  // shows the banner on its first render after the disconnect.
  const [result, setResult] = useState<StashedResult | null>(() => read());

  // Also react to another tab / the modal writing the stash.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SELF_EXPORT_RESULT_KEY) setResult(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!result) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.removeItem(SELF_EXPORT_RESULT_KEY);
    } catch {
      /* ignore */
    }
    setResult(null);
  };

  return (
    <div className="fixed inset-x-0 top-0 z-[1000] flex justify-center px-4 pt-3">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface-overlay p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-green-600">
            <Icon name="check" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-foreground">
              Your data was exported and you left {result.folderName}.
            </p>
            <p className="text-meta text-foreground-muted mt-1">
              Your new folder is at <code className="text-meta">{result.bundlePath}</code>. Click{" "}
              <span className="font-medium">Open a folder</span> below and select it to keep working as your own
              workspace. You can also move that folder anywhere on your computer first. A recoverable copy is in{" "}
              <code className="text-meta">{result.trashPath}</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded-md p-1 text-foreground-muted hover:bg-surface-raised"
            aria-label="Dismiss"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
