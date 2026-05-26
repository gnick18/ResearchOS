// Integration test for the wiki search dropdown.
//
// Three concerns:
//   1. Typing 2+ chars triggers the index fetch, debounce, and results render.
//   2. Enter on the highlighted result navigates via next/navigation router.push.
//   3. Escape clears the query (first press) and blurs (second press).
//
// We mock both `next/navigation` (router + pathname) and `fetch` (to return
// a small synthetic index), keeping the test fully hermetic.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WikiSearch from "./WikiSearch";
import type { WikiSearchIndex } from "@/lib/wiki/search";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
  usePathname: () => "/wiki",
}));

const fixture: WikiSearchIndex = {
  generatedAt: "2026-05-25T00:00:00Z",
  pageCount: 3,
  categories: [
    { id: "features", label: "Features" },
    { id: "getting-started", label: "Getting Started" },
  ],
  entries: [
    {
      href: "/wiki/features/lab-head",
      title: "Lab Head",
      breadcrumbs: ["Features", "Lab Head"],
      categoryId: "features",
      headings: ["What a Lab Head actually is"],
      bodySnippets: ["The Lab Head is a per-user role."],
    },
    {
      href: "/wiki/features/purchases",
      title: "Purchases & Funding",
      breadcrumbs: ["Features", "Purchases & Funding"],
      categoryId: "features",
      headings: ["Approval queue"],
      bodySnippets: ["The Lab Head can approve purchases through the soft-write queue."],
    },
    {
      href: "/wiki/getting-started/connecting-your-folder",
      title: "Connecting Your Folder",
      breadcrumbs: ["Getting Started", "Connecting Your Folder"],
      categoryId: "getting-started",
      headings: ["Pick a folder"],
      bodySnippets: ["The folder picker grants access."],
    },
  ],
};

describe("WikiSearch component", () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(fixture),
        } as Response),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the index on focus, then shows debounced results on typing", async () => {
    const user = userEvent.setup();
    render(<WikiSearch />);

    const input = screen.getByPlaceholderText("Search the wiki");
    await user.click(input);

    // Type a 2-char query.
    await user.type(input, "lab head");

    // Wait for the debounce + fetch + render to settle.
    // Lab Head should render as an option (combobox role exposes the listbox).
    await waitFor(
      () => {
        const options = screen.getAllByRole("option");
        expect(options.length).toBeGreaterThan(0);
        expect(options[0].textContent).toContain("Lab Head");
      },
      { timeout: 1000 },
    );

    // Verify the category header rendered.
    expect(screen.getByText("Features")).toBeInTheDocument();
    // Purchases ranks lower than Lab Head but should also appear (body match).
    const options = screen.getAllByRole("option");
    const hrefs = options.map((o) => o.getAttribute("href"));
    expect(hrefs).toContain("/wiki/features/lab-head");
    expect(hrefs).toContain("/wiki/features/purchases");
  });

  it("navigates via router.push when Enter is pressed on the highlighted result", async () => {
    const user = userEvent.setup();
    render(<WikiSearch />);
    const input = screen.getByPlaceholderText("Search the wiki");
    await user.click(input);
    await user.type(input, "lab head");

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0), {
      timeout: 1000,
    });

    // Enter on the default-highlighted (first) result.
    await user.keyboard("{Enter}");
    expect(pushMock).toHaveBeenCalledWith("/wiki/features/lab-head");
  });

  it("ArrowDown moves highlight to the next result, Enter navigates to it", async () => {
    const user = userEvent.setup();
    render(<WikiSearch />);
    const input = screen.getByPlaceholderText("Search the wiki");
    await user.click(input);
    await user.type(input, "lab head");

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1), {
      timeout: 1000,
    });

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(pushMock).toHaveBeenCalledWith("/wiki/features/purchases");
  });

  it("Escape clears the query first, then closes the dropdown on a second press", async () => {
    const user = userEvent.setup();
    render(<WikiSearch />);
    const input = screen.getByPlaceholderText("Search the wiki") as HTMLInputElement;
    await user.click(input);
    await user.type(input, "lab head");

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0), {
      timeout: 1000,
    });

    // First Escape: clears the input.
    await user.keyboard("{Escape}");
    expect(input.value).toBe("");

    // Second Escape: blurs (the dropdown should not be visible).
    await user.keyboard("{Escape}");
    // After clearing + blur, no result options should remain.
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows a zero-state when the query has no matches", async () => {
    const user = userEvent.setup();
    render(<WikiSearch />);
    const input = screen.getByPlaceholderText("Search the wiki");
    await user.click(input);
    await user.type(input, "xyzzy");

    await waitFor(
      () => {
        expect(screen.getByText(/No matches for/i)).toBeInTheDocument();
      },
      { timeout: 1000 },
    );
  });

  it("shows the type-more hint for 1-character queries", async () => {
    const user = userEvent.setup();
    render(<WikiSearch />);
    const input = screen.getByPlaceholderText("Search the wiki");
    await user.click(input);
    await user.type(input, "l");

    // Wait for debounce.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(screen.getByText(/Type 2 or more characters/i)).toBeInTheDocument();
  });
});
