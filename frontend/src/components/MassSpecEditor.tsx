"use client";

import { useMemo } from "react";
import type {
  IonizationMode,
  MassSpecCalibration,
  MassSpecScanParams,
  MassSpecSourceParams,
} from "@/lib/types";

/**
 * Editor for a mass spec method's source-of-truth protocol record. The
 * `ionization_mode` discriminator drives smart-per-mode field rendering —
 * only fields relevant to the selected mode show up by default, with a
 * "Show all fields" toggle that bypasses the visibility table for the
 * power-user case (e.g. documenting an unusual dual-source run or an
 * instrument-specific param the default mode-table misses).
 *
 * Per proposal §4.5: no per-task snapshot. The experiment-page tab content
 * renders this read-only against the source protocol; there are no
 * `original*` diff-display props to thread through, unlike LC/PCR/plate.
 */
export interface MassSpecEditorProps {
  ionizationMode: IonizationMode;
  onIonizationModeChange?: (mode: IonizationMode) => void;
  ionizationLabel?: string | null;
  onIonizationLabelChange?: (label: string | null) => void;
  instrument?: string | null;
  onInstrumentChange?: (instrument: string | null) => void;
  description?: string | null;
  onDescriptionChange?: (description: string | null) => void;
  source: MassSpecSourceParams;
  onSourceChange?: (source: MassSpecSourceParams) => void;
  scan: MassSpecScanParams;
  onScanChange?: (scan: MassSpecScanParams) => void;
  calibration: MassSpecCalibration;
  onCalibrationChange?: (calibration: MassSpecCalibration) => void;
  /** When true, all inputs render read-only (no editing). */
  readOnly?: boolean;
  /** Power-user override — bypass the per-mode visibility table and show
   *  every source-param field regardless of `ionizationMode`. Controlled
   *  state lives outside the editor so the toggle's checkbox can move into
   *  a header bar if needed. */
  showAllFields: boolean;
  onShowAllFieldsChange?: (show: boolean) => void;
}

const IONIZATION_MODE_OPTIONS: { value: IonizationMode; label: string }[] = [
  { value: "esi_pos", label: "ESI+ (electrospray, positive)" },
  { value: "esi_neg", label: "ESI− (electrospray, negative)" },
  { value: "esi_switching", label: "ESI switching (polarity swap)" },
  { value: "apci_pos", label: "APCI+ (atmospheric pressure chemical, positive)" },
  { value: "apci_neg", label: "APCI− (atmospheric pressure chemical, negative)" },
  { value: "ei", label: "EI (electron ionization, GC-MS)" },
  { value: "maldi", label: "MALDI (matrix-assisted laser desorption)" },
  { value: "other", label: "Other (free-text label)" },
];

/** Per-mode visibility table from proposal §4.4. `true` = field is relevant
 *  to this ionization mode and renders by default; `false` = hidden unless
 *  "Show all fields" is on. The "scan" + "calibration" sections always show
 *  regardless of mode. */
const SOURCE_FIELD_VISIBILITY: Record<
  keyof Omit<MassSpecSourceParams, "other_notes">,
  Partial<Record<IonizationMode, boolean>>
> = {
  source_temp_c: { esi_pos: true, esi_neg: true, esi_switching: true, apci_pos: true, apci_neg: true, ei: true, maldi: false, other: true },
  capillary_kv: { esi_pos: true, esi_neg: true, esi_switching: true, apci_pos: true, apci_neg: true, ei: false, maldi: false, other: true },
  nebulizer_gas_lpm: { esi_pos: true, esi_neg: true, esi_switching: true, apci_pos: true, apci_neg: true, ei: false, maldi: false, other: true },
  drying_gas_lpm: { esi_pos: true, esi_neg: true, esi_switching: true, apci_pos: true, apci_neg: true, ei: false, maldi: false, other: true },
  drying_gas_temp_c: { esi_pos: true, esi_neg: true, esi_switching: true, apci_pos: true, apci_neg: true, ei: false, maldi: false, other: true },
  ei_energy_ev: { esi_pos: false, esi_neg: false, esi_switching: false, apci_pos: false, apci_neg: false, ei: true, maldi: false, other: true },
  maldi_laser_nm: { esi_pos: false, esi_neg: false, esi_switching: false, apci_pos: false, apci_neg: false, ei: false, maldi: true, other: true },
  maldi_laser_energy: { esi_pos: false, esi_neg: false, esi_switching: false, apci_pos: false, apci_neg: false, ei: false, maldi: true, other: true },
  maldi_matrix: { esi_pos: false, esi_neg: false, esi_switching: false, apci_pos: false, apci_neg: false, ei: false, maldi: true, other: true },
};

function isFieldVisible(
  field: keyof Omit<MassSpecSourceParams, "other_notes">,
  mode: IonizationMode,
  showAll: boolean,
): boolean {
  if (showAll) return true;
  return SOURCE_FIELD_VISIBILITY[field]?.[mode] ?? false;
}

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(n);
}

function parseNumberOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function MassSpecEditor({
  ionizationMode,
  onIonizationModeChange,
  ionizationLabel,
  onIonizationLabelChange,
  instrument,
  onInstrumentChange,
  description,
  onDescriptionChange,
  source,
  onSourceChange,
  scan,
  onScanChange,
  calibration,
  onCalibrationChange,
  readOnly = false,
  showAllFields,
  onShowAllFieldsChange,
}: MassSpecEditorProps) {
  const visibility = useMemo(
    () => ({
      source_temp_c: isFieldVisible("source_temp_c", ionizationMode, showAllFields),
      capillary_kv: isFieldVisible("capillary_kv", ionizationMode, showAllFields),
      nebulizer_gas_lpm: isFieldVisible("nebulizer_gas_lpm", ionizationMode, showAllFields),
      drying_gas_lpm: isFieldVisible("drying_gas_lpm", ionizationMode, showAllFields),
      drying_gas_temp_c: isFieldVisible("drying_gas_temp_c", ionizationMode, showAllFields),
      ei_energy_ev: isFieldVisible("ei_energy_ev", ionizationMode, showAllFields),
      maldi_laser_nm: isFieldVisible("maldi_laser_nm", ionizationMode, showAllFields),
      maldi_laser_energy: isFieldVisible("maldi_laser_energy", ionizationMode, showAllFields),
      maldi_matrix: isFieldVisible("maldi_matrix", ionizationMode, showAllFields),
    }),
    [ionizationMode, showAllFields],
  );

  const setSource = (patch: Partial<MassSpecSourceParams>) => {
    if (!onSourceChange) return;
    onSourceChange({ ...source, ...patch });
  };

  const setScan = (patch: Partial<MassSpecScanParams>) => {
    if (!onScanChange) return;
    onScanChange({ ...scan, ...patch });
  };

  const setCalibration = (patch: Partial<MassSpecCalibration>) => {
    if (!onCalibrationChange) return;
    onCalibrationChange({ ...calibration, ...patch });
  };

  const inputCls =
    "w-full px-2 py-1 border border-gray-200 rounded text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-gray-50 disabled:text-gray-500";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="space-y-6">
      {/* Header row: instrument + ionization mode + Show all fields toggle */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <label className={labelCls}>Instrument</label>
          <input
            type="text"
            value={instrument ?? ""}
            onChange={(e) =>
              onInstrumentChange?.(e.target.value || null)
            }
            disabled={readOnly || !onInstrumentChange}
            className={inputCls}
            placeholder="e.g. Thermo Q-Exactive HF-X"
          />
        </div>
        <div>
          <label className={labelCls}>Ionization mode</label>
          <select
            value={ionizationMode}
            onChange={(e) =>
              onIonizationModeChange?.(e.target.value as IonizationMode)
            }
            disabled={readOnly || !onIonizationModeChange}
            className={inputCls}
          >
            {IONIZATION_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {ionizationMode === "other" && (
        <div>
          <label className={labelCls}>Ionization label (free text)</label>
          <input
            type="text"
            value={ionizationLabel ?? ""}
            onChange={(e) =>
              onIonizationLabelChange?.(e.target.value || null)
            }
            disabled={readOnly || !onIonizationLabelChange}
            className={inputCls}
            placeholder='e.g. "DESI" or "ICP-MS"'
          />
        </div>
      )}

      <div>
        <label className={labelCls}>Description (optional)</label>
        <textarea
          value={description ?? ""}
          onChange={(e) =>
            onDescriptionChange?.(e.target.value || null)
          }
          disabled={readOnly || !onDescriptionChange}
          rows={2}
          className={inputCls}
          placeholder="e.g. Targeted method for flbA tryptic peptides, retention window 10–16 min."
        />
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <h4 className="text-sm font-semibold text-gray-700">Source params</h4>
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showAllFields}
            onChange={(e) => onShowAllFieldsChange?.(e.target.checked)}
            disabled={readOnly || !onShowAllFieldsChange}
            className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
          />
          Show all fields
        </label>
      </div>

      {/* Source params — smart-per-mode visibility */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibility.source_temp_c && (
          <div>
            <label className={labelCls}>Source temperature (°C)</label>
            <input
              type="number"
              value={fmtNumber(source.source_temp_c)}
              onChange={(e) => setSource({ source_temp_c: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onSourceChange}
              className={inputCls}
              placeholder="e.g. 250"
            />
          </div>
        )}
        {visibility.capillary_kv && (
          <div>
            <label className={labelCls}>Capillary voltage (kV)</label>
            <input
              type="number"
              step="0.1"
              value={fmtNumber(source.capillary_kv)}
              onChange={(e) => setSource({ capillary_kv: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onSourceChange}
              className={inputCls}
              placeholder="e.g. 3.5"
            />
          </div>
        )}
        {visibility.nebulizer_gas_lpm && (
          <div>
            <label className={labelCls}>Nebulizer gas (L/min)</label>
            <input
              type="number"
              step="0.1"
              value={fmtNumber(source.nebulizer_gas_lpm)}
              onChange={(e) => setSource({ nebulizer_gas_lpm: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onSourceChange}
              className={inputCls}
              placeholder="e.g. 1.2"
            />
          </div>
        )}
        {visibility.drying_gas_lpm && (
          <div>
            <label className={labelCls}>Drying gas (L/min)</label>
            <input
              type="number"
              step="0.1"
              value={fmtNumber(source.drying_gas_lpm)}
              onChange={(e) => setSource({ drying_gas_lpm: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onSourceChange}
              className={inputCls}
              placeholder="e.g. 10"
            />
          </div>
        )}
        {visibility.drying_gas_temp_c && (
          <div>
            <label className={labelCls}>Drying gas temperature (°C)</label>
            <input
              type="number"
              value={fmtNumber(source.drying_gas_temp_c)}
              onChange={(e) => setSource({ drying_gas_temp_c: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onSourceChange}
              className={inputCls}
              placeholder="e.g. 350"
            />
          </div>
        )}
        {visibility.ei_energy_ev && (
          <div>
            <label className={labelCls}>EI ionization energy (eV)</label>
            <input
              type="number"
              value={fmtNumber(source.ei_energy_ev)}
              onChange={(e) => setSource({ ei_energy_ev: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onSourceChange}
              className={inputCls}
              placeholder="e.g. 70"
            />
          </div>
        )}
        {visibility.maldi_laser_nm && (
          <div>
            <label className={labelCls}>MALDI laser wavelength (nm)</label>
            <input
              type="number"
              value={fmtNumber(source.maldi_laser_nm)}
              onChange={(e) => setSource({ maldi_laser_nm: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onSourceChange}
              className={inputCls}
              placeholder="e.g. 337 (N2) or 355 (Nd:YAG)"
            />
          </div>
        )}
        {visibility.maldi_laser_energy && (
          <div>
            <label className={labelCls}>MALDI laser energy</label>
            <input
              type="text"
              value={source.maldi_laser_energy ?? ""}
              onChange={(e) => setSource({ maldi_laser_energy: e.target.value || null })}
              disabled={readOnly || !onSourceChange}
              className={inputCls}
              placeholder='e.g. "60%" or "2.5 µJ"'
            />
          </div>
        )}
        {visibility.maldi_matrix && (
          <div>
            <label className={labelCls}>MALDI matrix</label>
            <input
              type="text"
              value={source.maldi_matrix ?? ""}
              onChange={(e) => setSource({ maldi_matrix: e.target.value || null })}
              disabled={readOnly || !onSourceChange}
              className={inputCls}
              placeholder='e.g. "CHCA" or "DHB"'
            />
          </div>
        )}
      </div>

      {/* Other notes always shown — free-text catchall for instrument-specific
          params that fall through the modeled fields. */}
      <div>
        <label className={labelCls}>
          Other source notes
          {ionizationMode === "esi_switching" && (
            <span className="text-amber-600 font-normal ml-2">
              (use for polarity-switching schedule timing)
            </span>
          )}
        </label>
        <textarea
          value={source.other_notes ?? ""}
          onChange={(e) => setSource({ other_notes: e.target.value || null })}
          disabled={readOnly || !onSourceChange}
          rows={2}
          className={inputCls}
          placeholder="Instrument-specific params not modeled above."
        />
      </div>

      {/* Scan params — always shown */}
      <div className="border-t border-gray-100 pt-3">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Scan params</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>m/z range (low)</label>
            <input
              type="number"
              value={fmtNumber(scan.scan_mz_low)}
              onChange={(e) => setScan({ scan_mz_low: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onScanChange}
              className={inputCls}
              placeholder="e.g. 200"
            />
          </div>
          <div>
            <label className={labelCls}>m/z range (high)</label>
            <input
              type="number"
              value={fmtNumber(scan.scan_mz_high)}
              onChange={(e) => setScan({ scan_mz_high: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onScanChange}
              className={inputCls}
              placeholder="e.g. 2000"
            />
          </div>
          <div>
            <label className={labelCls}>Scan rate (Hz)</label>
            <input
              type="number"
              step="0.1"
              value={fmtNumber(scan.scan_rate_hz)}
              onChange={(e) => setScan({ scan_rate_hz: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onScanChange}
              className={inputCls}
              placeholder="e.g. 2"
            />
          </div>
          <div>
            <label className={labelCls}>Resolution (R, FWHM)</label>
            <input
              type="number"
              value={fmtNumber(scan.resolution_r)}
              onChange={(e) => setScan({ resolution_r: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onScanChange}
              className={inputCls}
              placeholder="e.g. 70000"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 mt-3 text-xs text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={scan.is_msms}
            onChange={(e) => setScan({ is_msms: e.target.checked })}
            disabled={readOnly || !onScanChange}
            className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
          />
          MS/MS workflow (precursor isolation + fragmentation)
        </label>

        {scan.is_msms && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 pl-6 border-l-2 border-violet-100">
            <div>
              <label className={labelCls}>Isolation window (m/z)</label>
              <input
                type="number"
                step="0.1"
                value={fmtNumber(scan.msms_isolation_window_mz)}
                onChange={(e) => setScan({ msms_isolation_window_mz: parseNumberOrNull(e.target.value) })}
                disabled={readOnly || !onScanChange}
                className={inputCls}
                placeholder="e.g. 1.2"
              />
            </div>
            <div>
              <label className={labelCls}>Collision energy (eV)</label>
              <input
                type="number"
                value={fmtNumber(scan.msms_collision_energy_ev)}
                onChange={(e) => setScan({ msms_collision_energy_ev: parseNumberOrNull(e.target.value) })}
                disabled={readOnly || !onScanChange}
                className={inputCls}
                placeholder="e.g. 25"
              />
            </div>
          </div>
        )}
      </div>

      {/* Calibration — always shown */}
      <div className="border-t border-gray-100 pt-3">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Calibration</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Reference standard</label>
            <input
              type="text"
              value={calibration.reference_standard ?? ""}
              onChange={(e) => setCalibration({ reference_standard: e.target.value || null })}
              disabled={readOnly || !onCalibrationChange}
              className={inputCls}
              placeholder='e.g. "Calmix" or "sodium formate"'
            />
          </div>
          <div>
            <label className={labelCls}>Calibration date</label>
            <input
              type="date"
              value={calibration.calibration_date ?? ""}
              onChange={(e) => setCalibration({ calibration_date: e.target.value || null })}
              disabled={readOnly || !onCalibrationChange}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Expected mass accuracy (ppm)</label>
            <input
              type="number"
              step="0.1"
              value={fmtNumber(calibration.expected_accuracy_ppm)}
              onChange={(e) => setCalibration({ expected_accuracy_ppm: parseNumberOrNull(e.target.value) })}
              disabled={readOnly || !onCalibrationChange}
              className={inputCls}
              placeholder="e.g. 2"
            />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input
              type="text"
              value={calibration.notes ?? ""}
              onChange={(e) => setCalibration({ notes: e.target.value || null })}
              disabled={readOnly || !onCalibrationChange}
              className={inputCls}
              placeholder="Optional"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
