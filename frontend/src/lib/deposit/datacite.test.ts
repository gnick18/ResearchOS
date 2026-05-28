// frontend/src/lib/deposit/datacite.test.ts
//
// Unit tests for the PURE DataCite deposit-metadata builder (guided-deposit
// bot, 2026-05-28). Covers: full data -> correct DataCite object (incl.
// creator ORCID + fundingReference), graceful handling when ORCID / funder /
// award are absent, the license-required surface, and the abstract
// derivation.

import { describe, expect, it } from "vitest";
import type { FundingAccount, Project, Task } from "@/lib/types";
import {
  buildCreators,
  buildDepositMetadata,
  buildFundingReferences,
  buildRights,
  deriveAbstract,
  inspectDepositMetadata,
  serializeDepositMetadata,
  type DepositMetadataInput,
} from "./datacite";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 12,
    project_id: 3,
    name: "CRISPR knockout of GENE-X",
    start_date: "2026-04-01",
    duration_days: 5,
    end_date: "2026-04-06",
    is_high_level: false,
    is_complete: true,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: ["CRISPR", "knockout", "GENE-X"],
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "alex",
    shared_with: [],
    ...overrides,
  } as Task;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 3,
    name: "Gene editing pipeline",
    funding_account_id: 7,
    ...overrides,
  } as Project;
}

function makeFundingAccount(
  overrides: Partial<FundingAccount> = {},
): FundingAccount {
  return {
    id: 7,
    name: "R01 main",
    description: null,
    total_budget: 0,
    spent: 0,
    remaining: 0,
    award_number: "R01-GM123456",
    funder_name: "National Institutes of Health",
    funder_id: "https://ror.org/01cwqze88",
    funder_id_type: "ROR",
    award_title: "Mechanisms of gene regulation",
    ...overrides,
  };
}

// A known-valid ORCID (documented example, passes the MOD 11-2 checksum).
const VALID_ORCID = "0000-0002-1825-0097";

// ---------------------------------------------------------------------------
// Full-data happy path
// ---------------------------------------------------------------------------

describe("buildDepositMetadata - full data", () => {
  const input: DepositMetadataInput = {
    task: makeTask(),
    project: makeProject(),
    ownerDisplayName: "Alex Rivera",
    ownerOrcid: VALID_ORCID,
    fundingAccount: makeFundingAccount(),
    abstract: "We knocked out GENE-X and measured the phenotype.",
    licenseSpdxId: "CC-BY-4.0",
    publicationDate: "2026-04-06",
  };

  it("maps the task name to titles[0]", () => {
    const md = buildDepositMetadata(input);
    expect(md.titles).toEqual([{ title: "CRISPR knockout of GENE-X" }]);
  });

  it("includes the owner as a Personal creator with the ORCID nameIdentifier", () => {
    const md = buildDepositMetadata(input);
    expect(md.creators).toEqual([
      {
        name: "Alex Rivera",
        nameType: "Personal",
        nameIdentifiers: [
          {
            nameIdentifier: VALID_ORCID,
            nameIdentifierScheme: "ORCID",
            schemeUri: "https://orcid.org",
          },
        ],
      },
    ]);
  });

  it("maps tags to subjects", () => {
    const md = buildDepositMetadata(input);
    expect(md.subjects).toEqual([
      { subject: "CRISPR" },
      { subject: "knockout" },
      { subject: "GENE-X" },
    ]);
  });

  it("derives the publication year from the publication date", () => {
    const md = buildDepositMetadata(input);
    expect(md.publicationYear).toBe("2026");
  });

  it("always types the deposit as a Dataset / Experiment", () => {
    const md = buildDepositMetadata(input);
    expect(md.types).toEqual({
      resourceTypeGeneral: "Dataset",
      resourceType: "Experiment",
    });
  });

  it("builds a complete fundingReference from the primary funding account", () => {
    const md = buildDepositMetadata(input);
    expect(md.fundingReferences).toEqual([
      {
        funderName: "National Institutes of Health",
        funderIdentifier: "https://ror.org/01cwqze88",
        funderIdentifierType: "ROR",
        awardNumber: "R01-GM123456",
        awardTitle: "Mechanisms of gene regulation",
      },
    ]);
  });

  it("records the user-typed abstract as a description", () => {
    const md = buildDepositMetadata(input);
    expect(md.descriptions).toEqual([
      {
        description: "We knocked out GENE-X and measured the phenotype.",
        descriptionType: "Abstract",
      },
    ]);
  });

  it("attaches the chosen license with its SPDX id and URI", () => {
    const md = buildDepositMetadata(input);
    expect(md.rights).toEqual([
      {
        rights: "CC BY 4.0",
        rightsIdentifier: "CC-BY-4.0",
        rightsIdentifierScheme: "SPDX",
        rightsUri: "https://creativecommons.org/licenses/by/4.0/legalcode",
      },
    ]);
  });

  it("never mints a DOI in Phase 1", () => {
    const md = buildDepositMetadata(input);
    expect(md.doi).toBeNull();
  });

  it("serializes to stable pretty JSON", () => {
    const md = buildDepositMetadata(input);
    const json = serializeDepositMetadata(md);
    expect(JSON.parse(json)).toEqual(md);
    expect(json).toContain("\n  ");
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------

describe("buildCreators - ORCID handling", () => {
  it("keeps the display name but drops an invalid ORCID", () => {
    const creators = buildCreators("Sam Lee", "0000-0000-0000-0000");
    expect(creators).toEqual([{ name: "Sam Lee", nameType: "Personal" }]);
  });

  it("omits nameIdentifiers when no ORCID is supplied", () => {
    const creators = buildCreators("Sam Lee", null);
    expect(creators[0].nameIdentifiers).toBeUndefined();
  });

  it("normalizes a URL-form ORCID before embedding it", () => {
    const creators = buildCreators(
      "Sam Lee",
      "https://orcid.org/0000-0002-1825-0097",
    );
    expect(creators[0].nameIdentifiers?.[0].nameIdentifier).toBe(VALID_ORCID);
  });

  it("falls back to Unknown when the display name is blank", () => {
    const creators = buildCreators("   ", null);
    expect(creators[0].name).toBe("Unknown");
  });
});

describe("buildFundingReferences - absent / partial funder", () => {
  it("returns an empty array when no account is supplied", () => {
    expect(buildFundingReferences(null)).toEqual([]);
    expect(buildFundingReferences(undefined)).toEqual([]);
  });

  it("returns an empty array when the account has no funder name or award number", () => {
    const acct = makeFundingAccount({
      funder_name: null,
      award_number: null,
      funder_id: null,
      award_title: null,
    });
    expect(buildFundingReferences(acct)).toEqual([]);
  });

  it("emits a minimal reference when only an award number is present", () => {
    const acct = makeFundingAccount({
      funder_name: null,
      funder_id: null,
      award_title: null,
      award_number: "DE-AC02",
      name: "DOE grant",
    });
    // funderName falls back to the account label so the reference stays valid.
    expect(buildFundingReferences(acct)).toEqual([
      { funderName: "DOE grant", awardNumber: "DE-AC02" },
    ]);
  });

  it("drops the funder identifier type when it is Other", () => {
    const acct = makeFundingAccount({
      funder_id: "some-internal-id",
      funder_id_type: "Other",
    });
    const refs = buildFundingReferences(acct);
    expect(refs[0].funderIdentifier).toBe("some-internal-id");
    expect(refs[0].funderIdentifierType).toBeUndefined();
  });
});

describe("buildDepositMetadata - graceful absence", () => {
  it("handles a task with no tags, no funder, no ORCID, no abstract", () => {
    const md = buildDepositMetadata({
      task: makeTask({ tags: null }),
      project: makeProject({ funding_account_id: null }),
      ownerDisplayName: "morgan",
      ownerOrcid: null,
      fundingAccount: null,
      abstract: null,
      licenseSpdxId: null,
    });
    expect(md.subjects).toEqual([]);
    expect(md.fundingReferences).toEqual([]);
    expect(md.creators[0].nameIdentifiers).toBeUndefined();
    expect(md.descriptions).toEqual([]);
    expect(md.rights).toEqual([]);
    // Title still present; publication year defaults to the current year.
    expect(md.titles[0].title).toBe("CRISPR knockout of GENE-X");
    expect(md.publicationYear).toMatch(/^\d{4}$/);
  });

  it("falls back to a placeholder title for an unnamed task", () => {
    const md = buildDepositMetadata({
      task: makeTask({ name: "   " }),
      project: null,
      ownerDisplayName: "morgan",
    });
    expect(md.titles[0].title).toBe("Untitled experiment");
  });
});

// ---------------------------------------------------------------------------
// License requirement surface
// ---------------------------------------------------------------------------

describe("buildRights + inspectDepositMetadata - license required", () => {
  it("produces no rights when no license is chosen", () => {
    expect(buildRights(null, null)).toEqual([]);
    expect(buildRights("", "")).toEqual([]);
  });

  it("records a free-text Other license with no SPDX identifier", () => {
    expect(buildRights("", "My institution's data policy")).toEqual([
      { rights: "My institution's data policy" },
    ]);
  });

  it("flags the missing license as the hard gate", () => {
    const md = buildDepositMetadata({
      task: makeTask(),
      project: makeProject(),
      ownerDisplayName: "Alex",
      licenseSpdxId: null,
    });
    const issues = inspectDepositMetadata(md, null);
    expect(issues.licenseMissing).toBe(true);
  });

  it("clears the license gate once a license is chosen", () => {
    const md = buildDepositMetadata({
      task: makeTask(),
      project: makeProject(),
      ownerDisplayName: "Alex",
      licenseSpdxId: "CC0-1.0",
    });
    const issues = inspectDepositMetadata(md, null);
    expect(issues.licenseMissing).toBe(false);
  });

  it("surfaces the soft ORCID-invalid signal without affecting the metadata gate", () => {
    const md = buildDepositMetadata({
      task: makeTask(),
      project: makeProject(),
      ownerDisplayName: "Alex",
      ownerOrcid: "0000-0000-0000-0000",
      licenseSpdxId: "CC-BY-4.0",
    });
    const issues = inspectDepositMetadata(md, "0000-0000-0000-0000");
    expect(issues.orcidInvalid).toBe(true);
    expect(issues.licenseMissing).toBe(false);
  });

  it("reports abstract + funder absence as soft signals", () => {
    const md = buildDepositMetadata({
      task: makeTask(),
      project: makeProject({ funding_account_id: null }),
      ownerDisplayName: "Alex",
      fundingAccount: null,
      abstract: null,
      licenseSpdxId: "CC-BY-4.0",
    });
    const issues = inspectDepositMetadata(md, null);
    expect(issues.abstractMissing).toBe(true);
    expect(issues.funderMissing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Abstract derivation
// ---------------------------------------------------------------------------

describe("deriveAbstract", () => {
  it("prefers results over notes", () => {
    expect(deriveAbstract("the results", "the notes")).toBe("the results");
  });

  it("falls back to notes when results are empty", () => {
    expect(deriveAbstract(null, "  the notes  ")).toBe("the notes");
  });

  it("returns an empty string when nothing is available", () => {
    expect(deriveAbstract(null, null)).toBe("");
    expect(deriveAbstract("   ", "")).toBe("");
  });

  it("caps long text on a word boundary and appends an ellipsis", () => {
    const long = "word ".repeat(500).trim();
    const out = deriveAbstract(long, null, 100);
    expect(out.length).toBeLessThanOrEqual(110);
    expect(out.endsWith(" ...")).toBe(true);
    expect(out).not.toContain("wor.");
  });
});
