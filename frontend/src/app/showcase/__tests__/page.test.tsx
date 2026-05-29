// Smoke test for the /showcase route. Asserts the page renders without
// throwing and wires the headline sections (hero, runway, performance
// hall, footer). The deep behavior of each section is covered by the
// component-level tests under src/components/showcase/__tests__.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// next/link is a thin <a> wrapper for the footer "Back to the lab" link.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import ShowcasePage from "../page";

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  installMatchMedia();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ShowcasePage (/showcase)", () => {
  it("renders the full stage without throwing", () => {
    render(<ShowcasePage />);
    expect(screen.getByTestId("showcase-page")).toBeTruthy();
    expect(screen.getByTestId("showcase-hero")).toBeTruthy();
    expect(screen.getByTestId("showcase-performance-hall")).toBeTruthy();
    expect(screen.getByTestId("showcase-footer")).toBeTruthy();
  });

  it("renders the skip-to-scenes corner pin", () => {
    render(<ShowcasePage />);
    expect(screen.getByTestId("showcase-skip-pin")).toBeTruthy();
  });

  it("renders the runway auto-show under the hero (one look on stage)", () => {
    render(<ShowcasePage />);
    // The runway is now a hands-free auto-show: exactly one look is on
    // stage at a time (not all 19 stacked as scroll frames).
    expect(screen.getByTestId("showcase-runway")).toBeTruthy();
    expect(screen.getAllByTestId("showcase-look")).toHaveLength(1);
  });
});
