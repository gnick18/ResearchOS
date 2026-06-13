// Tests for classifyLabRoster: the pure join behind the unified PI roster.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  classifyLabRoster,
  type LabMemberRecord,
} from "@/lib/billing/lab";

const LAB = "lab-owner-key";

function row(
  memberOwnerKey: string,
  status: LabMemberRecord["status"],
  source: LabMemberRecord["source"],
  extra: Partial<LabMemberRecord> = {},
): LabMemberRecord {
  return {
    labOwnerKey: LAB,
    memberOwnerKey,
    status,
    usageVisible: false,
    label: null,
    source,
    ...extra,
  };
}

describe("classifyLabRoster", () => {
  it("annotates a data member with an active billing chip when a directory row exists", () => {
    const data = [{ pubkey: "pkA", username: "alice", memberKey: "hashA" }];
    const billing = [row("hashA", "active", "directory")];

    const { members, sponsored } = classifyLabRoster(data, billing);

    expect(members).toHaveLength(1);
    expect(members[0].billingStatus).toBe("active");
    expect(members[0].username).toBe("alice");
    expect(members[0].memberKey).toBe("hashA");
    expect(sponsored).toHaveLength(0);
  });

  it("marks a bound data member with no billing row as unbilled", () => {
    const data = [{ pubkey: "pkB", username: "bob", memberKey: "hashB" }];
    const { members } = classifyLabRoster(data, []);
    expect(members[0].billingStatus).toBe("unbilled");
    expect(members[0].memberKey).toBe("hashB");
  });

  it("marks an unbound data member (no directory binding yet) as no_identity", () => {
    const data = [{ pubkey: "pkC", username: "carol", memberKey: null }];
    const { members } = classifyLabRoster(data, []);
    expect(members[0].billingStatus).toBe("no_identity");
    expect(members[0].memberKey).toBeNull();
  });

  it("maps an invited billing row to a pending chip", () => {
    const data = [{ pubkey: "pkD", username: "dave", memberKey: "hashD" }];
    const billing = [row("hashD", "invited", "directory")];
    const { members } = classifyLabRoster(data, billing);
    expect(members[0].billingStatus).toBe("pending");
  });

  it("surfaces a billing-only invite row as a sponsored collaborator, not a member", () => {
    const data = [{ pubkey: "pkA", username: "alice", memberKey: "hashA" }];
    const billing = [
      row("hashA", "active", "directory"),
      row("hashEXT", "active", "invite", { label: "ext@other.org" }),
    ];

    const { members, sponsored } = classifyLabRoster(data, billing);

    expect(members.map((m) => m.memberKey)).toEqual(["hashA"]);
    expect(sponsored).toHaveLength(1);
    expect(sponsored[0].memberKey).toBe("hashEXT");
    expect(sponsored[0].label).toBe("ext@other.org");
    expect(sponsored[0].status).toBe("active");
  });

  it("does not double-count a member who is both in the data lab and has a billing row", () => {
    // A member invited by email who then actually joined the data lab: their row
    // is now source 'directory' and they match a data member, so they appear ONCE
    // as a member, never as a sponsored collaborator.
    const data = [{ pubkey: "pkA", username: "alice", memberKey: "hashA" }];
    const billing = [row("hashA", "active", "directory")];

    const { members, sponsored } = classifyLabRoster(data, billing);
    expect(members).toHaveLength(1);
    expect(sponsored).toHaveLength(0);
  });

  it("carries usageVisible from the matching billing row onto the member", () => {
    const data = [{ pubkey: "pkA", username: "alice", memberKey: "hashA" }];
    const billing = [row("hashA", "active", "directory", { usageVisible: true })];
    const { members } = classifyLabRoster(data, billing);
    expect(members[0].usageVisible).toBe(true);
  });
});
