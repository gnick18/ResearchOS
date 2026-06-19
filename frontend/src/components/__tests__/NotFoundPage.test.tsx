// Branded 404 render contract — 404-consistency fixer 2026-06-18.
//
// NotFoundPage is the single branded 404 shared by the root app/not-found.tsx
// (catches explicit notFound() calls, e.g. /network with the social layer off)
// and the top-level catch-all app/[labSlug]/[[...path]]/not-found.tsx. The one
// behavior worth pinning is the social-layer gate on the "Researcher network"
// link: with the social layer OFF the 404 must NOT link to /network (which
// itself 404s), so the link is hidden; with it ON the link returns.
//
// The marketing chrome (nav/footer/backdrop) is stubbed so the test exercises
// only NotFoundPage's own contract, not its layout deps.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/components/MarketingNav", () => ({ default: () => null }));
vi.mock("@/components/MarketingFooter", () => ({ default: () => null }));
vi.mock("@/components/marketing/MarketingBackdrop", () => ({
  default: () => null,
}));

const socialMock = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/social/config", () => ({
  get SOCIAL_LAYER_ENABLED() {
    return socialMock.enabled;
  },
}));

async function renderNotFound() {
  const { default: NotFoundPage } = await import("../NotFoundPage");
  render(<NotFoundPage />);
}

describe("NotFoundPage (branded 404)", () => {
  beforeEach(() => {
    cleanup();
  });

  it("always shows the branded heading and a Go home link", async () => {
    socialMock.enabled = false;
    await renderNotFound();
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go home" }),
    ).toHaveAttribute("href", "/");
  });

  it("hides the Researcher network link when the social layer is OFF", async () => {
    socialMock.enabled = false;
    await renderNotFound();
    expect(
      screen.queryByRole("link", { name: "Researcher network" }),
    ).toBeNull();
  });

  it("shows the Researcher network link when the social layer is ON", async () => {
    socialMock.enabled = true;
    await renderNotFound();
    expect(
      screen.getByRole("link", { name: "Researcher network" }),
    ).toHaveAttribute("href", "/network");
  });
});
