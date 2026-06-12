// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const getContent = vi.fn();
vi.mock("@/lib/datahub/api", () => ({
  dataHubApi: { getContent: (...a: unknown[]) => getContent(...a) },
}));
// Stub the engine formatters so the result-view wiring is testable without a
// real NormalizedResult shape (those formatters have their own tests).
vi.mock("@/lib/datahub/plain-language", () => ({
  plainLanguageSummary: () => "A differs from B (p = 0.001).",
}));
vi.mock("@/lib/datahub/result-text", () => ({
  resultToText: () => "A differs from B (p = 0.001).\n\nt\t4.21\ndf\t44",
}));

import DataHubEmbed from "./DataHubEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const tableDescriptor: EmbedDescriptor = {
  type: "datahub",
  id: "2",
  view: "table",
  isEmbed: true,
  opts: {},
};

const content = {
  meta: { id: "2", name: "Growth curve", table_type: "xy", project_ids: [], folder_path: null, created_at: "" },
  columns: [
    { id: "c1", name: "time_h", role: "x", dataType: "number" },
    { id: "c2", name: "od600", role: "y", dataType: "number" },
  ],
  rows: [
    { id: "r1", cells: { c1: 0, c2: 0.04 } },
    { id: "r2", cells: { c1: 2, c2: 0.11 } },
  ],
  analyses: [],
  plots: [],
};

describe("DataHubEmbed", () => {
  it("renders a table preview with caption, dims, and cells", async () => {
    getContent.mockResolvedValue(content);
    render(<DataHubEmbed descriptor={tableDescriptor} caption="Growth curve" basePath="" />);
    await waitFor(() => expect(screen.getByText("time_h")).toBeInTheDocument());
    expect(screen.getByText("od600")).toBeInTheDocument();
    expect(screen.getByText("0.04")).toBeInTheDocument();
    expect(screen.getByText(/2 rows × 2 cols/)).toBeInTheDocument();
  });

  it("falls back to the generic card for a non-table view (plot)", async () => {
    getContent.mockResolvedValue(content);
    render(
      <DataHubEmbed
        descriptor={{ ...tableDescriptor, view: "plot" }}
        caption="OD over time"
        basePath=""
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/datahub?doc=2"),
    );
    expect(screen.queryByText("time_h")).toBeNull();
  });

  it("falls back to the card when the doc is gone", async () => {
    getContent.mockResolvedValue(null);
    render(<DataHubEmbed descriptor={tableDescriptor} caption="Gone" basePath="" />);
    await waitFor(() => expect(screen.getByText("Gone")).toBeInTheDocument());
    expect(screen.queryByText("time_h")).toBeNull();
  });

  it("renders the verdict + stats for a computed result view", async () => {
    getContent.mockResolvedValue({
      ...content,
      analyses: [{ id: "a3", type: "ttest", name: "Welch t-test", resultCache: { ok: true, kind: "ttest" } }],
    });
    render(
      <DataHubEmbed
        descriptor={{ ...tableDescriptor, view: "result", opts: { analysis: "a3" } }}
        caption="Welch t-test"
        basePath=""
      />,
    );
    await waitFor(() => expect(screen.getByText(/A differs from B/)).toBeInTheDocument());
    expect(screen.getByText(/4\.21/)).toBeInTheDocument();
  });

  it("falls back to the card when the result has not been computed", async () => {
    getContent.mockResolvedValue({
      ...content,
      analyses: [{ id: "a3", type: "ttest", name: "Welch t-test", resultCache: null }],
    });
    render(
      <DataHubEmbed
        descriptor={{ ...tableDescriptor, view: "result", opts: { analysis: "a3" } }}
        caption="Not run"
        basePath=""
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/datahub?doc=2"),
    );
    expect(screen.queryByText(/A differs from B/)).toBeNull();
  });
});
