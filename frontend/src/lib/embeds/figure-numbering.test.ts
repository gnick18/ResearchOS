import { describe, it, expect } from "vitest";
import { buildFigureNumberPlan } from "./figure-numbering";

describe("buildFigureNumberPlan", () => {
  it("is disabled without the directive", () => {
    const plan = buildFigureNumberPlan("[Resveratrol](/chemistry?molecule=1#ros=card)");
    expect(plan.enabled).toBe(false);
    expect(plan.labelAt(0)).toBeUndefined();
  });

  it("numbers figures and tables independently in document order", () => {
    const content = [
      "<!-- ros:number-figures -->",
      "",
      "[Resveratrol](/chemistry?molecule=1#ros=card)",
      "",
      "[Growth table](/datahub?doc=2#ros=table)",
      "",
      "[pUC19](/sequences?seq=3#ros=map)",
      "",
      "See [pUC19](/sequences?seq=3) inline, a mention that is not numbered.",
    ].join("\n");
    const plan = buildFigureNumberPlan(content);
    expect(plan.enabled).toBe(true);
    expect(plan.labelAt(0)).toBe("Figure 1");
    expect(plan.labelAt(1)).toBe("Table 1");
    expect(plan.labelAt(2)).toBe("Figure 2");
    // The inline mention is not a block embed, so it is not counted.
    expect(plan.labelAt(3)).toBeUndefined();
  });

  it("treats a Data Hub plot or result as a Figure, not a Table", () => {
    const content = [
      "<!-- ros:number-figures -->",
      "[OD600](/datahub?doc=2#ros=plot&plot=p1)",
      "[t-test](/datahub?doc=2#ros=result&analysis=a3)",
      "[Growth table](/datahub?doc=2#ros=table)",
    ].join("\n");
    const plan = buildFigureNumberPlan(content);
    expect(plan.labelAt(0)).toBe("Figure 1");
    expect(plan.labelAt(1)).toBe("Figure 2");
    expect(plan.labelAt(2)).toBe("Table 1");
  });
});
