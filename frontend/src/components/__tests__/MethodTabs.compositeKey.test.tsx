// Bug-fix pin: when a task carries two method attachments that share a
// numeric `method_id` but point at methods in different owner namespaces
// (e.g. one attachment for alex's private method 5, one for the public
// method 5), clicking the second tab must NOT shadow the first. The
// pre-fix `activeMethodId: number | null` state collapsed both tabs onto
// the same numeric handle; after the fix the state is the composite
// `(owner:method_id)` `activeAttachmentKey: string | null` so each tab
// is independently selectable and the active method resolves to the
// correct owner's record.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Method, Task, TaskMethodAttachment } from "@/lib/types";

const allMethods: Method[] = [
  makeMethod({ id: 5, owner: "alex", name: "Alex's lysis buffer" }),
  makeMethod({ id: 5, owner: "public", name: "Public lysis buffer" }),
];

vi.mock("@/lib/local-api", () => ({
  fetchAllMethodsIncludingShared: vi.fn(async () => allMethods),
  // MethodTabs imports MethodPicker, which in turn pulls these in for its
  // recency + preview panels. Stub them out so the picker mounts cleanly
  // even though this test never opens it.
  fetchAllTasks: vi.fn(async () => []),
  filesApi: { readFile: vi.fn(async () => ({ content: "" })) },
}));

// Stub the API surface so MethodTabs renders without hitting fileService /
// IndexedDB. We don't exercise add/remove in this test.
vi.mock("@/lib/tasks/owner-scoped-api", () => ({
  ownerScopedTasksApi: () => ({
    addMethod: vi.fn(),
    removeMethod: vi.fn(),
  }),
}));

// Replace every per-type viewer with a single text marker that includes
// the method's owner — that lets the assertion confirm which of the two
// same-id methods is active without depending on the real markdown /
// markdown-fork heavy viewer bundles.
function makeStub(label: string) {
  const Stub = ({ method }: { method: Method }) => (
    <div data-testid={`stub-${label}`}>
      {label} | owner:{method.owner} | id:{method.id} | name:{method.name}
    </div>
  );
  Stub.displayName = `Stub(${label})`;
  return Stub;
}
vi.mock("../methods/MarkdownMethodTabContent", () => ({ default: makeStub("markdown") }));
vi.mock("../methods/PdfMethodTabContent", () => ({ default: makeStub("pdf") }));
vi.mock("../methods/PcrMethodTabContent", () => ({ default: makeStub("pcr") }));
vi.mock("../methods/LcMethodTabContent", () => ({ default: makeStub("lc") }));
vi.mock("../methods/PlateMethodTabContent", () => ({ default: makeStub("plate") }));
vi.mock("../methods/CellCultureMethodTabContent", () => ({ default: makeStub("cellculture") }));
vi.mock("../methods/MassSpecMethodTabContent", () => ({ default: makeStub("ms") }));
vi.mock("../methods/CompoundMethodTabContent", () => ({ default: makeStub("compound") }));
vi.mock("../methods/CodingWorkflowMethodTabContent", () => ({ default: makeStub("coding") }));
vi.mock("../methods/QpcrAnalysisMethodTabContent", () => ({ default: makeStub("qpcr") }));
vi.mock("../methods/WrapAsCompoundAction", () => ({
  WrapAsCompoundAction: () => null,
}));

import MethodTabs from "../MethodTabs";

function makeMethod(partial: Partial<Method> & { id: number; owner: string; name: string }): Method {
  return {
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: partial.owner === "public",
    created_by: null,
    shared_with: [],
    ...partial,
  };
}

function makeAttachment(
  partial: Partial<TaskMethodAttachment> & { method_id: number },
): TaskMethodAttachment {
  return {
    owner: null,
    pcr_gradient: null,
    pcr_ingredients: null,
    lc_gradient: null,
    body_override: null,
    plate_annotation: null,
    cell_culture_schedule: null,
    variation_notes: null,
    compound_snapshots: null,
    qpcr_analysis: null,
    ...partial,
  };
}

function makeTask(): Task {
  return {
    id: 1,
    project_id: 1,
    name: "Two-buffer experiment",
    start_date: "2026-05-20",
    duration_days: 1,
    end_date: "2026-05-20",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [5, 5],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [
      // Same numeric id, two different owners — the collision that the
      // bare-id state shape silently shadowed.
      makeAttachment({ method_id: 5, owner: "alex" }),
      makeAttachment({ method_id: 5, owner: "public" }),
    ],
    owner: "alex",
    shared_with: [],
  };
}

function renderTabs() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MethodTabs task={makeTask()} />
    </QueryClientProvider>,
  );
}

describe("MethodTabs — composite (owner:method_id) active key", () => {
  it("renders two distinct tabs and lets the user switch between same-id different-owner attachments", async () => {
    renderTabs();

    // Initial state: first attachment (alex) is active. The stub renders
    // the owner+id so we can read which method resolved.
    expect(await screen.findByTestId("stub-markdown")).toHaveTextContent(
      "owner:alex",
    );

    // Both tabs visible. Each tab labels itself with the method name from
    // its resolved owner, so two distinct labels appear even though
    // method_id is the same on both.
    const rail = screen.getByTestId("method-tab-rail");
    const alexTab = within(rail).getByText("Alex's lysis buffer");
    const publicTab = within(rail).getByText("Public lysis buffer");
    expect(alexTab).toBeInTheDocument();
    expect(publicTab).toBeInTheDocument();

    // Click the public tab — the active method should now resolve to the
    // public-owner method, NOT collapse back to alex's just because
    // method_id is the same.
    fireEvent.click(publicTab);
    expect(await screen.findByTestId("stub-markdown")).toHaveTextContent(
      "owner:public",
    );

    // Click alex's tab again — switches back, no shadowing.
    fireEvent.click(alexTab);
    expect(await screen.findByTestId("stub-markdown")).toHaveTextContent(
      "owner:alex",
    );
  });
});
