"use client";

// Unified Share entry point (2026-06-04). One Share button per entity opens
// THIS dialog. It collapses the two share affordances every shareable entity
// used to show (the internal lab ACL + the cross-boundary "Share outside this
// folder" send) into ONE dialog with two clearly labelled tabs.
//
// Design: docs/proposals/UNIFIED_SHARE_ENTRY_POINT.md. Grant's decisions
// (2026-06-04): TWO TABS (not stacked), and UPGRADE NOTES to the full
// per-person lab ACL.
//
// This is a consolidation layer, NOT a rewrite of either mechanism:
//   - "In your lab" tab  -> the existing ShareDialog body (per-person read /
//     edit + whole-lab "*"), persisted through the existing ShareDialogAdapter.
//     Rendered chromeless via the adapter's `embedded` prop.
//   - "Outside your lab" tab -> the existing *SendOutsideDialog body for the
//     entity kind (encrypted-copy snapshot + invite-a-non-user), rendered
//     chromeless via each dialog's `embedded` prop. The useSharingIdentity gate
//     and the setup wizard are reused exactly.
//
// Per-entity tab logic:
//   - note / experiment / method / project  -> BOTH tabs.
//   - sequence  -> Outside ONLY (sequences have no lab-ACL model). The dialog
//     still opens from the same Share button; it just renders one tab.
//   - solo / no-lab user (no other active members in the folder) -> the lab tab
//     shows its empty state and the dialog defaults to the Outside tab. The lab
//     tab is NOT hidden (an explained empty state is clearer than a missing
//     tab); sharing is never hidden for solo users.

import { useMemo, useState } from "react";

import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import type { OpenOrigin } from "@/lib/ui/create-popup-store";
import ShareDialogAdapter from "@/components/sharing/ShareDialogAdapter";
import SendOutsideDialog from "@/components/sharing/SendOutsideDialog";
import ExperimentSendOutsideDialog from "@/components/sharing/ExperimentSendOutsideDialog";
import MethodSendOutsideDialog from "@/components/sharing/MethodSendOutsideDialog";
import ProjectSendOutsideDialog from "@/components/sharing/ProjectSendOutsideDialog";
import SequenceSendOutsideDialog from "@/components/sharing/SequenceSendOutsideDialog";
import ExternalCollabSection from "@/components/sharing/ExternalCollabSection";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { useArchivedUsers } from "@/hooks/useArchivedUsers";
import SharingServerCopyNotice from "@/components/sharing/SharingServerCopyNotice";
import { CopyMoveToFolderButton } from "@/components/transfer/FolderDestinationPicker";
import type { TransferTarget } from "@/lib/transfer/local-folder-transfer";
import type {
  Note,
  Task,
  Method,
  Project,
  SequenceDetail,
} from "@/lib/types";

// The discriminated entity this dialog shares. `owner` is the folder-local
// username that owns the record (the lab-ACL owner + the cross-boundary collect
// root). Sequences carry no owner / shared_with model, so the kind alone gates
// the tab set.
export type ShareTarget =
  | { kind: "note"; note: Note; owner: string }
  | { kind: "experiment"; task: Task; owner: string }
  | { kind: "method"; method: Method; owner: string }
  | { kind: "project"; project: Project; owner: string }
  | { kind: "sequence"; sequence: SequenceDetail; owner: string };

export interface UnifiedShareDialogProps {
  /** Render-gated by the caller; the dialog returns null when not open. */
  isOpen: boolean;
  /** Dismiss the whole dialog. */
  onClose: () => void;
  /** The entity to share (discriminated by `kind`). */
  target: ShareTarget;
  /** Called after a lab-ACL save completes so the caller refetches. The
   *  cross-boundary send path is self-contained and does not need this. */
  onShared?: () => void;
  /** Screen point the Share button was clicked, for the zoom animation.
   *  Optional; LivingPopup falls back to a soft default zoom when absent. */
  origin?: OpenOrigin | null;
}

type TabKey = "lab" | "outside";

function recordName(target: ShareTarget): string {
  switch (target.kind) {
    case "note":
      return target.note.title || "Untitled note";
    case "experiment":
      return target.task.name;
    case "method":
      return target.method.name;
    case "project":
      return target.project.name;
    case "sequence":
      return target.sequence.display_name;
  }
}

export default function UnifiedShareDialog({
  isOpen,
  onClose,
  target,
  onShared,
  origin = null,
}: UnifiedShareDialogProps) {
  // Sequences have no lab-ACL model, so the lab tab is not shown for them.
  const hasLabTab = target.kind !== "sequence";

  // Solo / no-lab detection: the lab roster minus the owner minus archived
  // users. When empty, the lab tab still renders (with its empty state) but the
  // dialog defaults to the Outside tab.
  const labProfileMap = useLabUserProfileMap();
  const archivedSet = useArchivedUsers();
  const labRosterCount = useMemo(() => {
    return Object.keys(labProfileMap).filter(
      (u) => u !== target.owner && !archivedSet.has(u),
    ).length;
  }, [labProfileMap, archivedSet, target.owner]);
  const isSolo = labRosterCount === 0;

  // Default tab: the lab tab unless there is no lab tab (sequence) or the user
  // is solo, in which case open on Outside.
  const defaultTab: TabKey = hasLabTab && !isSolo ? "lab" : "outside";
  const [tab, setTab] = useState<TabKey>(defaultTab);

  // Escape, scrim click, and the close X are all owned by LivingPopup below.

  const activeTab: TabKey = hasLabTab ? tab : "outside";

  return (
    <LivingPopup
      open={isOpen}
      onClose={onClose}
      origin={origin}
      label="Share"
      widthClassName="max-w-md"
      // This dialog brings its own card chrome (header + tabs + scroll body),
      // and its own header X, so LivingPopup contributes only the scrim, the
      // zoom, and the shared popup-stack membership (so it stacks above whatever
      // popup opened it and never double-dims the page behind it).
      card={false}
      showClose={false}
    >
      <div
        className="relative w-full rounded-xl bg-surface-raised shadow-xl max-h-[88vh] overflow-hidden flex flex-col"
        data-tour-target="share-dialog"
      >
        {/* Shared header chrome (title + record name + close). */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-heading font-semibold text-foreground">Share</h2>
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-foreground-muted hover:text-foreground-muted transition-colors"
                aria-label="Close share dialog"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </Tooltip>
          </div>
          <p className="text-body text-foreground-muted mt-1 truncate">
            {recordName(target)}
          </p>
        </div>

        {/* Tabs. For a sequence there is only the Outside tab, so we render a
            single static label rather than a clickable tab strip. */}
        {hasLabTab ? (
          <div className="px-6 pt-3 flex gap-1" role="tablist">
            <TabButton
              label="In your lab"
              active={activeTab === "lab"}
              onClick={() => setTab("lab")}
            />
            <TabButton
              label="Outside your lab"
              active={activeTab === "outside"}
              onClick={() => setTab("outside")}
            />
          </div>
        ) : (
          <div className="px-6 pt-3">
            <span className="inline-block px-3 py-1.5 text-body font-medium text-foreground border-b-2 border-blue-600">
              Outside your lab
            </span>
          </div>
        )}

        {/* Per-tab explainer (one plain line) + the reused body. */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "lab" ? (
            <div>
              <p className="px-6 pt-3 pb-1 text-meta text-foreground-muted leading-relaxed">
                People in your folder. They see your live copy and your edits.
              </p>
              <SharingServerCopyNotice className="mx-6 mt-1 mb-2" />
              <LabTabBody
                target={target}
                onClose={onClose}
                onShared={onShared}
              />
            </div>
          ) : (
            <div>
              <p className="px-6 pt-3 pb-1 text-meta text-foreground-muted leading-relaxed">
                Send an encrypted copy to someone by email. A snapshot, their own
                copy.
              </p>
              <div className="px-5 pb-5">
                <OutsideTabBody target={target} onClose={onClose} />
              </div>
            </div>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1.5 text-body font-medium border-b-2 transition-colors ${
        active
          ? "border-blue-600 text-foreground"
          : "border-transparent text-foreground-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// The "In your lab" tab. Maps the entity kind to the existing
// ShareDialogRecordType + record, and persists through ShareDialogAdapter
// (chromeless). Sequences never reach here (no lab tab).
function LabTabBody({
  target,
  onClose,
  onShared,
}: {
  target: ShareTarget;
  onClose: () => void;
  onShared?: () => void;
}) {
  const refetch = onShared ?? (() => {});

  switch (target.kind) {
    case "note":
      return (
        <ShareDialogAdapter
          isOpen
          embedded
          onClose={onClose}
          recordType="note"
          recordId={target.note.id}
          recordName={target.note.title || "Untitled note"}
          ownerUsername={target.owner}
          currentSharedWith={target.note.shared_with || []}
          onShared={refetch}
        />
      );
    case "experiment":
      return (
        <ShareDialogAdapter
          isOpen
          embedded
          onClose={onClose}
          recordType="task"
          recordId={target.task.id}
          recordName={target.task.name}
          ownerUsername={target.owner}
          currentSharedWith={target.task.shared_with || []}
          onShared={refetch}
        />
      );
    case "method":
      return (
        <ShareDialogAdapter
          isOpen
          embedded
          onClose={onClose}
          recordType="method"
          recordId={target.method.id}
          recordName={target.method.name}
          ownerUsername={target.owner}
          currentSharedWith={target.method.shared_with || []}
          onShared={refetch}
        />
      );
    case "project":
      return (
        <ShareDialogAdapter
          isOpen
          embedded
          onClose={onClose}
          recordType="project"
          recordId={target.project.id}
          recordName={target.project.name}
          ownerUsername={target.owner}
          currentSharedWith={target.project.shared_with || []}
          onShared={refetch}
        />
      );
    case "sequence":
      // Unreachable: sequences have no lab tab. Render nothing defensively.
      return null;
  }
}

// The "Outside your lab" tab. Maps the entity kind to the matching
// cross-boundary send body (chromeless via `embedded`). The send / invite logic
// and the identity gate live inside each dialog, unchanged.
function OutsideTabBody({
  target,
  onClose,
}: {
  target: ShareTarget;
  onClose: () => void;
}) {
  // External collaboration is gated through the ONE capability now, replacing
  // the hand-rolled `isRealSharingEnabled() && EXTERNAL_COLLAB_ENABLED` that
  // diverged from SharedWithMeTab's `status === "ready" && email`.
  // (capabilities bot, 2026-06-13)
  const { canCollabExternally } = useAccountCapabilities();

  return (
    <>
      <OutsideSendBody
        target={target}
        onClose={onClose}
        canCollabExternally={canCollabExternally}
      />
      {/* Cross-folder: "Another folder of mine". Flag-gated; renders nothing
          when CROSS_FOLDER is off, when no eligible destination exists, or for
          a kind without a two-handle transfer path (CopyMoveToFolderButton
          self-hides). Same disk, same account, no relay, so this sits below the
          email-send body as a sibling destination. */}
      <CrossFolderShareSection target={target} />
    </>
  );
}

/** A short mapping from the dialog's ShareTarget to the cross-folder
 *  TransferTarget. Returns null for a kind the cross-folder lane cannot transfer
 *  (the heavy zip-closure kinds and any future unsupported kind), so the section
 *  renders nothing rather than a doomed button. */
function toTransferTarget(target: ShareTarget): TransferTarget | null {
  switch (target.kind) {
    case "note":
      return { kind: "note", note: target.note, sourceUsername: target.owner };
    case "sequence":
      return {
        kind: "sequence",
        sequence: target.sequence,
        sourceUsername: target.owner,
      };
    // method / experiment / project have a relay builder but no two-handle
    // materialize yet, so they are intentionally not offered here.
    default:
      return null;
  }
}

/** The "Another folder of mine" destination, shown below the email-send body.
 *  Self-hides via CopyMoveToFolderButton when the flag is off, when there is no
 *  eligible destination, or for an unmapped kind. */
function CrossFolderShareSection({ target }: { target: ShareTarget }) {
  const transferTarget = toTransferTarget(target);
  if (!transferTarget) return null;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="mb-2 text-meta text-foreground-muted leading-relaxed">
        Or put a copy in another of your folders. Same account, no email, no
        encryption hop, it is a straight disk-to-disk copy.
      </p>
      <CopyMoveToFolderButton target={transferTarget} />
    </div>
  );
}

/** The original per-kind email-send body, unchanged. Split out so the
 *  cross-folder section can sit beside it without re-indenting the switch. */
function OutsideSendBody({
  target,
  onClose,
  canCollabExternally,
}: {
  target: ShareTarget;
  onClose: () => void;
  canCollabExternally: boolean;
}) {
  switch (target.kind) {
    case "note":
      return (
        <>
          <SendOutsideDialog
            embedded
            note={target.note}
            ownerUsername={target.owner}
            onClose={onClose}
          />
          {canCollabExternally ? (
            <div className="mt-4">
              <ExternalCollabSection
                note={target.note}
                ownerUsername={target.owner}
              />
            </div>
          ) : null}
        </>
      );
    case "experiment":
      return (
        <ExperimentSendOutsideDialog
          embedded
          task={target.task}
          ownerUsername={target.owner}
          onClose={onClose}
        />
      );
    case "method":
      return (
        <MethodSendOutsideDialog
          embedded
          method={target.method}
          ownerUsername={target.owner}
          onClose={onClose}
        />
      );
    case "project":
      return (
        <ProjectSendOutsideDialog
          embedded
          project={target.project}
          ownerUsername={target.owner}
          onClose={onClose}
        />
      );
    case "sequence":
      return (
        <SequenceSendOutsideDialog
          embedded
          sequence={target.sequence}
          ownerUsername={target.owner}
          onClose={onClose}
        />
      );
  }
}
