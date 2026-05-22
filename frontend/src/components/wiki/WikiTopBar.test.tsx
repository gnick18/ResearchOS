// Surgical regression test for the wiki "Back to app" handler. The handler
// reads a sessionStorage cache (`researchOS.wikiReturnPath`) populated on
// mount when arriving via `?return=<path>`. Without clearing the cache on
// click, a later deep-link visit (no `?return=`) would still find the stale
// value and route back to the wrong origin. The handler clears the cache
// immediately after reading it so each round-trip is self-contained.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WikiTopBar from "./WikiTopBar";

const pushMock = vi.fn();
const backMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    back: backMock,
  }),
}));

const RETURN_PATH_KEY = "researchOS.wikiReturnPath";

describe("WikiTopBar back-to-app handler", () => {
  beforeEach(() => {
    pushMock.mockClear();
    backMock.mockClear();
    sessionStorage.clear();
  });

  it("clears sessionStorage cache when back-to-app fires", () => {
    // Pre-seed the cache as if a previous `?return=/gantt` visit had stored it.
    sessionStorage.setItem(RETURN_PATH_KEY, "/gantt?view=week");

    render(<WikiTopBar />);
    fireEvent.click(screen.getByRole("button", { name: /back to app/i }));

    // The cache must be gone so a subsequent deep-link visit can't reuse it.
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull();
    // Sanity: the click still routed to the cached path for this round-trip.
    expect(pushMock).toHaveBeenCalledWith("/gantt?view=week");
  });
});
