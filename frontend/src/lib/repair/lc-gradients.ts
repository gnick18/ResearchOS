import { JsonStore, getPublicStore } from "../storage/json-store";
import type {
  LCGradientProtocol,
  LCGradientStep,
  LCGradientColumn,
  LCIngredient,
  LCIngredientRole,
} from "../types";

export interface LCProtocolRepairResult {
  protocol: LCGradientProtocol;
  fixes: string[];
}

export interface LCRepairReport {
  total: number;
  repaired: number;
  unrecoverable: number;
  errors: string[];
  details: Array<{ id: number; name: string; scope: "private" | "public"; fixes: string[] }>;
}

const VALID_ROLES: ReadonlyArray<LCIngredientRole> = [
  "solvent_a",
  "solvent_b",
  "buffer",
  "additive",
];

function repairStep(raw: unknown, idx: number, fixes: string[]): LCGradientStep {
  if (!raw || typeof raw !== "object") {
    fixes.push(`gradient step ${idx} was not an object → defaulted`);
    return { time_min: 0, percent_a: 100, percent_b: 0, flow_ml_min: 0 };
  }
  const r = raw as Record<string, unknown>;
  const time_min =
    typeof r.time_min === "number" && Number.isFinite(r.time_min) && r.time_min >= 0
      ? r.time_min
      : (fixes.push(`step ${idx} time_min invalid → 0`), 0);
  const percent_a =
    typeof r.percent_a === "number" && Number.isFinite(r.percent_a)
      ? r.percent_a
      : (fixes.push(`step ${idx} percent_a invalid → 100`), 100);
  const percent_b =
    typeof r.percent_b === "number" && Number.isFinite(r.percent_b)
      ? r.percent_b
      : (fixes.push(`step ${idx} percent_b invalid → 0`), 0);
  const flow_ml_min =
    typeof r.flow_ml_min === "number" && Number.isFinite(r.flow_ml_min) && r.flow_ml_min >= 0
      ? r.flow_ml_min
      : (fixes.push(`step ${idx} flow_ml_min invalid → 0`), 0);
  return { time_min, percent_a, percent_b, flow_ml_min };
}

function repairColumn(raw: unknown, fixes: string[]): LCGradientColumn {
  if (!raw || typeof raw !== "object") {
    fixes.push("column missing → defaulted");
    return {};
  }
  const r = raw as Record<string, unknown>;
  const out: LCGradientColumn = {};
  if (typeof r.manufacturer === "string") out.manufacturer = r.manufacturer;
  else if (r.manufacturer !== undefined && r.manufacturer !== null) {
    fixes.push("column.manufacturer wrong type → dropped");
  }
  if (typeof r.model === "string") out.model = r.model;
  else if (r.model !== undefined && r.model !== null) {
    fixes.push("column.model wrong type → dropped");
  }
  if (typeof r.length_mm === "number" && Number.isFinite(r.length_mm)) out.length_mm = r.length_mm;
  else if (r.length_mm !== undefined && r.length_mm !== null) {
    fixes.push("column.length_mm wrong type → dropped");
  }
  if (typeof r.inner_diameter_mm === "number" && Number.isFinite(r.inner_diameter_mm))
    out.inner_diameter_mm = r.inner_diameter_mm;
  else if (r.inner_diameter_mm !== undefined && r.inner_diameter_mm !== null) {
    fixes.push("column.inner_diameter_mm wrong type → dropped");
  }
  if (typeof r.particle_size_um === "number" && Number.isFinite(r.particle_size_um))
    out.particle_size_um = r.particle_size_um;
  else if (r.particle_size_um !== undefined && r.particle_size_um !== null) {
    fixes.push("column.particle_size_um wrong type → dropped");
  }
  return out;
}

function repairIngredients(raw: unknown, fixes: string[]): LCIngredient[] {
  if (!Array.isArray(raw)) {
    fixes.push("ingredients not an array → []");
    return [];
  }
  const seenIds = new Set<string>();
  return raw.map((item, i) => {
    if (!item || typeof item !== "object") {
      const id = `repaired_${Date.now()}_${i}`;
      fixes.push(`ingredient ${i} not an object → blank row`);
      seenIds.add(id);
      return { id, name: "", role: "additive" as LCIngredientRole };
    }
    const r = item as Record<string, unknown>;
    let id = typeof r.id === "string" ? r.id : "";
    if (!id || seenIds.has(id)) {
      const newId = `repaired_${Date.now()}_${i}`;
      fixes.push(`ingredient ${i} ${id ? "duplicate" : "missing"} id → ${newId}`);
      id = newId;
    }
    seenIds.add(id);
    const role = typeof r.role === "string" && (VALID_ROLES as readonly string[]).includes(r.role)
      ? (r.role as LCIngredientRole)
      : (fixes.push(`ingredient ${i} role invalid → additive`), "additive" as LCIngredientRole);
    const out: LCIngredient = {
      id,
      name: typeof r.name === "string" ? r.name : (fixes.push(`ingredient ${i} missing name`), ""),
      role,
    };
    if (typeof r.concentration === "string") out.concentration = r.concentration;
    if (typeof r.notes === "string") out.notes = r.notes;
    return out;
  });
}

export function repairLCGradientProtocol(raw: unknown): LCProtocolRepairResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number") return null;

  const fixes: string[] = [];
  const name = typeof r.name === "string" ? r.name : (fixes.push("missing name"), `LC Gradient ${r.id}`);
  const description =
    typeof r.description === "string" || r.description === null
      ? (r.description as string | null)
      : (fixes.push("description malformed → null"), null);
  const gradient_steps = Array.isArray(r.gradient_steps)
    ? r.gradient_steps.map((s, i) => repairStep(s, i, fixes))
    : (fixes.push("gradient_steps not an array → []"), []);
  const column = repairColumn(r.column, fixes);
  const detection_wavelength_nm =
    r.detection_wavelength_nm === null || r.detection_wavelength_nm === undefined
      ? null
      : typeof r.detection_wavelength_nm === "number" && Number.isFinite(r.detection_wavelength_nm)
        ? r.detection_wavelength_nm
        : (fixes.push("detection_wavelength_nm malformed → null"), null);
  const ingredients = repairIngredients(r.ingredients, fixes);
  const is_public = typeof r.is_public === "boolean" ? r.is_public : (fixes.push("is_public missing → false"), false);
  const created_by =
    typeof r.created_by === "string" || r.created_by === null
      ? (r.created_by as string | null)
      : (fixes.push("created_by malformed → null"), null);
  const created_at = typeof r.created_at === "string" ? r.created_at : undefined;
  const updated_at = typeof r.updated_at === "string" ? r.updated_at : undefined;

  return {
    protocol: {
      id: r.id,
      name,
      description,
      gradient_steps,
      column,
      detection_wavelength_nm,
      ingredients,
      is_public,
      created_by,
      ...(created_at ? { created_at } : {}),
      ...(updated_at ? { updated_at } : {}),
    },
    fixes,
  };
}

export async function repairAllLCGradientProtocols(): Promise<LCRepairReport> {
  const report: LCRepairReport = { total: 0, repaired: 0, unrecoverable: 0, errors: [], details: [] };

  const privateStore = new JsonStore<LCGradientProtocol>("lc_gradients");
  const publicStore = getPublicStore<LCGradientProtocol>("lc_gradients");
  const stores: Array<{ store: JsonStore<LCGradientProtocol>; scope: "private" | "public" }> = [
    { store: privateStore, scope: "private" },
    { store: publicStore, scope: "public" },
  ];

  for (const { store, scope } of stores) {
    let raws: unknown[];
    try {
      raws = await store.listAll();
    } catch (err) {
      report.errors.push(`Failed to list ${scope} LC gradients: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const raw of raws) {
      report.total++;
      const result = repairLCGradientProtocol(raw);
      if (!result) {
        report.unrecoverable++;
        report.errors.push(`Unrecoverable ${scope} LC gradient (missing id): ${JSON.stringify(raw).slice(0, 200)}`);
        continue;
      }
      if (result.fixes.length === 0) continue;

      try {
        await store.save(result.protocol.id, { ...result.protocol, is_public: scope === "public" });
        report.repaired++;
        report.details.push({ id: result.protocol.id, name: result.protocol.name, scope, fixes: result.fixes });
      } catch (err) {
        report.errors.push(`Failed to save ${scope} LC gradient ${result.protocol.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return report;
}
