"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { plateApi, methodsApi as rawMethodsApi } from "@/lib/local-api";
import type {
  Method,
  MethodUpdate,
  PlateProtocol,
  PlateRegionLabel,
  PlateSize,
  PlateWellAnnotation,
} from "@/lib/types";
import ShareDialogAdapter from "@/components/sharing/ShareDialogAdapter";
import Tooltip from "@/components/Tooltip";
import { GlobeIcon, LockIcon } from "@/lib/utils/icons";
import PlateLayoutEditor, {
  regionLabelsToWells,
  wellsToRegionLabels,
} from "@/components/PlateLayoutEditor";

/**
 * Read-write viewer for a Plate method, shown by the /methods modal. Mirrors
 * `LcViewer` / `PcrViewer`: the editor edits a per-well annotation map, and on
 * Save the wells are projected back to `region_labels` (1×1 rectangles) on
 * the source PlateProtocol.
 */
export interface PlateViewerProps {
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

function extractPlateProtocolId(sourcePath: string): number | null {
  const match = sourcePath.match(/^plate:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default function PlateViewer({
  method,
  currentUser,
  onClose,
  onDelete,
}: PlateViewerProps) {
  const queryClient = useQueryClient();
  const [currentMethod, setCurrentMethod] = useState(method);
  const [protocol, setProtocol] = useState<PlateProtocol | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);

  const [plateSize, setPlateSize] = useState<PlateSize>(96);
  const [wells, setWells] = useState<Record<string, PlateWellAnnotation>>({});
  const [description, setDescription] = useState<string | null>(null);

  const scopedMethodsApi = useMemo(() => ownerScopedMethodsApi(currentMethod), [currentMethod]);

  const plateId = method.source_path ? extractPlateProtocolId(method.source_path) : null;
  const protocolOwner = method.owner || undefined;

  useEffect(() => {
    if (plateId === null) {
      setLoading(false);
      return;
    }
    plateApi
      .get(plateId, protocolOwner)
      .then((data) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setProtocol(data);
        setPlateSize(data.plate_size);
        setWells(regionLabelsToWells(data.region_labels));
        setDescription(data.description ?? null);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [plateId, protocolOwner]);

  const persist = useCallback(
    async (patch: { plate_size?: PlateSize; region_labels?: PlateRegionLabel[]; description?: string | null }) => {
      if (plateId === null) return;
      try {
        await plateApi.update(plateId, patch, protocolOwner);
        await queryClient.refetchQueries({ queryKey: ["methods"] });
      } catch (err) {
        console.error("Failed to save Plate changes:", err);
      }
    },
    [plateId, protocolOwner, queryClient],
  );

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    try {
      await persist({
        plate_size: plateSize,
        region_labels: wellsToRegionLabels(wells),
        description,
      });
    } finally {
      setSaving(false);
    }
  }, [persist, plateSize, wells, description]);

  const canModify = !currentMethod.is_public || currentMethod.created_by === currentUser;

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{currentMethod.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Plate Layout</p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && (
              <button
                onClick={() => setShowSharePopup(true)}
                className={`px-3 py-1.5 text-xs rounded-lg ${
                  currentMethod.is_public
                    ? "bg-green-50 text-green-600 hover:bg-green-100"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                title="Share method"
              >
                <span className="flex items-center gap-1">
                  {currentMethod.is_public ? <GlobeIcon /> : <LockIcon />}
                  {currentMethod.is_public ? "Public" : "Private"}
                </span>
              </button>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-xs text-red-500 rounded-lg hover:bg-red-50"
              >
                Delete
              </button>
            )}
            <button
              onClick={handleSaveAll}
              disabled={saving || loading || plateId === null}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
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
            <p className="text-sm text-gray-400 animate-pulse">Loading plate layout…</p>
          ) : !protocol ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">Plate layout protocol not found. It may have been deleted.</p>
            </div>
          ) : (
            <PlateLayoutEditor
              plateSize={plateSize}
              onPlateSizeChange={canModify ? setPlateSize : undefined}
              wells={wells}
              onWellsChange={canModify ? setWells : undefined}
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
