import { JsonStore, getPublicStore } from "../storage/json-store";
import type { PCRProtocol, PCRGradient, PCRStep, PCRCycle, PCRIngredient } from "../types";

export interface ProtocolRepairResult {
  protocol: PCRProtocol;
  fixes: string[];
}

export interface RepairReport {
  total: number;
  repaired: number;
  unrecoverable: number;
  errors: string[];
  details: Array<{ id: number; name: string; scope: "private" | "public"; fixes: string[] }>;
}

function repairStep(raw: unknown, fallbackName: string, fixes: string[]): PCRStep {
  if (!raw || typeof raw !== "object") {
    fixes.push(`step ${fallbackName} was not an object`);
    return { name: fallbackName, temperature: 0, duration: "" };
  }
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name : fallbackName;
  const temperature = typeof r.temperature === "number" && Number.isFinite(r.temperature) ? r.temperature : 0;
  const duration = typeof r.duration === "string" ? r.duration : "";
  if (typeof r.name !== "string") fixes.push(`step "${name}" missing name`);
  if (typeof r.temperature !== "number") fixes.push(`step "${name}" missing temperature`);
  if (typeof r.duration !== "string") fixes.push(`step "${name}" missing duration`);
  return { name, temperature, duration };
}

function repairCycle(raw: unknown, idx: number, fixes: string[]): PCRCycle {
  if (!raw || typeof raw !== "object") {
    fixes.push(`cycle ${idx} was not an object`);
    return { repeats: 1, steps: [] };
  }
  const r = raw as Record<string, unknown>;
  const repeats =
    typeof r.repeats === "number" && Number.isFinite(r.repeats) && r.repeats >= 1
      ? Math.floor(r.repeats)
      : (fixes.push(`cycle ${idx} repeats invalid → 1`), 1);
  const steps = Array.isArray(r.steps)
    ? r.steps.map((s, i) => repairStep(s, `Step ${i + 1}`, fixes))
    : (fixes.push(`cycle ${idx} steps not an array → []`), []);
  return { repeats, steps };
}

function repairGradient(raw: unknown, fixes: string[]): PCRGradient {
  if (!raw || typeof raw !== "object") {
    fixes.push("gradient missing → default empty");
    return { initial: [], cycles: [], final: [], hold: null };
  }
  const g = raw as Record<string, unknown>;
  const initial = Array.isArray(g.initial)
    ? g.initial.map((s, i) => repairStep(s, `Initial ${i + 1}`, fixes))
    : (fixes.push("gradient.initial not an array → []"), []);
  const cycles = Array.isArray(g.cycles)
    ? g.cycles.map((c, i) => repairCycle(c, i, fixes))
    : (fixes.push("gradient.cycles not an array → []"), []);
  const final = Array.isArray(g.final)
    ? g.final.map((s, i) => repairStep(s, `Final ${i + 1}`, fixes))
    : (fixes.push("gradient.final not an array → []"), []);
  let hold: PCRStep | null = null;
  if (g.hold === null || g.hold === undefined) {
    hold = null;
  } else if (typeof g.hold === "object") {
    hold = repairStep(g.hold, "Hold", fixes);
  } else {
    fixes.push("gradient.hold malformed → null");
    hold = null;
  }
  return { initial, cycles, final, hold };
}

function repairIngredients(raw: unknown, fixes: string[]): PCRIngredient[] {
  if (!Array.isArray(raw)) {
    fixes.push("ingredients not an array → []");
    return [];
  }
  const seenIds = new Set<string>();
  return raw.map((item, i) => {
    if (!item || typeof item !== "object") {
      fixes.push(`ingredient ${i} not an object → blank row`);
      const id = `repaired_${Date.now()}_${i}`;
      seenIds.add(id);
      return { id, name: "", concentration: "", amount_per_reaction: "" };
    }
    const r = item as Record<string, unknown>;
    let id = typeof r.id === "string" ? r.id : "";
    if (!id || seenIds.has(id)) {
      const newId = `repaired_${Date.now()}_${i}`;
      fixes.push(`ingredient ${i} ${id ? "duplicate" : "missing"} id → ${newId}`);
      id = newId;
    }
    seenIds.add(id);
    return {
      id,
      name: typeof r.name === "string" ? r.name : (fixes.push(`ingredient ${i} missing name`), ""),
      concentration: typeof r.concentration === "string" ? r.concentration : (fixes.push(`ingredient ${i} missing concentration`), ""),
      amount_per_reaction: typeof r.amount_per_reaction === "string"
        ? r.amount_per_reaction
        : (fixes.push(`ingredient ${i} missing amount`), ""),
      ...(typeof r.checked === "boolean" ? { checked: r.checked } : {}),
    };
  });
}

export function repairPCRProtocol(raw: unknown): ProtocolRepairResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number") return null;

  const fixes: string[] = [];
  const name = typeof r.name === "string" ? r.name : (fixes.push("missing name"), `Protocol ${r.id}`);
  const gradient = repairGradient(r.gradient, fixes);
  const ingredients = repairIngredients(r.ingredients, fixes);
  const notes = typeof r.notes === "string" || r.notes === null ? (r.notes as string | null) : (fixes.push("notes malformed → null"), null);
  const is_public = typeof r.is_public === "boolean" ? r.is_public : (fixes.push("is_public missing → false"), false);
  const created_by = typeof r.created_by === "string" || r.created_by === null ? (r.created_by as string | null) : (fixes.push("created_by malformed → null"), null);

  return {
    protocol: { id: r.id, name, gradient, ingredients, notes, is_public, created_by },
    fixes,
  };
}

export async function repairAllPCRProtocols(): Promise<RepairReport> {
  const report: RepairReport = { total: 0, repaired: 0, unrecoverable: 0, errors: [], details: [] };

  const privateStore = new JsonStore<PCRProtocol>("pcr_protocols");
  const publicStore = getPublicStore<PCRProtocol>("pcr_protocols");
  const stores: Array<{ store: JsonStore<PCRProtocol>; scope: "private" | "public" }> = [
    { store: privateStore, scope: "private" },
    { store: publicStore, scope: "public" },
  ];

  for (const { store, scope } of stores) {
    let raws: unknown[];
    try {
      raws = await store.listAll();
    } catch (err) {
      report.errors.push(`Failed to list ${scope} protocols: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const raw of raws) {
      report.total++;
      const result = repairPCRProtocol(raw);
      if (!result) {
        report.unrecoverable++;
        report.errors.push(`Unrecoverable ${scope} record (missing id): ${JSON.stringify(raw).slice(0, 200)}`);
        continue;
      }
      if (result.fixes.length === 0) continue;

      try {
        await store.save(result.protocol.id, { ...result.protocol, is_public: scope === "public" });
        report.repaired++;
        report.details.push({ id: result.protocol.id, name: result.protocol.name, scope, fixes: result.fixes });
      } catch (err) {
        report.errors.push(`Failed to save ${scope} protocol ${result.protocol.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return report;
}
