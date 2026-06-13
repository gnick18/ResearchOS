"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cellCultureApi, methodsApi as rawMethodsApi } from "@/lib/local-api";
import type {
  CellCultureCellLine,
  CellCultureMedia,
  CellCulturePlannedEvent,
  CellCultureSchedule,
  Method,
  MethodUpdate,
} from "@/lib/types";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import Tooltip from "@/components/Tooltip";
import CellCultureScheduleEditor from "@/components/CellCultureScheduleEditor";
import { GlobeIcon, LockIcon } from "@/lib/utils/icons";
import { useMethodPermissions } from "@/hooks/useMethodPermissions";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { isWholeLabShared } from "@/lib/sharing/unified";

/**
 * Read-write viewer for a cell-culture passaging schedule method, shown by
 * the /methods modal. Mirrors `LcViewer` — explicit Save button persists the
 * edited schedule back to the source `cell_culture_schedules/<id>.json`.
 */
export interface CellCultureViewerProps {
  method: Method;
  currentUser: string;
  onClose: () => void;
  onDelete: (id: number) => void;
}

function effectiveOwnerOf(method: Method): string | undefined {
  return method.is_shared_with_me && method.shared_permission === "edit"
    ? method.owner
    : undefined;
}

function ownerScopedMethodsApi(method: Method) {
  const owner = effectiveOwnerOf(method);
  return {
    ...rawMethodsApi,
    get: (id: number) => rawMethodsApi.get(id, owner),
    update: (id: number, data: MethodUpdate) => rawMethodsApi.update(id, data, owner),
  };
}

function extractCellCultureScheduleId(sourcePath: string): number | null {
  const match = sourcePath.match(/^cell_culture:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default function CellCultureViewer({
  method,
  currentUser,
  onClose,
  onDelete,
}: CellCultureViewerProps) {
  // R1c: permissions resolve through `useMethodPermissions` (canRead /
  // canWrite / canReadMethodViaTask). `currentUser` is still consumed
  // below as the `ownerUsername` fallback for the share dialog when a
  // method record has neither `owner` nor `created_by` set.
  const queryClient = useQueryClient();
  const { canModifyMethod } = useMethodPermissions();
  const { canShare } = useAccountCapabilities();
  const [currentMethod, setCurrentMethod] = useState(method);
  const [schedule, setSchedule] = useState<CellCultureSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);

  const [cellLine, setCellLine] = useState<CellCultureCellLine>({});
  const [media, setMedia] = useState<CellCultureMedia>({});
  const [plannedEvents, setPlannedEvents] = useState<CellCulturePlannedEvent[]>([]);
  const [description, setDescription] = useState<string | null>(null);

  const scopedMethodsApi = useMemo(
    () => ownerScopedMethodsApi(currentMethod),
    [currentMethod],
  );

  const scheduleId = method.source_path
    ? extractCellCultureScheduleId(method.source_path)
    : null;
  const scheduleOwner = method.owner || undefined;

  useEffect(() => {
    if (scheduleId === null) {
      setLoading(false);
      return;
    }
    cellCultureApi
      .get(scheduleId, scheduleOwner)
      .then((data) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setSchedule(data);
        setCellLine(data.cell_line ?? {});
        setMedia(data.media ?? {});
        setPlannedEvents(data.planned_events ?? []);
        setDescription(data.description ?? null);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [scheduleId, scheduleOwner]);

  const persist = useCallback(
    async (patch: Partial<CellCultureSchedule>) => {
      if (scheduleId === null) return;
      try {
        await cellCultureApi.update(scheduleId, patch, scheduleOwner);
        await queryClient.refetchQueries({ queryKey: ["methods"] });
      } catch (err) {
        console.error("Failed to save cell culture schedule changes:", err);
      }
    },
    [scheduleId, scheduleOwner, queryClient],
  );

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    try {
      await persist({
        cell_line: cellLine,
        media,
        planned_events: plannedEvents,
        description,
      });
    } finally {
      setSaving(false);
    }
  }, [persist, cellLine, media, plannedEvents, description]);

  const canModify = canModifyMethod(currentMethod);
  const isWholeLab =
    currentMethod.is_public || isWholeLabShared(currentMethod.shared_with);

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-body font-semibold text-foreground">{currentMethod.name}</h3>
            <p className="text-meta text-foreground-muted mt-0.5">Cell culture passaging</p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && canShare && (
              <Tooltip label="Share method" placement="bottom">
                <button
                  onClick={() => setShowSharePopup(true)}
                  className={`px-3 py-1.5 text-meta rounded-lg ${
                    isWholeLab
                      ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-500/20"
                      : "bg-surface-sunken text-foreground-muted hover:bg-foreground-muted/15"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {isWholeLab ? <GlobeIcon /> : <LockIcon />}
                    {isWholeLab ? "Public" : "Private"}
                  </span>
                </button>
              </Tooltip>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-meta text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                Delete
              </button>
            )}
            <button
              onClick={handleSaveAll}
              disabled={saving || loading || scheduleId === null}
              className="px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-foreground-muted hover:text-foreground text-heading ml-2"
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-body text-foreground-muted animate-pulse">Loading cell culture schedule…</p>
          ) : !schedule ? (
            <div className="text-center py-8">
              <p className="text-body text-foreground-muted">
                Cell culture schedule not found. It may have been deleted.
              </p>
            </div>
          ) : (
            <CellCultureScheduleEditor
              cellLine={cellLine}
              onCellLineChange={canModify ? setCellLine : undefined}
              media={media}
              onMediaChange={canModify ? setMedia : undefined}
              plannedEvents={plannedEvents}
              onPlannedEventsChange={canModify ? setPlannedEvents : undefined}
              description={description}
              onDescriptionChange={canModify ? setDescription : undefined}
              readOnly={!canModify}
            />
          )}
        </div>
      </div>

      {/* Unified Share dialog. The viewer's Public / Private pill opens this
          two-tab surface (lab ACL + cross-boundary send) instead of the bare
          lab-ACL dialog, matching the method viewer's action-strip Share
          button (Unified Share entry point, 2026-06-04). */}
      {showSharePopup && (
        <UnifiedShareDialog
          isOpen
          target={{
            kind: "method",
            method: currentMethod,
            owner:
              currentMethod.owner || currentMethod.created_by || currentUser,
          }}
          onClose={() => setShowSharePopup(false)}
          onShared={() => {
            queryClient.refetchQueries({ queryKey: ["methods"] });
            scopedMethodsApi.get(currentMethod.id).then((updatedMethod) => {
              if (updatedMethod) setCurrentMethod(updatedMethod);
            });
          }}
        />
      )}
    </>
  );
}
