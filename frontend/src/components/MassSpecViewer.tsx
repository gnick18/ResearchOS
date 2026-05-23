"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { massSpecApi, methodsApi as rawMethodsApi } from "@/lib/local-api";
import type {
  IonizationMode,
  MassSpecCalibration,
  MassSpecProtocol,
  MassSpecScanParams,
  MassSpecSourceParams,
  Method,
  MethodUpdate,
} from "@/lib/types";
import SharePopup from "@/components/SharePopup";
import Tooltip from "@/components/Tooltip";
import MassSpecEditor from "@/components/MassSpecEditor";
import { GlobeIcon, LockIcon } from "@/lib/utils/icons";

/**
 * Read-write viewer for a mass spec method, shown by the /methods modal.
 * Mirrors `LcViewer` — explicit "Save" button writes the source protocol
 * record back. No per-task snapshot story to manage (mass spec is a static
 * template per proposal §4.5).
 */
export interface MassSpecViewerProps {
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

function extractMassSpecProtocolId(sourcePath: string): number | null {
  const match = sourcePath.match(/^mass_spec:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default function MassSpecViewer({
  method,
  currentUser,
  onClose,
  onDelete,
}: MassSpecViewerProps) {
  const queryClient = useQueryClient();
  const [currentMethod, setCurrentMethod] = useState(method);
  const [protocol, setProtocol] = useState<MassSpecProtocol | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);

  const [ionizationMode, setIonizationMode] = useState<IonizationMode>("esi_pos");
  const [ionizationLabel, setIonizationLabel] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [source, setSource] = useState<MassSpecSourceParams>({});
  const [scan, setScan] = useState<MassSpecScanParams>({ is_msms: false });
  const [calibration, setCalibration] = useState<MassSpecCalibration>({});

  const scopedMethodsApi = useMemo(
    () => ownerScopedMethodsApi(currentMethod),
    [currentMethod],
  );

  const msId = method.source_path ? extractMassSpecProtocolId(method.source_path) : null;
  const protocolOwner = method.owner || undefined;

  useEffect(() => {
    if (msId === null) {
      setLoading(false);
      return;
    }
    massSpecApi
      .get(msId, protocolOwner)
      .then((data) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setProtocol(data);
        setIonizationMode(data.ionization_mode);
        setIonizationLabel(data.ionization_label ?? null);
        setInstrument(data.instrument ?? null);
        setDescription(data.description ?? null);
        setSource(data.source ?? {});
        setScan(data.scan ?? { is_msms: false });
        setCalibration(data.calibration ?? {});
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [msId, protocolOwner]);

  const persist = useCallback(
    async (patch: Partial<MassSpecProtocol>) => {
      if (msId === null) return;
      try {
        await massSpecApi.update(msId, patch, protocolOwner);
        await queryClient.refetchQueries({ queryKey: ["methods"] });
      } catch (err) {
        console.error("Failed to save mass spec changes:", err);
      }
    },
    [msId, protocolOwner, queryClient],
  );

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    try {
      await persist({
        ionization_mode: ionizationMode,
        ionization_label: ionizationLabel,
        instrument,
        description,
        source,
        scan,
        calibration,
      });
    } finally {
      setSaving(false);
    }
  }, [persist, ionizationMode, ionizationLabel, instrument, description, source, scan, calibration]);

  const canModify = !currentMethod.is_public || currentMethod.created_by === currentUser;

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{currentMethod.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Mass spec method</p>
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
              disabled={saving || loading || msId === null}
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
            <p className="text-sm text-gray-400 animate-pulse">Loading mass spec method…</p>
          ) : !protocol ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">
                Mass spec protocol not found. It may have been deleted.
              </p>
            </div>
          ) : (
            <MassSpecEditor
              ionizationMode={ionizationMode}
              onIonizationModeChange={canModify ? setIonizationMode : undefined}
              ionizationLabel={ionizationLabel}
              onIonizationLabelChange={canModify ? setIonizationLabel : undefined}
              instrument={instrument}
              onInstrumentChange={canModify ? setInstrument : undefined}
              description={description}
              onDescriptionChange={canModify ? setDescription : undefined}
              source={source}
              onSourceChange={canModify ? setSource : undefined}
              scan={scan}
              onScanChange={canModify ? setScan : undefined}
              calibration={calibration}
              onCalibrationChange={canModify ? setCalibration : undefined}
              readOnly={!canModify}
              showAllFields={showAllFields}
              onShowAllFieldsChange={setShowAllFields}
            />
          )}
        </div>
      </div>

      {showSharePopup && (
        <SharePopup
          isOpen={showSharePopup}
          onClose={() => setShowSharePopup(false)}
          itemType="method"
          itemId={currentMethod.id}
          itemName={currentMethod.name}
          currentOwner={currentMethod.owner || currentMethod.created_by || currentUser}
          currentSharedWith={currentMethod.shared_with || []}
          isPublic={currentMethod.is_public}
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
