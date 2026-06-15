import { describe, it, expect } from "vitest";
import {
  classifyDataKeyState,
  describeDataKeyState,
  membersNeedingSeal,
  type MemberSealFacts,
} from "@/lib/lab/lab-deferred-seal";

// Phase 4A pure decision core: the membership-vs-data-key state machine and the
// "who needs sealing" reconciliation decision. No crypto, no network, no keys.

const PUB = "ab".repeat(32); // a 64-hex stand-in for an X25519 pubkey.

function facts(over: Partial<MemberSealFacts>): MemberSealFacts {
  return {
    username: "user@example.com",
    publishedX25519Pub: null,
    hasSealedCopy: false,
    inRoster: true,
    ...over,
  };
}

describe("classifyDataKeyState", () => {
  it("not in roster -> not-member (short-circuits everything else)", () => {
    expect(
      classifyDataKeyState(
        facts({ inRoster: false, hasSealedCopy: true, publishedX25519Pub: PUB }),
      ),
    ).toBe("not-member");
  });

  it("in roster + has sealed copy -> active", () => {
    expect(
      classifyDataKeyState(facts({ hasSealedCopy: true, publishedX25519Pub: PUB })),
    ).toBe("active");
  });

  it("in roster + published pubkey + no copy -> seal-pending", () => {
    expect(
      classifyDataKeyState(facts({ hasSealedCopy: false, publishedX25519Pub: PUB })),
    ).toBe("seal-pending");
  });

  it("in roster + no pubkey + no copy -> key-pending", () => {
    expect(
      classifyDataKeyState(facts({ hasSealedCopy: false, publishedX25519Pub: null })),
    ).toBe("key-pending");
  });

  it("an empty-string pubkey counts as no pubkey (key-pending, not seal-pending)", () => {
    expect(
      classifyDataKeyState(facts({ hasSealedCopy: false, publishedX25519Pub: "" })),
    ).toBe("key-pending");
  });

  it("an existing sealed copy wins even before a pubkey is known (active)", () => {
    // hasSealedCopy is the cryptographic source of truth for access.
    expect(
      classifyDataKeyState(facts({ hasSealedCopy: true, publishedX25519Pub: null })),
    ).toBe("active");
  });
});

describe("describeDataKeyState", () => {
  it("gives a distinct, non-empty label + detail for every state", () => {
    const states = ["active", "seal-pending", "key-pending", "not-member"] as const;
    const labels = states.map((s) => describeDataKeyState(s).label);
    states.forEach((s) => {
      const d = describeDataKeyState(s);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.detail.length).toBeGreaterThan(0);
    });
    expect(new Set(labels).size).toBe(states.length);
  });
});

describe("membersNeedingSeal", () => {
  it("returns exactly the seal-pending members with their pubkey", () => {
    const input: MemberSealFacts[] = [
      facts({ username: "active@x.com", hasSealedCopy: true, publishedX25519Pub: PUB }),
      facts({ username: "pending@x.com", hasSealedCopy: false, publishedX25519Pub: PUB }),
      facts({ username: "nokey@x.com", hasSealedCopy: false, publishedX25519Pub: null }),
      facts({ username: "gone@x.com", inRoster: false, publishedX25519Pub: PUB }),
    ];
    const out = membersNeedingSeal(input);
    expect(out).toEqual([{ username: "pending@x.com", x25519PublicKey: PUB }]);
  });

  it("is idempotent: once sealed (active), the member is no longer a target", () => {
    const before = membersNeedingSeal([
      facts({ username: "m@x.com", hasSealedCopy: false, publishedX25519Pub: PUB }),
    ]);
    expect(before).toHaveLength(1);
    const after = membersNeedingSeal([
      facts({ username: "m@x.com", hasSealedCopy: true, publishedX25519Pub: PUB }),
    ]);
    expect(after).toHaveLength(0);
  });

  it("never targets a member who has not published a pubkey (cannot seal blind)", () => {
    const out = membersNeedingSeal([
      facts({ username: "a@x.com", hasSealedCopy: false, publishedX25519Pub: null }),
      facts({ username: "b@x.com", hasSealedCopy: false, publishedX25519Pub: "" }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("returns an empty list for an empty roster", () => {
    expect(membersNeedingSeal([])).toEqual([]);
  });
});
