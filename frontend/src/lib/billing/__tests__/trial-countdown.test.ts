import { describe, expect, it } from "vitest";
import { trialBannerCopy, trialCountdown, trialDismissKey } from "../trial-countdown";

const NOW = Date.parse("2026-06-19T12:00:00Z");
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe("trialCountdown", () => {
  it("hides unless the phase is trialing", () => {
    expect(trialCountdown("none", inDays(30), NOW).show).toBe(false);
    expect(trialCountdown("ended_no_card", inDays(-1), NOW).show).toBe(false);
    expect(trialCountdown("ended_with_card", inDays(-1), NOW).show).toBe(false);
    expect(trialCountdown("trialing", null, NOW).show).toBe(false);
    expect(trialCountdown("trialing", "not-a-date", NOW).show).toBe(false);
  });

  it("shows while trialing with whole days remaining", () => {
    const c = trialCountdown("trialing", inDays(30), NOW);
    expect(c.show).toBe(true);
    expect(c.daysLeft).toBe(30);
    expect(c.urgency).toBe("calm");
  });

  it("escalates: calm > 7d, soon <= 7d, final <= 1d", () => {
    expect(trialCountdown("trialing", inDays(10), NOW).urgency).toBe("calm");
    expect(trialCountdown("trialing", inDays(7), NOW).urgency).toBe("soon");
    expect(trialCountdown("trialing", inDays(2), NOW).urgency).toBe("soon");
    expect(trialCountdown("trialing", inDays(1), NOW).urgency).toBe("final");
  });

  it("floors days at 0 and never goes negative", () => {
    const c = trialCountdown("trialing", inDays(-0.5), NOW);
    expect(c.daysLeft).toBe(0);
    expect(c.urgency).toBe("final");
  });
});

describe("trialDismissKey", () => {
  it("buckets per urgency so an escalation re-shows after a dismiss", () => {
    expect(trialDismissKey("calm")).not.toBe(trialDismissKey("soon"));
    expect(trialDismissKey("soon")).not.toBe(trialDismissKey("final"));
  });
});

describe("trialBannerCopy", () => {
  it("leads with no-card reassurance early, the add-a-card ask late", () => {
    expect(trialBannerCopy(30, "calm").body.toLowerCase()).toContain("no card needed");
    expect(trialBannerCopy(5, "soon").body.toLowerCase()).toContain("add a card");
    expect(trialBannerCopy(1, "final").title.toLowerCase()).toContain("last day");
  });
  it("pluralizes the day word", () => {
    expect(trialBannerCopy(1, "soon").title).toContain("1 day ");
    expect(trialBannerCopy(3, "soon").title).toContain("3 days ");
  });
});
