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
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import Tooltip from "@/components/Tooltip";
import MassSpecEditor from "@/components/MassSpecEditor";
import { GlobeIcon, LockIcon } from "@/lib/utils/icons";
import { useMethodPermissions } from "@/hooks/useMethodPermissions";
import { isWholeLabShared } from "@/lib/sharing/unified";

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
  const { canModifyMethod } = useMethodPermissions();
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
            <p className="text-meta text-foreground-muted mt-0.5">Mass spec method</p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && (
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
              disabled={saving || loading || msId === null}
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
            <p className="text-body text-foreground-muted animate-pulse">Loading mass spec method…</p>
          ) : !protocol ? (
            <div className="text-center py-8">
              <p className="text-body text-foreground-muted">
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
