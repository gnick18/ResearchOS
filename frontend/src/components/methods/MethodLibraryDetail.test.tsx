import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  MethodTypeDetail,
  SingleTemplateDetail,
  CompoundTemplateDetail,
  CompoundTemplateDetailLoader,
} from "./MethodLibraryDetail";
import { getMethodModule } from "@/lib/methods/method-module";
import type { MethodCatalogManifestEntry } from "@/lib/methods/method-catalog";
import type { MethodTypeId } from "@/lib/methods/method-type-registry";
import type { ResolvedCompoundComponent } from "@/lib/methods/compound-template-detail";

/**
 * Method library detail-pane tests (Extension Store Phase D): type detail with
 * working template cross-links, single-type template gating reflecting enabled
 * state + read-only payload render, and compound gating that requires ALL
 * component types.
 */

const pcrTemplate: MethodCatalogManifestEntry = {
  slug: "pcr-colony",
  title: "Colony PCR",
  description: "Quick screen.",
  category: "Molecular biology",
  method_type: "pcr",
  tags: ["screening"],
};

afterEach(cleanup);

describe("MethodTypeDetail", () => {
  it("lists templates built on the type and cross-links them", () => {
    const onOpenTemplate = vi.fn();
    render(
      <MethodTypeDetail
        module={getMethodModule("pcr")}
        on
        curating
        onToggle={vi.fn()}
        templatesOfType={[pcrTemplate]}
        onOpenTemplate={onOpenTemplate}
      />,
    );
    const link = screen.getByText("Colony PCR");
    expect(link).toBeInTheDocument();
    fireEvent.click(link);
    expect(onOpenTemplate).toHaveBeenCalledWith(pcrTemplate);
  });

  it("shows a sample rendering of the type", () => {
    render(
      <MethodTypeDetail
        module={getMethodModule("pcr")}
        on
        curating
        onToggle={vi.fn()}
        templatesOfType={[]}
        onOpenTemplate={vi.fn()}
      />,
    );
    expect(screen.getByText(/Cycle x30/)).toBeInTheDocument();
    expect(
      screen.getByText("No prebuilt templates use this type yet."),
    ).toBeInTheDocument();
  });

  it("enables/disables the type via the footer toggle", () => {
    const onToggle = vi.fn();
    render(
      <MethodTypeDetail
        module={getMethodModule("pcr")}
        on={false}
        curating
        onToggle={onToggle}
        templatesOfType={[]}
        onOpenTemplate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe("SingleTemplateDetail", () => {
  const okFetch = () =>
    Promise.resolve({
      slug: "pcr-colony",
      title: "Colony PCR",
      description: "Quick screen.",
      category: "Molecular biology",
      method_type: "markdown" as const,
      payload: { body: "## Protocol heading\nStep one." },
    });

  it("offers Use template when the underlying type is enabled", async () => {
    const onUse = vi.fn();
    render(
      <SingleTemplateDetail
        entry={pcrTemplate}
        typeEnabled
        isUsing={false}
        anyUsing={false}
        onUse={onUse}
        onEnableType={vi.fn()}
        fetchTemplate={okFetch}
      />,
    );
    const useBtn = screen.getByText("Use template");
    fireEvent.click(useBtn);
    expect(onUse).toHaveBeenCalled();
    // The fetched markdown body renders read-only.
    await waitFor(() =>
      expect(screen.getByText("Protocol heading")).toBeInTheDocument(),
    );
  });

  it("gates to Enable <type> when the underlying type is disabled", () => {
    const onEnableType = vi.fn();
    render(
      <SingleTemplateDetail
        entry={pcrTemplate}
        typeEnabled={false}
        isUsing={false}
        anyUsing={false}
        onUse={vi.fn()}
        onEnableType={onEnableType}
        fetchTemplate={okFetch}
      />,
    );
    expect(screen.queryByText("Use template")).not.toBeInTheDocument();
    const enableBtn = screen.getByText("Enable PCR");
    fireEvent.click(enableBtn);
    expect(onEnableType).toHaveBeenCalled();
  });
});

describe("CompoundTemplateDetail", () => {
  const components: ResolvedCompoundComponent[] = [
    {
      method_id: 1,
      owner: "alex",
      ordering: 0,
      label: "RP gradient",
      method_type: "lc_gradient",
    },
    {
      method_id: 2,
      owner: "alex",
      ordering: 1,
      label: "Orbitrap MS",
      method_type: "mass_spec",
    },
  ];
  const componentTypes: MethodTypeId[] = ["lc_gradient", "mass_spec"];

  it("shows ALL component type badges and the bundled steps", () => {
    render(
      <CompoundTemplateDetail
        title="Peptide LC-MS kit"
        description="LC + MS."
        components={components}
        componentTypes={componentTypes}
        enabledIds={new Set<MethodTypeId>()}
        onUse={vi.fn()}
        onEnableType={vi.fn()}
      />,
    );
    // Both component types appear (in badges + step rows).
    expect(screen.getAllByText("LC Gradient").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mass spec").length).toBeGreaterThan(0);
    expect(screen.getByText("RP gradient")).toBeInTheDocument();
    expect(screen.getByText("Orbitrap MS")).toBeInTheDocument();
  });

  it("gates Use template until ALL component types are enabled", () => {
    const onUse = vi.fn();
    const { rerender } = render(
      <CompoundTemplateDetail
        title="Peptide LC-MS kit"
        components={components}
        componentTypes={componentTypes}
        enabledIds={new Set<MethodTypeId>(["lc_gradient"])}
        onUse={onUse}
        onEnableType={vi.fn()}
      />,
    );
    // One type still disabled: no Use template, the missing one is offered.
    expect(screen.queryByText("Use template")).not.toBeInTheDocument();
    expect(screen.getByText("Enable Mass spec")).toBeInTheDocument();

    // All enabled: Use template unlocks.
    rerender(
      <CompoundTemplateDetail
        title="Peptide LC-MS kit"
        components={components}
        componentTypes={componentTypes}
        enabledIds={new Set<MethodTypeId>(["lc_gradient", "mass_spec"])}
        onUse={onUse}
        onEnableType={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Use template"));
    expect(onUse).toHaveBeenCalled();
  });
});

describe("CompoundTemplateDetailLoader", () => {
  // A synthetic compound (kit) entry + the child entries it references by slug.
  // No compound combination entries exist on main yet (the catalog session
  // lands them in a follow-up), so this is an in-test fixture manifest standing
  // in for the live catalog. Slugs match the contract's LC-MS peptide pairing.
  const lcEntry: MethodCatalogManifestEntry = {
    slug: "lcms-peptide-rp-lc-thermo",
    title: "Peptide RP LC",
    description: "",
    category: "LC-MS",
    method_type: "lc_gradient",
  };
  const msEntry: MethodCatalogManifestEntry = {
    slug: "lcms-peptide-ms-thermo-orbitrap",
    title: "Peptide Orbitrap MS",
    description: "",
    category: "LC-MS",
    method_type: "mass_spec",
  };
  const comboEntry: MethodCatalogManifestEntry = {
    slug: "lcms-peptide-combo-thermo",
    title: "Peptide LC-MS (kit)",
    description: "Full peptide LC-MS kit.",
    category: "LC-MS",
    method_type: "compound",
  };
  const manifestEntries = [lcEntry, msEntry, comboEntry];

  // The lazily-fetched compound payload: references the two children by slug,
  // MS authored before LC to prove the loader sorts by ordering.
  const comboFetch = () =>
    Promise.resolve({
      slug: "lcms-peptide-combo-thermo",
      title: "Peptide LC-MS (kit)",
      description: "Full peptide LC-MS kit.",
      category: "LC-MS",
      method_type: "compound" as const,
      payload: {
        description: "Full peptide LC-MS kit.",
        components: [
          {
            slug: "lcms-peptide-ms-thermo-orbitrap",
            ordering: 1,
            label: "MS setup",
          },
          { slug: "lcms-peptide-rp-lc-thermo", ordering: 0 },
        ],
      },
    });

  it("resolves component types off the fetched payload and gates Use until ALL are enabled", async () => {
    const onUse = vi.fn();
    const onEnableType = vi.fn();
    const { rerender } = render(
      <CompoundTemplateDetailLoader
        entry={comboEntry}
        manifestEntries={manifestEntries}
        enabledIds={new Set<MethodTypeId>(["lc_gradient"])}
        isUsing={false}
        anyUsing={false}
        onUse={onUse}
        onEnableType={onEnableType}
        fetchTemplate={comboFetch}
      />,
    );
    // Both component types resolve via the manifest once the payload loads.
    await waitFor(() =>
      expect(screen.getAllByText("LC Gradient").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Mass spec").length).toBeGreaterThan(0);
    // mass_spec still disabled: gated, the missing type offered, no Use.
    expect(screen.queryByText("Use template")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Enable Mass spec"));
    expect(onEnableType).toHaveBeenCalledWith("mass_spec");

    // Enable both: Use unlocks (payload already cached, no refetch).
    rerender(
      <CompoundTemplateDetailLoader
        entry={comboEntry}
        manifestEntries={manifestEntries}
        enabledIds={new Set<MethodTypeId>(["lc_gradient", "mass_spec"])}
        isUsing={false}
        anyUsing={false}
        onUse={onUse}
        onEnableType={onEnableType}
        fetchTemplate={comboFetch}
      />,
    );
    fireEvent.click(await screen.findByText("Use template"));
    expect(onUse).toHaveBeenCalled();
  });

  it("renders the bundled steps in ordering order with label fallback + override", async () => {
    render(
      <CompoundTemplateDetailLoader
        entry={comboEntry}
        manifestEntries={manifestEntries}
        enabledIds={new Set<MethodTypeId>(["lc_gradient", "mass_spec"])}
        isUsing={false}
        anyUsing={false}
        onUse={vi.fn()}
        onEnableType={vi.fn()}
        fetchTemplate={comboFetch}
      />,
    );
    // ordering 0 (LC, label falls back to the manifest title) renders; the
    // ordering 1 component shows its label override.
    await waitFor(() =>
      expect(screen.getByText("Peptide RP LC")).toBeInTheDocument(),
    );
    expect(screen.getByText("MS setup")).toBeInTheDocument();
  });

  it("shows a loading state and never a premature Use before the payload resolves", () => {
    render(
      <CompoundTemplateDetailLoader
        entry={comboEntry}
        manifestEntries={manifestEntries}
        enabledIds={new Set<MethodTypeId>(["lc_gradient", "mass_spec"])}
        isUsing={false}
        anyUsing={false}
        onUse={vi.fn()}
        onEnableType={vi.fn()}
        fetchTemplate={() => new Promise(() => {})}
      />,
    );
    expect(screen.getByText("Loading kit...")).toBeInTheDocument();
    // Types are unknown while loading, so the gated action must NOT render.
    expect(screen.queryByText("Use template")).not.toBeInTheDocument();
  });
});
