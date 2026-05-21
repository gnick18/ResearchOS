// Component test for the Phase S5 PTO indicator on event tiles
// rendered by MonthView. Covers STREAK_AND_MILESTONES_PROPOSAL.md
// §6.5 visual indicator: when an event has `is_pto: true`, the tile
// gets a sky-blue "PTO" pill + ring accent + the tooltip text
// "PTO day, won't break your streak" (via native title attribute,
// matching the existing pattern in this file).
//
// Non-PTO events render without the badge: that's the baseline.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MonthView from "../MonthView";
import type { Event } from "@/lib/types";

const anchor = new Date(2026, 5, 15); // June 15, 2026 (Monday)

const baseEvent: Event = {
  id: 1,
  title: "Team offsite",
  event_type: "meeting",
  start_date: "2026-06-15",
  end_date: "2026-06-15",
  start_time: null,
  end_time: null,
  location: null,
  url: null,
  notes: null,
  color: null,
};

describe("MonthView PTO indicator", () => {
  it("renders a PTO pill on event tiles flagged is_pto = true", () => {
    const ptoEvent: Event = {
      ...baseEvent,
      title: "Spring break",
      is_pto: true,
    };
    render(
      <MonthView
        anchor={anchor}
        events={[ptoEvent]}
        externalEvents={[]}
        onDayClick={() => {}}
        onDayDoubleClick={() => {}}
        onEventClick={() => {}}
        onExternalClick={() => {}}
      />,
    );
    // The PTO label is rendered as visible text on the tile.
    const ptoLabels = screen.getAllByText("PTO");
    expect(ptoLabels.length).toBeGreaterThan(0);
  });

  it("sets data-pto and the tooltip title on PTO event tiles", () => {
    const ptoEvent: Event = {
      ...baseEvent,
      title: "Spring break",
      is_pto: true,
    };
    render(
      <MonthView
        anchor={anchor}
        events={[ptoEvent]}
        externalEvents={[]}
        onDayClick={() => {}}
        onDayDoubleClick={() => {}}
        onEventClick={() => {}}
        onExternalClick={() => {}}
      />,
    );
    // Find the tile button by name (includes both PTO label and title).
    const tiles = screen.getAllByRole("button", { name: /Spring break/ });
    // At least one tile should carry the PTO data attribute + tooltip.
    const ptoTile = tiles.find((el) => el.getAttribute("data-pto") === "true");
    expect(ptoTile).toBeTruthy();
    expect(ptoTile?.getAttribute("title")).toBe(
      "PTO day, won't break your streak",
    );
  });

  it("does NOT render a PTO pill on event tiles without is_pto", () => {
    render(
      <MonthView
        anchor={anchor}
        events={[baseEvent]}
        externalEvents={[]}
        onDayClick={() => {}}
        onDayDoubleClick={() => {}}
        onEventClick={() => {}}
        onExternalClick={() => {}}
      />,
    );
    // No "PTO" label text anywhere on the grid.
    expect(screen.queryByText("PTO")).toBeNull();
  });

  it("does NOT render a PTO pill when is_pto is explicitly false", () => {
    const event: Event = { ...baseEvent, is_pto: false };
    render(
      <MonthView
        anchor={anchor}
        events={[event]}
        externalEvents={[]}
        onDayClick={() => {}}
        onDayDoubleClick={() => {}}
        onEventClick={() => {}}
        onExternalClick={() => {}}
      />,
    );
    expect(screen.queryByText("PTO")).toBeNull();
  });
});
