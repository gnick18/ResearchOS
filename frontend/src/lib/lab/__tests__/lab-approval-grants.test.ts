import { describe, it, expect } from "vitest";
import {
  hasActiveGrant,
  activeGrantKeys,
  pruneExpired,
  addGrant,
  grantKey,
  type ApprovalGrant,
} from "../lab-approval-grants";

function grant(
  recordType: string,
  recordId: string,
  approvedUntil: number,
): ApprovalGrant {
  return { recordType, recordId, approvedUntil, requestedBy: "pi" };
}

const NOW = 1_000_000;

describe("approval grants model", () => {
  it("hasActiveGrant is true only for a matching, non-expired grant", () => {
    const grants = [grant("datahub", "dh-1", NOW + 1000)];
    expect(hasActiveGrant(grants, "datahub", "dh-1", NOW)).toBe(true);
    // expired
    expect(hasActiveGrant([grant("datahub", "dh-1", NOW - 1)], "datahub", "dh-1", NOW)).toBe(false);
    // wrong record
    expect(hasActiveGrant(grants, "datahub", "dh-2", NOW)).toBe(false);
  });

  it("activeGrantKeys returns the keys of every live grant", () => {
    const grants = [
      grant("datahub", "dh-1", NOW + 1000),
      grant("sequence", "s-1", NOW - 1), // expired
      grant("datahub", "dh-2", NOW + 5000),
    ];
    const keys = activeGrantKeys(grants, NOW);
    expect([...keys].sort()).toEqual(["datahub/dh-1", "datahub/dh-2"]);
    expect(keys.has(grantKey("sequence", "s-1"))).toBe(false);
  });

  it("pruneExpired drops only expired grants and never mutates the input", () => {
    const grants = [
      grant("datahub", "dh-1", NOW + 1000),
      grant("datahub", "dh-2", NOW - 1),
    ];
    const pruned = pruneExpired(grants, NOW);
    expect(pruned.map((g) => g.recordId)).toEqual(["dh-1"]);
    expect(grants).toHaveLength(2); // input untouched
  });

  it("addGrant replaces an existing grant for the same record (re-approval extends)", () => {
    let grants = [grant("datahub", "dh-1", NOW + 1000)];
    grants = addGrant(grants, grant("datahub", "dh-1", NOW + 9999));
    expect(grants).toHaveLength(1);
    expect(grants[0].approvedUntil).toBe(NOW + 9999);
    // a different record adds, not replaces
    grants = addGrant(grants, grant("sequence", "s-1", NOW + 100));
    expect(grants).toHaveLength(2);
  });
});
