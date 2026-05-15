import { JsonStore, getPublicStore } from "../storage/json-store";
import type {
  CellCultureCellLine,
  CellCultureEventType,
  CellCultureMedia,
  CellCulturePlannedEvent,
  CellCultureSchedule,
  CellCultureSupplement,
} from "../types";

export interface CellCultureScheduleRepairResult {
  schedule: CellCultureSchedule;
  fixes: string[];
}

export interface CellCultureScheduleRepairReport {
  total: number;
  repaired: number;
  unrecoverable: number;
  errors: string[];
  details: Array<{ id: number; name: string; scope: "private" | "public"; fixes: string[] }>;
}

const VALID_EVENT_TYPES: ReadonlyArray<CellCultureEventType> = [
  "feed",
  "split",
  "observe",
  "harvest",
];

function repairPlannedEvent(raw: unknown, idx: number, fixes: string[]): CellCulturePlannedEvent {
  if (!raw || typeof raw !== "object") {
    fixes.push(`planned event ${idx} was not an object → defaulted`);
    return { day_offset: 0, event_type: "feed" };
  }
  const r = raw as Record<string, unknown>;
  const day_offset =
    typeof r.day_offset === "number" && Number.isFinite(r.day_offset)
      ? r.day_offset
      : (fixes.push(`event ${idx} day_offset invalid → 0`), 0);
  const event_type =
    typeof r.event_type === "string" &&
    (VALID_EVENT_TYPES as readonly string[]).includes(r.event_type)
      ? (r.event_type as CellCultureEventType)
      : (fixes.push(`event ${idx} event_type invalid → feed`), "feed" as CellCultureEventType);
  const out: CellCulturePlannedEvent = { day_offset, event_type };
  if (typeof r.split_ratio === "string") out.split_ratio = r.split_ratio;
  if (typeof r.notes === "string") out.notes = r.notes;
  return out;
}

function repairCellLine(raw: unknown, fixes: string[]): CellCultureCellLine {
  if (!raw || typeof raw !== "object") {
    fixes.push("cell_line missing → defaulted");
    return {};
  }
  const r = raw as Record<string, unknown>;
  const out: CellCultureCellLine = {};
  if (typeof r.name === "string") out.name = r.name;
  else if (r.name !== undefined && r.name !== null) {
    fixes.push("cell_line.name wrong type → dropped");
  }
  if (typeof r.species === "string") out.species = r.species;
  else if (r.species !== undefined && r.species !== null) {
    fixes.push("cell_line.species wrong type → dropped");
  }
  if (typeof r.tissue === "string") out.tissue = r.tissue;
  else if (r.tissue !== undefined && r.tissue !== null) {
    fixes.push("cell_line.tissue wrong type → dropped");
  }
  if (typeof r.notes === "string") out.notes = r.notes;
  else if (r.notes !== undefined && r.notes !== null) {
    fixes.push("cell_line.notes wrong type → dropped");
  }
  return out;
}

function repairSupplements(raw: unknown, fixes: string[]): CellCultureSupplement[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      fixes.push("media.supplements not an array → []");
    }
    return [];
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== "object") {
      fixes.push(`supplement ${i} not an object → blank row`);
      return { name: "", concentration: "", units: "" };
    }
    const r = item as Record<string, unknown>;
    return {
      name: typeof r.name === "string" ? r.name : (fixes.push(`supplement ${i} missing name`), ""),
      concentration:
        typeof r.concentration === "string"
          ? r.concentration
          : (fixes.push(`supplement ${i} concentration invalid → ""`), ""),
      units: typeof r.units === "string" ? r.units : (fixes.push(`supplement ${i} units invalid → ""`), ""),
    };
  });
}

function repairMedia(raw: unknown, fixes: string[]): CellCultureMedia {
  if (!raw || typeof raw !== "object") {
    fixes.push("media missing → defaulted");
    return {};
  }
  const r = raw as Record<string, unknown>;
  const out: CellCultureMedia = {};
  if (typeof r.base_medium === "string") out.base_medium = r.base_medium;
  else if (r.base_medium !== undefined && r.base_medium !== null) {
    fixes.push("media.base_medium wrong type → dropped");
  }
  if (typeof r.serum_percent === "number" && Number.isFinite(r.serum_percent)) {
    out.serum_percent = r.serum_percent;
  } else if (r.serum_percent !== undefined && r.serum_percent !== null) {
    fixes.push("media.serum_percent wrong type → dropped");
  }
  out.supplements = repairSupplements(r.supplements, fixes);
  return out;
}

export function repairCellCultureSchedule(raw: unknown): CellCultureScheduleRepairResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number") return null;

  const fixes: string[] = [];
  const name =
    typeof r.name === "string"
      ? r.name
      : (fixes.push("missing name"), `Cell culture schedule ${r.id}`);
  const description =
    typeof r.description === "string" || r.description === null
      ? (r.description as string | null)
      : (fixes.push("description malformed → null"), null);
  const planned_events = Array.isArray(r.planned_events)
    ? r.planned_events.map((s, i) => repairPlannedEvent(s, i, fixes))
    : (fixes.push("planned_events not an array → []"), []);
  const cell_line = repairCellLine(r.cell_line, fixes);
  const media = repairMedia(r.media, fixes);
  const is_public =
    typeof r.is_public === "boolean" ? r.is_public : (fixes.push("is_public missing → false"), false);
  const created_by =
    typeof r.created_by === "string" || r.created_by === null
      ? (r.created_by as string | null)
      : (fixes.push("created_by malformed → null"), null);
  const created_at = typeof r.created_at === "string" ? r.created_at : undefined;
  const updated_at = typeof r.updated_at === "string" ? r.updated_at : undefined;

  return {
    schedule: {
      id: r.id,
      name,
      description,
      cell_line,
      media,
      planned_events,
      is_public,
      created_by,
      ...(created_at ? { created_at } : {}),
      ...(updated_at ? { updated_at } : {}),
    },
    fixes,
  };
}

export async function repairAllCellCultureSchedules(): Promise<CellCultureScheduleRepairReport> {
  const report: CellCultureScheduleRepairReport = {
    total: 0,
    repaired: 0,
    unrecoverable: 0,
    errors: [],
    details: [],
  };

  const privateStore = new JsonStore<CellCultureSchedule>("cell_culture_schedules");
  const publicStore = getPublicStore<CellCultureSchedule>("cell_culture_schedules");
  const stores: Array<{ store: JsonStore<CellCultureSchedule>; scope: "private" | "public" }> = [
    { store: privateStore, scope: "private" },
    { store: publicStore, scope: "public" },
  ];

  for (const { store, scope } of stores) {
    let raws: unknown[];
    try {
      raws = await store.listAll();
    } catch (err) {
      report.errors.push(
        `Failed to list ${scope} cell culture schedules: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    for (const raw of raws) {
      report.total++;
      const result = repairCellCultureSchedule(raw);
      if (!result) {
        report.unrecoverable++;
        report.errors.push(
          `Unrecoverable ${scope} cell culture schedule (missing id): ${JSON.stringify(raw).slice(0, 200)}`,
        );
        continue;
      }
      if (result.fixes.length === 0) continue;

      try {
        await store.save(result.schedule.id, { ...result.schedule, is_public: scope === "public" });
        report.repaired++;
        report.details.push({
          id: result.schedule.id,
          name: result.schedule.name,
          scope,
          fixes: result.fixes,
        });
      } catch (err) {
        report.errors.push(
          `Failed to save ${scope} cell culture schedule ${result.schedule.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return report;
}
