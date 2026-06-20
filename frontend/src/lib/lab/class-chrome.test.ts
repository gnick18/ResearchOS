import { describe, expect, it } from "vitest";
import {
  lensLabel,
  overviewLabel,
  buildLabLensItems,
  filterResearcherItems,
  wholeAudienceCopy,
  CLASS_HIDDEN_PI_HREFS,
  CLASS_HIDDEN_NAV_HREFS,
  CLASS_MATERIALS_HREF,
} from "./class-chrome";
import type { NavItem } from "../nav";

// A representative base nav as AppShell hands it to the lab-lens builder:
// the dashboard ("/"), the personal Workbench (dropped in the lab lens), a
// research-only tool (/purchases), and the science tools a CURE class keeps.
const BASE: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/workbench", label: "Workbench" },
  { href: "/sequences", label: "Sequences" },
  { href: "/phylo", label: "Phylogenetics" },
  { href: "/datahub", label: "Data Hub" },
  { href: "/methods", label: "Methods" },
  { href: "/calendar", label: "Calendar" },
  { href: "/purchases", label: "Purchases" },
];

const hrefs = (items: NavItem[]) => items.map((i) => i.href);
const labelFor = (items: NavItem[], href: string) =>
  items.find((i) => i.href === href)?.label;

describe("lensLabel", () => {
  it("reads Class in class mode and Lab otherwise (flag-off parity)", () => {
    expect(lensLabel(true)).toBe("Class");
    expect(lensLabel(false)).toBe("Lab");
  });
});

describe("overviewLabel", () => {
  it("reads Class Overview in class mode and Lab Overview otherwise", () => {
    expect(overviewLabel(true)).toBe("Class Overview");
    expect(overviewLabel(false)).toBe("Lab Overview");
  });
});

describe("wholeAudienceCopy (CT-1 class-context share relabel)", () => {
  it("reads class framing in class mode", () => {
    const copy = wholeAudienceCopy(true);
    expect(copy.rowLabel).toBe("Whole class");
    expect(copy.addLabel).toBe("+ Share with the whole class");
    expect(copy.removeLabel).toBe("Remove whole-class share");
    expect(copy.ariaAudience).toBe("the whole class");
    expect(copy.rosterLead(3)).toBe("All 3 students");
    expect(copy.rosterEmpty).toBe("No students in this class yet.");
  });

  it("reads the legacy research-lab framing when off (flag-off parity)", () => {
    const copy = wholeAudienceCopy(false);
    expect(copy.rowLabel).toBe("Whole lab");
    expect(copy.addLabel).toBe("+ Share with the whole lab");
    expect(copy.removeLabel).toBe("Remove Whole-lab share");
    expect(copy.ariaAudience).toBe("the whole lab");
    expect(copy.rosterLead(3)).toBe("Currently includes (3)");
    expect(copy.rosterEmpty).toBe("No other active members in this lab yet.");
  });

  it("never says class in lab mode and never says lab in class mode", () => {
    const lab = wholeAudienceCopy(false);
    const cls = wholeAudienceCopy(true);
    expect(lab.addLabel.toLowerCase()).not.toContain("class");
    expect(cls.addLabel.toLowerCase()).not.toContain("lab");
  });
});

describe("buildLabLensItems (research lab, classMode false)", () => {
  const out = buildLabLensItems(BASE, false);

  it("expands the dashboard entry into the full PI lineup", () => {
    expect(hrefs(out)).toEqual([
      "/lab-overview",
      "/people",
      "/lab-work",
      "/approvals",
      "/activity",
      "/funding",
      "/sequences",
      "/phylo",
      "/datahub",
      "/methods",
      "/calendar",
      "/purchases",
    ]);
  });

  it("labels the overview entry Lab Overview", () => {
    expect(labelFor(out, "/lab-overview")).toBe("Lab Overview");
  });

  it("drops the personal Workbench from the lab lens", () => {
    expect(hrefs(out)).not.toContain("/workbench");
  });

  it("keeps Funding, Approvals, and Purchases (research lab keeps everything)", () => {
    expect(hrefs(out)).toContain("/funding");
    expect(hrefs(out)).toContain("/approvals");
    expect(hrefs(out)).toContain("/purchases");
  });

  it("does NOT add the Class Materials entry in a research lab (flag-off parity)", () => {
    expect(hrefs(out)).not.toContain(CLASS_MATERIALS_HREF);
  });
});

describe("buildLabLensItems (class, classMode true)", () => {
  const out = buildLabLensItems(BASE, true);

  it("relabels the overview entry to Class Overview", () => {
    expect(labelFor(out, "/lab-overview")).toBe("Class Overview");
  });

  it("hides the research-only PI tabs (Funding, Approvals)", () => {
    for (const href of CLASS_HIDDEN_PI_HREFS) {
      expect(hrefs(out)).not.toContain(href);
    }
  });

  it("hides the research-only tools (Purchases)", () => {
    for (const href of CLASS_HIDDEN_NAV_HREFS) {
      expect(hrefs(out)).not.toContain(href);
    }
  });

  it("keeps the science tools a CURE class needs", () => {
    for (const href of [
      "/sequences",
      "/phylo",
      "/datahub",
      "/methods",
      "/calendar",
    ]) {
      expect(hrefs(out)).toContain(href);
    }
  });

  it("keeps People, Lab Work, and Activity (mapped onto a class for now)", () => {
    expect(hrefs(out)).toContain("/people");
    expect(hrefs(out)).toContain("/lab-work");
    expect(hrefs(out)).toContain("/activity");
  });

  it("adds the Class Materials nav entry in class mode", () => {
    expect(hrefs(out)).toContain(CLASS_MATERIALS_HREF);
    expect(labelFor(out, CLASS_MATERIALS_HREF)).toBe("Class Materials");
  });

  it("still drops the personal Workbench", () => {
    expect(hrefs(out)).not.toContain("/workbench");
  });
});

describe("filterResearcherItems", () => {
  // The researcher set the caller passes in already has HOME_HREF stripped.
  const RESEARCHER: NavItem[] = BASE.filter((i) => i.href !== "/");

  it("is the identity filter when class mode is off (flag-off parity)", () => {
    expect(filterResearcherItems(RESEARCHER, false)).toEqual(RESEARCHER);
  });

  it("drops the research-only tools in class mode", () => {
    const out = filterResearcherItems(RESEARCHER, true);
    expect(hrefs(out)).not.toContain("/purchases");
    // science tools + the personal workbench remain
    expect(hrefs(out)).toContain("/sequences");
    expect(hrefs(out)).toContain("/workbench");
  });
});

describe("solo / member parity (no lab lens)", () => {
  // A solo or member user never enters buildLabLensItems; AppShell calls
  // filterResearcherItems on their tab set. With class mode off that is the
  // identity, so a non-class user is byte-identical to today.
  it("leaves a member tab set untouched when class mode is off", () => {
    const member: NavItem[] = BASE.filter((i) => i.href !== "/");
    expect(filterResearcherItems(member, false)).toBe(member);
  });
});
