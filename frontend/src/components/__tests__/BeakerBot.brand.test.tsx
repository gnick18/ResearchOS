import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import BeakerBot from "@/components/BeakerBot";

// Brand guard: the ResearchOS mascot must ALWAYS render with the signature
// sky-blue stroke, never a black/inherited outline (brand/README.md). The bug
// this prevents: passing a sizing-only className used to drop the default color,
// so BeakerBot inherited the parent's dark text color and rendered black. The
// component now forces `text-brand-sky` unless the caller set their own text
// color. These tests fail if that guarantee is ever removed.

function markClass(container: HTMLElement): string {
  const svg = container.querySelector('svg[role="img"]');
  return svg?.getAttribute("class") ?? "";
}

describe("BeakerBot brand color guarantee", () => {
  it("uses the brand sky stroke with no props", () => {
    const { container } = render(<BeakerBot pose="idle" />);
    expect(markClass(container)).toContain("text-brand-sky");
  });

  it("keeps the brand sky stroke when a sizing-only className is passed", () => {
    // The exact shape of the welcome-card bug: size, no color.
    const { container } = render(
      <BeakerBot pose="idle" className="h-28 w-28" />,
    );
    expect(markClass(container)).toContain("text-brand-sky");
  });

  it("never falls back to a bare currentColor (no forced color is the bug)", () => {
    const { container } = render(<BeakerBot pose="idle" className="block" />);
    const cls = markClass(container);
    expect(cls).toContain("text-brand-sky");
  });

  it("honors a deliberate text-color override", () => {
    const { container } = render(
      <BeakerBot pose="idle" className="h-6 w-6 text-white" />,
    );
    const cls = markClass(container);
    expect(cls).toContain("text-white");
    expect(cls).not.toContain("text-brand-sky");
  });
});
