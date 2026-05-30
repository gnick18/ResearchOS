import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProtocolTemplateCard } from "./MethodTemplateLibraryModal";
import type { MethodCatalogManifestEntry } from "@/lib/methods/method-catalog";

/**
 * Browse-list CARD gating (kit-card-gate bot, 2026-05-30).
 *
 * Regression guard: a kit (compound) card must NOT expose an inline "Use"
 * affordance. The card holds only the manifest entry, not the fetched payload,
 * so it cannot know the kit's component types; its per-type gate would key off
 * the "compound" method type, which is ALWAYS enabled (the ALWAYS_ENABLED
 * carve-out), so an inline Use would always fire and bypass the detail pane's
 * correct component-type gate. The kit card therefore routes to the detail
 * ("View kit") instead. Single-type cards keep their inline Use + per-type gate.
 *
 * No live compound combination entry exists in the catalog yet (the catalog
 * session lands the LC-MS kit manifest entries in a follow-up), so the compound
 * entry here is an in-test fixture standing in for the live catalog.
 */

const singleTypeEntry: MethodCatalogManifestEntry = {
  slug: "pcr-colony",
  title: "Colony PCR",
  description: "Quick screen.",
  category: "Molecular biology",
  method_type: "pcr",
  tags: ["screening"],
};

const kitEntry: MethodCatalogManifestEntry = {
  slug: "lcms-peptide-combo-thermo",
  title: "Peptide LC-MS (kit)",
  description: "Full peptide LC-MS kit.",
  category: "LC-MS",
  method_type: "compound",
};

afterEach(cleanup);

describe("ProtocolTemplateCard kit gating", () => {
  it("kit card offers no gating-bypassing inline Use, only View kit which opens the detail", () => {
    const onUse = vi.fn();
    const onViewKit = vi.fn();
    render(
      <ProtocolTemplateCard
        entry={kitEntry}
        // "compound" is always-enabled, so the old card would have shown an
        // inline Use here. That is exactly the bypass we are guarding against.
        typeEnabled
        isUsing={false}
        anyUsing={false}
        onUse={onUse}
        onEnableType={vi.fn()}
        isKit
        onViewKit={onViewKit}
      />,
    );

    // No inline Use (or "Adding...") on the kit card: the gate lives in detail.
    expect(screen.queryByText("Use template")).not.toBeInTheDocument();
    expect(screen.queryByText("Adding...")).not.toBeInTheDocument();

    // The only action routes to the detail pane.
    const viewKit = screen.getByText("View kit");
    fireEvent.click(viewKit);
    expect(onViewKit).toHaveBeenCalled();
    expect(onUse).not.toHaveBeenCalled();
  });

  it("single-type card keeps its inline Use when the type is enabled", () => {
    const onUse = vi.fn();
    render(
      <ProtocolTemplateCard
        entry={singleTypeEntry}
        typeEnabled
        isUsing={false}
        anyUsing={false}
        onUse={onUse}
        onEnableType={vi.fn()}
      />,
    );

    expect(screen.queryByText("View kit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Use template"));
    expect(onUse).toHaveBeenCalled();
  });

  it("single-type card gates to Enable <type> when the type is disabled", () => {
    const onUse = vi.fn();
    const onEnableType = vi.fn();
    render(
      <ProtocolTemplateCard
        entry={singleTypeEntry}
        typeEnabled={false}
        isUsing={false}
        anyUsing={false}
        onUse={onUse}
        onEnableType={onEnableType}
      />,
    );

    expect(screen.queryByText("Use template")).not.toBeInTheDocument();
    expect(screen.getByText("Type disabled")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Enable PCR"));
    expect(onEnableType).toHaveBeenCalled();
    expect(onUse).not.toHaveBeenCalled();
  });
});
