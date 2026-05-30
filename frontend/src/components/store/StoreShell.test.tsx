import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StoreShell, type StoreCategory } from "./StoreShell";

/**
 * Frame tests for the shared StoreShell (Extension Store Phase B). These
 * assert the master/detail structure and the rail/detail callbacks without
 * depending on either store's data, so the generic frame is verified in
 * isolation.
 */

interface Item {
  id: string;
  name: string;
}

const ITEMS: Item[] = [
  { id: "x", name: "Ex" },
  { id: "y", name: "Why" },
];

const CATEGORIES: StoreCategory[] = [
  { id: "a", label: "Alpha", count: 2 },
  { id: "b", label: "Beta", count: 3 },
];

function renderShell(
  overrides: Partial<Parameters<typeof StoreShell<Item>>[0]> = {},
) {
  const props = {
    title: "Test store",
    subtitle: "A subtitle",
    categories: CATEGORIES,
    selectedCategoryId: null as string | null,
    onSelectCategory: vi.fn(),
    searchSlot: <input aria-label="search-slot" />,
    enabledOnly: false,
    onToggleEnabledOnly: vi.fn(),
    items: ITEMS,
    getItemKey: (it: Item) => it.id,
    selectedItem: null as Item | null,
    onSelectItem: vi.fn(),
    renderCard: (
      it: Item,
      { onSelect }: { selected: boolean; onSelect: () => void },
    ) => <button onClick={onSelect}>card-{it.id}</button>,
    renderDetail: (it: Item) => <div>detail-{it.id}</div>,
    browseHint: "Pick a card to preview",
    footerSlot: <div>footer-stub</div>,
    onClose: vi.fn(),
    ...overrides,
  };
  render(<StoreShell<Item> {...props} />);
  return props;
}

afterEach(cleanup);

describe("StoreShell", () => {
  it("renders the header, search slot, categories with counts, and an All entry", () => {
    renderShell({ allLabel: "All things" });
    expect(screen.getByText("Test store")).toBeInTheDocument();
    expect(screen.getByText("A subtitle")).toBeInTheDocument();
    // The search slot appears in both the rail and the mobile chip row.
    expect(screen.getAllByLabelText("search-slot").length).toBeGreaterThan(0);
    // Category labels appear in the rail (mobile chips fold the count into the
    // label so the exact-text rail spans are what these match).
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // The synthetic All entry sums the category counts (2 + 3 = 5).
    expect(screen.getByText("All things")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows the browse hint and collapses the detail pane until an item is selected", () => {
    renderShell();
    expect(screen.getByText("Pick a card to preview")).toBeInTheDocument();
    expect(screen.queryByText("detail-x")).not.toBeInTheDocument();
  });

  it("renders the detail pane and drops the browse hint when an item is selected", () => {
    renderShell({ selectedItem: ITEMS[0] });
    // Rendered in both the lg pane and the mobile overlay.
    expect(screen.getAllByText("detail-x").length).toBeGreaterThan(0);
    // The orienting hint is only for the no-selection browse state.
    expect(screen.queryByText("Pick a card to preview")).not.toBeInTheDocument();
  });

  it("calls back when a card is selected", () => {
    const props = renderShell();
    fireEvent.click(screen.getByText("card-x"));
    expect(props.onSelectItem).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("calls back when a rail category is chosen", () => {
    const props = renderShell();
    fireEvent.click(screen.getByText("Alpha"));
    expect(props.onSelectCategory).toHaveBeenCalledWith("a");
  });

  it("toggles the enabled-only filter", () => {
    const props = renderShell({ enabledOnly: false });
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(props.onToggleEnabledOnly).toHaveBeenCalledWith(true);
  });

  it("renders the footer slot", () => {
    renderShell();
    expect(screen.getByText("footer-stub")).toBeInTheDocument();
  });

  it("shows a custom empty state when there are no items", () => {
    renderShell({ items: [], emptyState: "Nothing here yet" });
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const props = renderShell();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });
});
