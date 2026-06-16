// Render smoke test for the welcome marketing page. We do not pull any heavy
// chunk or touch the network; we only assert that the page renders and a couple
// of its stable sections are on screen. (The old tree-of-life showcase was
// removed from the page, so its dedicated test went with it.)

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// next/navigation router (the page calls useRouter).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// next/image renders a plain img in the test.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, unknown>)} />;
  },
}));

import WelcomePage from "./WelcomePage";

afterEach(() => cleanup());

describe("WelcomePage", () => {
  it("renders the page with its key marketing sections", () => {
    render(<WelcomePage />);

    expect(
      screen.getByText("The companion app brings ResearchOS to the bench"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Three steps, your data never leaves unless you say so",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Free, but accountable")).toBeTruthy();
  });

  it("renders the tri-CTA on the unsupported (phone) path", () => {
    render(<WelcomePage unsupported />);

    // The three CTA cards, in priority order.
    expect(screen.getByText("Get the companion app")).toBeTruthy();
    expect(
      screen.getByText("Open on desktop for the full app"),
    ).toBeTruthy();
    expect(screen.getByText("Be first to know")).toBeTruthy();

    // Demo + notify hand-offs are present and wired.
    expect(screen.getByTestId("phone-cta-demo").getAttribute("href")).toBe(
      "/demo",
    );
    expect(
      screen.getByTestId("phone-cta-notify").getAttribute("href"),
    ).toMatch(/^mailto:/);

    // Companion store badges default to a "Coming soon" state (no live flag).
    expect(screen.getAllByText("Coming soon to").length).toBe(2);
  });

  it("hides the tri-CTA on the supported desktop path", () => {
    render(<WelcomePage />);
    expect(screen.queryByText("Get the companion app")).toBeNull();
  });
});
