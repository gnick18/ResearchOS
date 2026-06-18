// Unit tests for resolveProduceEntitlement, the pure core of the send-is-paid
// client gate. Proves the gate is dormant (permissive) during the beta, never
// reports "blocked" before the status read settles, and gates a free account only
// once billing is live.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it } from "vitest";

import { resolveProduceEntitlement } from "../useProduceEntitlement";

describe("resolveProduceEntitlement", () => {
  it("is dormant and permissive while billing is off (the beta)", () => {
    // The status field is irrelevant when the gate is dormant, a free account
    // keeps full behavior so the beta is byte-for-byte unchanged.
    expect(resolveProduceEntitlement(false, null)).toEqual({
      gateActive: false,
      entitled: true,
      loading: false,
    });
    expect(resolveProduceEntitlement(false, false)).toEqual({
      gateActive: false,
      entitled: true,
      loading: false,
    });
  });

  it("reports loading (not blocked) while the status read is in flight", () => {
    expect(resolveProduceEntitlement(true, null)).toEqual({
      gateActive: true,
      entitled: false,
      loading: true,
    });
  });

  it("entitles a PAID account to send once billing is live", () => {
    expect(resolveProduceEntitlement(true, true)).toEqual({
      gateActive: true,
      entitled: true,
      loading: false,
    });
  });

  it("blocks a FREE account from sending once billing is live", () => {
    expect(resolveProduceEntitlement(true, false)).toEqual({
      gateActive: true,
      entitled: false,
      loading: false,
    });
  });
});
