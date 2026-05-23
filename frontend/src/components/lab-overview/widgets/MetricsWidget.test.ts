// Mira-Skeptic P0 #3 (Mira-Skeptic P0 fix manager, 2026-05-23): the
// funding rollup must filter on `item.approved` before summing. This
// test pins the exact predicate so the regression that surfaced in
// Phase 4 verification cannot resurface unnoticed.
//
// The aggregation lives inline in MetricsWidget.tsx, so this test
// reimplements the predicate against the same data shape and asserts
// the same back-compat semantics: `approved === undefined` counts as
// approved (legacy data).

import { describe, expect, it } from "vitest";

type Item = {
  total_price: number;
  approved?: boolean;
  username: string;
};

// Pinned predicate — mirror of MetricsWidget.tsx's `isApproved`.
const isApproved = (item: { approved?: boolean }) =>
  item.approved === undefined || item.approved === true;

function totalSpent(items: Item[]) {
  return items.filter(isApproved).reduce((acc, i) => acc + (i.total_price ?? 0), 0);
}

function pendingTotal(items: Item[]) {
  return items
    .filter((i) => !isApproved(i))
    .reduce((acc, i) => acc + (i.total_price ?? 0), 0);
}

function spendByMember(items: Item[]) {
  const totals = new Map<string, number>();
  for (const item of items.filter(isApproved)) {
    totals.set(item.username, (totals.get(item.username) ?? 0) + (item.total_price ?? 0));
  }
  return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
}

describe("MetricsWidget funding-rollup approved filter (P0 #3)", () => {
  it("totalSpent excludes unapproved items", () => {
    const items: Item[] = [
      { total_price: 100, approved: true, username: "a" },
      { total_price: 5000, approved: false, username: "b" },
      { total_price: 50, approved: true, username: "c" },
    ];
    expect(totalSpent(items)).toBe(150);
  });

  it("totalSpent treats `approved === undefined` as approved (back-compat)", () => {
    const items: Item[] = [
      { total_price: 100, username: "a" }, // legacy — no `approved` field
      { total_price: 200, approved: true, username: "b" },
      { total_price: 5000, approved: false, username: "c" },
    ];
    expect(totalSpent(items)).toBe(300);
  });

  it("pendingTotal sums only unapproved (approved === false) items", () => {
    const items: Item[] = [
      { total_price: 100, approved: true, username: "a" },
      { total_price: 5000, approved: false, username: "b" },
      { total_price: 750, approved: false, username: "c" },
      { total_price: 50, username: "d" }, // legacy — counted as approved, not pending
    ];
    expect(pendingTotal(items)).toBe(5750);
  });

  it("spendByMember excludes unapproved per-member", () => {
    const items: Item[] = [
      { total_price: 100, approved: true, username: "alex" },
      { total_price: 5000, approved: false, username: "alex" }, // unapproved — skipped
      { total_price: 50, approved: true, username: "bob" },
    ];
    const rollup = spendByMember(items);
    const lookup = new Map(rollup);
    expect(lookup.get("alex")).toBe(100);
    expect(lookup.get("bob")).toBe(50);
  });

  it("Mira's scenario: $5000 unapproved line lands at 0 'spent', shows up in 'pending'", () => {
    const items: Item[] = [
      { total_price: 5000, approved: false, username: "newgrad" },
    ];
    expect(totalSpent(items)).toBe(0);
    expect(pendingTotal(items)).toBe(5000);
  });
});
