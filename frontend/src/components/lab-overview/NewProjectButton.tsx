"use client";

import { useState } from "react";
import Tooltip from "@/components/Tooltip";
import ProjectCreateModal from "./ProjectCreateModal";

/**
 * Shared "+ New Project" button (widget-framework teardown v2, 2026-06-02).
 *
 * Project creation used to be reachable ONLY through the customizable widget
 * canvas (DashboardNewProject + the Projects Overview / Single Project
 * widgets). Phase 2 removed that whole framework, so creation needed a new
 * home. This button is that home: it lives in the curated Lab Overview header
 * and the Workbench header, opening the full ProjectCreateModal (name + color
 * + tags + weekend toggle).
 *
 * Wiring lifted from the retired DashboardNewProject.tsx:
 *   - onClick dispatches `tour:home-create-modal-opened` so the §6.1 TRIGGER
 *     walkthrough beat advances exactly once when the modal opens.
 *   - the button carries the `home-new-project` tour anchor (the FILL beat's
 *     form anchors live inside ProjectCreateModal).
 *   - on a successful create, navigate to the new project's page so the user
 *     lands on what they just made (this replaces the old NAV beat that
 *     clicked the auto-pinned Single Project tile).
 *
 * Custom inline SVG (no emojis), project `<Tooltip>`, no em-dashes.
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

export interface NewProjectButtonProps {
  /** The creating user (current user). */
  username: string;
  /** Optional extra classes for the button (e.g. a tour anchor host wants
   *  a specific size). The default styling matches the house primary button. */
  className?: string;
  /** Optional `data-tour-target` override. Defaults to `home-new-project`
   *  (the §6.1 TRIGGER beat anchor). Pass a stable value such as
   *  `create-project-button` on the curated Lab Overview header. */
  tourTarget?: string;
}

export default function NewProjectButton({
  username,
  className,
  tourTarget = "home-new-project",
}: NewProjectButtonProps) {
  const [open, setOpen] = useState(false);

  const openModal = () => {
    setOpen(true);
    // §6.1 TRIGGER beat advances on this event. Dispatched here, by the
    // opener, so it fires exactly once when the modal mounts (the modal stays
    // event-free so the walkthrough's own programmatic open can fire the
    // event in lockstep).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tour:home-create-modal-opened"));
    }
  };

  const handleCreated = () => {
    // Intentionally do NOT navigate into the new project. Auto-opening it on
    // create felt intrusive (Grant 2026-06-09). The create modal already
    // invalidates the ["projects"] query and closes itself, so the new card
    // simply appears in the list and the user stays where they are.
  };

  return (
    <>
      <Tooltip label="Create a new project" placement="bottom">
        <button
          type="button"
          onClick={openModal}
          data-testid="new-project-button"
          data-tour-target={tourTarget}
          className={
            className ??
            "inline-flex items-center gap-1.5 rounded-lg bg-brand-action px-3 py-1.5 text-body font-semibold text-white transition-colors hover:bg-brand-action/90"
          }
        >
          <span aria-hidden="true">{PLUS_SVG}</span>
          New Project
        </button>
      </Tooltip>
      {open && (
        <ProjectCreateModal
          username={username}
          onClose={() => setOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}
