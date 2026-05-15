import { methodsApi, projectsApi } from "@/lib/local-api";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import type {
  ImportPayload,
  ImportPlan,
  MethodResolution,
  ProjectResolution,
} from "./types";

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Build a default `ImportPlan` from the parsed payload and the receiver's
 * existing data.
 *
 * Defaults aim to be the safe, sensible call:
 *  - **Project**: if an exact (case-insensitive) name match exists, default
 *    to "use-existing". Otherwise default to "import-new" so the experiment
 *    has a home; the user can switch to "no-project" if they want.
 *  - **Method**: if an exact name match exists, default to "use-existing"
 *    (almost always the right call — methods are typically shared protocols).
 *    Otherwise default to "import-new" so nothing silently disappears.
 *
 * The user sees these decisions in the preview dialog and can override per
 * entity before applying.
 */
export async function buildImportPlan(
  payload: ImportPayload,
): Promise<ImportPlan> {
  const existingProjects = await projectsApi.list();
  const existingMethods = await methodsApi.list();

  // ── Project ──────────────────────────────────────────────────────────────
  const sourceProjectName = payload.project.name;
  const projectCandidates = existingProjects
    .filter((p) => !p.is_archived)
    .map((p) => ({ id: p.id, name: p.name }));
  const projectExact = existingProjects.find(
    (p) => !p.is_archived && normalizeName(p.name) === normalizeName(sourceProjectName),
  );

  const project: ProjectResolution = projectExact
    ? {
        sourceProjectId: payload.project.id,
        sourceProjectName,
        decision: "use-existing",
        existingProjectId: projectExact.id,
        candidates: projectCandidates,
      }
    : {
        sourceProjectId: payload.project.id,
        sourceProjectName,
        decision: "import-new",
        existingProjectId: null,
        candidates: projectCandidates,
      };

  // ── Methods ──────────────────────────────────────────────────────────────
  const methodResolutions: MethodResolution[] = [];
  for (const entry of payload.methods) {
    const methodName = entry.record.name;
    // For methods, only consider receiver-owned methods (not is_shared_with_me)
    // as "existing" candidates — a receiver shouldn't link an imported task
    // to a method that's shared into their workspace from a third party.
    const ownCandidates = existingMethods
      .filter((m) => !m.is_shared_with_me)
      .map((m) => ({ id: m.id, name: m.name }));
    // For structured methods (PCR today; LC/plate/cell-culture in v1),
    // only consider a name match as "use-existing" if the existing method
    // shares the same method_type — pointing a structured-typed task slot
    // at a markdown/pdf method (or at a *different* structured type) would
    // render badly. Standard types stay name-match-only.
    const sourceMeta = getMethodTypeMeta(entry.record.method_type);
    const requireSameType = sourceMeta.hasStructuredProtocol;
    const exactMatch = existingMethods.find(
      (m) =>
        !m.is_shared_with_me &&
        (!requireSameType || m.method_type === entry.record.method_type) &&
        normalizeName(m.name) === normalizeName(methodName),
    );

    // import-new is only available for structured types when the bundle
    // carried the protocol record. Without it, the importer has nothing
    // to recreate from, so the default falls through to skip.
    //   - PCR   → entry.pcrProtocol
    //   - LC    → entry.lcGradientProtocol
    //   - Plate → entry.plateProtocol
    // Future structured types add their carrier check here.
    const importNewAvailable =
      !sourceMeta.hasStructuredProtocol ||
      (entry.record.method_type === "pcr"
        ? entry.pcrProtocol != null
        : entry.record.method_type === "lc_gradient"
          ? entry.lcGradientProtocol != null
          : entry.record.method_type === "plate"
            ? entry.plateProtocol != null
            : false);

    let decision: MethodResolution["decision"];
    let existingMethodId: number | null;
    if (exactMatch) {
      decision = "use-existing";
      existingMethodId = exactMatch.id;
    } else if (importNewAvailable) {
      decision = "import-new";
      existingMethodId = null;
    } else {
      decision = "skip";
      existingMethodId = null;
    }

    methodResolutions.push({
      sourceMethodId: entry.record.id,
      sourceMethodName: methodName,
      sourceMethodType: entry.record.method_type,
      decision,
      existingMethodId,
      candidates: ownCandidates,
    });
  }

  return {
    payload,
    project,
    methods: methodResolutions,
  };
}

/**
 * Pick an unused name for a freshly-imported project. The strategy is to
 * append " (imported)", and if that's taken, walk through
 * " (imported 2)", " (imported 3)", etc. until we find a free slot.
 *
 * Used by `apply.ts`. Exported so the dialog can preview the resulting name.
 */
export async function pickImportedProjectName(baseName: string): Promise<string> {
  const existing = await projectsApi.list();
  const taken = new Set(existing.map((p) => normalizeName(p.name)));
  const candidate = `${baseName} (imported)`;
  if (!taken.has(normalizeName(candidate))) return candidate;
  for (let i = 2; i < 1000; i++) {
    const next = `${baseName} (imported ${i})`;
    if (!taken.has(normalizeName(next))) return next;
  }
  // Final fallback — vanishingly unlikely.
  return `${baseName} (imported ${Date.now()})`;
}

/**
 * Same shape for methods. Methods can be private OR public, but both share
 * the global `methods` id space; we still suffix-search for clarity.
 */
export async function pickImportedMethodName(baseName: string): Promise<string> {
  const existing = await methodsApi.list();
  const taken = new Set(existing.map((m) => normalizeName(m.name)));
  const candidate = `${baseName} (imported)`;
  if (!taken.has(normalizeName(candidate))) return candidate;
  for (let i = 2; i < 1000; i++) {
    const next = `${baseName} (imported ${i})`;
    if (!taken.has(normalizeName(next))) return next;
  }
  return `${baseName} (imported ${Date.now()})`;
}
