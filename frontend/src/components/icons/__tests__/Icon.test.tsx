// sequence editor master. Renders the <Icon> component from the verified
// registry and checks the canonical tree glyph plus registry integrity.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon, ICONS, type IconName } from "@/components/icons";

describe("<Icon>", () => {
  it("renders an <svg> carrying the branching-tree path for name='tree'", () => {
    const { container } = render(<Icon name="tree" className="h-4 w-4" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class")).toContain("h-4 w-4");
    // The canonical tree glyph is a rooted cladogram: this is its root stem path.
    const paths = Array.from(container.querySelectorAll("path")).map((p) =>
      p.getAttribute("d"),
    );
    expect(paths).toContain("M3 12H6");
  });

  it("is decorative (aria-hidden) by default and an img with a title when titled", () => {
    const plain = render(<Icon name="search" />);
    const plainSvg = plain.container.querySelector("svg");
    expect(plainSvg?.getAttribute("aria-hidden")).toBe("true");
    expect(plainSvg?.getAttribute("role")).toBeNull();

    const titled = render(<Icon name="search" title="Search" />);
    const titledSvg = titled.container.querySelector("svg");
    expect(titledSvg?.getAttribute("role")).toBe("img");
    expect(titledSvg?.getAttribute("aria-hidden")).toBeNull();
    expect(titledSvg?.querySelector("title")?.textContent).toBe("Search");
  });

  it("degrades to a fallback glyph (no throw) for an unknown / undefined name", () => {
    // The palette aggregates icon names from many dynamic + persisted sources;
    // a single bad or undefined name must not white-screen the surface. Cast
    // around the IconName type to simulate the runtime-bad value.
    const bogus = render(<Icon name={"definitely-not-an-icon" as IconName} />);
    const bogusSvg = bogus.container.querySelector("svg");
    expect(bogusSvg).not.toBeNull();
    expect(bogusSvg?.querySelectorAll("path, circle, line, rect, polyline, polygon, text, ellipse").length).toBeGreaterThan(0);

    const missing = render(<Icon name={undefined as unknown as IconName} />);
    expect(missing.container.querySelector("svg")).not.toBeNull();
  });

  it("every registry entry has a non-empty body and a concept", () => {
    const names = Object.keys(ICONS) as IconName[];
    expect(names.length).toBeGreaterThan(30);
    for (const name of names) {
      const entry = ICONS[name];
      expect(entry.concept, `${name} concept`).toBeTruthy();
      expect(entry.body, `${name} body`).toBeTruthy();
      // Each glyph must render at least one drawable element.
      const { container } = render(<Icon name={name} />);
      const drawables = container.querySelectorAll(
        "path, circle, line, rect, polyline, polygon, text, ellipse",
      );
      expect(drawables.length, `${name} drawables`).toBeGreaterThan(0);
    }
  });
});
