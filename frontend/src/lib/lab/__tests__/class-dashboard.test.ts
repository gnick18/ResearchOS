// Class dashboard (CT-5 + CT-3) resolution + visibility-seed unit tests.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  resolveClassDashboard,
  defaultResolvedClassDashboard,
  seedSharedWithForVisibility,
  resolveClassStudentNav,
  CLASS_STUDENT_NAV_DEFAULT,
  decodeClassDashboard,
  encodeClassDashboard,
  WORKBENCH_TAB_ORDER,
  DEFAULT_LANDING_TAB,
  type ClassDashboard,
} from "../class-dashboard";

describe("resolveClassDashboard (CT-5)", () => {
  it("absent template => all tabs in default order + default landing + no intro", () => {
    const r = resolveClassDashboard(null);
    expect(r.tabs).toEqual([...WORKBENCH_TAB_ORDER]);
    expect(r.landingTab).toBe(DEFAULT_LANDING_TAB);
    expect(r.intro).toBeNull();
    // Equal to the explicit default.
    expect(r).toEqual(defaultResolvedClassDashboard());
  });

  it("absent tabs on a present template => all tabs on (absent-is-all-on)", () => {
    const r = resolveClassDashboard({ rev: 1 });
    expect(r.tabs).toEqual([...WORKBENCH_TAB_ORDER]);
  });

  it("a template => only its tabs in AUTHORED order", () => {
    const tpl: ClassDashboard = { tabs: ["notes", "projects"], rev: 1 };
    const r = resolveClassDashboard(tpl);
    expect(r.tabs).toEqual(["notes", "projects"]);
    // landing falls back to the first resolved tab when none named.
    expect(r.landingTab).toBe("notes");
  });

  it("honors landingTab when it survives the resolved set", () => {
    const tpl: ClassDashboard = {
      tabs: ["projects", "notes", "lists"],
      landingTab: "notes",
      rev: 1,
    };
    expect(resolveClassDashboard(tpl).landingTab).toBe("notes");
  });

  it("falls back to the first resolved tab when landingTab was dropped", () => {
    const tpl: ClassDashboard = {
      tabs: ["experiments", "lists"],
      landingTab: "projects", // not in the set
      rev: 1,
    };
    expect(resolveClassDashboard(tpl).landingTab).toBe("experiments");
  });

  it("drops unknown tab ids and de-dupes", () => {
    const tpl = {
      tabs: ["notes", "bogus", "notes", "lists"],
      rev: 1,
    } as unknown as ClassDashboard;
    expect(resolveClassDashboard(tpl).tabs).toEqual(["notes", "lists"]);
  });

  it("empty tabs never strands the student (keeps the landing or default)", () => {
    const tpl: ClassDashboard = { tabs: [], landingTab: "lists", rev: 1 };
    const r = resolveClassDashboard(tpl);
    expect(r.tabs).toEqual(["lists"]);
    expect(r.landingTab).toBe("lists");

    const noLanding: ClassDashboard = { tabs: [], rev: 1 };
    const r2 = resolveClassDashboard(noLanding);
    expect(r2.tabs).toEqual([DEFAULT_LANDING_TAB]);
    expect(r2.landingTab).toBe(DEFAULT_LANDING_TAB);
  });

  it("surfaces the intro when title or body is non-empty, null otherwise", () => {
    expect(
      resolveClassDashboard({ intro: { title: "Welcome" }, rev: 1 }).intro,
    ).toEqual({ title: "Welcome" });
    expect(
      resolveClassDashboard({ intro: { body: "Read the syllabus" }, rev: 1 })
        .intro,
    ).toEqual({ body: "Read the syllabus" });
    // Whitespace-only intro is treated as absent.
    expect(
      resolveClassDashboard({ intro: { title: "   ", body: "" }, rev: 1 }).intro,
    ).toBeNull();
    expect(resolveClassDashboard({ rev: 1 }).intro).toBeNull();
  });
});

describe("seedSharedWithForVisibility (CT-3)", () => {
  it("collaborative => the whole-class read entry", () => {
    expect(seedSharedWithForVisibility("collaborative")).toEqual([
      { username: "*", level: "read" },
    ]);
  });

  it("private => empty", () => {
    expect(seedSharedWithForVisibility("private")).toEqual([]);
  });

  it("absent / undefined => empty (today's behavior)", () => {
    expect(seedSharedWithForVisibility(undefined)).toEqual([]);
    expect(seedSharedWithForVisibility(null)).toEqual([]);
  });
});

describe("encode / decode round-trip", () => {
  it("round-trips a full template", () => {
    const tpl: ClassDashboard = {
      tabs: ["projects", "notes"],
      landingTab: "notes",
      intro: { title: "BIO 301", body: "syllabus" },
      enabledTools: ["pcr"],
      enabledMethodTypes: ["markdown"],
      visibilityDefault: "collaborative",
      rev: 3,
    };
    const decoded = decodeClassDashboard(encodeClassDashboard(tpl));
    expect(decoded).toEqual(tpl);
  });

  it("malformed payload decodes to null (defensive)", () => {
    expect(decodeClassDashboard(new TextEncoder().encode("not json"))).toBeNull();
    expect(decodeClassDashboard(new TextEncoder().encode("[1,2,3]"))).toBeNull();
  });

  it("missing rev defaults to 0", () => {
    const decoded = decodeClassDashboard(
      new TextEncoder().encode(JSON.stringify({ tabs: ["notes"] })),
    );
    expect(decoded?.rev).toBe(0);
    expect(decoded?.tabs).toEqual(["notes"]);
  });
});

describe("resolveClassStudentNav (CT-6)", () => {
  it("absent template => the coursework default allowlist", () => {
    const set = resolveClassStudentNav(null);
    expect([...set].sort()).toEqual([...CLASS_STUDENT_NAV_DEFAULT].sort());
    // The coursework default hides research-lab screens.
    expect(set.has("/gantt")).toBe(false);
    expect(set.has("/purchases")).toBe(false);
    expect(set.has("/inventory")).toBe(false);
    expect(set.has("/links")).toBe(false);
    // ...and keeps the home + science tools.
    expect(set.has("/workbench")).toBe(true);
    expect(set.has("/methods")).toBe(true);
    expect(set.has("/datahub")).toBe(true);
  });

  it("absent `nav` on a present template => the coursework default", () => {
    const set = resolveClassStudentNav({ rev: 1, tabs: ["notes"] });
    expect([...set].sort()).toEqual([...CLASS_STUDENT_NAV_DEFAULT].sort());
  });

  it("present `nav` => exactly the instructor's choice, with /workbench force-kept", () => {
    const set = resolveClassStudentNav({ rev: 2, nav: ["/methods", "/gantt"] });
    expect(set.has("/methods")).toBe(true);
    expect(set.has("/gantt")).toBe(true); // the instructor turned it on
    expect(set.has("/workbench")).toBe(true); // never hidden (no soft-lock)
    expect(set.has("/datahub")).toBe(false); // not chosen
  });

  it("never strands the student even if the instructor clears the nav", () => {
    const set = resolveClassStudentNav({ rev: 3, nav: [] });
    expect(set.has("/workbench")).toBe(true);
    expect(set.size).toBe(1);
  });
});
