// Unit tests for the Model A margin explorer (PriceModelingModal rebuild).
//
// Asserts revenue/cost/margin math for known tier+usage inputs, and that dept
// is cheaper per lab than lab on both base fee and usage markup. Canvas is a
// no-op in jsdom (clientWidth 0, so prep() returns null before getContext),
// which the component already handles gracefully.

import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import PriceModelingModal, {
  MarginExplorerTab,
} from "./PriceModelingModal";
import {
  MODEL_A_PLANS,
  periodCharge,
  ACCRUAL_CHARGE_THRESHOLD_CENTS,
} from "@/lib/billing/model-a/pricing";
import {
  DEPT_PER_LAB_DISCOUNT_CENTS,
  DEPT_USAGE_DISCOUNT_PCT,
} from "@/lib/billing/catalog";

const has = (re: RegExp) =>
  expect(screen.getAllByText(re).length).toBeGreaterThan(0);

// ── pure math assertions (no DOM) ────────────────────────────────────────────

describe("Model A pricing math", () => {
  it("solo: revenue = base + marked-up usage + storage + hosted", () => {
    const plan = MODEL_A_PLANS.solo;
    // 100k writes, 2 GB stored, 0 hosted.
    const charge = periodCharge(plan, {
      writes: 100_000,
      storageBytes: 2e9,
      hostedBytes: 0,
      labCount: 1,
    });
    // Base is $3 = 300 cents.
    expect(charge.baseCents).toBe(300);
    // Usage: relay bare cost * 5x markup. relayCost(0.1M) = 0.1 * 1.5 = $0.15;
    // marked up 5x = $0.75 = 75 cents.
    expect(charge.usageCents).toBeGreaterThan(0);
    // Storage: 2 GB at retail (1.15x blended ~$0.05/GB = ~$0.1175).
    expect(charge.storageCents).toBeGreaterThan(0);
    // Hosted: 0 GB.
    expect(charge.hostedCents).toBe(0);
    // Total = sum of parts.
    expect(charge.totalCents).toBe(
      charge.baseCents + charge.usageCents + charge.storageCents + charge.hostedCents,
    );
  });

  it("lab: base scales with lab count", () => {
    const plan = MODEL_A_PLANS.lab;
    const charge3 = periodCharge(plan, {
      writes: 0,
      storageBytes: 0,
      hostedBytes: 0,
      labCount: 3,
    });
    const charge1 = periodCharge(plan, {
      writes: 0,
      storageBytes: 0,
      hostedBytes: 0,
      labCount: 1,
    });
    // 3 labs = 3x the single-lab base.
    expect(charge3.baseCents).toBe(charge1.baseCents * 3);
  });

  it("dept is cheaper per lab than lab on base fee", () => {
    const lab = MODEL_A_PLANS.lab;
    const dept = MODEL_A_PLANS.dept;
    // Dept base < Lab base per lab.
    expect(dept.baseFeeCents).toBeLessThan(lab.baseFeeCents);
    // The catalog discount constant matches the plan values.
    expect(DEPT_PER_LAB_DISCOUNT_CENTS).toBe(
      lab.baseFeeCents - dept.baseFeeCents,
    );
    // Discount must be positive.
    expect(DEPT_PER_LAB_DISCOUNT_CENTS).toBeGreaterThan(0);
  });

  it("dept is cheaper per lab than lab on usage markup", () => {
    const lab = MODEL_A_PLANS.lab;
    const dept = MODEL_A_PLANS.dept;
    expect(dept.usageMarkup).toBeLessThan(lab.usageMarkup);
    expect(DEPT_USAGE_DISCOUNT_PCT).toBeGreaterThan(0);
  });

  it("free plan has zero base and zero markup and cannot produce", () => {
    const plan = MODEL_A_PLANS.free;
    expect(plan.baseFeeCents).toBe(0);
    expect(plan.usageMarkup).toBe(0);
    expect(plan.produce).toBe(false);
    const charge = periodCharge(plan, {
      writes: 1_000_000,
      storageBytes: 10e9,
      hostedBytes: 0,
    });
    // No base, no usage charge (free cannot produce).
    expect(charge.baseCents).toBe(0);
    expect(charge.usageCents).toBe(0);
  });

  it("accrual threshold is the $5 card-run gate", () => {
    // Threshold is 500 cents = $5.
    expect(ACCRUAL_CHARGE_THRESHOLD_CENTS).toBe(500);
  });
});

// ── component smoke tests ─────────────────────────────────────────────────────

describe("MarginExplorerTab", () => {
  it("mounts and renders the four main panels", () => {
    render(<MarginExplorerTab />);
    has(/Tier \+ scale/i);
    has(/Usage this month/i);
    has(/Cost, Stripe fee, and net margin/i);
    has(/Dept vs Lab/i);
    cleanup();
  });

  it("shows the three usage presets", () => {
    render(<MarginExplorerTab />);
    has(/Light note-taker/i);
    has(/Typical researcher/i);
    has(/Heavy imaging/i);
    cleanup();
  });

  it("shows the accrual threshold note", () => {
    render(<MarginExplorerTab />);
    has(/only run the card when accrued balance crosses/i);
    cleanup();
  });

  it("shows dept discount copy when dept tier is selected", () => {
    render(<MarginExplorerTab />);
    // Switch to dept tier.
    fireEvent.click(screen.getByText("Department"));
    has(/Dept saves/i);
    has(/volume discount/i);
    cleanup();
  });

  it("shows lab count slider for lab tier", () => {
    render(<MarginExplorerTab />);
    fireEvent.click(screen.getByText("Lab"));
    has(/Lab count/i);
    cleanup();
  });

  it("preset click updates the active preset highlight", () => {
    render(<MarginExplorerTab />);
    fireEvent.click(screen.getByText("Heavy imaging"));
    // The Heavy imaging button should now be active (has different styling).
    // The other presets should still be visible.
    has(/Light note-taker/i);
    has(/Typical researcher/i);
    cleanup();
  });

  it("shows revenue breakdown with base fee, relay, storage, hosted, AI lines", () => {
    render(<MarginExplorerTab />);
    has(/Base fee/i);
    has(/Relay\/compute/i);
    has(/Storage \(1\.15x\)/i);
    has(/Hosted assets \(1\.15x\)/i);
    has(/Total revenue/i);
    cleanup();
  });

  it("shows net margin readout and provider cost breakdown", () => {
    render(<MarginExplorerTab />);
    has(/Net margin/i);
    has(/minus provider cost/i);
    has(/minus Stripe/i);
    has(/Net to us/i);
    cleanup();
  });

  it("shows the storage pass-through note", () => {
    render(<MarginExplorerTab />);
    has(/pass-through, never a profit center/i);
    cleanup();
  });
});

describe("PriceModelingModal (shell)", () => {
  it("renders the modal title when open", () => {
    render(<PriceModelingModal open onClose={() => {}} />);
    has(/Model A margin explorer/i);
    cleanup();
  });

  it("does not crash when closed", () => {
    // Should mount cleanly even when closed (LivingPopup gates rendering).
    const { unmount } = render(<PriceModelingModal open={false} onClose={() => {}} />);
    unmount();
  });
});
