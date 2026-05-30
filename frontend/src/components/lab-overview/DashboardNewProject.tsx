"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Tooltip from "@/components/Tooltip";
import { createProjectWithDashboardWidget } from "@/lib/lab-overview/create-project-with-widget";

/**
 * Top-level "+ New Project" button on the unified dashboard toolbar
 * (dashboard-newproject-tour bot, 2026-05-29).
 *
 * Grant's decided model: a persistent New Project affordance lives on the
 * dashboard header, INDEPENDENT of any widget, so a fresh dashboard with zero
 * widgets can still create a project. It reuses the same `projectsApi.create`
 * flow the Projects Overview widget's inline form used, and (via
 * `createProjectWithDashboardWidget`) auto-pins the new project to a Single
 * Project widget so the dashboard shows it immediately.
 *
 * Shape: a button that flips into a compact inline form (color swatch + name
 * input + Create / Cancel), mirroring the Projects Overview inline create so
 * the two creation surfaces feel identical. On create it invalidates the
 * project query caches and calls `onCreated` so the canvas re-reads its layout
 * and the auto-created widget tile appears without a reload.
 *
 * TOUR (§6.1): carries the `home-new-project` / `home-project-create-form` /
 * `home-project-name-input` / `home-project-create-submit` anchors (the
 * deleted hardcoded Home grid used to own them; the Projects Overview widget
 * held them transiently). BeakerBot clicks the button, the form opens (the
 * `tour:home-create-modal-opened` event fires), the user fills + submits, and
 * `projectsApi.create` dispatches `tour:project-created`. The follow-up beat
 * clicks the freshly auto-created Single Project widget tile to open the
 * project. No emojis, custom inline SVG, project `<Tooltip>` per house style.
 */

const PLUS_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export interface DashboardNewProjectProps {
  /** The dashboard owner (current user) whose layout receives the widget. */
  username: string;
  /** Called after a successful create so the canvas re-reads its layout and
   *  the auto-created Single Project widget tile appears. */
  onCreated: () => void;
}

export default function DashboardNewProject({
  username,
  onCreated,
}: DashboardNewProjectProps) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [saving, setSaving] = useState(false);

  const openForm = () => {
    setCreating(true);
    // §6.1 walkthrough TRIGGER beat advances on this event (the
    // `home-create-project` step watches `tour:home-create-modal-opened`).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tour:home-create-modal-opened"));
    }
  };

  const cancel = () => {
    setCreating(false);
    setName("");
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await createProjectWithDashboardWidget({
        username,
        name: trimmed,
        color,
      });
      // Refresh both the widget reads and any legacy project consumers so the
      // new project + its auto-widget show everywhere without a reload.
      await queryClient.invalidateQueries({
        queryKey: ["lab", "projects-with-progress"],
      });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setCreating(false);
      onCreated();
    } catch {
      // projectsApi.create throws on empty names; the guard above blocks that,
      // so a throw here is an unexpected write failure.
      window.alert("Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  if (creating) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1.5"
        data-testid="dashboard-new-project-form"
        // §6.1 FILL beat anchor: spotlights the whole create form panel.
        data-tour-target="home-project-create-form"
      >
        <Tooltip label="Project color" placement="top">
          <input
            type="color"
            aria-label="Project color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-7 w-7 flex-shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
          />
        </Tooltip>
        <input
          type="text"
          autoFocus
          value={name}
          placeholder="New project name"
          data-testid="dashboard-new-project-name"
          data-tour-target="home-project-name-input"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") cancel();
          }}
          className="w-44 min-w-0 rounded border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800"
        />
        <button
          type="button"
          disabled={!name.trim() || saving}
          onClick={submit}
          data-testid="dashboard-new-project-save"
          data-tour-target="home-project-create-submit"
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <Tooltip label="Create a new project" placement="bottom">
      <button
        type="button"
        onClick={openForm}
        data-testid="dashboard-new-project"
        // §6.1 TRIGGER beat anchor (`home-new-project`): the persistent
        // top-level create button BeakerBot clicks to open the form.
        data-tour-target="home-new-project"
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
      >
        <span aria-hidden="true">{PLUS_SVG}</span>
        New Project
      </button>
    </Tooltip>
  );
}
