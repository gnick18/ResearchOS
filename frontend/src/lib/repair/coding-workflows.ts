import { JsonStore, getPublicStore } from "../storage/json-store";
import type {
  CodingWorkflowLanguage,
  CodingWorkflowOutputRenderer,
  CodingWorkflowProtocol,
} from "../types";

export interface CodingWorkflowRepairResult {
  protocol: CodingWorkflowProtocol;
  fixes: string[];
}

export interface CodingWorkflowRepairReport {
  total: number;
  repaired: number;
  unrecoverable: number;
  errors: string[];
  details: Array<{ id: number; name: string; scope: "private" | "public"; fixes: string[] }>;
}

const VALID_LANGUAGES: ReadonlyArray<CodingWorkflowLanguage> = [
  "python",
  "r",
  "bash",
  "sql",
  "julia",
  "matlab",
  "javascript",
  "other",
];

const VALID_RENDERERS: ReadonlyArray<"syntax-highlight" | "ipynb"> = [
  "syntax-highlight",
  "ipynb",
];

export function repairCodingWorkflowProtocol(raw: unknown): CodingWorkflowRepairResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number") return null;

  const fixes: string[] = [];
  const name =
    typeof r.name === "string"
      ? r.name
      : (fixes.push("missing name"), `Coding Workflow ${r.id}`);
  const description =
    typeof r.description === "string" || r.description === null
      ? (r.description as string | null)
      : (fixes.push("description malformed → null"), null);
  const language: CodingWorkflowLanguage =
    typeof r.language === "string" &&
    (VALID_LANGUAGES as readonly string[]).includes(r.language)
      ? (r.language as CodingWorkflowLanguage)
      : (fixes.push("language invalid → python"), "python");
  const language_label =
    typeof r.language_label === "string" || r.language_label === null
      ? (r.language_label as string | null)
      : (fixes.push("language_label malformed → null"), null);
  const embedded_code =
    typeof r.embedded_code === "string" || r.embedded_code === null
      ? (r.embedded_code as string | null)
      : (fixes.push("embedded_code malformed → null"), null);
  const external_path =
    typeof r.external_path === "string" || r.external_path === null
      ? (r.external_path as string | null)
      : (fixes.push("external_path malformed → null"), null);

  let output_renderer: CodingWorkflowOutputRenderer;
  if (r.output_renderer === null) {
    output_renderer = null;
  } else if (
    typeof r.output_renderer === "string" &&
    (VALID_RENDERERS as readonly string[]).includes(r.output_renderer)
  ) {
    output_renderer = r.output_renderer as "syntax-highlight" | "ipynb";
  } else {
    fixes.push("output_renderer malformed → syntax-highlight");
    output_renderer = "syntax-highlight";
  }

  const is_public =
    typeof r.is_public === "boolean"
      ? r.is_public
      : (fixes.push("is_public missing → false"), false);
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
      language,
      language_label,
      embedded_code,
      external_path,
      output_renderer,
      is_public,
      created_by,
      ...(created_at ? { created_at } : {}),
      ...(updated_at ? { updated_at } : {}),
    },
    fixes,
  };
}

export async function repairAllCodingWorkflows(): Promise<CodingWorkflowRepairReport> {
  const report: CodingWorkflowRepairReport = {
    total: 0,
    repaired: 0,
    unrecoverable: 0,
    errors: [],
    details: [],
  };

  const privateStore = new JsonStore<CodingWorkflowProtocol>("coding_workflows");
  const publicStore = getPublicStore<CodingWorkflowProtocol>("coding_workflows");
  const stores: Array<{ store: JsonStore<CodingWorkflowProtocol>; scope: "private" | "public" }> = [
    { store: privateStore, scope: "private" },
    { store: publicStore, scope: "public" },
  ];

  for (const { store, scope } of stores) {
    let raws: unknown[];
    try {
      raws = await store.listAll();
    } catch (err) {
      report.errors.push(
        `Failed to list ${scope} coding workflows: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    for (const raw of raws) {
      report.total++;
      const result = repairCodingWorkflowProtocol(raw);
      if (!result) {
        report.unrecoverable++;
        report.errors.push(
          `Unrecoverable ${scope} coding workflow (missing id): ${JSON.stringify(raw).slice(0, 200)}`,
        );
        continue;
      }
      if (result.fixes.length === 0) continue;

      try {
        await store.save(result.protocol.id, {
          ...result.protocol,
          is_public: scope === "public",
        });
        report.repaired++;
        report.details.push({
          id: result.protocol.id,
          name: result.protocol.name,
          scope,
          fixes: result.fixes,
        });
      } catch (err) {
        report.errors.push(
          `Failed to save ${scope} coding workflow ${result.protocol.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return report;
}
