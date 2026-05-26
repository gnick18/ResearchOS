import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabOverviewSnapshotAndExpandedPage() {
  return (
    <WikiPage
      title="Snapshot tiles and expanded views"
      intro="Every widget on the Lab Overview is two things at once: a small snapshot tile that lives on the canvas, and a richer expanded view that opens as a popup when you click the tile. The split is what lets the page stay dense without losing the full story behind any one number."
    >
      {/* TODO screenshot agent: capture a snapshot tile next to its expanded popup.
          Route: /lab-overview (with one popup open)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture; LabPurchases burn-rate tile visible on the canvas
                 with the expanded LabPurchases popup mounted on top
          Save to: frontend/public/wiki/screenshots/lab-overview-tile-vs-popup.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-overview-tile-vs-popup.png"
        alt="A small burn-rate widget tile on the canvas with the full LabPurchases popup mounted on top, showing the same data at two different fidelities."
        caption="The tile shows the headline. Click it and the same data opens in the full Tool popup with every tab and control available."
      />

      <h2>The two-fidelity model</h2>
      <p>
        Each widget renders at two fidelities:
      </p>
      <ul>
        <li>
          <strong>The snapshot tile</strong> on the canvas (or in the
          sidebar rail) shows the single most important fact: a count, a
          tiny chart, a single bar. Tiles are designed to be readable
          without interaction, so a glance at the page tells you the
          state of the lab.
        </li>
        <li>
          <strong>The expanded view</strong> is the full Tool popup. It
          opens centered over the page and contains every tab, control,
          filter, and action the Tool supports. Same data, full surface.
        </li>
      </ul>
      <p>
        Clicking a tile is the only way to open its expanded view. The
        Tools launcher in the page header opens the same popups directly,
        without needing a tile.
      </p>

      <h2>Drag tiles to reorder</h2>
      <p>
        With <strong>edit mode</strong> on (toggled via the{" "}
        <strong>Edit layout</strong> text button in the canvas toolbar at
        the top-right of the canvas itself, NOT a gear icon), tiles sprout
        drag handles and the canvas turns into a grid you can rearrange.
        Drag a tile to a new cell, drop it, and the layout persists in
        your settings sidecar. Tiles snap to the grid; you cannot place
        them at arbitrary pixel offsets.
      </p>
      <p>
        Edit mode is sticky until you toggle it off (the button switches
        to <strong>Done</strong> while active), so you can stage a whole
        new layout in one pass. The page is interactive the rest of the
        time; tile clicks still open the expanded view while edit mode is
        off. One detail worth knowing: clicking <strong>+ Add widget</strong>{" "}
        auto-flips edit mode on if it was off, then opens the palette. You
        do not have to enter edit mode manually first.
      </p>

      <h2>Tile layout</h2>
      <p>
        The canvas renders tiles in a fixed responsive grid (one column
        on narrow viewports, two columns on desktop). Tiles are uniform
        in their grid cell; there is no per-tile size selector or resize
        handle. The layout shape stored in your settings sidecar is an
        ordered list of widget IDs per surface, so reorder is the only
        layout knob.
      </p>

      <h2>Reset to default</h2>
      <p>
        The <strong>Reset</strong> button in the canvas toolbar (sibling to
        Edit layout and +Add widget, NOT a menu item) restores the shipping
        layout: the default widget set, in the default positions, with the
        default variants. Your customizations wipe in one click. Useful
        when you have experimented your way into a layout you do not like
        and want to start over without manually unpinning everything.
      </p>

      <Callout variant="tip" title="Sidebar tiles and canvas tiles are the same widget">
        Drag a tile from the canvas onto the right-edge sidebar rail and it
        re-renders in its slim sidebar variant. Drag it back and it pops
        back into its canvas variant. The Tool behind the tile does not
        change, only the rendering. See{" "}
        <Link href="/wiki/features/lab-overview/customizable-sidebar">
          Customizable sidebar
        </Link>{" "}
        for the rail-side details.
      </Callout>

      <h2>What opens in the popup</h2>
      <p>
        Every Tool popup follows the same shape:
      </p>
      <ul>
        <li>
          <strong>A header bar</strong> with the Tool name, the close button,
          and any global controls (time range pickers, search boxes).
        </li>
        <li>
          <strong>One or more tabs</strong> when the Tool has distinct sub-views
          (PI actions has Pending / Flagged / Audit log, for example).
        </li>
        <li>
          <strong>A body</strong> with the rich data: tables, charts, lists,
          inline edit affordances.
        </li>
        <li>
          <strong>Per-row actions</strong> where the Tool supports them. Approve
          a purchase from the Pending tab, mark a flagged note resolved, etc.
        </li>
      </ul>
      <p>
        The popup is where every click-out from the canvas lands, so it is
        worth getting comfortable with the shared shape. The widget tiles are
        the entry points; the popup is where the work happens.
      </p>
    </WikiPage>
  );
}
