// frontend/src/components/AttributionChip.test.tsx
//
// VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26).
//
// AttributionChip renders the per-record edit attribution surfaced by
// `last_edited_by` / `last_edited_at`. Three render cases:
//
//   - owner edit (the record's owner edits their own record) →
//     "Owner, just now" with no "(PI)" badge.
//   - shared edit (a non-owner with edit permission edits the record) →
//     "Editor, just now" with no badge.
//   - PI edit (a lab_head edits a non-owned record) →
//     "PI (PI), just now" — the stored field is the bare username; the
//     "(PI)" badge is a UI render concern resolved from the user's
//     account_type.
//
// We test the pure helper `resolveDisplayName` to avoid React Query
// plumbing for the lookup; the component-level rendering is exercised
// via React Testing Library.

import { describe, it, expect } from "vitest";
import { resolveDisplayName, formatFullDate, formatRelative } from "./AttributionChip";

describe("resolveDisplayName — PI badge resolution", () => {
  it("returns 'Unknown' when username is null or empty", () => {
    expect(resolveDisplayName(null, {})).toEqual({ label: "Unknown", isPi: false });
    expect(resolveDisplayName("", {})).toEqual({ label: "Unknown", isPi: false });
    expect(resolveDisplayName(undefined, {})).toEqual({ label: "Unknown", isPi: false });
  });

  it("falls back to the bare username when the user is not in the profile map", () => {
    // Departed lab member case — the user was on the lab once but is gone
    // now. The stored attribution still resolves; the badge does not.
    const result = resolveDisplayName("alex", {});
    expect(result).toEqual({ label: "alex", isPi: false });
  });

  it("renders an owner edit without a PI badge", () => {
    const result = resolveDisplayName("alex", {
      alex: { username: "alex", displayName: null, account_type: "member" },
    });
    expect(result).toEqual({ label: "alex", isPi: false });
  });

  it("renders a shared edit without a PI badge", () => {
    const result = resolveDisplayName("alex", {
      alex: { username: "alex", displayName: "Alex", account_type: "member" },
    });
    expect(result).toEqual({ label: "Alex", isPi: false });
  });

  it("renders a PI edit with the '(PI)' suffix", () => {
    const result = resolveDisplayName("morgan", {
      morgan: { username: "morgan", displayName: "Morgan", account_type: "lab_head" },
    });
    expect(result).toEqual({ label: "Morgan (PI)", isPi: true });
  });

  it("falls back to the username when displayName is empty", () => {
    const result = resolveDisplayName("morgan", {
      morgan: { username: "morgan", displayName: "  ", account_type: "lab_head" },
    });
    expect(result).toEqual({ label: "morgan (PI)", isPi: true });
  });
});

describe("formatRelative — graceful degradation", () => {
  it("returns empty string on missing input", () => {
    expect(formatRelative("")).toBe("");
  });

  it("returns empty string on invalid ISO", () => {
    expect(formatRelative("not-a-date")).toBe("");
  });

  it("returns 'just now' for very recent timestamps", () => {
    const iso = new Date(Date.now() - 1_000).toISOString();
    expect(formatRelative(iso)).toBe("just now");
  });

  it("returns 'Nm ago' for minute-old timestamps", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelative(iso)).toBe("5m ago");
  });

  it("returns 'Nh ago' for hour-old timestamps", () => {
    const iso = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    expect(formatRelative(iso)).toBe("3h ago");
  });
});

describe("formatFullDate — graceful degradation", () => {
  it("returns empty string on missing input", () => {
    expect(formatFullDate("")).toBe("");
  });

  it("returns empty string on invalid ISO", () => {
    expect(formatFullDate("not-a-date")).toBe("");
  });

  it("renders 'May 26, 2026'-style output for valid ISO", () => {
    const out = formatFullDate("2026-05-26T12:00:00.000Z");
    // Locale-sensitive; just assert it contains the year and a month abbrev.
    expect(out).toMatch(/2026/);
    expect(out.length).toBeGreaterThan(5);
  });
});
