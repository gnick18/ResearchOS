import { JsonStore, getPublicStore } from "../storage/json-store";
import type {
  QPCRAnalysisProtocol,
  QPCRChemistry,
  QPCRMeltCurveConfig,
  QPCRReference,
  QPCRStandardCurvePoint,
} from "../types";

export interface QPCRAnalysisRepairResult {
  protocol: QPCRAnalysisProtocol;
  fixes: string[];
}

export interface QPCRAnalysisRepairReport {
  total: number;
  repaired: number;
  unrecoverable: number;
  errors: string[];
  details: Array<{ id: number; name: string; scope: "private" | "public"; fixes: string[] }>;
}

const VALID_CHEMISTRIES: ReadonlyArray<QPCRChemistry> = [
  "sybr",
  "taqman",
  "evagreen",
  "other",
];

function repairReference(raw: unknown, idx: number, fixes: string[], seenIds: Set<string>): QPCRReference {
  if (!raw || typeof raw !== "object") {
    const id = `repaired_${Date.now()}_${idx}`;
    fixes.push(`reference ${idx} was not an object → blank row`);
    seenIds.add(id);
    return { id, target: "", channel: "", is_reference: false };
  }
  const r = raw as Record<string, unknown>;
  let id = typeof r.id === "string" ? r.id : "";
  if (!id || seenIds.has(id)) {
    const newId = `repaired_${Date.now()}_${idx}`;
    fixes.push(`reference ${idx} ${id ? "duplicate" : "missing"} id → ${newId}`);
    id = newId;
  }
  seenIds.add(id);
  const target = typeof r.target === "string" ? r.target : (fixes.push(`reference ${idx} missing target`), "");
  const channel = typeof r.channel === "string" ? r.channel : (fixes.push(`reference ${idx} missing channel`), "");
  const is_reference =
    typeof r.is_reference === "boolean"
      ? r.is_reference
      : (fixes.push(`reference ${idx} is_reference malformed → false`), false);
  const out: QPCRReference = { id, target, channel, is_reference };
  if (r.expected_cq === null || r.expected_cq === undefined) {
    // omit
  } else if (typeof r.expected_cq === "number" && Number.isFinite(r.expected_cq)) {
    out.expected_cq = r.expected_cq;
  } else {
    fixes.push(`reference ${idx} expected_cq malformed → dropped`);
  }
  return out;
}

function repairStandardCurve(raw: unknown, fixes: string[]): QPCRStandardCurvePoint[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      fixes.push("standard_curve not an array → []");
    }
    return [];
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== "object") {
      fixes.push(`standard_curve point ${i} not an object → defaulted`);
      return { log_quantity: 0, cq: 0 };
    }
    const r = item as Record<string, unknown>;
    const log_quantity =
      typeof r.log_quantity === "number" && Number.isFinite(r.log_quantity)
        ? r.log_quantity
        : (fixes.push(`standard_curve point ${i} log_quantity invalid → 0`), 0);
    const cq =
      typeof r.cq === "number" && Number.isFinite(r.cq)
        ? r.cq
        : (fixes.push(`standard_curve point ${i} cq invalid → 0`), 0);
    const out: QPCRStandardCurvePoint = { log_quantity, cq };
    if (typeof r.replicate_n === "number" && Number.isFinite(r.replicate_n) && r.replicate_n > 0) {
      out.replicate_n = r.replicate_n;
    } else if (r.replicate_n !== undefined && r.replicate_n !== null) {
      fixes.push(`standard_curve point ${i} replicate_n malformed → dropped`);
    }
    return out;
  });
}

function repairMeltCurve(raw: unknown, fixes: string[]): QPCRMeltCurveConfig | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") {
    fixes.push("melt_curve malformed → null");
    return null;
  }
  const r = raw as Record<string, unknown>;
  const start_c =
    typeof r.start_c === "number" && Number.isFinite(r.start_c)
      ? r.start_c
      : (fixes.push("melt_curve.start_c invalid → 60"), 60);
  const end_c =
    typeof r.end_c === "number" && Number.isFinite(r.end_c)
      ? r.end_c
      : (fixes.push("melt_curve.end_c invalid → 95"), 95);
  const ramp_rate_c_per_sec =
    typeof r.ramp_rate_c_per_sec === "number" && Number.isFinite(r.ramp_rate_c_per_sec) && r.ramp_rate_c_per_sec > 0
      ? r.ramp_rate_c_per_sec
      : (fixes.push("melt_curve.ramp_rate_c_per_sec invalid → 0.1"), 0.1);
  return { start_c, end_c, ramp_rate_c_per_sec };
}

export function repairQPCRAnalysisProtocol(raw: unknown): QPCRAnalysisRepairResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number") return null;

  const fixes: string[] = [];
  const name = typeof r.name === "string" ? r.name : (fixes.push("missing name"), `qPCR Analysis ${r.id}`);
  const description =
    typeof r.description === "string" || r.description === null
      ? (r.description as string | null)
      : (fixes.push("description malformed → null"), null);

  const chemistry =
    typeof r.chemistry === "string" && (VALID_CHEMISTRIES as readonly string[]).includes(r.chemistry)
      ? (r.chemistry as QPCRChemistry)
      : (fixes.push("chemistry invalid → sybr"), "sybr" as QPCRChemistry);
  const chemistry_label =
    typeof r.chemistry_label === "string" || r.chemistry_label === null
      ? (r.chemistry_label as string | null)
      : (fixes.push("chemistry_label malformed → null"), null);

  const seenIds = new Set<string>();
  const references = Array.isArray(r.references)
    ? r.references.map((ref, i) => repairReference(ref, i, fixes, seenIds))
    : (fixes.push("references not an array → []"), []);

  const standard_curve = repairStandardCurve(r.standard_curve, fixes);
  const melt_curve = repairMeltCurve(r.melt_curve, fixes);

  const use_delta_delta_cq =
    typeof r.use_delta_delta_cq === "boolean"
      ? r.use_delta_delta_cq
      : (fixes.push("use_delta_delta_cq missing → false"), false);

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
      chemistry,
      chemistry_label,
      references,
      standard_curve,
      melt_curve,
      use_delta_delta_cq,
      is_public,
      created_by,
      ...(created_at ? { created_at } : {}),
      ...(updated_at ? { updated_at } : {}),
    },
    fixes,
  };
}

export async function repairAllQPCRAnalysisProtocols(): Promise<QPCRAnalysisRepairReport> {
  const report: QPCRAnalysisRepairReport = {
    total: 0,
    repaired: 0,
    unrecoverable: 0,
    errors: [],
    details: [],
  };

  const privateStore = new JsonStore<QPCRAnalysisProtocol>("qpcr_analyses");
  const publicStore = getPublicStore<QPCRAnalysisProtocol>("qpcr_analyses");
  const stores: Array<{ store: JsonStore<QPCRAnalysisProtocol>; scope: "private" | "public" }> = [
    { store: privateStore, scope: "private" },
    { store: publicStore, scope: "public" },
  ];

  for (const { store, scope } of stores) {
    let raws: unknown[];
    try {
      raws = await store.listAll();
    } catch (err) {
      report.errors.push(
        `Failed to list ${scope} qPCR analyses: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    for (const raw of raws) {
      report.total++;
      const result = repairQPCRAnalysisProtocol(raw);
      if (!result) {
        report.unrecoverable++;
        report.errors.push(
          `Unrecoverable ${scope} qPCR analysis (missing id): ${JSON.stringify(raw).slice(0, 200)}`,
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
          `Failed to save ${scope} qPCR analysis ${result.protocol.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return report;
}
