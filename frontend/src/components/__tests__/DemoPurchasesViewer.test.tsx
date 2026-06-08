import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * F2 (Onboarding v4 §6.14 Purchases redesign 2026-05-22, Purchases
 * manager): the read-only DemoPurchasesViewer overlay.
 *
 * The viewer fetches Alex's fixtures from `/demo-data/users/alex/...`
 * and renders them in a fullscreen overlay. These tests stub fetch
 * with a minimal in-memory fixture set so we can assert:
 *   - The viewer renders the overlay surface + dismiss button.
 *   - Purchase rows render from the fetched purchase_items + tasks.
 *   - The dismiss button calls onClose.
 *   - The viewer is read-only — no edit buttons inside the rows.
 *   - SpendingDashboard mounts (its heading is rendered).
 */

import DemoPurchasesViewer from "../DemoPurchasesViewer";

// Static fixture set. Counters list 1 of each entity, the loops fetch
// id=1 only, so we serve a single JSON per directory below.
const fakeCounters = {
  tasks: 1,
  projects: 1,
  purchase_items: 1,
  funding_accounts: 1,
};

const fakeProject = {
  id: 1,
  name: "Demo Project",
  weekend_active: false,
  tags: null,
  color: null,
  created_at: "2026-05-01T00:00:00Z",
  sort_order: 0,
  is_archived: false,
  archived_at: null,
  shared_with: [],
};

const fakeTask = {
  id: 7,
  project_id: 1,
  name: "Demo purchase task",
  start_date: "2026-05-15",
  duration_days: 1,
  end_date: "2026-05-16",
  is_high_level: false,
  is_complete: false,
  task_type: "purchase",
  weekend_override: null,
  method_ids: [],
  deviation_log: null,
  tags: null,
  sort_order: 0,
  experiment_color: null,
  sub_tasks: null,
  method_attachments: [],
  shared_with: [],
};

const fakeItem = {
  id: 1,
  task_id: 7,
  item_name: "Demo widget",
  quantity: 1,
  link: null,
  cas: null,
  price_per_unit: 100,
  shipping_fees: 0,
  total_price: 100,
  notes: null,
  funding_string: "Demo funding",
  vendor: "Demo vendor",
  category: "Reagents",
};

const fakeFunding = {
  id: 1,
  name: "Demo funding",
  description: null,
  total_budget: 1000,
};

beforeEach(() => {
  // Stub global fetch — returns JSON keyed off path suffix.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.toString();
      if (path.endsWith("_counters.json")) {
        return new Response(JSON.stringify(fakeCounters));
      }
      if (path.includes("/projects/1.json")) {
        return new Response(JSON.stringify(fakeProject));
      }
      if (path.includes("/tasks/1.json")) {
        return new Response(JSON.stringify({ ...fakeTask, id: 1 }));
      }
      // Match any tasks/N.json
      if (path.includes("/tasks/")) {
        return new Response(JSON.stringify(fakeTask));
      }
      if (path.includes("/purchase_items/1.json")) {
        return new Response(JSON.stringify(fakeItem));
      }
      if (path.includes("/funding_accounts/1.json")) {
        return new Response(JSON.stringify(fakeFunding));
      }
      return new Response("Not Found", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DemoPurchasesViewer", () => {
  it("returns null when open=false", () => {
    const onClose = vi.fn();
    const { container } = render(
      <DemoPurchasesViewer open={false} onClose={onClose} />,
    );
    expect(container.querySelector('[data-testid="demo-purchases-viewer"]')).toBeNull();
  });

  it("renders the overlay surface when open=true", async () => {
    const onClose = vi.fn();
    render(<DemoPurchasesViewer open onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByTestId("demo-purchases-viewer")).toBeInTheDocument();
    });
    expect(screen.getByTestId("demo-purchases-back-button")).toBeInTheDocument();
  });

  it("dismiss button calls onClose", async () => {
    const onClose = vi.fn();
    render(<DemoPurchasesViewer open onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByTestId("demo-purchases-back-button")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("demo-purchases-back-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders one demo-purchase-row per loaded purchase task", async () => {
    const onClose = vi.fn();
    render(<DemoPurchasesViewer open onClose={onClose} />);
    await waitFor(() => {
      const rows = screen.queryAllByTestId("demo-purchase-row");
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
    // The fake task is task_type="purchase" so it shows up.
    expect(screen.getAllByText(/Demo purchase task/i).length).toBeGreaterThan(0);
  });

  it("mounts the SpendingDashboard with the demo-spending-dashboard anchor", async () => {
    const onClose = vi.fn();
    render(<DemoPurchasesViewer open onClose={onClose} />);
    await waitFor(() => {
      const dash = document.querySelector(
        '[data-tour-target="demo-spending-dashboard"]',
      );
      expect(dash).toBeTruthy();
    });
  });

  it("is read-only: no edit / delete affordances inside the purchase rows", async () => {
    const onClose = vi.fn();
    render(<DemoPurchasesViewer open onClose={onClose} />);
    await waitFor(() => {
      expect(screen.queryAllByTestId("demo-purchase-row").length).toBeGreaterThan(0);
    });
    // The viewer rows are plain divs — no buttons inside them.
    const rows = screen.queryAllByTestId("demo-purchase-row");
    for (const row of rows) {
      expect(row.querySelectorAll("button").length).toBe(0);
    }
  });
});
