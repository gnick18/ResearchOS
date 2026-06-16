"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Tooltip from "@/components/Tooltip";
import { focusWithoutTooltip } from "@/components/tooltip-focus";
import LivingPopup from "@/components/ui/LivingPopup";
import { projectsApi } from "@/lib/local-api";
import type { Project } from "@/lib/types";

/**
 * Full project-create modal (newproject-modal-tour-fix bot, 2026-05-29;
 * widget-framework teardown v2, 2026-06-02).
 *
 * Grant's correction to the §6.1 dashboard rework: the "+ New Project" button
 * must open the FULL project-create popup the old Home page used, NOT the
 * cramped inline strip (a color swatch + a name only). This is that popup:
 * name + COLOR (swatch row) + TAGS (comma-separated) + the seven-day-week
 * (WEEKEND_ACTIVE) toggle.
 *
 * Teardown rewrite: the customizable widget dashboard (canvas + Single Project
 * widget + layout-persistence) was removed in Phase 2. The modal now creates
 * the project DIRECTLY via `projectsApi.create` (which dispatches
 * `tour:project-created` itself, so the §6.1 FILL beat still advances) and
 * hands the created project back to its caller via `onCreated(project)` so the
 * new homes (the curated Lab Overview header button and the Workbench header
 * button) can navigate to it. No auto-pinned widget is appended any more
 * (there is no canvas).
 *
 * Modal chrome mirrors the house popup pattern: fixed inset overlay, backdrop
 * dim, click-outside + Escape close, focus restore on unmount. Custom inline
 * SVG, project `<Tooltip>`, no native title=, no emojis, no em-dashes.
 *
 * TOUR (§6.1): the FILL beat spotlights `home-project-create-form` (the modal
 * panel) and the trigger beat's `tour:home-create-modal-opened` event is
 * dispatched by the OPENER (the New Project buttons / the walkthrough step),
 * not here, so the event fires exactly once on open. The name input carries
 * `home-project-name-input`, the submit button `home-project-create-submit`,
 * and the panel `home-project-create-form` so the spotlights still resolve.
 */

/** The same swatch palette the old Home create form offered. */
export const PROJECT_COLOR_SWATCHES = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#6366f1",
];

const CLOSE_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export interface ProjectCreateModalProps {
  /** The creating user (current user). Retained on the props for callers
   *  that pass it through; the create itself runs as the active user. */
  username: string;
  /** Close the modal without creating (backdrop click, Escape, Cancel). */
  onClose: () => void;
  /** Called after a successful create with the created project, so the
   *  caller can refresh its view and/or navigate to the new project. */
  onCreated: (project: Project) => void;
}

export default function ProjectCreateModal({
  username: _username,
  onClose,
  onCreated,
}: ProjectCreateModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [color, setColor] = useState(PROJECT_COLOR_SWATCHES[0]);
  const [weekendActive, setWeekendActive] = useState(false);
  const [saving, setSaving] = useState(false);

  // Restore focus to the opener (the "+ New Project" button) on close, the
  // same accessibility pattern SnapshotTilePopup uses.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    return () => {
      try {
        // Return focus to the opener (good a11y), but suppress its <Tooltip>
        // focus-reveal so the "Create a new project" bubble does not pop on
        // close while the pointer is elsewhere.
        focusWithoutTooltip(restoreFocusRef.current);
      } catch {
        // best-effort focus restore — never throw on unmount
      }
    };
  }, []);

  // Escape / scrim close are owned by LivingPopup below.

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      // Create directly through the data layer. `projectsApi.create`
      // dispatches `tour:project-created` itself, so the §6.1 FILL beat still
      // advances. The widget canvas (and its auto-pinned Single Project tile)
      // were removed in the Phase 2 teardown, so there is nothing to append.
      const project = await projectsApi.create({
        name: trimmed,
        color,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        weekend_active: weekendActive,
      });
      // Refresh project consumers so the new project shows everywhere without
      // a reload.
      await queryClient.invalidateQueries({
        queryKey: ["lab", "projects-with-progress"],
      });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onCreated(project);
      onClose();
    } catch {
      // projectsApi.create throws on empty names; the guard above blocks that,
      // so a throw here is an unexpected write failure.
      window.alert("Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  return (
    // elevated -> z-[440], so the panel clears the v4 tour input lock (z-[420])
    // the same way the old bespoke z-[440] scrim did. card=false keeps the
    // panel's own chrome + header X (showClose=false); no blur per the popup
    // policy (forms dim only).
    <LivingPopup
      open
      onClose={onClose}
      label="New Research Project"
      card={false}
      widthClassName="max-w-lg"
      elevated
      showClose={false}
    >
      <div
        // §6.1 FILL beat anchor: spotlights the whole create-form panel.
        data-tour-target="home-project-create-form"
        data-testid="project-create-modal"
        className="pointer-events-auto bg-surface-raised rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden"
        style={{
          boxShadow:
            "0 1px 3px rgba(0,0,0,0.06), 0 20px 50px -10px rgba(0,0,0,0.25)",
        }}
        // Clicks inside the panel must not bubble to the backdrop close.
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <h2 className="flex-1 min-w-0 truncate text-title font-semibold text-foreground">
            New Research Project
          </h2>
          <Tooltip label="Close" placement="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken p-1.5 rounded-lg transition-colors"
            >
              <span aria-hidden="true">{CLOSE_SVG}</span>
            </button>
          </Tooltip>
        </header>

        <div className="px-5 py-5 space-y-4">
          <div>
            <label
              htmlFor="project-create-name"
              className="block text-meta font-medium text-foreground-muted mb-1"
            >
              Project Name
            </label>
            <input
              id="project-create-name"
              data-tour-target="home-project-name-input"
              data-testid="project-create-name"
              type="text"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="e.g. CRISPR Gene Editing Study"
              className="w-full px-3 py-2 border border-border rounded-lg text-body text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="project-create-tags"
              className="block text-meta font-medium text-foreground-muted mb-1"
            >
              Tags (comma-separated)
            </label>
            <input
              id="project-create-tags"
              data-testid="project-create-tags"
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. sequencing, LC-MS, cell-culture"
              className="w-full px-3 py-2 border border-border rounded-lg text-body text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <span className="block text-meta font-medium text-foreground-muted mb-1">
              Project Color
            </span>
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLOR_SWATCHES.map((c) => (
                <Tooltip key={c} label={`Use color ${c}`} placement="bottom">
                  <button
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Use color ${c}`}
                    aria-pressed={color === c}
                    className={`w-7 h-7 rounded-full transition-transform ${
                      color === c
                        ? "ring-2 ring-offset-2 ring-gray-400 scale-110"
                        : ""
                    }`}
                    style={{ backgroundColor: c }}
                  />
                </Tooltip>
              ))}
            </div>
          </div>

          <label
            data-tour-target="home-project-weekend-toggle"
            className="flex items-center gap-2 cursor-pointer"
          >
            <input
              type="checkbox"
              data-testid="project-create-weekend"
              checked={weekendActive}
              onChange={(e) => setWeekendActive(e.target.checked)}
              className="rounded border-border text-blue-600 dark:text-blue-300"
            />
            <span className="text-body text-foreground-muted">
              7-day schedule (weekends active)
            </span>
          </label>
        </div>

        <footer className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-body font-medium text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            data-tour-target="home-project-create-submit"
            data-testid="project-create-submit"
            disabled={!name.trim() || saving}
            onClick={submit}
            className="ros-btn-raise px-4 py-2 text-body font-semibold text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create Project"}
          </button>
        </footer>
      </div>
    </LivingPopup>
  );
}
