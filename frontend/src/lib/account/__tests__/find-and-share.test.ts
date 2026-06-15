import { describe, it, expect, afterEach } from "vitest";
import {
  decideDeliveryMethod,
  isFindAndShareEnabled,
} from "@/lib/account/find-and-share";

describe("decideDeliveryMethod", () => {
  it("seals when the recipient has a published X25519 key", () => {
    expect(decideDeliveryMethod({ hasPublishedKey: true })).toBe("seal");
  });

  it("falls back to a one-time link when there is no published key", () => {
    expect(decideDeliveryMethod({ hasPublishedKey: false })).toBe(
      "one-time-link",
    );
  });
});

describe("isFindAndShareEnabled", () => {
  const original = process.env.NEXT_PUBLIC_FIND_AND_SHARE;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_FIND_AND_SHARE;
    else process.env.NEXT_PUBLIC_FIND_AND_SHARE = original;
  });

  it("is off by default (unset)", () => {
    delete process.env.NEXT_PUBLIC_FIND_AND_SHARE;
    expect(isFindAndShareEnabled()).toBe(false);
  });

  it('is off for "0" and "false"', () => {
    process.env.NEXT_PUBLIC_FIND_AND_SHARE = "0";
    expect(isFindAndShareEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_FIND_AND_SHARE = "false";
    expect(isFindAndShareEnabled()).toBe(false);
  });

  it('is on for "1" and "true"', () => {
    process.env.NEXT_PUBLIC_FIND_AND_SHARE = "1";
    expect(isFindAndShareEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_FIND_AND_SHARE = "true";
    expect(isFindAndShareEnabled()).toBe(true);
  });
});
