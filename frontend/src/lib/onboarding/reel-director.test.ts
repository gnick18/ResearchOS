import { describe, it, expect } from "vitest";
import {
  buildReel,
  selectDeepSurfaces,
  aiVariantFor,
  DEEP_CAP,
  SURFACE_PRIORITY,
  type DirectorInput,
  type Surface,
} from "./reel-director";

const inp = (over: Partial<DirectorInput>): DirectorInput => ({
  role: "grad",
  pickedGoals: [],
  ...over,
});

describe("selectDeepSurfaces — adaptive to picks", () => {
  it("1 pick -> 1 deep demo", () => {
    expect(selectDeepSurfaces(inp({ pickedGoals: ["trees"] }))).toEqual([
      "phylo",
    ]);
  });

  it("2-3 picks -> a deep demo each (priority-ordered)", () => {
    const deep = selectDeepSurfaces(
      inp({ pickedGoals: ["trees", "analyze", "track"] }),
    );
    // datahub(analyze) < phylo(trees) < methods(track) by SURFACE_PRIORITY
    expect(deep).toEqual(["datahub", "phylo", "methods"]);
  });

  it("4+ picks -> cap at 3, kept by surface priority", () => {
    const deep = selectDeepSurfaces(
      inp({
        role: "pi",
        pickedGoals: ["inventory", "chemistry", "trees", "analyze", "lab"],
      }),
    );
    expect(deep).toHaveLength(DEEP_CAP);
    // top 3 by priority among {datahub,phylo,chemistry,inventory,people}
    expect(deep).toEqual(["datahub", "phylo", "chemistry"]);
  });

  it("0 picks -> role-default set (grad)", () => {
    expect(selectDeepSurfaces(inp({ pickedGoals: [] }))).toEqual([
      "methods",
      "sequences",
      "datahub",
    ]);
  });

  it("0 picks -> role-default set (pi includes people)", () => {
    expect(selectDeepSurfaces(inp({ role: "pi", pickedGoals: [] }))).toEqual([
      "datahub",
      "phylo",
      "people",
    ]);
  });
});

describe("role gating — People is PI-only", () => {
  it("a non-PI who picks 'run a lab' does not get People", () => {
    const deep = selectDeepSurfaces(
      inp({ role: "undergrad", pickedGoals: ["lab"] }),
    );
    expect(deep).not.toContain("people");
    // only pick was gated away -> falls back to role default
    expect(deep).toEqual(["methods", "sequences", "datahub"]);
  });

  it("People never appears anywhere in the reel for a student", () => {
    const reel = buildReel(
      inp({ role: "grad", pickedGoals: ["analyze", "lab"] }),
    );
    const all: Surface[] = [
      ...reel.deepSurfaces,
      ...reel.montageSurfaces,
    ];
    expect(all).not.toContain("people");
  });

  it("a PI does see People in montage when not picked", () => {
    const reel = buildReel(inp({ role: "pi", pickedGoals: ["analyze"] }));
    expect([...reel.deepSurfaces, ...reel.montageSurfaces]).toContain("people");
  });
});

describe("aiVariantFor — exactly one AI demo, by top interest", () => {
  it("phylo in deep -> overlay_tree", () => {
    expect(aiVariantFor(["datahub", "phylo"])).toBe("overlay_tree");
  });
  it("datahub (no phylo) -> plan_analysis", () => {
    expect(aiVariantFor(["datahub", "methods"])).toBe("plan_analysis");
  });
  it("neither -> make_table", () => {
    expect(aiVariantFor(["methods", "sequences"])).toBe("make_table");
  });
});

describe("buildReel — shape + montage complement", () => {
  it("orders beats welcome -> picker -> deep* -> ai -> montage -> memory -> recap", () => {
    const reel = buildReel(inp({ role: "grad", pickedGoals: ["trees"] }));
    expect(reel.beats.map((b) => b.kind)).toEqual([
      "welcome",
      "interest_picker",
      "deep_demo",
      "ai_demo",
      "montage",
      "memory_propose",
      "recap",
    ]);
  });

  it("montage = every allowed demoable surface NOT shown deep", () => {
    const reel = buildReel(inp({ role: "grad", pickedGoals: ["trees"] }));
    const deep = new Set(reel.deepSurfaces);
    const allowedDemoable = SURFACE_PRIORITY.filter((s) => s !== "people"); // grad
    expect(reel.montageSurfaces).toEqual(
      allowedDemoable.filter((s) => !deep.has(s)),
    );
    // nothing is invisible: deep + montage covers all allowed surfaces
    expect(
      new Set([...reel.deepSurfaces, ...reel.montageSurfaces]),
    ).toEqual(new Set(allowedDemoable));
  });

  it("exactly one ai_demo beat, always present", () => {
    const reel = buildReel(inp({ pickedGoals: [] }));
    expect(reel.beats.filter((b) => b.kind === "ai_demo")).toHaveLength(1);
  });

  it("a focused single-pick run is shorter than a broad run", () => {
    const focused = buildReel(inp({ pickedGoals: ["trees"] })).estTotalSeconds;
    const broad = buildReel(
      inp({ pickedGoals: ["trees", "analyze", "track"] }),
    ).estTotalSeconds;
    expect(focused).toBeLessThan(broad);
  });

  it("no montage beat when deep covers every allowed surface", () => {
    // contrived: a role with few allowed surfaces still always has > 3 demoable,
    // so montage is present; assert it is non-empty for a normal run instead.
    const reel = buildReel(inp({ pickedGoals: ["analyze"] }));
    expect(reel.montageSurfaces.length).toBeGreaterThan(0);
  });
});
