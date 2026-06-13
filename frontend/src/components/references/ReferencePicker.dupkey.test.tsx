import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ReferencePicker from "./ReferencePicker";

// jsdom has no scrollIntoView; the picker calls it on highlight/keyboard nav.
beforeEach(() => {
  // @ts-expect-error jsdom stub
  Element.prototype.scrollIntoView = vi.fn();
});

// loadData() dynamically imports these, so they must be mocked. The point of the
// test is the methods tab: a private method and a public method can share a
// numeric id (separate stores, overlapping id-spaces), which previously produced
// two React children with the same key `method-1`.
vi.mock("@/lib/chemistry/api", () => ({
  moleculesApi: { list: async () => [] },
}));
vi.mock("@/lib/datahub/api", () => ({
  dataHubApi: { list: async () => [] },
}));
vi.mock("@/lib/local-api", () => ({
  sequencesApi: { list: async () => [] },
  methodsApi: {
    list: async () => [
      { id: "1", name: "Private protocol", method_type: "general", is_public: false },
      { id: "1", name: "Public protocol", method_type: "general", is_public: true },
    ],
  },
}));

describe("ReferencePicker duplicate-key guard", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("keys private and public methods of the same id uniquely", async () => {
    render(<ReferencePicker onPick={() => {}} onClose={() => {}} />);
    // Switch to the Methods tab and wait for both rows to render.
    const methodsTab = await screen.findByRole("button", { name: /Methods/i });
    fireEvent.click(methodsTab);
    await waitFor(() => {
      expect(screen.getByText("Private protocol")).toBeTruthy();
      expect(screen.getByText("Public protocol")).toBeTruthy();
    });
    // React would log "Encountered two children with the same key" on a collision.
    const dupKeyError = errSpy.mock.calls.some((args) =>
      String(args[0] ?? "").includes("same key"),
    );
    expect(dupKeyError).toBe(false);
  });
});
