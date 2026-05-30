// frontend/src/components/methods/MethodTypeCategoryPicker.test.tsx
//
// Extension Store Phase A (store-declutter bot): the New Method builder must
// show ONLY the method types the account has enabled. The mechanism is a prop
// contract on MethodTypeCategoryPicker:
//
//   - `enabledTypes` supplied WITHOUT `onEnableType`  => disabled types are
//     filtered out of the picker entirely (no muted "Enable" tiles).
//   - `enabledTypes` supplied WITH `onEnableType`     => disabled types stay
//     visible in a muted "Disabled in your library" state with an inline
//     Enable button. The library modal relies on this branch, so it must keep
//     working even though the builder no longer reaches it.
//
// These two cases are the regression guard for the declutter change.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MethodTypeCategoryPicker } from "./MethodTypePicker";

describe("MethodTypeCategoryPicker enablement filtering", () => {
  it("hides disabled types entirely when enabledTypes is set without onEnableType", () => {
    // Only Markdown (standard) and PCR (structured) enabled. Everything else
    // is disabled and must not render at all in the builder.
    render(
      <MethodTypeCategoryPicker
        uploadType="markdown"
        onSelect={() => {}}
        enabledTypes={["markdown", "pcr"]}
      />,
    );

    // Enabled types render.
    expect(screen.getByText("Markdown")).toBeInTheDocument();
    expect(screen.getByText("PCR")).toBeInTheDocument();

    // Disabled types are gone — no tile, no muted placeholder.
    expect(screen.queryByText("PDF")).not.toBeInTheDocument();
    expect(screen.queryByText("Mass spec")).not.toBeInTheDocument();
    expect(screen.queryByText("Plate Layout")).not.toBeInTheDocument();
    expect(screen.queryByText("Cell culture passaging")).not.toBeInTheDocument();

    // The "Enable" affordance and its muted caption are absent without
    // onEnableType.
    expect(screen.queryByText("Disabled in your library")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Enable$/ })).not.toBeInTheDocument();
  });

  it("keeps disabled types visible with an Enable affordance when onEnableType is supplied (library path)", () => {
    const onEnableType = vi.fn();
    render(
      <MethodTypeCategoryPicker
        uploadType="markdown"
        onSelect={() => {}}
        enabledTypes={["markdown"]}
        onEnableType={onEnableType}
      />,
    );

    // The enabled type is still a tile.
    expect(screen.getAllByText("Markdown").length).toBeGreaterThan(0);
    // A disabled type now stays, shown muted with the Enable affordance.
    expect(screen.getAllByText("PDF").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Disabled in your library").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Enable$/ }).length).toBeGreaterThan(0);
  });
});
