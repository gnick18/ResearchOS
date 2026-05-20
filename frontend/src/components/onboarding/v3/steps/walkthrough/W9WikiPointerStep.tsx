import { useEffect } from "react";
import SpeechBubble from "./lib/SpeechBubble";

/**
 * W9: Wiki pointer (universal walkthrough).
 *
 * Pure text + Next per §5 lock. No artifact, no API call, no demo
 * surface. Just a friendly pointer at the Wiki tab so users know
 * where the deeper reference lives.
 *
 * Next is always enabled because nothing here is gated.
 */

interface W9Props {
  setNextDisabled: (disabled: boolean) => void;
}

export default function W9WikiPointerStep({ setNextDisabled }: W9Props) {
  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  return (
    <div data-step-id="W9" className="space-y-4">
      <SpeechBubble>
        If you ever get stuck, click the Wiki tab over in the sidebar.
        There&apos;s a getting-started guide and a feature reference for
        everything we just walked through, plus a few corners we
        didn&apos;t cover yet. Bookmark it.
      </SpeechBubble>

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 leading-relaxed">
        <p className="font-medium text-gray-800 mb-1">What lives in the wiki</p>
        <ul className="list-disc list-inside text-xs space-y-0.5">
          <li>Getting started + first-folder setup</li>
          <li>Feature reference for every tab in the sidebar</li>
          <li>Integrations: Telegram, calendar feeds, LabArchives, AI Helper</li>
          <li>Lab Mode collaboration patterns</li>
        </ul>
      </div>
    </div>
  );
}
