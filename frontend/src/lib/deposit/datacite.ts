// frontend/src/lib/deposit/datacite.ts
//
// Repository-deposit PHASE 1 (guided-deposit bot, 2026-05-28). A PURE,
// well-typed builder that turns the data ResearchOS already holds for an
// experiment (task + project + funding account + the owner's ORCID) into a
// DataCite-shaped metadata object the user can paste into a repository's
// own web upload page.
//
// NO API calls, NO credentials, NO server routes live here. Phase 1 is the
// GUIDED path: we build a repository-ready metadata file and hand off to the
// repository's web upload form. The repository mints the DOI; we do not.
//
// This module is intentionally side-effect-free and dependency-light so the
// Phase 2 one-click-deposit bot can reuse `buildDepositMetadata` verbatim and
// feed its output straight to a Zenodo / DataCite API call. Field names match
// DataCite's REST schema (https://support.datacite.org/docs/api-create-dois)
// so the mapping is a direct copy when that day comes.
//
// Conventions: no em-dashes, no emojis. This file imports only types + the
// pure ORCID helpers; it never touches the filesystem or the network.

import type { FundingAccount, FunderIdType, Project, Task } from "@/lib/types";
import { isValidOrcid, normalizeOrcid } from "@/lib/metadata/orcid";

// ---------------------------------------------------------------------------
// DataCite-shaped output types
// ---------------------------------------------------------------------------

/**
 * One creator (author) in the DataCite `creators` array. We model the
 * subset Phase 1 fills: a display name plus an optional ORCID
 * nameIdentifier. `nameType` defaults to "Personal" since ResearchOS owners
 * are people.
 */
export interface DataCiteNameIdentifier {
  nameIdentifier: string;
  nameIdentifierScheme: "ORCID";
  schemeUri: "https://orcid.org";
}

export interface DataCiteCreator {
  name: string;
  nameType: "Personal";
  // Present only when the owner has a (soft-)valid ORCID on file.
  nameIdentifiers?: DataCiteNameIdentifier[];
}

/**
 * One DataCite `fundingReference`. All optional sub-fields mirror the
 * controlled vocabulary so a Phase 2 API copy is field-for-field. We emit a
 * reference only when at least a funder name OR an award number is present.
 */
export interface DataCiteFundingReference {
  funderName: string;
  funderIdentifier?: string;
  funderIdentifierType?: Exclude<FunderIdType, null>;
  awardNumber?: string;
  awardTitle?: string;
}

/**
 * The DataCite `rights` (license) array entry. Phase 1 has no on-disk
 * license field, so this is always user-supplied at the metadata step. We
 * carry the SPDX id plus a best-effort URI for the well-known licenses.
 */
export interface DataCiteRights {
  rights: string;
  rightsIdentifier?: string;
  rightsIdentifierScheme?: "SPDX";
  rightsUri?: string;
}

/**
 * The DataCite metadata object Phase 1 produces. A faithful subset of the
 * DataCite 4.x schema: only the fields a guided deposit can prefill or the
 * user can reasonably complete. Phase 2 widens this without changing the
 * shape of what is here.
 */
export interface DepositMetadata {
  // The experiment title (DataCite `titles[0].title`). Always present.
  titles: { title: string }[];
  // The owner + any future co-authors.
  creators: DataCiteCreator[];
  // Free-text abstract (DataCite `descriptions[0]`, descriptionType
  // "Abstract"). Empty string when neither notes/results nor a typed
  // abstract are available; the UI nudges the user to fill it.
  descriptions: { description: string; descriptionType: "Abstract" }[];
  // The publication year as a 4-digit string (DataCite `publicationYear`).
  publicationYear: string;
  // Free-form subjects / keywords (DataCite `subjects`). Sourced from the
  // task's tags. Empty array when the task is untagged.
  subjects: { subject: string }[];
  // resourceType is always "Dataset" for an experiment deposit in Phase 1.
  types: { resourceTypeGeneral: "Dataset"; resourceType: "Experiment" };
  // Zero or one funding references (Phase 1 derives ONLY the project's
  // primary funding account). Empty array when no funder data is available.
  fundingReferences: DataCiteFundingReference[];
  // Zero or one license. Empty array until the user picks one; the UI makes
  // a license required before handoff. See `LICENSE_OPTIONS`.
  rights: DataCiteRights[];
  // The repository (Zenodo / DataCite) mints the DOI; we never set it in
  // Phase 1. Present in the type as `null` so Phase 2 can populate it.
  doi: string | null;
}

// ---------------------------------------------------------------------------
// License catalog (user-picked at the metadata step)
// ---------------------------------------------------------------------------

/**
 * A license the user can attach. We surface the two NIH-friendly defaults
 * up top (CC-BY-4.0 and CC0-1.0) with a short explainer, plus a small set of
 * other common research-data licenses, and an "Other" escape hatch the user
 * types themselves.
 */
export interface LicenseOption {
  // SPDX identifier, e.g. "CC-BY-4.0". Empty string for the "Other" sentinel.
  spdxId: string;
  // Human label shown in the picker.
  label: string;
  // One-line plain-language explainer.
  explainer: string;
  // Canonical license URI (best-effort; omitted for "Other").
  uri?: string;
  // Marks the two suggested defaults so the UI can badge them.
  recommended?: boolean;
}

export const LICENSE_OPTIONS: LicenseOption[] = [
  {
    spdxId: "CC-BY-4.0",
    label: "CC BY 4.0",
    explainer:
      "Others may reuse and build on your data for any purpose as long as they credit you. The most common choice for shared research data.",
    uri: "https://creativecommons.org/licenses/by/4.0/legalcode",
    recommended: true,
  },
  {
    spdxId: "CC0-1.0",
    label: "CC0 1.0 (public domain)",
    explainer:
      "You waive all rights and place the data in the public domain. No attribution required. Maximizes reuse.",
    uri: "https://creativecommons.org/publicdomain/zero/1.0/legalcode",
    recommended: true,
  },
  {
    spdxId: "CC-BY-SA-4.0",
    label: "CC BY-SA 4.0",
    explainer:
      "Reuse with credit, but derivative works must carry the same license (share-alike).",
    uri: "https://creativecommons.org/licenses/by-sa/4.0/legalcode",
  },
  {
    spdxId: "CC-BY-NC-4.0",
    label: "CC BY-NC 4.0",
    explainer:
      "Reuse with credit, but non-commercial use only. Note: some funders discourage NC terms for open data.",
    uri: "https://creativecommons.org/licenses/by-nc/4.0/legalcode",
  },
  {
    spdxId: "MIT",
    label: "MIT License",
    explainer:
      "A permissive software license. Pick this when the deposit is primarily code rather than data.",
    uri: "https://opensource.org/license/mit",
  },
  {
    spdxId: "",
    label: "Other (type it yourself)",
    explainer:
      "Use a license not listed here. Enter the name or SPDX identifier the repository should record.",
  },
];

/** Look up a license option by SPDX id (exact match). */
export function findLicenseOption(spdxId: string): LicenseOption | undefined {
  return LICENSE_OPTIONS.find((opt) => opt.spdxId === spdxId);
}

// ---------------------------------------------------------------------------
// Builder input + the pure builder
// ---------------------------------------------------------------------------

/**
 * Inputs to `buildDepositMetadata`. All resolved by the caller (the dialog)
 * from the local APIs; the builder itself does no I/O. `fundingAccount` is
 * the PROJECT's PRIMARY funding account (single) per the locked Phase 1
 * design; multi-funder feeding is a later bot's job.
 */
export interface DepositMetadataInput {
  task: Task;
  project: Project | null;
  // The owner's display name (already resolved by the caller; falls back to
  // the username when no friendlier label exists).
  ownerDisplayName: string;
  // The owner's ORCID in any paste form, or null when not set. Validated
  // softly here.
  ownerOrcid?: string | null;
  // The project's primary funding account, or null when the project has no
  // grant link or the account could not be resolved.
  fundingAccount?: FundingAccount | null;
  // A user-typed abstract that, when non-empty, overrides the auto-summary
  // derived from notes/results. The dialog seeds this from the auto-summary
  // and lets the user edit it.
  abstract?: string | null;
  // The SPDX id of the chosen license (empty string / "Other"), plus the
  // free-text name when "Other". Absent until the user picks one.
  licenseSpdxId?: string | null;
  licenseCustomName?: string | null;
  // Publication date as an ISO `YYYY-MM-DD`. Defaults to today when absent.
  publicationDate?: string | null;
}

function publicationYearFrom(dateIso: string | null | undefined): string {
  const source =
    typeof dateIso === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateIso)
      ? dateIso
      : new Date().toISOString();
  return source.slice(0, 4);
}

/**
 * Build the DataCite-shaped `fundingReference` array from a single funding
 * account. Returns `[]` when the account is absent OR carries neither a
 * funder name nor an award number (an empty reference would be useless to a
 * repository). The funder identifier + type only ride along when both are
 * present and the type is one of the controlled values.
 */
export function buildFundingReferences(
  account: FundingAccount | null | undefined,
): DataCiteFundingReference[] {
  if (!account) return [];
  const funderName = (account.funder_name ?? "").trim();
  const awardNumber = (account.award_number ?? "").trim();
  // Need at least a funder name or an award number to be worth emitting.
  if (!funderName && !awardNumber) return [];

  const ref: DataCiteFundingReference = {
    // DataCite requires funderName on a fundingReference. When the account
    // only has an award number we fall back to the account label as the
    // funder name so the reference stays schema-valid.
    funderName: funderName || account.name,
  };

  const funderId = (account.funder_id ?? "").trim();
  const funderIdType = account.funder_id_type ?? null;
  if (funderId && funderIdType && funderIdType !== "Other") {
    ref.funderIdentifier = funderId;
    ref.funderIdentifierType = funderIdType;
  } else if (funderId) {
    // Carry the identifier even when the scheme is "Other" / unset so the
    // user does not lose the value; type is omitted (DataCite treats a
    // missing type as "Other").
    ref.funderIdentifier = funderId;
  }

  if (awardNumber) ref.awardNumber = awardNumber;
  const awardTitle = (account.award_title ?? "").trim();
  if (awardTitle) ref.awardTitle = awardTitle;

  return [ref];
}

/**
 * Build the DataCite `creators` array. Phase 1 has a single creator (the
 * experiment owner). The ORCID nameIdentifier rides along ONLY when the
 * owner's ORCID passes the soft MOD 11-2 checksum (a malformed id is dropped
 * rather than embedded, so we never publish a bad identifier). The display
 * name is always kept regardless of ORCID validity.
 */
export function buildCreators(
  ownerDisplayName: string,
  ownerOrcid: string | null | undefined,
): DataCiteCreator[] {
  const name = ownerDisplayName.trim() || "Unknown";
  const creator: DataCiteCreator = { name, nameType: "Personal" };
  if (ownerOrcid && isValidOrcid(ownerOrcid)) {
    const normalized = normalizeOrcid(ownerOrcid);
    if (normalized) {
      creator.nameIdentifiers = [
        {
          nameIdentifier: normalized,
          nameIdentifierScheme: "ORCID",
          schemeUri: "https://orcid.org",
        },
      ];
    }
  }
  return [creator];
}

/**
 * Build the DataCite `rights` (license) array from the user's pick. Returns
 * `[]` when no license has been chosen yet (the UI gates handoff on a
 * non-empty result). For a known SPDX option we attach the canonical URI;
 * for "Other" we record the user's free-text name with no identifier.
 */
export function buildRights(
  licenseSpdxId: string | null | undefined,
  licenseCustomName: string | null | undefined,
): DataCiteRights[] {
  const spdx = (licenseSpdxId ?? "").trim();
  if (spdx) {
    const option = findLicenseOption(spdx);
    const entry: DataCiteRights = {
      rights: option?.label ?? spdx,
      rightsIdentifier: spdx,
      rightsIdentifierScheme: "SPDX",
    };
    if (option?.uri) entry.rightsUri = option.uri;
    return [entry];
  }
  // "Other" path: free-text name only.
  const custom = (licenseCustomName ?? "").trim();
  if (custom) {
    return [{ rights: custom }];
  }
  return [];
}

/**
 * Derive the auto-abstract from the available section text. Prefers the
 * results summary, then notes. Returns a trimmed, length-capped plain string
 * (no markdown stripping beyond a trim; the UI shows it in a textarea the
 * user can clean up). Empty string when nothing usable exists.
 *
 * `summarize` is intentionally simple: take the first ~1200 characters of
 * the first section that has content. The user edits from there.
 */
export function deriveAbstract(
  resultsText: string | null | undefined,
  notesText: string | null | undefined,
  maxChars = 1200,
): string {
  const pick = (s: string | null | undefined): string =>
    typeof s === "string" ? s.trim() : "";
  const source = pick(resultsText) || pick(notesText);
  if (!source) return "";
  if (source.length <= maxChars) return source;
  // Cut on a word boundary near the cap, then add a trailing ellipsis word.
  const slice = source.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()} ...`;
}

/**
 * The PURE DataCite metadata builder. Maps the ResearchOS data model onto a
 * DataCite-shaped `DepositMetadata`:
 *
 *   title            <- task.name
 *   creators         <- ownerDisplayName + ownerOrcid (via buildCreators)
 *   descriptions     <- user abstract (the caller seeds this from notes/results)
 *   publicationYear  <- publicationDate (defaults to today)
 *   subjects         <- task.tags
 *   types            <- always Dataset / Experiment
 *   fundingReferences<- project's PRIMARY funding account (via buildFundingReferences)
 *   rights           <- user-picked license (via buildRights)
 *   doi              <- null (the repository mints it; Phase 2 fills it)
 *
 * No I/O, no DOM, no network. Safe to unit-test and to reuse in Phase 2.
 */
export function buildDepositMetadata(
  input: DepositMetadataInput,
): DepositMetadata {
  const title = (input.task.name ?? "").trim() || "Untitled experiment";

  const subjects = (input.task.tags ?? [])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t.length > 0)
    .map((subject) => ({ subject }));

  const abstract = (input.abstract ?? "").trim();

  return {
    titles: [{ title }],
    creators: buildCreators(input.ownerDisplayName, input.ownerOrcid),
    descriptions: abstract
      ? [{ description: abstract, descriptionType: "Abstract" }]
      : [],
    publicationYear: publicationYearFrom(input.publicationDate),
    subjects,
    types: { resourceTypeGeneral: "Dataset", resourceType: "Experiment" },
    fundingReferences: buildFundingReferences(input.fundingAccount),
    rights: buildRights(input.licenseSpdxId, input.licenseCustomName),
    doi: null,
  };
}

// ---------------------------------------------------------------------------
// Validation surface (soft signals for the metadata form)
// ---------------------------------------------------------------------------

/**
 * What the metadata form needs to surface. `licenseMissing` is the only HARD
 * gate Phase 1 enforces before handoff (NIH wants a license on shared data,
 * and we have no field to fall back on). The ORCID / abstract / funder
 * signals are SOFT nudges the form shows but never blocks on.
 */
export interface DepositMetadataIssues {
  // Hard gate: no license chosen yet.
  licenseMissing: boolean;
  // Soft: the owner typed an ORCID that fails the checksum.
  orcidInvalid: boolean;
  // Soft: no abstract / description at all.
  abstractMissing: boolean;
  // Soft: no funding reference could be derived.
  funderMissing: boolean;
}

/**
 * Inspect a built `DepositMetadata` (plus the raw ORCID the user typed, which
 * the metadata object may have dropped if invalid) and report the issues the
 * form should surface. Pure; the UI decides how to render each signal.
 */
export function inspectDepositMetadata(
  metadata: DepositMetadata,
  rawOrcid: string | null | undefined,
): DepositMetadataIssues {
  const typedOrcid = (rawOrcid ?? "").trim();
  return {
    licenseMissing: metadata.rights.length === 0,
    orcidInvalid: typedOrcid.length > 0 && !isValidOrcid(typedOrcid),
    abstractMissing: metadata.descriptions.length === 0,
    funderMissing: metadata.fundingReferences.length === 0,
  };
}

/**
 * Serialize the metadata to the pretty JSON string that lands inside / beside
 * the bundle as `datacite.json`. Centralized so the dialog and any Phase 2
 * reuse emit byte-identical output.
 */
export function serializeDepositMetadata(metadata: DepositMetadata): string {
  return JSON.stringify(metadata, null, 2);
}
