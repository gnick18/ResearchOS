// Bug-fix pin: two methods that happen to share a numeric `id` but belong to
// different owner namespaces (e.g. alex's private 5 and the public 5, or
// alex's 5 and morgan's 5) must both surface as distinct rows in the
// MethodPicker. The pre-fix picker keyed `methodById` and the recency
// `buildRecency` map by bare numeric id, silently shadowing one with the
// other. After the fix both maps are keyed on the composite `(owner, id)`
// produced by `methodKey`, so the picker renders one option per
// (owner, id) pair.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Method, Task } from "@/lib/types";

// jsdom does not implement Element.scrollIntoView; the picker calls it on
// highlight change and an unhandled error there derails rendering.
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
  // Shared with Lab. Neither test method belongs to "casey", so both land in
  // Shared with Lab grouped by their owner — both still render as cards,
  // which is all this composite-key regression pins.
  usersApi: {
    list: vi.fn(async () => ({ users: ["casey"], current_user: "casey" })),
  },
}));

import MethodPicker from "../MethodPicker";

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

function mockMethods(): Method[] {
  return [
    makeMethod({ id: 5, owner: "alex", name: "Alex's lysis buffer" }),
    makeMethod({ id: 5, owner: "morgan", name: "Morgan's lysis buffer" }),
  ];
}

function renderPicker() {
  // Fresh client per test so the cached fetchAllMethodsIncludingShared
  // payload from a previous case doesn't leak forward.
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

describe("MethodPicker — composite (owner, id) key", () => {
  it("surfaces both same-id different-owner methods as distinct options", async () => {
    renderPicker();

    // Both names appear — the by-id Map no longer collapses them.
    expect(await screen.findByText("Alex's lysis buffer")).toBeInTheDocument();
    expect(await screen.findByText("Morgan's lysis buffer")).toBeInTheDocument();
  });
});
