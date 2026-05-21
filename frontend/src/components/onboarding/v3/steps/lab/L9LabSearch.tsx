import { useEffect, useState } from "react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import { BEAKERBOT_DISPLAY_NAME } from "./lib/beakerbot-user";
import { findLabTask, findLabUser } from "./lib/lab-artifacts";

/**
 * L9: Lab search demo. Static panel inside the wizard — the user
 * types into a search field, the panel filters a small synthetic
 * result list that includes BeakerBot's shared tasks. The real lab
 * search lives at `/lab` and goes through labApi.search; the wizard
 * shows the concept without navigating away.
 */

interface L9Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
}

interface PreviewRow {
  title: string;
  owner: string;
  kind: string;
}

export default function L9LabSearch({ sidecar, setNextDisabled }: L9Props) {
  const labUser = findLabUser(sidecar);
  const editTask = findLabTask(sidecar, "edit-demo");
  const viewTask = findLabTask(sidecar, "view-demo");
  const [query, setQuery] = useState("");

  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  const rows: PreviewRow[] = [];
  if (editTask && labUser) {
    rows.push({
      title: "Sample experiment, gel screen",
      owner: BEAKERBOT_DISPLAY_NAME,
      kind: "Experiment",
    });
  }
  if (viewTask && labUser) {
    rows.push({
      title: "Sample dataset, read-only",
      owner: BEAKERBOT_DISPLAY_NAME,
      kind: "Dataset",
    });
  }

  const filtered = query.trim()
    ? rows.filter((r) =>
        r.title.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : rows;

  return (
    <div data-step-id="L9" className="space-y-4">
      <SpeechBubble>
        Lab Search hits everything anyone shared with you. Try typing
        &quot;sample&quot; — you should see my fake stuff pop up.
      </SpeechBubble>

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shared work..."
          data-l9-query
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide pt-1">
          Results, preview
        </div>
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-500">
            Nothing matches. Try a different query, or go back to L2 if
            you skipped the spawn step.
          </p>
        ) : (
          <ul className="space-y-1.5" data-l9-results>
            {filtered.map((row, idx) => (
              <li
                key={idx}
                className="flex items-center gap-3 text-sm text-gray-700"
              >
                <div
                  aria-hidden
                  className="w-2 h-2 rounded-full bg-sky-500 flex-shrink-0"
                />
                <div className="flex-1">
                  <div className="font-medium">{row.title}</div>
                  <div className="text-xs text-gray-500">
                    {row.kind} • {row.owner}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
