"use client";

import { useState } from "react";
import Tooltip from "@/components/Tooltip";
import ProjectCreateModal from "./ProjectCreateModal";

/**
 * Top-level "+ New Project" button on the unified dashboard toolbar
 * (dashboard-newproject-tour bot, 2026-05-29; modal rework
 * newproject-modal-tour-fix bot, 2026-05-29).
 *
 * Grant's decided model: a persistent New Project affordance lives on the
 * dashboard header, INDEPENDENT of any widget, so a fresh dashboard with zero
 * widgets can still create a project.
 *
 * Modal rework (Grant 2026-05-29): the button now opens the FULL project-create
 * popup the old Home page used (name + COLOR + TAGS + the seven-day-week
 * toggle), not the prior cramped inline strip. The modal lives in
 * `ProjectCreateModal.tsx` and routes its submit through
 * `createProjectWithDashboardWidget`, so the auto Single Project widget is
 * still pinned to the new project in its color.
 *
 * TOUR (§6.1): the button carries the `home-new-project` anchor and dispatches
 * `tour:home-create-modal-opened` on open (the §6.1 TRIGGER beat advances on
 * that event). The modal owns the `home-project-create-form`,
 * `home-project-name-input`, and `home-project-create-submit` anchors. No
 * emojis, custom inline SVG, project `<Tooltip>` per house style.
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
  const [open, setOpen] = useState(false);

  const openModal = () => {
    setOpen(true);
    // §6.1 walkthrough TRIGGER beat advances on this event (the
    // `home-create-project` step watches `tour:home-create-modal-opened`).
    // Dispatched here, by the opener, so it fires exactly once when the modal
    // mounts (the modal itself stays event-free so the walkthrough's own
    // programmatic open can fire the event in lockstep).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tour:home-create-modal-opened"));
    }
  };

  return (
    <>
      <Tooltip label="Create a new project" placement="bottom">
        <button
          type="button"
          onClick={openModal}
          data-testid="dashboard-new-project"
          // §6.1 TRIGGER beat anchor (`home-new-project`): the persistent
          // top-level create button BeakerBot points the user at to open the
          // full create modal.
          data-tour-target="home-new-project"
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          <span aria-hidden="true">{PLUS_SVG}</span>
          New Project
        </button>
      </Tooltip>
      {open && (
        <ProjectCreateModal
          username={username}
          onClose={() => setOpen(false)}
          onCreated={onCreated}
        />
      )}
    </>
  );
}
