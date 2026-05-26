import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabOverviewCustomizableSidebarPage() {
  return (
    <WikiPage
      title="Customizable sidebar"
      intro="The Lab Overview has a second canvas: a vertical rail down the right edge that holds slim, always-visible tiles. It is the place to put things you want a constant ambient read on (today's tasks, today's announcements, pending approvals) without surrendering canvas real estate. The rail is PIs only because the Lab Overview itself is PIs only."
    >
      {/* TODO screenshot agent: capture the sidebar rail in edit mode with a tile mid-drag.
          Route: /lab-overview (edit mode on)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture; sidebar rail visible with DailyTasksWidget, PiActions,
                 TodaysAnnouncements pinned; one tile mid-drag with the canvas drop zones lit
          Save to: frontend/public/wiki/screenshots/lab-overview-sidebar-rail.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-overview-sidebar-rail.png"
        alt="The right-edge sidebar rail on the Lab Overview, showing three slim widget tiles pinned vertically."
        caption="The right-edge rail. Each tile is a slim sidebar variant of a Tool, always visible while you work on the canvas."
      />

      <h2>What the sidebar is for</h2>
      <p>
        The snapshot canvas in the middle of the Lab Overview is great for
        widgets you want at a comfortable reading size, but it has a finite
        height before you start scrolling. The sidebar rail solves the
        scroll problem for the small handful of widgets you want in your
        peripheral vision at all times. The rail is fixed to the right edge,
        every tile is the slim sidebar variant of a Tool, and the rail is
        always visible while you work elsewhere on the canvas.
      </p>

      <Callout variant="info" title="PIs only">
        The Lab Overview surface itself is gated on{" "}
        <code>account_type === &quot;lab_head&quot;</code>. Members never have
        a <code>/lab-overview</code> page, so the sidebar rail never appears
        for them either. The closest analog on the member side is the home
        canvas at <code>/home</code>, which has its own widget layout but no
        permanent right-edge rail. (The <code>/home</code> page uses the
        existing AppShell sidebar; its layout shape explicitly does NOT
        include a customizable rail today.)
      </Callout>

      <h2>Pinning a widget to the rail</h2>
      <p>
        The Lab Overview&apos;s customizable rail has its own edit toggle
        that is separate from the snapshot canvas&apos;s <strong>Edit
        layout</strong> button. With the rail&apos;s edit mode on, drag a
        tile out of the snapshot canvas and drop it on the sidebar rail.
        The rail accepts the drop and the tile re-renders in its slim
        sidebar variant. The opposite direction works too: drag a tile
        from the rail back onto the canvas and it re-renders in the
        larger canvas variant.
      </p>
      <p>
        You can also pin straight from the palette. Open{" "}
        <strong>+ Add widget</strong>, find the Tool you want, and drop the
        sidebar variant directly on the rail without first staging it on
        the canvas.
      </p>

      <h2>Reordering</h2>
      <p>
        Inside the rail, drag any pinned tile up or down to change the
        stacking order. The order persists per PI (it lives in your
        settings sidecar), so each PI&apos;s rail is their own.
      </p>

      <h2>Widgets that ship with a sidebar variant</h2>
      <p>
        Not every Tool has a slim variant. The ones that do are the
        ones a PI usually wants at a glance:
      </p>
      <ul>
        <li>
          <strong>Daily tasks.</strong> Today&apos;s tasks across the lab,
          ranked. The sidebar variant is the same data as the canvas
          version with the per-row chrome trimmed. Pinning daily tasks here
          frees the canvas for week-long widgets.
        </li>
        <li>
          <strong>Today&apos;s announcements.</strong> A compressed read of
          the Announcements Tool that only surfaces pinned and same-day
          announcements. Cross-link to{" "}
          <Link href="/wiki/features/lab-inbox/announcements">
            Announcements
          </Link>{" "}
          for how those get written.
        </li>
        <li>
          <strong>PI actions.</strong> A small queue of pending approvals
          and flagged items, with the tile body acting as a quick-action
          button. See{" "}
          <Link href="/wiki/features/lab-head/soft-write-actions">
            Soft-write actions
          </Link>.
        </li>
        <li>
          <strong>Member workload.</strong> A condensed list of members
          with their active and overdue counts.
        </li>
        <li>
          <strong>Recent activity (sidebar).</strong> A condensed slice of
          the rolling lab activity feed, rendered as one-liners. (Not the
          same as the full Lab activity Tool; that one is canvas / home
          only and does not pin to the rail.)
        </li>
        <li>
          <strong>Daily tasks variants.</strong> Daily tasks ships{" "}
          <code>sidebar-overdue</code>, <code>sidebar-today</code>, and{" "}
          <code>sidebar-upcoming</code> as three time-window-specific slim
          rail tiles, plus a full-stack <code>sidebar-daily-tasks</code>{" "}
          variant that combines all three. Pin whichever window you
          actually want to glance at.
        </li>
      </ul>

      <h2>The SidebarTile contract</h2>
      <p>
        Every widget that supports the rail conforms to the{" "}
        <code>SidebarTile</code> contract, which is the slim-rendering side
        of the larger widget contract. A widget without a SidebarTile
        implementation never offers a sidebar variant in the palette, so the
        rail only ever shows tiles that are designed to fit at sidebar width.
      </p>

      <Callout variant="tip" title="Click a sidebar tile to open the full Tool">
        Sidebar tiles are still tiles. Clicking one opens the same Tool popup
        you would get from the canvas, so the rail is also your one-click path
        to the full surface for the things you watch most often.
      </Callout>
    </WikiPage>
  );
}
