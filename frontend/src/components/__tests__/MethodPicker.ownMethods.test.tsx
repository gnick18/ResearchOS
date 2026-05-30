// Bug-fix pin (2026-05-26, method-picker sub-bot): the §6.4d walkthrough
// authors a "funny markdown method" that §6.6c's attach demo then pins
// to the just-created experiment. After fix, the picker MUST show that
// own-private method alongside any public methods the lab seeded. The
// fresh-user repro had the picker showing only 3 public method PDFs
// (NEBuilder / Qubit / Trichoderma) because no own method had been
// written; the bug was in the cursor typing loop (BeakerBotCursor
// dropped chars after a mid-typing unmount), which meant the markdown
// body stayed empty and the Create button stayed disabled. This test
// pins the picker contract: when the user's own + public method
// stores both have entries, both surface as rows.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Method, Task } from "@/lib/types";

beforeAll(() => {
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

vi.mock("@/lib/local-api", () => ({
  fetchAllTasks: vi.fn(async () => [] as Task[]),
  fetchAllMethodsIncludingShared: vi.fn(async () => mockMethods()),
  filesApi: { readFile: vi.fn(async () => ({ content: "" })) },
  // The redesigned picker reads the current user to split My Methods from
  // Shared with Lab. The §6.4d funny method is authored by Test_Walkthrough,
  // so that user owns it and it lands in My Methods.
  usersApi: {
    list: vi.fn(async () => ({
      users: ["Test_Walkthrough"],
      current_user: "Test_Walkthrough",
    })),
  },
}));

import MethodPicker from "../MethodPicker";

function makeMethod(
  partial: Partial<Method> & { id: number; owner: string; name: string },
): Method {
  return {
    source_path: null,
    method_type: "markdown",
    folder_path: partial.folder_path ?? null,
    parent_method_id: null,
    tags: null,
    is_public: partial.owner === "public",
    created_by: null,
    shared_with: [],
    ...partial,
  };
}

function mockMethods(): Method[] {
  // Mirrors the §6.6 repro shape: three lab-shared public methods plus
  // the one own-private markdown method §6.4d just authored.
  return [
    makeMethod({
      id: 17,
      owner: "public",
      name: "NEBuilder PDF",
      folder_path: "Molecular Biology",
      method_type: "pdf",
    }),
    makeMethod({
      id: 18,
      owner: "public",
      name: "Qubit HS Assay Kit PDF",
      folder_path: "Molecular Biology",
      method_type: "pdf",
    }),
    makeMethod({
      id: 19,
      owner: "public",
      name: "Transformation of Trichoderma Asperellum PDF",
      folder_path: "Molecular Biology",
      method_type: "pdf",
    }),
    makeMethod({
      id: 21,
      owner: "Test_Walkthrough",
      name: "BeakerBot's Patent-Pending Coffee Brewing Protocol",
      folder_path: "Methods",
      method_type: "markdown",
    }),
  ];
}

function renderPicker() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MethodPicker
        open
        currentMethodId={null}
        onSelect={() => {}}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("MethodPicker — own + public methods", () => {
  it("shows the user's own-private method alongside lab-shared public ones", async () => {
    renderPicker();

    // The own markdown method (§6.4d-authored funny coffee protocol)
    // and all three public methods land as distinct rows.
    expect(
      await screen.findByText(
        "BeakerBot's Patent-Pending Coffee Brewing Protocol",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText("NEBuilder PDF")).toBeInTheDocument();
    expect(
      await screen.findByText("Qubit HS Assay Kit PDF"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Transformation of Trichoderma Asperellum PDF",
      ),
    ).toBeInTheDocument();
  });

  it("renders the §6.4d own method above the lab-shared library", async () => {
    renderPicker();

    // The redesigned picker splits the rail into "My Methods" (own work,
    // grouped by folder) and "Shared with Lab" (everything public / shared,
    // grouped by owner). Test_Walkthrough owns the coffee protocol, so it
    // lands under My Methods; the three public PDFs land under Shared with
    // Lab. The My Methods section header therefore renders before the
    // Shared with Lab one, so the user sees their own work at the top.
    const ownSection = await screen.findByText("My Methods");
    const sharedSection = await screen.findByText("Shared with Lab");
    const ownComesFirst =
      (ownSection.compareDocumentPosition(sharedSection) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;
    expect(ownComesFirst).toBe(true);

    // The own method's folder header (its category) still appears inside
    // My Methods. Scope to the card grid so the match is the rail folder
    // header, not the preview pane's folder_path label for the same method.
    const grid = await screen.findByRole("grid", { name: "Method library" });
    expect(within(grid).getByText("Methods")).toBeInTheDocument();
  });
});
