/**
 * LabSearchPanel cache-driven filter (Lab search fix manager, 2026-05-22).
 *
 * Before this fix, LabSearchPanel called `labApi.search()` directly,
 * which read the user's REAL on-disk lab folder via the file-system
 * service. Inside DemoLabModeViewer that bypassed the demo viewer's
 * scoped React Query cache entirely — typing a keyword returned 0
 * results even when the seeded demo bundle had matches. The fix
 * refactors the panel to filter the already-cached `["lab","tasks"]`
 * / `["lab","projects"]` / `["lab","methods"]` query data client-side.
 *
 * This test seeds a fresh QueryClient with mock LabTask/Project/Method
 * data, mounts the panel directly under the QueryClientProvider, types
 * a keyword, presses Enter, and asserts the matching task surfaces.
 * Mirrors the demo viewer's wiring (which seeds the same query keys)
 * so a regression here would map straight back to the "qPCR returns 0
 * results in the demo" bug.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LabTask, LabProject, LabMethod, LabUser } from "@/lib/local-api";

// `useCurrentUser` reaches into FileSystemProvider; we don't have one
// in jsdom and the panel only uses `currentUser` as an export attribution
// string, so stub it.
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    currentUser: "alex",
    setCurrentUser: () => {},
    mainUser: "alex",
    availableUsers: ["alex"],
    createUser: async () => {},
    isLoggedIn: true,
  }),
}));

// ExportFormatDialog and the orchestrator pull in zip/FSA machinery
// that's heavy for this test (which never opens the export flow). Stub
// to a no-op.
vi.mock("@/components/ExportFormatDialog", () => ({
  default: () => null,
}));
vi.mock("@/lib/export/orchestrate", () => ({
  exportExperiments: vi.fn(),
  exportExperimentsToFile: vi.fn(),
  downloadResult: vi.fn(),
  estimateMultiExportSize: vi.fn(async () => null),
}));

import LabSearchPanel from "../LabSearchPanel";

function makeUser(username: string, color: string): LabUser {
  return {
    username,
    color,
    color_secondary: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function makeTask(
  partial: Partial<LabTask> & { id: number; name: string; username: string },
): LabTask {
  return {
    id: partial.id,
    name: partial.name,
    project_id: partial.project_id ?? 1,
    start_date: partial.start_date ?? "2026-04-01",
    duration_days: partial.duration_days ?? 3,
    end_date: partial.end_date ?? "2026-04-03",
    is_complete: partial.is_complete ?? false,
    task_type: partial.task_type ?? "experiment",
    username: partial.username,
    user_color: partial.user_color ?? "#3b82f6",
    user_color_secondary: partial.user_color_secondary ?? null,
    experiment_color: partial.experiment_color ?? null,
    method_ids: partial.method_ids ?? [],
    notes: partial.notes ?? null,
  };
}

/**
 * When the keyword matches, the panel wraps the matched substring in a
 * `<mark>` element, so the full task name spans multiple DOM nodes
 * (`<>head<mark>qPCR</mark>tail</>`). Plain `getByText` can't see across
 * that split. This matcher rebuilds the visible text of any element and
 * tests against the joined form.
 */
function byTextContent(needle: string) {
  return (_content: string, element: Element | null): boolean => {
    if (!element) return false;
    const haystack = (element.textContent ?? "").trim();
    if (!haystack.includes(needle)) return false;
    // Reject parent elements whose text only matches via a child — we
    // want the most-specific element so the assertion is unique.
    const childMatch = Array.from(element.children).some((c) =>
      (c.textContent ?? "").includes(needle),
    );
    return !childMatch;
  };
}

/**
 * The LabSearchPanel's `<label>`/`<select>` pairs aren't associated via
 * `for`/`id`, so `getByLabelText` doesn't find the form control. The
 * cleanest workaround for tests is to look up the select by the text of
 * its placeholder option (e.g. "All Selected Users" or "All Types"),
 * which uniquely identifies each select in the panel.
 */
function findSelectByPlaceholder(
  container: HTMLElement,
  placeholderText: string,
): HTMLSelectElement {
  const selects = Array.from(container.querySelectorAll("select"));
  for (const sel of selects) {
    const firstOption = sel.querySelector("option");
    if (firstOption?.textContent?.trim() === placeholderText) {
      return sel as HTMLSelectElement;
    }
  }
  throw new Error(
    `No <select> with first option "${placeholderText}" found in container`,
  );
}

function renderPanel(opts: {
  tasks: LabTask[];
  projects?: LabProject[];
  methods?: LabMethod[];
  users?: LabUser[];
  methodFolders?: string[];
  selectedUsernames?: Set<string>;
}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
      },
    },
  });
  client.setQueryData(["lab", "users"], opts.users ?? [makeUser("alex", "#3b82f6")]);
  client.setQueryData(["lab", "tasks"], opts.tasks);
  client.setQueryData(["lab", "projects"], opts.projects ?? []);
  client.setQueryData(["lab", "methods"], opts.methods ?? []);
  client.setQueryData(["lab", "method-folders"], opts.methodFolders ?? []);

  return render(
    <QueryClientProvider client={client}>
      <LabSearchPanel
        selectedUsernames={
          opts.selectedUsernames ?? new Set(["alex", "morgan"])
        }
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Make sure the panel never reaches a real fetch path.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("LabSearchPanel should not hit fetch — cache-only");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LabSearchPanel — reads from React Query cache, not labApi", () => {
  it("returns matching tasks for a keyword from the seeded cache", () => {
    const tasks: LabTask[] = [
      makeTask({ id: 1, name: "qPCR primer validation", username: "alex" }),
      makeTask({ id: 2, name: "qPCR clean-up", username: "morgan" }),
      makeTask({ id: 3, name: "Unrelated cell culture", username: "alex" }),
    ];
    renderPanel({
      tasks,
      users: [makeUser("alex", "#3b82f6"), makeUser("morgan", "#10b981")],
    });

    const input = screen.getByPlaceholderText(/search by name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "qPCR" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

    // The cache contained 2 qPCR tasks across two demo users; the
    // unrelated cell-culture task must NOT surface. This is the
    // regression the demo-bundle bug-fix was filed against.
    expect(screen.getByText(byTextContent("qPCR primer validation"))).toBeInTheDocument();
    expect(screen.getByText(byTextContent("qPCR clean-up"))).toBeInTheDocument();
    expect(screen.queryByText(byTextContent("Unrelated cell culture"))).not.toBeInTheDocument();
    // "2 results found" — exact count.
    expect(screen.getByText(/2 results found/i)).toBeInTheDocument();
  });

  it("respects the user dropdown narrowing (filters.username overrides selectedUsernames)", () => {
    const tasks: LabTask[] = [
      makeTask({ id: 1, name: "qPCR primer validation", username: "alex" }),
      makeTask({ id: 2, name: "qPCR clean-up", username: "morgan" }),
    ];
    const { container } = renderPanel({
      tasks,
      users: [makeUser("alex", "#3b82f6"), makeUser("morgan", "#10b981")],
    });

    // Pick the morgan-only filter from the User dropdown. The labels
    // aren't associated to selects via `for/id`, so grab the select by
    // its placeholder option text.
    const userSelect = findSelectByPlaceholder(container, "All Selected Users");
    fireEvent.change(userSelect, { target: { value: "morgan" } });

    const input = screen.getByPlaceholderText(/search by name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "qPCR" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

    expect(screen.queryByText(byTextContent("qPCR primer validation"))).not.toBeInTheDocument();
    expect(screen.getByText(byTextContent("qPCR clean-up"))).toBeInTheDocument();
    expect(screen.getByText(/1 result found/i)).toBeInTheDocument();
  });

  it("filters by task_type", () => {
    const tasks: LabTask[] = [
      makeTask({ id: 1, name: "qPCR experiment", username: "alex", task_type: "experiment" }),
      makeTask({ id: 2, name: "qPCR reagent order", username: "alex", task_type: "purchase" }),
    ];
    const { container } = renderPanel({ tasks });

    const typeSelect = findSelectByPlaceholder(container, "All Types");
    fireEvent.change(typeSelect, { target: { value: "experiment" } });

    const input = screen.getByPlaceholderText(/search by name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "qPCR" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

    expect(screen.getByText(byTextContent("qPCR experiment"))).toBeInTheDocument();
    expect(screen.queryByText(byTextContent("qPCR reagent order"))).not.toBeInTheDocument();
  });

  it("matches keyword in deviation_log (notes) too", () => {
    const tasks: LabTask[] = [
      makeTask({
        id: 1,
        name: "Plate prep",
        username: "alex",
        notes: "had to redo because qPCR plate cracked",
      }),
      makeTask({ id: 2, name: "Buffer swap", username: "alex", notes: null }),
    ];
    renderPanel({ tasks });

    const input = screen.getByPlaceholderText(/search by name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "qPCR" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

    expect(screen.getByText("Plate prep")).toBeInTheDocument();
    expect(screen.queryByText("Buffer swap")).not.toBeInTheDocument();
  });

  it("with empty keyword and no other filters, returns every cached task", () => {
    const tasks: LabTask[] = [
      makeTask({ id: 1, name: "Task A", username: "alex" }),
      makeTask({ id: 2, name: "Task B", username: "morgan" }),
    ];
    renderPanel({ tasks });

    const searchButton = screen.getByRole("button", { name: /^Search$/i });
    fireEvent.click(searchButton);

    expect(screen.getByText("Task A")).toBeInTheDocument();
    expect(screen.getByText("Task B")).toBeInTheDocument();
  });
});
