// Method Picker FLAG B (excerpt-field sub-bot of HR): MethodCard prefers the
// persisted `method.excerpt` for its hero, falling back to the lazy file-read
// (when active) and finally the type-registry resting summary when absent.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Method } from "@/lib/types";

beforeAll(() => {
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// The fallback path reads the body via filesApi.readFile; mock it so the
// absent-excerpt case can exercise the lazy read deterministically.
const readFileMock = vi.fn(async (_path: string) => ({
  content: "Lazy-read body line from the source file.",
}));
vi.mock("@/lib/local-api", () => ({
  filesApi: { readFile: (path: string) => readFileMock(path) },
}));

import MethodCard from "../MethodCard";

function makeMethod(partial: Partial<Method> & { id: number }): Method {
  return {
    name: "Test Method",
    source_path: "methods/test/test.md",
    method_type: "markdown",
    folder_path: "Methods",
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: null,
    owner: "alex",
    shared_with: [],
    ...partial,
  };
}

function renderCard(method: Method, isActive = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MethodCard
        method={method}
        forkChildren={new Map()}
        attachedKeys={new Set()}
        isActive={isActive}
        isHighlighted={false}
        expandedForks={new Set()}
        onAttach={() => {}}
        onHighlight={() => {}}
        onToggleForks={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("MethodCard — excerpt hero", () => {
  it("renders the persisted excerpt when present and skips the file read", async () => {
    renderCard(
      makeMethod({ id: 1, excerpt: "Stamped preview from the saved field." }),
    );
    expect(
      await screen.findByText("Stamped preview from the saved field."),
    ).toBeInTheDocument();
    // Persisted excerpt means no lazy read fires, even with no active state.
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("falls back to the lazy file read for the active card when excerpt is absent", async () => {
    renderCard(makeMethod({ id: 2, excerpt: undefined }), /* isActive */ true);
    expect(
      await screen.findByText("Lazy-read body line from the source file."),
    ).toBeInTheDocument();
    expect(readFileMock).toHaveBeenCalled();
  });

  it("falls back to the structured resting summary when excerpt is absent and not active", async () => {
    renderCard(
      makeMethod({
        id: 3,
        excerpt: undefined,
        method_type: "pcr",
        source_path: "pcr://protocol/3",
      }),
    );
    expect(
      await screen.findByText("Thermocycler program and reaction recipe."),
    ).toBeInTheDocument();
  });
});
