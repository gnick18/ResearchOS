// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const getMethod = vi.fn();
vi.mock("@/lib/local-api", () => ({
  methodsApi: { get: (...a: unknown[]) => getMethod(...a) },
  filesApi: { readFile: vi.fn().mockResolvedValue({ content: "", path: "", sha: "", html_url: "" }) },
}));

import MethodEmbed from "./MethodEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "method",
  id: "12",
  view: "card",
  isEmbed: true,
  opts: {},
};

describe("MethodEmbed", () => {
  it("renders the method name and type badge once loaded", async () => {
    getMethod.mockResolvedValue({
      id: 12,
      name: "Gibson Assembly Protocol",
      method_type: "markdown",
      source_path: "methods/gibson/protocol.md",
      folder_path: null,
      parent_method_id: null,
      tags: null,
      is_public: false,
      created_by: null,
      owner: "grant",
      shared_with: [],
    });
    render(<MethodEmbed descriptor={descriptor} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByText("Gibson Assembly Protocol")).toBeInTheDocument());
    expect(screen.getByText("Markdown")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Open/ })).toHaveAttribute("href", "/methods?openMethod=12");
  });

  it("shows the unavailable card when the method is gone", async () => {
    getMethod.mockResolvedValue(null);
    render(<MethodEmbed descriptor={descriptor} caption="My Method" basePath="" />);
    await waitFor(() => expect(screen.getByText("My Method")).toBeInTheDocument());
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });
});
