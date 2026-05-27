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
import { render, screen } from "@testing-library/react";
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

  it("renders the §6.4d own method first when it sits in its own folder", async () => {
    renderPicker();

    // The picker groups by folder_path; "Methods" sorts before
    // "Molecular Biology" alphabetically, so the own-folder header
    // appears before the public-folder header. The user therefore
    // sees their own work at the top of the picker, not buried
    // below the lab-shared library.
    const ownHeader = await screen.findByText("Methods");
    const publicHeader = await screen.findByText("Molecular Biology");
    const ownDocPosition = (ownHeader.compareDocumentPosition(publicHeader) &
      Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(ownDocPosition).toBe(true);
  });
});
