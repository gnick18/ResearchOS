"use client";

/**
 * Re-usable 2-tab "fetch your missing LabArchives inline images" panel.
 *
 * Used by:
 *  - the ELN import wizard's `5 · Fetch images` step
 *    (`components/import-eln/steps/LabArchivesSignInStep.tsx`), via the
 *    thin wizard-step wrapper that adds the Back/Continue buttons.
 *  - the persistent post-import banner in `TaskDetailPopup`'s Lab Notes
 *    tab, via `RehydrateMissingImagesModal`.
 *
 * The panel owns the tab state + per-tab staging maps; the parent owns the
 * Back/Continue/Apply buttons.
 *
 * Two cred-less paths only (the institutional-API tab was removed
 * 2026-05-14 — see AGENTS.md §8 "LabArchives institutional API removal"):
 *  - "devtools" — paste-a-script-into-LabArchives-DevTools, no creds.
 *                 Default tab. Works in demo mode.
 *  - "drop"     — drop a folder / zip you already have. Works in demo.
 *
 * The `onMatchesChange` callback fires every time the staged map for the
 * currently-active panel changes. Parents that want a single source of
 * truth (e.g. modal) should treat the latest fired map as the canonical
 * value. The map keys are `MissingInlineImage.originalUrl`; values are
 * `FetchedImage` (`{ kind: "ok"; blob; contentType } | { kind: "error" }`).
 */

import { useEffect, useMemo, useState } from "react";
import type { FetchedImage, MissingInlineImage } from "@/lib/import/eln/types";
import ManualImageDropPanel from "../import-eln/steps/ManualImageDropPanel";
import DevToolsScriptPanel from "../import-eln/steps/DevToolsScriptPanel";

type WhichPanel = "devtools" | "drop";

export interface RehydrateMissingImagesPanelProps {
  missingImages: MissingInlineImage[];
  notebookLabel?: string;
  onMatchesChange: (matches: Map<string, FetchedImage>) => void;
}

export default function RehydrateMissingImagesPanel({
  missingImages,
  notebookLabel,
  onMatchesChange,
}: RehydrateMissingImagesPanelProps) {
  const [active, setActive] = useState<WhichPanel>("devtools");
  const [scriptDrop, setScriptDrop] = useState<Map<string, FetchedImage>>(new Map());
  const [manualDrop, setManualDrop] = useState<Map<string, FetchedImage>>(new Map());

  const stagedForActive = useMemo<Map<string, FetchedImage>>(() => {
    if (active === "devtools") return scriptDrop;
    return manualDrop;
  }, [active, scriptDrop, manualDrop]);

  useEffect(() => {
    onMatchesChange(stagedForActive);
  }, [stagedForActive, onMatchesChange]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-body font-semibold text-foreground">
          Pull online-only images into your notes
        </h3>
        <p className="text-meta text-foreground-muted mt-1">
          The export ZIP doesn&apos;t bundle every inline image — about half are
          stored online by LabArchives. Pick a path below to fetch them now,
          or skip and leave them as placeholders you can fix up later.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface-raised p-4">
        <p className="text-body text-foreground">
          <span className="font-semibold">{missingImages.length}</span> online-only
          image{missingImages.length === 1 ? "" : "s"} expected.
        </p>
      </div>

      <PanelSwitcher active={active} onChange={setActive} />

      {active === "devtools" && (
        <div className="rounded-xl border border-border bg-surface-raised p-4">
          <DevToolsScriptPanel
            missing={missingImages}
            notebookLabel={notebookLabel}
            onMatchesChange={setScriptDrop}
          />
        </div>
      )}

      {active === "drop" && (
        <div className="rounded-xl border border-border bg-surface-raised p-4 space-y-3">
          <p className="text-meta text-foreground-muted">
            Already saved your inline images somewhere — from a previous
            download, a screenshot batch, or another tool? Drop the folder
            or a <code className="text-meta">.zip</code> here. ResearchOS
            matches the files to the expected names automatically.
          </p>
          <ManualImageDropPanel
            missing={missingImages}
            onMatchesChange={setManualDrop}
          />
        </div>
      )}
    </div>
  );
}

function PanelSwitcher({
  active,
  onChange,
}: {
  active: WhichPanel;
  onChange: (p: WhichPanel) => void;
}) {
  const tab = (id: WhichPanel, label: string, subtitle: string) => (
    <button
      key={id}
      type="button"
      onClick={() => onChange(id)}
      className={`flex-1 text-left px-3 py-2 rounded-lg border transition-colors ${
        active === id
          ? "border-blue-400 bg-blue-50"
          : "border-border bg-surface-raised hover:border-border"
      }`}
    >
      <p className="text-meta font-semibold text-foreground">{label}</p>
      <p className="text-meta text-foreground-muted mt-0.5">{subtitle}</p>
    </button>
  );

  return (
    <div className="flex items-stretch gap-2">
      {tab(
        "devtools",
        "Generate browser script",
        "Paste a one-liner into LabArchives DevTools. No credentials needed.",
      )}
      {tab(
        "drop",
        "Drop your own images",
        "Already have the files? Drop a folder or .zip and we'll match them.",
      )}
    </div>
  );
}
