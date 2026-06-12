import { describe, it, expect } from "vitest";
import { resolveNavLayout, NavLayout } from "./nav-layout";
import { NavItem } from "./nav";

// A representative member nav set (Home dropped for members, but for these
// tests we include "/" to exercise the home-forcing rule directly).
const NAV: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/workbench", label: "Workbench" },
  { href: "/gantt", label: "GANTT" },
  { href: "/methods", label: "Methods" },
  { href: "/sequences", label: "Sequences" },
  { href: "/chemistry", label: "Chemistry" },
  { href: "/datahub", label: "Data Hub" },
  { href: "/inventory", label: "Inventory" },
  { href: "/purchases", label: "Purchases" },
  { href: "/calendar", label: "Calendar" },
  { href: "/links", label: "Links" },
];

const hrefs = (items: NavItem[]): string[] => items.map((i) => i.href);

describe("resolveNavLayout", () => {
  it("no saved layout uses the default split", () => {
    const { inline, more } = resolveNavLayout(NAV, null);
    expect(hrefs(inline)).toEqual([
      "/",
      "/workbench",
      "/gantt",
      "/methods",
      "/datahub",
      "/calendar",
    ]);
    expect(hrefs(more)).toEqual([
      "/sequences",
      "/chemistry",
      "/inventory",
      "/purchases",
      "/links",
    ]);
  });

  it("default split reconciles against a flag-reduced nav set (no Data Hub)", () => {
    const reduced = NAV.filter((i) => i.href !== "/datahub");
    const { inline, more } = resolveNavLayout(reduced, null);
    expect(hrefs(inline)).toEqual([
      "/",
      "/workbench",
      "/gantt",
      "/methods",
      "/calendar",
    ]);
    expect(more.find((i) => i.href === "/datahub")).toBeUndefined();
  });

  it("a newly-visible tab lands in More, not inline", () => {
    const saved: NavLayout = {
      inline: ["/", "/workbench", "/methods"],
      more: ["/gantt", "/calendar"],
    };
    // /datahub is visible now but absent from the saved layout.
    const navNoExtras = NAV.filter((i) =>
      ["/", "/workbench", "/methods", "/gantt", "/calendar", "/datahub"].includes(
        i.href,
      ),
    );
    const { inline, more } = resolveNavLayout(navNoExtras, saved);
    expect(hrefs(inline)).toEqual(["/", "/workbench", "/methods"]);
    expect(hrefs(more)).toContain("/datahub");
    // and it goes to the END of More (appended, after the saved more entries)
    expect(hrefs(more)).toEqual(["/gantt", "/calendar", "/datahub"]);
  });

  it("a saved href no longer in navItems is dropped", () => {
    const saved: NavLayout = {
      inline: ["/", "/workbench", "/inventory"],
      more: ["/gantt", "/old-removed-route"],
    };
    const navNoInventory = NAV.filter((i) => i.href !== "/inventory");
    const { inline, more } = resolveNavLayout(navNoInventory, saved);
    expect(hrefs(inline)).not.toContain("/inventory");
    expect(hrefs(more)).not.toContain("/old-removed-route");
  });

  it("forces Home first in inline even if saved put it elsewhere", () => {
    const saved: NavLayout = {
      inline: ["/workbench", "/methods", "/"],
      more: ["/gantt"],
    };
    const { inline } = resolveNavLayout(NAV, saved);
    expect(inline[0].href).toBe("/");
  });

  it("pulls Home out of More and forces it first in inline", () => {
    const saved: NavLayout = {
      inline: ["/workbench", "/methods"],
      more: ["/", "/gantt"],
    };
    const { inline, more } = resolveNavLayout(NAV, saved);
    expect(inline[0].href).toBe("/");
    expect(hrefs(more)).not.toContain("/");
  });

  it("forces the lab-head Lab Overview remap first in inline", () => {
    const labNav: NavItem[] = [
      { href: "/lab-overview", label: "Lab Overview" },
      { href: "/workbench", label: "Workbench" },
      { href: "/gantt", label: "GANTT" },
    ];
    const saved: NavLayout = {
      inline: ["/workbench"],
      more: ["/gantt", "/lab-overview"],
    };
    const { inline, more } = resolveNavLayout(labNav, saved);
    expect(inline[0].href).toBe("/lab-overview");
    expect(hrefs(more)).not.toContain("/lab-overview");
  });

  it("de-dupes an href that appears in both saved lists (inline wins)", () => {
    const saved: NavLayout = {
      inline: ["/", "/workbench", "/methods"],
      more: ["/methods", "/gantt"],
    };
    const { inline, more } = resolveNavLayout(NAV, saved);
    expect(hrefs(inline).filter((h) => h === "/methods")).toHaveLength(1);
    expect(hrefs(more)).not.toContain("/methods");
  });

  it("preserves a custom saved reorder", () => {
    const saved: NavLayout = {
      inline: ["/", "/calendar", "/methods", "/workbench"],
      more: ["/links", "/sequences", "/chemistry", "/datahub", "/inventory", "/purchases", "/gantt"],
    };
    const { inline } = resolveNavLayout(NAV, saved);
    expect(hrefs(inline)).toEqual(["/", "/calendar", "/methods", "/workbench"]);
  });
});
