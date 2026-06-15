import { describe, it, expect } from "vitest";
import {
  generateInviteToken,
  redeemErrorMessage,
  DEFAULT_INVITE_TTL_MS,
} from "@/lib/invites/invite-tokens";

describe("invite-tokens pure surface", () => {
  it("generates a 256-bit (64 hex char) unguessable token", () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a fresh token each call", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateInviteToken()));
    expect(seen.size).toBe(200);
  });

  it("has a sane default TTL (14 days)", () => {
    expect(DEFAULT_INVITE_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("maps every redeem failure reason to a distinct, non-empty message", () => {
    const reasons = ["not_found", "wrong_layer", "expired", "already_used"] as const;
    const msgs = reasons.map((r) => redeemErrorMessage(r));
    msgs.forEach((m) => expect(m.length).toBeGreaterThan(0));
    expect(new Set(msgs).size).toBe(reasons.length);
  });
});
