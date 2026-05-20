import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

vi.mock("@/lib/local-api", () => ({
  filesApi: { writeFile: vi.fn() },
  methodsApi: { create: vi.fn() },
  projectsApi: { create: vi.fn() },
  tasksApi: { create: vi.fn(), addMethod: vi.fn(), get: vi.fn() },
}));

// Force the typewriter to resolve in one microtask so tests don't have to
// wait on the 95ms cadence. The component imports the hook from
// `./lib/use-typewriter`, so mock that exact module path.
vi.mock("../lib/use-typewriter", () => ({
  useTypewriter: (source: string) => ({
    revealed: source,
    done: true,
  }),
}));

import W5HybridEditorTourStep from "../W5HybridEditorTourStep";

function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    ...patch,
  };
}

describe("W5HybridEditorTourStep", () => {
  it("renders the full demo script (bold/italic/code/quote/heading) and logs the hybrid_edit artifact", async () => {
    let sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W5",
        skipped_steps: [],
        artifacts_created: [
          { type: "experiment", id: "200", cleanup_default: "keep" },
        ],
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <W5HybridEditorTourStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    // Each demo step caption renders.
    expect(screen.getByText("Bold")).toBeInTheDocument();
    expect(screen.getByText("Italic")).toBeInTheDocument();
    expect(screen.getByText("Code block")).toBeInTheDocument();
    expect(screen.getByText("Block quote")).toBeInTheDocument();
    expect(screen.getByText("Heading 2")).toBeInTheDocument();

    // The hidden full-script element carries the canonical end state.
    const fullScript = document.querySelector("[data-w5-full-script]");
    expect(fullScript).not.toBeNull();
    expect(fullScript?.textContent).toContain("**blockbuster bold**");
    expect(fullScript?.textContent).toContain("*italicized prose*");
    expect(fullScript?.textContent).toContain("```python");
    expect(fullScript?.textContent).toContain("Methods are recipes");
    expect(fullScript?.textContent).toContain("## Sub-heading");

    // The component cascades through 5 demos with a 500ms gap between each
    // (the typewriter mock resolves each one synchronously), so the artifact
    // log fires roughly 2 seconds after mount. Bump waitFor's default 1s
    // timeout to cover the worst-case cascade.
    await waitFor(
      () => {
        expect(
          sidecar.wizard_resume_state?.artifacts_created.find(
            (a) => a.type === "hybrid_edit",
          ),
        ).toEqual({
          type: "hybrid_edit",
          id: "200",
          cleanup_default: "keep",
        });
      },
      { timeout: 5000 },
    );
  });
});
