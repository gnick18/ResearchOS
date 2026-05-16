import { JsonStore, getPublicStore } from "../storage/json-store";
import type {
  IonizationMode,
  MassSpecCalibration,
  MassSpecProtocol,
  MassSpecScanParams,
  MassSpecSourceParams,
} from "../types";

export interface MassSpecProtocolRepairResult {
  protocol: MassSpecProtocol;
  fixes: string[];
}

export interface MassSpecRepairReport {
  total: number;
  repaired: number;
  unrecoverable: number;
  errors: string[];
  details: Array<{ id: number; name: string; scope: "private" | "public"; fixes: string[] }>;
}

const VALID_MODES: ReadonlyArray<IonizationMode> = [
  "esi_pos",
  "esi_neg",
  "esi_switching",
  "apci_pos",
  "apci_neg",
  "ei",
  "maldi",
  "other",
];

function repairNumberOrNull(
  raw: unknown,
  label: string,
  fixes: string[],
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  fixes.push(`${label} malformed → null`);
  return null;
}

function repairStringOrNull(
  raw: unknown,
  label: string,
  fixes: string[],
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;
  fixes.push(`${label} malformed → null`);
  return null;
}

function repairSource(raw: unknown, fixes: string[]): MassSpecSourceParams {
  if (!raw || typeof raw !== "object") {
    fixes.push("source missing → defaulted");
    return {};
  }
  const r = raw as Record<string, unknown>;
  return {
    source_temp_c: repairNumberOrNull(r.source_temp_c, "source.source_temp_c", fixes),
    capillary_kv: repairNumberOrNull(r.capillary_kv, "source.capillary_kv", fixes),
    nebulizer_gas_lpm: repairNumberOrNull(r.nebulizer_gas_lpm, "source.nebulizer_gas_lpm", fixes),
    drying_gas_lpm: repairNumberOrNull(r.drying_gas_lpm, "source.drying_gas_lpm", fixes),
    drying_gas_temp_c: repairNumberOrNull(r.drying_gas_temp_c, "source.drying_gas_temp_c", fixes),
    ei_energy_ev: repairNumberOrNull(r.ei_energy_ev, "source.ei_energy_ev", fixes),
    maldi_laser_nm: repairNumberOrNull(r.maldi_laser_nm, "source.maldi_laser_nm", fixes),
    maldi_laser_energy: repairStringOrNull(r.maldi_laser_energy, "source.maldi_laser_energy", fixes),
    maldi_matrix: repairStringOrNull(r.maldi_matrix, "source.maldi_matrix", fixes),
    other_notes: repairStringOrNull(r.other_notes, "source.other_notes", fixes),
  };
}

function repairScan(raw: unknown, fixes: string[]): MassSpecScanParams {
  if (!raw || typeof raw !== "object") {
    fixes.push("scan missing → defaulted");
    return { is_msms: false };
  }
  const r = raw as Record<string, unknown>;
  const is_msms = typeof r.is_msms === "boolean"
    ? r.is_msms
    : (fixes.push("scan.is_msms missing → false"), false);
  return {
    scan_mz_low: repairNumberOrNull(r.scan_mz_low, "scan.scan_mz_low", fixes),
    scan_mz_high: repairNumberOrNull(r.scan_mz_high, "scan.scan_mz_high", fixes),
    scan_rate_hz: repairNumberOrNull(r.scan_rate_hz, "scan.scan_rate_hz", fixes),
    resolution_r: repairNumberOrNull(r.resolution_r, "scan.resolution_r", fixes),
    is_msms,
    msms_isolation_window_mz: repairNumberOrNull(
      r.msms_isolation_window_mz,
      "scan.msms_isolation_window_mz",
      fixes,
    ),
    msms_collision_energy_ev: repairNumberOrNull(
      r.msms_collision_energy_ev,
      "scan.msms_collision_energy_ev",
      fixes,
    ),
  };
}

function repairCalibration(raw: unknown, fixes: string[]): MassSpecCalibration {
  if (!raw || typeof raw !== "object") {
    fixes.push("calibration missing → defaulted");
    return {};
  }
  const r = raw as Record<string, unknown>;
  return {
    reference_standard: repairStringOrNull(r.reference_standard, "calibration.reference_standard", fixes),
    calibration_date: repairStringOrNull(r.calibration_date, "calibration.calibration_date", fixes),
    expected_accuracy_ppm: repairNumberOrNull(
      r.expected_accuracy_ppm,
      "calibration.expected_accuracy_ppm",
      fixes,
    ),
    notes: repairStringOrNull(r.notes, "calibration.notes", fixes),
  };
}

export function repairMassSpecProtocol(raw: unknown): MassSpecProtocolRepairResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number") return null;

  const fixes: string[] = [];
  const name = typeof r.name === "string"
    ? r.name
    : (fixes.push("missing name"), `Mass spec method ${r.id}`);
  const description = repairStringOrNull(r.description, "description", fixes);
  const ionization_mode =
    typeof r.ionization_mode === "string" &&
    (VALID_MODES as readonly string[]).includes(r.ionization_mode)
      ? (r.ionization_mode as IonizationMode)
      : (fixes.push("ionization_mode invalid → esi_pos"), "esi_pos" as IonizationMode);
  const ionization_label = repairStringOrNull(r.ionization_label, "ionization_label", fixes);
  const instrument = repairStringOrNull(r.instrument, "instrument", fixes);
  const source = repairSource(r.source, fixes);
  const scan = repairScan(r.scan, fixes);
  const calibration = repairCalibration(r.calibration, fixes);
  const is_public = typeof r.is_public === "boolean"
    ? r.is_public
    : (fixes.push("is_public missing → false"), false);
  const created_by = typeof r.created_by === "string" || r.created_by === null
    ? (r.created_by as string | null)
    : (fixes.push("created_by malformed → null"), null);
  const created_at = typeof r.created_at === "string" ? r.created_at : undefined;
  const updated_at = typeof r.updated_at === "string" ? r.updated_at : undefined;

  return {
    protocol: {
      id: r.id,
      name,
      description,
      ionization_mode,
      ionization_label,
      instrument,
      source,
      scan,
      calibration,
      is_public,
      created_by,
      ...(created_at ? { created_at } : {}),
      ...(updated_at ? { updated_at } : {}),
    },
    fixes,
  };
}

export async function repairAllMassSpecProtocols(): Promise<MassSpecRepairReport> {
  const report: MassSpecRepairReport = {
    total: 0,
    repaired: 0,
    unrecoverable: 0,
    errors: [],
    details: [],
  };

  const privateStore = new JsonStore<MassSpecProtocol>("mass_spec_methods");
  const publicStore = getPublicStore<MassSpecProtocol>("mass_spec_methods");
  const stores: Array<{ store: JsonStore<MassSpecProtocol>; scope: "private" | "public" }> = [
    { store: privateStore, scope: "private" },
    { store: publicStore, scope: "public" },
  ];

  for (const { store, scope } of stores) {
    let raws: unknown[];
    try {
      raws = await store.listAll();
    } catch (err) {
      report.errors.push(
        `Failed to list ${scope} mass spec methods: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    for (const raw of raws) {
      report.total++;
      const result = repairMassSpecProtocol(raw);
      if (!result) {
        report.unrecoverable++;
        report.errors.push(
          `Unrecoverable ${scope} mass spec method (missing id): ${JSON.stringify(raw).slice(0, 200)}`,
        );
        continue;
      }
      if (result.fixes.length === 0) continue;

      try {
        await store.save(result.protocol.id, { ...result.protocol, is_public: scope === "public" });
        report.repaired++;
        report.details.push({
          id: result.protocol.id,
          name: result.protocol.name,
          scope,
          fixes: result.fixes,
        });
      } catch (err) {
        report.errors.push(
          `Failed to save ${scope} mass spec method ${result.protocol.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return report;
}
