import { afterEach, describe, expect, it } from "vitest";

import { isAdminEmail } from "../admin";

const ORIGINAL = process.env.ADMIN_EMAILS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL;
});

describe("isAdminEmail", () => {
  it("fails closed when ADMIN_EMAILS is unset", () => {
    delete process.env.ADMIN_EMAILS;
    expect(isAdminEmail("grant@wisc.edu")).toBe(false);
  });

  it("matches an allow-listed email, case-insensitively and trimmed", () => {
    process.env.ADMIN_EMAILS = "grant@wisc.edu, other@lab.org";
    expect(isAdminEmail("grant@wisc.edu")).toBe(true);
    expect(isAdminEmail("GRANT@WISC.EDU")).toBe(true);
    expect(isAdminEmail("  other@lab.org ")).toBe(true);
  });

  it("rejects a non-listed email", () => {
    process.env.ADMIN_EMAILS = "grant@wisc.edu";
    expect(isAdminEmail("someone@else.com")).toBe(false);
  });

  it("rejects null / empty", () => {
    process.env.ADMIN_EMAILS = "grant@wisc.edu";
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });
});
