import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * Identity model simplification, phase 2 (sharing + collaboration manager,
 * 2026-06-07): useIsLabHead is a pure wrapper over useAccountType. These tests
 * pin the equivalence to `useAccountType(x) === "lab_head"` in a boolean
 * context, plus the preserved loading (`undefined`) signal, so migrating a PI
 * surface from one to the other is provably a no-op.
 */

const { accountTypeRef } = vi.hoisted(() => ({
  accountTypeRef: {
    current: undefined as "lab_head" | "member" | null | undefined,
  },
}));

vi.mock("../useAccountType", () => ({
  useAccountType: () => accountTypeRef.current,
}));

import { useIsLabHead } from "../useIsLabHead";

describe("useIsLabHead", () => {
  beforeEach(() => {
    accountTypeRef.current = undefined;
  });

  it("returns undefined while the underlying read is in flight", () => {
    accountTypeRef.current = undefined;
    const { result } = renderHook(() => useIsLabHead("mira"));
    expect(result.current).toBeUndefined();
  });

  it("returns true for a lab head", () => {
    accountTypeRef.current = "lab_head";
    const { result } = renderHook(() => useIsLabHead("mira"));
    expect(result.current).toBe(true);
  });

  it("returns false for a member", () => {
    accountTypeRef.current = "member";
    const { result } = renderHook(() => useIsLabHead("alex"));
    expect(result.current).toBe(false);
  });

  it("returns false when signed out (null)", () => {
    accountTypeRef.current = null;
    const { result } = renderHook(() => useIsLabHead(null));
    expect(result.current).toBe(false);
  });

  it("is equivalent to `useAccountType(x) === 'lab_head'` in a boolean context", () => {
    // For every resolved value, the truthiness of useIsLabHead matches the
    // truthiness of the legacy `=== "lab_head"` comparison. (undefined is the
    // loading case, where the legacy check is falsy and the hook is undefined,
    // both falsy in `if`/`&&`.)
    for (const value of ["lab_head", "member", null, undefined] as const) {
      accountTypeRef.current = value;
      const { result } = renderHook(() => useIsLabHead("mira"));
      const legacy = value === "lab_head";
      expect(Boolean(result.current)).toBe(legacy);
    }
  });
});
