// Smoke test for the /showcase route. The page is a CLICK-SWITCHED
// two-view layout (Change 3): a persistent StageNav switches between the
// Runway view and the Scenes view (one mounted at a time) and offers a
// Leave control that routes home. Asserts the page renders without
// throwing, opens on the Runway view, click-switches to the Scenes view,
// and the Leave control routes to "/". The deep behavior of each view is
// covered by the component-level tests under
// src/components/showcase/__tests__.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

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
  pushMock.mockClear();
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

import ShowcasePage from "../page";

describe("ShowcasePage (/showcase)", () => {
  it("renders the stage with the persistent click nav", () => {
    render(<ShowcasePage />);
    expect(screen.getByTestId("showcase-page")).toBeTruthy();
    expect(screen.getByTestId("showcase-nav")).toBeTruthy();
    expect(screen.getByTestId("showcase-nav-runway")).toBeTruthy();
    expect(screen.getByTestId("showcase-nav-scenes")).toBeTruthy();
    expect(screen.getByTestId("showcase-nav-leave")).toBeTruthy();
  });

  it("opens on the Runway view (one look on stage), not the scenes", () => {
    render(<ShowcasePage />);
    // The runway is a hands-free auto-show: exactly one look is on stage.
    expect(screen.getByTestId("showcase-runway")).toBeTruthy();
    expect(screen.getAllByTestId("showcase-look")).toHaveLength(1);
    // The Performance Hall view is NOT mounted while on the Runway view.
    expect(screen.queryByTestId("showcase-performance-hall")).toBeNull();
  });

  it("click-switches to the Scenes view and unmounts the runway", () => {
    render(<ShowcasePage />);
    fireEvent.click(screen.getByTestId("showcase-nav-scenes"));
    expect(screen.getByTestId("showcase-performance-hall")).toBeTruthy();
    // The runway (and its autoplay timer) is unmounted on the Scenes view.
    expect(screen.queryByTestId("showcase-runway")).toBeNull();
  });

  it("click-switches back to the Runway view", () => {
    render(<ShowcasePage />);
    fireEvent.click(screen.getByTestId("showcase-nav-scenes"));
    fireEvent.click(screen.getByTestId("showcase-nav-runway"));
    expect(screen.getByTestId("showcase-runway")).toBeTruthy();
    expect(screen.queryByTestId("showcase-performance-hall")).toBeNull();
  });

  it("routes home when Leave is clicked", () => {
    render(<ShowcasePage />);
    fireEvent.click(screen.getByTestId("showcase-nav-leave"));
    expect(pushMock).toHaveBeenCalledWith("/");
  });
});
