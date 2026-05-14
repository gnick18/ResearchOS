import { parseLabArchivesOfflineZip } from "./adapters/labarchives";
import { applyELNImportPlan } from "./apply";
import { buildDefaultPlan } from "./plan";
import type { ELNApplyDeps } from "./apply";
import type { ELNImportPlan, ELNImportResult, ParsedNotebook } from "./types";

export { buildDefaultPlan } from "./plan";
export { applyELNImportPlan } from "./apply";
export type { ELNApplyDeps } from "./apply";

/**
 * Parse a LabArchives offline ZIP into the shared `ParsedNotebook` shape.
 * Re-exported here so wizard-UI callers have a single entry point for the
 * whole import flow.
 */
export async function parseELNZip(input: File | ArrayBuffer): Promise<ParsedNotebook> {
  return parseLabArchivesOfflineZip(input);
}

/**
 * End-to-end convenience: parse a ZIP, build a default plan, and apply
 * immediately without UI intervention. Useful for test harnesses and
 * "trust-defaults" CLI flows.
 *
 * For the real wizard UI: call `parseELNZip` → `buildDefaultPlan` → let the
 * user edit `projectMappings` → call `applyELNImportPlan(plan)`.
 */
export async function importELNZipWithDefaults(
  input: File | ArrayBuffer,
  receiver: string,
  depsOverride?: Partial<ELNApplyDeps>,
): Promise<{ plan: ELNImportPlan; result: ELNImportResult }> {
  const parsed = await parseELNZip(input);
  const plan = buildDefaultPlan(parsed, receiver, new Date().toISOString());
  const result = await applyELNImportPlan(plan, depsOverride);
  return { plan, result };
}
