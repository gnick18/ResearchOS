"use client";

// The Info sheet editor (info documentation slice). An Info sheet is NOT a grid:
// it is a documentation page that travels with a dataset, holding a free-text
// markdown BODY plus an optional list of named CONSTANTS (name / value / note).
// It runs no statistic, draws no figure, and offers no Analyze / New graph.
//
// The body is a lightweight edit-and-render surface: a plain textarea for the
// markdown source with an Edit / Preview toggle that renders through the shared
// RenderedMarkdown (the same renderer notes use), so the heavy Loro-bound notes
// editor is not pulled into this surface. Below the body, the constants list has
// per-row name / value / note fields with Add and Delete affordances.
//
// Like the grids this is a CONTROLLED view: it renders the passed content and
// reports edits up via onBodyChange / onConstantsChange (the page writes them
// through the Loro store with a debounced commit), so a commit + reproject flows
// straight back in.
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import {
  addConstant,
  infoOf,
  removeConstant,
  setBody,
  updateConstant,
} from "@/lib/datahub/info-sheet";
import type {
  DataHubDocContent,
  InfoContent,
} from "@/lib/datahub/model/types";

export default function InfoSheetEditor({
  content,
  onChange,
}: {
  content: DataHubDocContent;
  /** Persist the next info payload (body + constants). The page commits it. */
  onChange: (next: InfoContent) => void;
}) {
  const info = infoOf(content);
  // Default to Preview when there is already a body to read, otherwise Edit so a
  // fresh sheet drops straight into typing.
  const [mode, setMode] = useState<"edit" | "preview">(
    info.body.trim() === "" ? "edit" : "preview",
  );

  return (
    <div className="flex flex-col gap-6" data-testid="datahub-info-sheet">
      {/* Documentation body. */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-body font-semibold text-foreground">
            Documentation
          </h2>
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface-raised p-0.5">
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={`rounded px-2 py-1 text-meta font-medium transition-colors ${
                mode === "edit"
                  ? "bg-accent-soft text-foreground"
                  : "text-foreground-muted hover:bg-surface-sunken"
              }`}
              data-testid="datahub-info-edit-toggle"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={`rounded px-2 py-1 text-meta font-medium transition-colors ${
                mode === "preview"
                  ? "bg-accent-soft text-foreground"
                  : "text-foreground-muted hover:bg-surface-sunken"
              }`}
              data-testid="datahub-info-preview-toggle"
            >
              Preview
            </button>
          </div>
        </div>

        {mode === "edit" ? (
          <textarea
            value={info.body}
            onChange={(e) => onChange(setBody(info, e.target.value))}
            placeholder={
              "What this dataset is, where it came from, the instrument and settings, anything a reader needs to trust the numbers. Markdown is supported."
            }
            className="min-h-[12rem] w-full resize-y rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            data-testid="datahub-info-body-input"
          />
        ) : info.body.trim() === "" ? (
          <p
            className="rounded-md border border-dashed border-border px-3 py-6 text-center text-meta text-foreground-muted"
            data-testid="datahub-info-body-empty"
          >
            No documentation yet. Switch to Edit to write it.
          </p>
        ) : (
          <div
            className="rounded-md border border-border bg-surface-raised px-3 py-2"
            data-testid="datahub-info-body-preview"
          >
            <RenderedMarkdown content={info.body} />
          </div>
        )}
      </section>

      {/* Constants list. */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-body font-semibold text-foreground">Constants</h2>
            <p className="text-meta text-foreground-muted">
              Named values you record for reference, like a dilution factor or a
              plate reader. They document the dataset, they are not yet used in
              analyses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(addConstant(info))}
            className="ros-btn-neutral flex shrink-0 items-center gap-1 px-2 py-1 text-meta font-medium text-foreground"
            data-testid="datahub-info-add-constant"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add constant
          </button>
        </div>

        {info.constants.length === 0 ? (
          <p
            className="rounded-md border border-dashed border-border px-3 py-6 text-center text-meta text-foreground-muted"
            data-testid="datahub-info-constants-empty"
          >
            No constants yet. Add one to record a named value.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-center gap-2 border-b border-border bg-surface-sunken px-3 py-1.5 text-meta font-medium uppercase tracking-wide text-foreground-muted">
              <span>Name</span>
              <span>Value</span>
              <span>Note</span>
              <span className="sr-only">Actions</span>
            </div>
            {info.constants.map((c, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-center gap-2 border-b border-border bg-surface-raised px-3 py-1.5 last:border-b-0"
                data-testid="datahub-info-constant-row"
              >
                <input
                  type="text"
                  value={c.name}
                  onChange={(e) =>
                    onChange(updateConstant(info, i, { name: e.target.value }))
                  }
                  placeholder="Dilution factor"
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:bg-surface-sunken focus:outline-none"
                  data-testid="datahub-info-constant-name"
                />
                <input
                  type="text"
                  value={c.value}
                  onChange={(e) =>
                    onChange(updateConstant(info, i, { value: e.target.value }))
                  }
                  placeholder="100"
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:bg-surface-sunken focus:outline-none"
                  data-testid="datahub-info-constant-value"
                />
                <input
                  type="text"
                  value={c.note ?? ""}
                  onChange={(e) =>
                    onChange(updateConstant(info, i, { note: e.target.value }))
                  }
                  placeholder="serial 1:10"
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:bg-surface-sunken focus:outline-none"
                  data-testid="datahub-info-constant-note"
                />
                <Tooltip label="Delete this constant.">
                  <button
                    type="button"
                    onClick={() => onChange(removeConstant(info, i))}
                    className="flex h-7 w-7 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                    data-testid="datahub-info-constant-delete"
                    aria-label="Delete constant"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
