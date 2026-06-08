// frontend/src/lib/funding/prefill.test.ts
//
// Unit tests for the funding-string prefill helpers (funding-niceties bot,
// 2026-05-28): primary-link resolution to an account name, the no-default
// cases (unlinked / deleted account), and the non-destructive resolve that
// preserves a value the user already typed.

import { describe, expect, it } from "vitest";
import {
  defaultFundingStringForProject,
  resolveFundingStringDefault,
} from "./prefill";
import type { FundingAccount } from "@/lib/types";

function acct(id: number, name: string): FundingAccount {
  return {
    id,
    name,
    description: null,
    total_budget: 0,
  };
}

const accounts = [acct(1, "NIH R01"), acct(2, "NSF CAREER")];

describe("defaultFundingStringForProject", () => {
  it("resolves a primary funding_account_id to the account name", () => {
    expect(defaultFundingStringForProject(2, accounts)).toBe("NSF CAREER");
  });

  it("returns null when the project is unlinked (null id)", () => {
    expect(defaultFundingStringForProject(null, accounts)).toBeNull();
  });

  it("returns null when the project is unlinked (undefined id)", () => {
    expect(defaultFundingStringForProject(undefined, accounts)).toBeNull();
  });

  it("returns null when the id resolves to no known account (deleted grant)", () => {
    expect(defaultFundingStringForProject(99, accounts)).toBeNull();
  });
});

describe("resolveFundingStringDefault", () => {
  it("applies the project default when the field is untouched", () => {
    expect(resolveFundingStringDefault("", "NIH R01")).toBe("NIH R01");
  });

  it("applies the project default when the field is whitespace-only", () => {
    expect(resolveFundingStringDefault("   ", "NIH R01")).toBe("NIH R01");
  });

  it("preserves a value the user already typed", () => {
    expect(resolveFundingStringDefault("NSF CAREER", "NIH R01")).toBe("NSF CAREER");
  });

  it("preserves a typed value even when there is no project default", () => {
    expect(resolveFundingStringDefault("Gift fund", null)).toBe("Gift fund");
  });

  it("returns empty string when there is neither a typed value nor a default", () => {
    expect(resolveFundingStringDefault("", null)).toBe("");
    expect(resolveFundingStringDefault(null, undefined)).toBe("");
  });
});
