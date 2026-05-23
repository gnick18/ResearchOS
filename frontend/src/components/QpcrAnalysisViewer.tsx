"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qpcrAnalysisApi, methodsApi as rawMethodsApi } from "@/lib/local-api";
import type {
  Method,
  MethodUpdate,
  QPCRAnalysisProtocol,
  QPCRChemistry,
  QPCRMeltCurveConfig,
  QPCRReference,
  QPCRStandardCurvePoint,
} from "@/lib/types";
import ShareDialogAdapter from "@/components/sharing/ShareDialogAdapter";
import Tooltip from "@/components/Tooltip";
import QpcrAnalysisEditor from "@/components/QpcrAnalysisEditor";
import { GlobeIcon, LockIcon } from "@/lib/utils/icons";

/**
 * Read-write modal viewer for a qPCR analysis method, shown by /methods.
 * Mirrors LcViewer's per-section save flow: all edits are batched into a
 * single explicit Save click against the source protocol record.
 */
export interface QpcrAnalysisViewerProps {
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

function extractQpcrAnalysisId(sourcePath: string): number | null {
  const match = sourcePath.match(/^qpcr_analysis:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default function QpcrAnalysisViewer({
  method,
  currentUser,
  onClose,
  onDelete,
}: QpcrAnalysisViewerProps) {
  const queryClient = useQueryClient();
  const [currentMethod, setCurrentMethod] = useState(method);
  const [protocol, setProtocol] = useState<QPCRAnalysisProtocol | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);

  const [chemistry, setChemistry] = useState<QPCRChemistry>("sybr");
  const [chemistryLabel, setChemistryLabel] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [references, setReferences] = useState<QPCRReference[]>([]);
  const [standardCurve, setStandardCurve] = useState<QPCRStandardCurvePoint[]>([]);
  const [meltCurve, setMeltCurve] = useState<QPCRMeltCurveConfig | null>(null);
  const [useDeltaDeltaCq, setUseDeltaDeltaCq] = useState(true);

  const scopedMethodsApi = useMemo(() => ownerScopedMethodsApi(currentMethod), [currentMethod]);

  const qpcrId = method.source_path ? extractQpcrAnalysisId(method.source_path) : null;
  const protocolOwner = method.owner || undefined;

  useEffect(() => {
    if (qpcrId === null) {
      setLoading(false);
      return;
    }
    qpcrAnalysisApi
      .get(qpcrId, protocolOwner)
      .then((data) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setProtocol(data);
        setChemistry(data.chemistry);
        setChemistryLabel(data.chemistry_label ?? null);
        setDescription(data.description ?? null);
        setReferences(data.references ?? []);
        setStandardCurve(data.standard_curve ?? []);
        setMeltCurve(data.melt_curve ?? null);
        setUseDeltaDeltaCq(data.use_delta_delta_cq);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [qpcrId, protocolOwner]);

  const persist = useCallback(
    async (patch: Partial<QPCRAnalysisProtocol>) => {
      if (qpcrId === null) return;
      try {
        await qpcrAnalysisApi.update(qpcrId, patch, protocolOwner);
        await queryClient.refetchQueries({ queryKey: ["methods"] });
      } catch (err) {
        console.error("Failed to save qPCR analysis changes:", err);
      }
    },
    [qpcrId, protocolOwner, queryClient],
  );

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    try {
      await persist({
        chemistry,
        chemistry_label: chemistryLabel,
        description,
        references,
        standard_curve: standardCurve,
        melt_curve: meltCurve,
        use_delta_delta_cq: useDeltaDeltaCq,
      });
    } finally {
      setSaving(false);
    }
  }, [persist, chemistry, chemistryLabel, description, references, standardCurve, meltCurve, useDeltaDeltaCq]);

  const canModify = !currentMethod.is_public || currentMethod.created_by === currentUser;

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{currentMethod.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">qPCR analysis</p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && (
              <Tooltip label="Share method" placement="bottom">
                <button
                  onClick={() => setShowSharePopup(true)}
                  className={`px-3 py-1.5 text-xs rounded-lg ${
                    currentMethod.is_public
                      ? "bg-green-50 text-green-600 hover:bg-green-100"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {currentMethod.is_public ? <GlobeIcon /> : <LockIcon />}
                    {currentMethod.is_public ? "Public" : "Private"}
                  </span>
                </button>
              </Tooltip>
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
              disabled={saving || loading || qpcrId === null}
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
            <p className="text-sm text-gray-400 animate-pulse">Loading qPCR analysis…</p>
          ) : !protocol ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">
                qPCR analysis protocol not found. It may have been deleted.
              </p>
            </div>
          ) : (
            <QpcrAnalysisEditor
              chemistry={chemistry}
              onChemistryChange={canModify ? setChemistry : undefined}
              chemistryLabel={chemistryLabel}
              onChemistryLabelChange={canModify ? setChemistryLabel : undefined}
              description={description}
              onDescriptionChange={canModify ? setDescription : undefined}
              useDeltaDeltaCq={useDeltaDeltaCq}
              onUseDeltaDeltaCqChange={canModify ? setUseDeltaDeltaCq : undefined}
              references={references}
              onReferencesChange={canModify ? setReferences : undefined}
              standardCurve={standardCurve}
              onStandardCurveChange={canModify ? setStandardCurve : undefined}
              meltCurve={meltCurve}
              onMeltCurveChange={canModify ? setMeltCurve : undefined}
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
