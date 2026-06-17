"use client";

// Unified inbox shell (cross-boundary sharing Phase 2b-iii).
//
// One badge, one panel, two segments, "Shared with me" and "Photos". The panel
// is the shared backdrop + card chrome plus a segmented-tab header; the two
// tab bodies live in their own components:
//   - PhotosInboxTab   the EXISTING Telegram photo-triage flow, moved verbatim.
//   - SharedWithMeTab  the new cross-boundary received-shares review-and-import
//                      flow (identity-gated).
//
// The panel opens on whichever segment has pending items, preferring "Shared
// with me" when both do. The badge (InboxBadge) sums both pending counts and
// passes them in so the tab labels can show their own count without re-fetching.

import { useEffect, useState } from "react";

import Tooltip from "@/components/Tooltip";
import { CloseIcon } from "@/components/sharing/icons";
import PhotosInboxTab from "./PhotosInboxTab";
import SharedWithMeTab from "./SharedWithMeTab";

type Segment = "shared" | "photos";

interface InboxPanelProps {
  onClose: () => void;
  /** Pending photo count (from InboxBadge). */
  photosCount?: number;
  /** Pending received-shares count (from InboxBadge). */
  sharesCount?: number;
}

export default function InboxPanel({
  onClose,
  photosCount = 0,
  sharesCount = 0,
}: InboxPanelProps) {
  // Default to the segment with pending items, preferring "Shared with me" when
  // both have items. When neither has items, default to "Shared with me" so the
  // newer surface is what a curious user lands on. Computed once on mount; the
  // user's tab choice afterward is sticky for the panel's lifetime.
  const [segment, setSegment] = useState<Segment>(() => {
    if (sharesCount > 0) return "shared";
    if (photosCount > 0) return "photos";
    return "shared";
  });

  // Esc closes the whole panel (each tab body owns its own inner-popup Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Inbox"
      className="fixed inset-0 z-[105] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="inbox-panel"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-xl ros-popup-card-shadow w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-3 border-b border-border bg-surface-sunken">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-title font-semibold text-foreground">Inbox</h3>
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-foreground-muted hover:text-foreground"
                aria-label="Close"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </Tooltip>
          </div>
          {/* Segmented tabs. The badge count rides on each label. */}
          <div className="flex items-center gap-1" role="tablist">
            <TabButton
              active={segment === "shared"}
              onClick={() => setSegment("shared")}
              label="Shared with me"
              count={sharesCount}
            />
            <TabButton
              active={segment === "photos"}
              onClick={() => setSegment("photos")}
              label="Photos"
              count={photosCount}
            />
          </div>
        </div>

        {/* Tab bodies. Only the active segment renders, so each owns its own
            load + state cleanly. */}
        {segment === "photos" ? <PhotosInboxTab /> : <SharedWithMeTab />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative px-3 py-2 text-meta font-medium transition-colors border-b-2 -mb-px ${
        active
          ? "border-blue-600 text-blue-700 dark:text-blue-300"
          : "border-transparent text-foreground-muted hover:text-foreground"
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`ml-1.5 px-1.5 py-0.5 text-meta font-semibold rounded-full ${
            active ? "bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-200" : "bg-foreground-muted/20 text-foreground"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
