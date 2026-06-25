// frontend/src/lib/deposit/project-prefill.ts
//
// Project-level (multi-item) deposit prefill (deposit-widening bot,
// 2026-05-29). The I/O layer that gathers everything the PROJECT-scoped
// deposit dialog needs:
//
//   - the project's experiments (the multi-select source for experiments),
//   - the owner's notes (the multi-select source for notes; notes are NOT
//     project-scoped in ResearchOS, so we present the owner's notes as a flat
//     selectable list and let the user attach the relevant ones),
//   - the owner's display name + ORCID,
//   - the project's PRIMARY funding account (the main funder),
//   - the DERIVED charged-grants set (additional funders), via the existing
//     computeChargedGrants / loadChargedGrants pipeline.
//
// Kept OUT of datacite.ts so that module stays pure. This file does the reads;
// the metadata builders do the mapping. NO new on-disk field is written: the
// prefilled metadata + the bundle live in the downloadable archive, never in
// the user's data folder.
//
// No em-dashes, no emojis.

import type { FundingAccount, Note, Project, Task } from "@/lib/types";
import { tasksApi, notesApi, purchasesApi } from "@/lib/local-api";
import { readUserSettings } from "@/lib/settings/user-settings";
import { getUserMetadata } from "@/lib/file-system/user-metadata";
import { loadChargedGrants, type ChargedGrants } from "@/lib/funding/charged-grants";
import { resolveOwnerOrcid } from "./owner-orcid";

/**
 * Everything the project-level deposit dialog prefills from. The experiment +
 * note lists drive the multi-select curation step; the rest feeds
 * `buildProjectDepositMetadata`.
 */
export interface ProjectDepositPrefill {
  project: Project;
  // The project's experiment tasks (task_type === "experiment"), the
  // selectable experiment set.
  experiments: Task[];
  // The owner's notes, the selectable note set. Notes are owner-scoped, not
  // project-scoped, so this is the owner's full note list.
  notes: Note[];
  ownerDisplayName: string;
  ownerOrcid: string | null;
  // The project's PRIMARY funding account (main funder), or null when unlinked.
  primaryFundingAccount: FundingAccount | null;
  // The DERIVED charged-grants set (additional funders), deduped against the
  // primary by the metadata builder downstream.
  chargedGrants: ChargedGrants;
  // Today's date as YYYY-MM-DD, the default publication date.
  defaultPublicationDate: string;
}

/**
 * Resolve the owner's display name: settings.json#displayName when set,
 * otherwise the folder username. Never throws.
 */
async function resolveOwnerDisplayName(owner: string): Promise<string> {
  try {
    const settings = await readUserSettings(owner);
    const dn = (settings.displayName ?? "").trim();
    return dn.length > 0 ? dn : owner;
  } catch {
    return owner;
  }
}

/**
 * Resolve the project's PRIMARY funding account (single) from its
 * `funding_account_id` link. Returns null when unlinked or the referenced
 * account no longer exists.
 */
async function resolvePrimaryFundingAccount(
  project: Project,
): Promise<FundingAccount | null> {
  const id = project.funding_account_id;
  if (id === null || id === undefined) return null;
  const accounts = await purchasesApi.listFundingAccounts();
  return accounts.find((a) => a.id === id) ?? null;
}

/**
 * Gather every prefill input for a project's deposit. `owner` routes the reads
 * into a shared project's owner directory (mirrors the charged-grants loader),
 * or undefined for the viewer's own project.
 */
export async function loadProjectDepositPrefill(
  project: Project,
  currentUser: string | null,
  owner?: string,
): Promise<ProjectDepositPrefill> {
  const [tasks, notes, ownerDisplayName, ownerEntry, primaryFundingAccount, chargedGrants] =
    await Promise.all([
      tasksApi.listByProject(project.id, owner),
      // Notes are owner-scoped; list the project owner's notes so a shared
      // project's deposit can still attach the owner's notes.
      notesApi.list(),
      resolveOwnerDisplayName(project.owner),
      getUserMetadata(project.owner),
      resolvePrimaryFundingAccount(project),
      loadChargedGrants(
        project.id,
        {
          listTasksByProject: tasksApi.listByProject,
          listPurchasesByTask: purchasesApi.listByTask,
          listFundingAccounts: purchasesApi.listFundingAccounts,
        },
        owner,
      ),
    ]);

  const experiments = tasks
    .filter((t) => t.task_type === "experiment")
    .sort((a, b) => a.sort_order - b.sort_order);

  // Filter the owner's notes to the project owner so a viewer of a shared
  // project does not pull in their own unrelated notes. `username` is the
  // creator stamp on a Note.
  const ownerNotes = notes
    .filter((n) => !n.username || n.username === project.owner)
    .sort((a, b) =>
      (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
    );

  // ORCID is cloud-preferred (account_profiles.links.orcid) with the local
  // _user_metadata.json value as the fallback, so a cloud-set ORCID applies
  // across folders while offline / solo deposits keep the same local value.
  const ownerOrcid = await resolveOwnerOrcid(ownerEntry?.orcid);

  return {
    project,
    experiments,
    notes: ownerNotes,
    ownerDisplayName,
    ownerOrcid,
    primaryFundingAccount,
    chargedGrants,
    defaultPublicationDate: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Re-export so the dialog can reference the project's combined funder set
 * (primary first, then the deduped charged-grants accounts) for the metadata
 * preview without re-deriving the order. The dedupe itself lives in
 * `buildFundingReferences`; this is only the source ordering.
 */
export function combinedFundingAccounts(
  prefill: Pick<ProjectDepositPrefill, "primaryFundingAccount" | "chargedGrants">,
): FundingAccount[] {
  const out: FundingAccount[] = [];
  if (prefill.primaryFundingAccount) out.push(prefill.primaryFundingAccount);
  for (const acc of prefill.chargedGrants.accounts) {
    if (acc.id !== prefill.primaryFundingAccount?.id) out.push(acc);
  }
  return out;
}
