// sequence editor master. Render test for the welcome page's tree-of-life
// showcase. The heavy d3 explorer is mocked to a light stub so this test does
// not pull the real chunk or touch any network; we only assert that the
// dedicated section mounts the EMBEDDED tree (the offline embed) on the page.
// jsdom has no IntersectionObserver, so the showcase mounts the tree eagerly
// (its documented fallback), which is exactly what we assert.

import { describe, it, expect, vi, afterEach } from "vitest";
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

// next/dynamic returns the module's default synchronously, so the mocked
// TaxonomyTreeView below is the component the showcase renders.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: unknown }>) => {
    // The welcome page only dynamic-imports the tree view, which we mock to a
    // stub; return that stub directly so the showcase renders it inline.
    void loader;
    return Stub;
  },
}));

// The real explorer is replaced by a stub that records the props it gets, so we
// can assert the embed is mounted with `embedded`. No d3, no network.
function Stub(props: { open?: boolean; embedded?: boolean }) {
  return (
    <div
      data-testid="stub-tree-view"
      data-open={String(Boolean(props.open))}
      data-embedded={String(Boolean(props.embedded))}
    />
  );
}

import WelcomePage from "./WelcomePage";

afterEach(() => cleanup());

describe("WelcomePage tree-of-life showcase", () => {
  it("mounts a dedicated tree-of-life section with the embedded explorer", () => {
    render(<WelcomePage />);

    // The dedicated section card is present.
    const card = screen.getByTestId("welcome-tree-of-life");
    expect(card).toBeTruthy();

    // The headline copy reads as the explore-the-tree-of-life showcase.
    expect(screen.getByText("Explore the tree of life")).toBeTruthy();

    // jsdom has no IntersectionObserver, so the showcase mounts the tree
    // eagerly. It is the embedded (offline) explorer.
    const tree = screen.getByTestId("stub-tree-view");
    expect(tree.getAttribute("data-embedded")).toBe("true");
    expect(tree.getAttribute("data-open")).toBe("true");
  });
});
