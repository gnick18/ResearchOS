// Figure composer soft-lock guard (UX clawback).
//
// Pins the rule that the CORE add-a-figure path survives with the asset
// (icon) library turned OFF. The bug: /figures is nav-visible on a different
// flag than ASSET_LIBRARY_ENABLED, so on the prod/demo default the page used
// to render with NO way to add a figure (the rail, and its only "Add a figure"
// trigger, were wrapped in the asset-library gate). The rail must always offer
// figure-page + layer management; only the Icons section is library-gated.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FigureLeftRail from "../FigureLeftRail";

function renderRail(iconLibraryEnabled: boolean, onAddFigure = vi.fn()) {
  render(
    <FigureLeftRail
      iconLibraryEnabled={iconLibraryEnabled}
      tool={null}
      setTool={() => {}}
      textVariant="body"
      setTextVariant={() => {}}
      onPickIcon={() => {}}
      pages={[]}
      currentPageId="page-1"
      onOpenPage={() => {}}
      onNewPage={() => {}}
      onAddFigure={onAddFigure}
      layers={[]}
      selectedKeys={new Set()}
      onSelectLayer={() => {}}
      onReorderLayer={() => {}}
      onToggleLock={() => {}}
      onToggleHide={() => {}}
      onAddShape={() => {}}
      onUseTemplate={() => {}}
    />,
  );
  return { onAddFigure };
}

describe("FigureLeftRail add-figure availability", () => {
  it("shows the add-figure trigger when the icon library is OFF", () => {
    const { onAddFigure } = renderRail(false);
    // With the library off, the rail opens on Figures, so the add-figure
    // button is reachable without any hidden Icons panel.
    const btn = screen.getByRole("button", { name: /add a figure to this page/i });
    fireEvent.click(btn);
    expect(onAddFigure).toHaveBeenCalledTimes(1);
    // The Icons nav entry must not exist when the library is off.
    expect(screen.queryByRole("button", { name: "Icons" })).toBeNull();
  });

  it("keeps the Icons nav entry when the library is ON", () => {
    renderRail(true);
    expect(screen.getByRole("button", { name: "Icons" })).not.toBeNull();
  });
});
