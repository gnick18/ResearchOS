// frontend/src/lib/deposit/prefill.ts
//
// Repository-deposit PHASE 1 (guided-deposit bot, 2026-05-28). The thin I/O
// layer that gathers everything the metadata form prefills from: the built
// export payload (notes/results for the abstract), the owner's display name
// + ORCID, and the project's PRIMARY funding account.
//
// Kept OUT of datacite.ts so that module stays pure + unit-testable. This
// file does the reads; `buildDepositMetadata` does the mapping.
//
// FUNDER SOURCE (locked Phase 1): the project's PRIMARY funding_account_id
// only (single). We do NOT compute a charged-grants set; the multi-funder
// feeding is a later bot's job. We stay out of purchases-prefill code.
//
// No em-dashes, no emojis. NO new on-disk field is written here; the
// prefilled metadata file lives in the downloadable bundle, never in the
// user's data folder.

import type { FundingAccount, Task } from "@/lib/types";
import { purchasesApi, projectsApi } from "@/lib/local-api";
import { readUserSettings } from "@/lib/settings/user-settings";
import { getUserMetadata } from "@/lib/file-system/user-metadata";
import { buildExperimentPayload } from "@/lib/export/extract";
import { methodsApi, filesApi } from "@/lib/local-api";
import { extractUserContent } from "@/lib/stamp-utils";
import { deriveAbstract } from "./datacite";
import { resolveOwnerOrcid } from "./owner-orcid";
import type { ExperimentExportPayload } from "@/lib/export/types";

/**
 * The bundle of prefill data the dialog needs. `payload` is the fully-built
 * export payload (reused for the curation step AND the abstract seed);
 * everything else feeds `buildDepositMetadata`.
 */
export interface DepositPrefill {
  payload: ExperimentExportPayload;
  ownerDisplayName: string;
  ownerOrcid: string | null;
  // The project's primary funding account, or null when unlinked / missing.
  fundingAccount: FundingAccount | null;
  // The auto-derived abstract (from results then notes) the form seeds the
  // editable abstract field with.
  suggestedAbstract: string;
  // Today's date as YYYY-MM-DD, the default publication date.
  defaultPublicationDate: string;
}

/**
 * Resolve the project's PRIMARY funding account (single) for a task.
 * Returns null when the project has no `funding_account_id` link or the
 * referenced account no longer exists.
 */
export async function resolvePrimaryFundingAccount(
  task: Task,
): Promise<FundingAccount | null> {
  const project = await projectsApi.get(task.project_id, task.owner);
  const id = project?.funding_account_id;
  if (id === null || id === undefined) return null;
  const accounts = await purchasesApi.listFundingAccounts();
  return accounts.find((a) => a.id === id) ?? null;
}

/**
 * Resolve the owner's display name: settings.json#displayName when set,
 * otherwise the folder username. Never throws (a missing/broken settings
 * file falls back to the username).
 */
export async function resolveOwnerDisplayName(owner: string): Promise<string> {
  try {
    const settings = await readUserSettings(owner);
    const dn = (settings.displayName ?? "").trim();
    return dn.length > 0 ? dn : owner;
  } catch {
    return owner;
  }
}

/**
 * Gather every prefill input for a task's deposit. Reuses
 * `buildExperimentPayload` (the existing pipeline) so the curation step and
 * the abstract seed share one read of the experiment.
 */
export async function loadDepositPrefill(
  task: Task,
  currentUser: string | null,
): Promise<DepositPrefill> {
  const deps = { projectsApi, methodsApi, filesApi };
  const payload = await buildExperimentPayload(task, currentUser, deps);

  const [ownerDisplayName, ownerEntry, fundingAccount] = await Promise.all([
    resolveOwnerDisplayName(task.owner),
    getUserMetadata(task.owner),
    resolvePrimaryFundingAccount(task),
  ]);

  // Seed the abstract from the user-authored body of results, then notes
  // (stamps stripped). The form lets the user edit this freely.
  const suggestedAbstract = deriveAbstract(
    extractUserContent(payload.resultsMarkdown),
    extractUserContent(payload.notesMarkdown),
  );

  // ORCID is cloud-preferred (account_profiles.links.orcid) with the local
  // _user_metadata.json value as the fallback, so a cloud-set ORCID applies
  // across folders while offline / solo deposits keep the same local value.
  const ownerOrcid = await resolveOwnerOrcid(ownerEntry?.orcid);

  return {
    payload,
    ownerDisplayName,
    ownerOrcid,
    fundingAccount,
    suggestedAbstract,
    defaultPublicationDate: new Date().toISOString().slice(0, 10),
  };
}
