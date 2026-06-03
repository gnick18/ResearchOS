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
import ShareDialogAdapter from "@/components/sharing/ShareDialogAdapter";
import Tooltip from "@/components/Tooltip";
import CellCultureScheduleEditor from "@/components/CellCultureScheduleEditor";
import { GlobeIcon, LockIcon } from "@/lib/utils/icons";
import { useMethodPermissions } from "@/hooks/useMethodPermissions";
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-body font-semibold text-gray-900">{currentMethod.name}</h3>
            <p className="text-meta text-gray-400 mt-0.5">Cell culture passaging</p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && (
              <button
                onClick={() => setShowSharePopup(true)}
                className={`px-3 py-1.5 text-meta rounded-lg ${
                  isWholeLab
                    ? "bg-green-50 text-green-600 hover:bg-green-100"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                title="Share method"
              >
                <span className="flex items-center gap-1">
                  {isWholeLab ? <GlobeIcon /> : <LockIcon />}
                  {isWholeLab ? "Public" : "Private"}
                </span>
              </button>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-meta text-red-500 rounded-lg hover:bg-red-50"
              >
                Delete
              </button>
            )}
            <button
              onClick={handleSaveAll}
              disabled={saving || loading || scheduleId === null}
              className="px-3 py-1.5 text-meta text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 text-lg ml-2"
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-body text-gray-400 animate-pulse">Loading cell culture schedule…</p>
          ) : !schedule ? (
            <div className="text-center py-8">
              <p className="text-body text-gray-500">
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

      {showSharePopup && (
        <ShareDialogAdapter
          isOpen={showSharePopup}
          onClose={() => setShowSharePopup(false)}
          recordType="method"
          recordId={currentMethod.id}
          recordName={currentMethod.name}
          ownerUsername={currentMethod.owner || currentMethod.created_by || currentUser}
          currentSharedWith={currentMethod.shared_with || []}
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
