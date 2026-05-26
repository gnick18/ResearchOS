import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabOverviewFeaturePage() {
  return (
    <WikiPage
      title="Lab Overview"
      intro="The Lab Overview at /lab-overview is the Lab Head's customizable dashboard for the whole lab. It is not a separate view of the same app; it is a canvas of small, draggable summary tiles that each click out into a full popup. Members do not see this surface at all (their starting point is /home). The mental model is closer to a phone home screen than a tab: you pin the things you want to glance at, you click a tile when you need the full story."
    >
      {/* TODO screenshot agent: capture the Lab Overview canvas at default layout.
          Route: /lab-overview
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture with the default widget set pinned (announcements, comments,
                 lab activity, today's events, daily-tasks sidebar tiles)
          Save to: frontend/public/wiki/screenshots/lab-overview-canvas.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-overview-canvas.png"
        alt="The Lab Overview at /lab-overview, showing a grid of widget tiles (announcements, comments, lab activity) with a vertical sidebar rail on the right pinning a few extra tiles."
        caption="The Lab Overview. Snapshot tiles in the main grid, a customizable sidebar rail on the right, and a Tools header button up top."
      />

      <h2>Who this page is for</h2>
      <p>
        Lab Overview is gated on <code>account_type === &quot;lab_head&quot;</code>.
        Lab members never see it. After the Home canvas migration, members land
        on <code>/home</code> for their own work, while Lab Heads get this
        dedicated cross-lab surface at <code>/lab-overview</code>. The two surfaces
        share the widget vocabulary but answer different questions: Home asks
        &quot;what is on my plate today,&quot; Lab Overview asks &quot;what is
        the lab doing right now and what needs my attention.&quot;
      </p>
      <p>
        Lab Heads also get a Home canvas of their own (with its own default
        layout under <code>defaultLabHeadHomeLayout</code>). Lab Overview is
        not their only widget surface; it is the cross-lab dashboard that
        sits next to a personal Home, and the two layouts persist separately.
      </p>

      <h2>Anatomy</h2>
      <p>
        The page has three regions you interact with:
      </p>
      <ul>
        <li>
          <strong>The snapshot canvas</strong> is the main grid in the center.
          Each cell is a widget tile that pulls live data from the lab and
          renders a compact summary. Tiles are draggable when edit mode is
          on, toggled via the <strong>Edit layout</strong> text button in
          the canvas toolbar (right side of the same row as <strong>+ Add
          widget</strong> and <strong>Reset</strong>).
        </li>
        <li>
          <strong>The customizable sidebar</strong> runs down the right edge
          as a vertical rail of slim tiles. Pin a widget to the sidebar when
          you want it always-visible without consuming canvas space, the way
          you would put a battery indicator in a phone status bar.
        </li>
        <li>
          <strong>The Tools launcher</strong> is a header button that opens
          the same widget popups directly, without pinning anything. Useful
          when you want a one-shot look at audit logs or pending purchases
          but do not want a permanent tile for it.
        </li>
      </ul>

      <h2>Three core ideas</h2>
      <p>
        Once these three primitives click, the rest of the page is just
        composition.
      </p>
      <ul>
        <li>
          <strong>Tools.</strong> The canonical full-screen popup for each
          subject (announcements, comments, purchases, member workload, and
          so on). Each Tool is the same popup regardless of where you opened
          it from: a tile click, the Tools launcher, or a sidebar entry all
          route to the same surface. See{" "}
          <Link href="/wiki/features/lab-overview/widgets-and-tools">
            Widgets and Tools
          </Link>{" "}
          for the full catalog.
        </li>
        <li>
          <strong>Widget variants.</strong> A single Tool can have multiple
          tile shapes. <code>LabPurchases</code>, for example, ships three
          variants (funding-bars, burn-rate, pending-count); each one summarizes
          the same underlying data in a different visual register. Think of it
          as the iPhone-widgets model: same app, different widget sizes for
          different glance patterns.
        </li>
        <li>
          <strong>Customizable layout.</strong> Edit mode (toggle from the gear
          icon) flips every tile into drag mode. Snapshots reorder freely, the
          sidebar rail accepts drops from the canvas and vice versa, and a
          <strong>+ Add widget</strong> palette mounts a panel of every
          available widget. <strong>Reset to default</strong> restores the
          shipping layout.
        </li>
      </ul>

      <Callout variant="info" title="The widget contract">
        Every widget conforms to the same <code>SidebarTile</code> contract
        on the data side and renders both a small snapshot body and a full
        expanded popup. That is what makes the variants pluggable: pinning
        a widget to the sidebar or dragging it onto the canvas is the same
        underlying object, just rendered at a different size.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/wiki/features/lab-overview/widgets-and-tools">
            Widgets and Tools
          </Link>{" "}
          covers the 12 Tools you can pin and the variant system.
        </li>
        <li>
          <Link href="/wiki/features/lab-overview/customizable-sidebar">
            Customizable sidebar
          </Link>{" "}
          walks the right-edge rail (lab heads only).
        </li>
        <li>
          <Link href="/wiki/features/lab-overview/snapshot-tiles-and-expanded-views">
            Snapshot tiles and expanded views
          </Link>{" "}
          explains the tile-to-popup model, drag-to-reorder, and edit mode.
        </li>
        <li>
          For the Lab Head role itself (the account type that gates this whole
          page), see <Link href="/wiki/features/lab-head">Lab Head</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
