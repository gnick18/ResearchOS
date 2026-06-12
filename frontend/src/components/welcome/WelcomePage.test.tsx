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
});
