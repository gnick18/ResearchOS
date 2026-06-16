"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { lcGradientApi, methodsApi as rawMethodsApi } from "@/lib/local-api";
import type {
  LCGradientColumn,
  LCGradientProtocol,
  LCGradientStep,
  LCIngredient,
  Method,
  MethodUpdate,
} from "@/lib/types";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import Tooltip from "@/components/Tooltip";
import { GlobeIcon, LockIcon } from "@/lib/utils/icons";
import LcGradientEditor from "@/components/LcGradientEditor";
import { useMethodPermissions } from "@/hooks/useMethodPermissions";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { isWholeLabShared } from "@/lib/sharing/unified";

/**
 * Read-write viewer for an LC gradient method, shown by the /methods modal.
 * Equivalent to `PcrViewer` in app/methods/page.tsx — saves are auto-debounced
 * on the gradient/column/wavelength fields and on an explicit "Save" for the
 * ingredients table (mirrors the editing pattern of PcrViewer's recipe).
 */
export interface LcViewerProps {
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

function extractLcProtocolId(sourcePath: string): number | null {
  const match = sourcePath.match(/^lc_gradient:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default function LcViewer({
  method,
  currentUser,
  onClose,
  onDelete,
}: LcViewerProps) {
  const queryClient = useQueryClient();
  const { canModifyMethod } = useMethodPermissions();
  const { canShare } = useAccountCapabilities();
  const [currentMethod, setCurrentMethod] = useState(method);
  const [protocol, setProtocol] = useState<LCGradientProtocol | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);

  const [gradientSteps, setGradientSteps] = useState<LCGradientStep[]>([]);
  const [column, setColumn] = useState<LCGradientColumn>({});
  const [wavelength, setWavelength] = useState<number | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<LCIngredient[]>([]);

  const scopedMethodsApi = useMemo(() => ownerScopedMethodsApi(currentMethod), [currentMethod]);

  const lcId = method.source_path ? extractLcProtocolId(method.source_path) : null;
  const protocolOwner = method.owner || undefined;

  useEffect(() => {
    if (lcId === null) {
      setLoading(false);
      return;
    }
    lcGradientApi
      .get(lcId, protocolOwner)
      .then((data) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setProtocol(data);
        setGradientSteps(data.gradient_steps ?? []);
        setColumn(data.column ?? {});
        setWavelength(data.detection_wavelength_nm ?? null);
        setDescription(data.description ?? null);
        setIngredients(data.ingredients ?? []);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [lcId, protocolOwner]);

  const persist = useCallback(
    async (patch: Partial<LCGradientProtocol>) => {
      if (lcId === null) return;
      try {
        await lcGradientApi.update(lcId, patch, protocolOwner);
        await queryClient.refetchQueries({ queryKey: ["methods"] });
      } catch (err) {
        console.error("Failed to save LC gradient changes:", err);
      }
    },
    [lcId, protocolOwner, queryClient],
  );

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    try {
      await persist({
        gradient_steps: gradientSteps,
        column,
        detection_wavelength_nm: wavelength,
        description,
        ingredients,
      });
    } finally {
      setSaving(false);
    }
  }, [persist, gradientSteps, column, wavelength, description, ingredients]);

  // R1c: unified canWrite gate.
  const canModify = canModifyMethod(currentMethod);
  const isWholeLab =
    currentMethod.is_public || isWholeLabShared(currentMethod.shared_with);

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-body font-semibold text-foreground">{currentMethod.name}</h3>
            <p className="text-meta text-foreground-muted mt-0.5">LC Gradient</p>
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
              disabled={saving || loading || lcId === null}
              className="ros-btn-raise px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
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
            <p className="text-body text-foreground-muted animate-pulse">Loading LC gradient…</p>
          ) : !protocol ? (
            <div className="text-center py-8">
              <p className="text-body text-foreground-muted">LC gradient protocol not found. It may have been deleted.</p>
            </div>
          ) : (
            <LcGradientEditor
              gradientSteps={gradientSteps}
              onGradientStepsChange={canModify ? setGradientSteps : undefined}
              column={column}
              onColumnChange={canModify ? setColumn : undefined}
              detectionWavelengthNm={wavelength}
              onDetectionWavelengthChange={canModify ? setWavelength : undefined}
              description={description}
              onDescriptionChange={canModify ? setDescription : undefined}
              ingredients={ingredients}
              onIngredientsChange={canModify ? setIngredients : undefined}
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
