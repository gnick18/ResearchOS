import { parseLabArchivesOfflineZip } from "./adapters/labarchives";
import { applyELNImportPlan, detectChangedPages } from "./apply";
import { buildDefaultPlan } from "./plan";
import type { ELNApplyDeps, ELNApplyFileService, ChangedPage } from "./apply";
import type { ELNImportPlan, ELNImportResult, ParsedNotebook } from "./types";

export { buildDefaultPlan } from "./plan";
export { applyELNImportPlan, detectChangedPages } from "./apply";
export type { ELNApplyDeps, ChangedPage } from "./apply";

/**
 * Wizard-side helper: scan the receiver's existing imports against a freshly
 * parsed notebook and surface any pages whose content has drifted since the
 * last import. The wizard's preview step uses this to decide which pages
 * need the "overwrite?" prompt.
 *
 * Lazy-loads the production `fileService` so the function stays callable
 * from contexts that don't already have apply-side deps wired up.
 */
export async function detectChangedPagesAgainstDisk(
  parsed: ParsedNotebook,
  receiver: string,
  fsOverride?: ELNApplyFileService,
): Promise<ChangedPage[]> {
  const fs = fsOverride ?? (await import("../../file-system/file-service")).fileService;
  return detectChangedPages(parsed, receiver, fs);
}

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
