import { JsonStore, getPublicStore } from "../storage/json-store";
import type {
  PlateProtocol,
  PlateRegionLabel,
  PlateSize,
  PlateWellRole,
} from "../types";

export interface PlateProtocolRepairResult {
  protocol: PlateProtocol;
  fixes: string[];
}

export interface PlateRepairReport {
  total: number;
  repaired: number;
  unrecoverable: number;
  errors: string[];
  details: Array<{ id: number; name: string; scope: "private" | "public"; fixes: string[] }>;
}

const VALID_SIZES: ReadonlyArray<PlateSize> = [12, 24, 48, 96];
const VALID_ROLES: ReadonlyArray<PlateWellRole> = [
  "blank",
  "sample",
  "control",
  "na",
  "custom",
];

function repairRegion(raw: unknown, idx: number, plateSize: PlateSize, fixes: string[]): PlateRegionLabel | null {
  if (!raw || typeof raw !== "object") {
    fixes.push(`region ${idx} not an object → dropped`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const { rows, cols } = dimsForSize(plateSize);

  const clampInt = (v: unknown, max: number, fallback: number, name: string): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      fixes.push(`region ${idx} ${name} invalid → ${fallback}`);
      return fallback;
    }
    const n = Math.floor(v);
    if (n < 0) {
      fixes.push(`region ${idx} ${name} < 0 → 0`);
      return 0;
    }
    if (n >= max) {
      fixes.push(`region ${idx} ${name} >= ${max} → ${max - 1}`);
      return max - 1;
    }
    return n;
  };

  let row_start = clampInt(r.row_start, rows, 0, "row_start");
  let row_end = clampInt(r.row_end, rows, row_start, "row_end");
  let col_start = clampInt(r.col_start, cols, 0, "col_start");
  let col_end = clampInt(r.col_end, cols, col_start, "col_end");
  if (row_end < row_start) {
    fixes.push(`region ${idx} row_end < row_start → swapped`);
    [row_start, row_end] = [row_end, row_start];
  }
  if (col_end < col_start) {
    fixes.push(`region ${idx} col_end < col_start → swapped`);
    [col_start, col_end] = [col_end, col_start];
  }

  const role = typeof r.role === "string" && (VALID_ROLES as readonly string[]).includes(r.role)
    ? (r.role as PlateWellRole)
    : (fixes.push(`region ${idx} role invalid → na`), "na" as PlateWellRole);

  const out: PlateRegionLabel = { row_start, row_end, col_start, col_end, role };
  if (typeof r.custom_label === "string") out.custom_label = r.custom_label;
  if (typeof r.notes === "string") out.notes = r.notes;
  return out;
}

function dimsForSize(size: PlateSize): { rows: number; cols: number } {
  switch (size) {
    case 12: return { rows: 3, cols: 4 };
    case 24: return { rows: 4, cols: 6 };
    case 48: return { rows: 6, cols: 8 };
    case 96: return { rows: 8, cols: 12 };
  }
}

export function repairPlateProtocol(raw: unknown): PlateProtocolRepairResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number") return null;

  const fixes: string[] = [];
  const name = typeof r.name === "string" ? r.name : (fixes.push("missing name"), `Plate Layout ${r.id}`);
  const description =
    typeof r.description === "string" || r.description === null
      ? (r.description as string | null)
      : (fixes.push("description malformed → null"), null);
  const plate_size: PlateSize =
    typeof r.plate_size === "number" && (VALID_SIZES as readonly number[]).includes(r.plate_size)
      ? (r.plate_size as PlateSize)
      : (fixes.push("plate_size invalid → 96"), 96);
  const region_labels = Array.isArray(r.region_labels)
    ? r.region_labels
        .map((reg, i) => repairRegion(reg, i, plate_size, fixes))
        .filter((reg): reg is PlateRegionLabel => reg !== null)
    : r.region_labels === undefined
      ? []
      : (fixes.push("region_labels not an array → []"), []);
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
      plate_size,
      region_labels,
      is_public,
      created_by,
      ...(created_at ? { created_at } : {}),
      ...(updated_at ? { updated_at } : {}),
    },
    fixes,
  };
}

export async function repairAllPlateProtocols(): Promise<PlateRepairReport> {
  const report: PlateRepairReport = { total: 0, repaired: 0, unrecoverable: 0, errors: [], details: [] };

  const privateStore = new JsonStore<PlateProtocol>("plate_layouts");
  const publicStore = getPublicStore<PlateProtocol>("plate_layouts");
  const stores: Array<{ store: JsonStore<PlateProtocol>; scope: "private" | "public" }> = [
    { store: privateStore, scope: "private" },
    { store: publicStore, scope: "public" },
  ];

  for (const { store, scope } of stores) {
    let raws: unknown[];
    try {
      raws = await store.listAll();
    } catch (err) {
      report.errors.push(`Failed to list ${scope} plate layouts: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const raw of raws) {
      report.total++;
      const result = repairPlateProtocol(raw);
      if (!result) {
        report.unrecoverable++;
        report.errors.push(`Unrecoverable ${scope} plate layout (missing id): ${JSON.stringify(raw).slice(0, 200)}`);
        continue;
      }
      if (result.fixes.length === 0) continue;

      try {
        await store.save(result.protocol.id, { ...result.protocol, is_public: scope === "public" });
        report.repaired++;
        report.details.push({ id: result.protocol.id, name: result.protocol.name, scope, fixes: result.fixes });
      } catch (err) {
        report.errors.push(`Failed to save ${scope} plate layout ${result.protocol.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return report;
}
