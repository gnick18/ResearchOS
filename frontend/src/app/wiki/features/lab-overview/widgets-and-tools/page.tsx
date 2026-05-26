import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabOverviewWidgetsAndToolsPage() {
  return (
    <WikiPage
      title="Widgets and Tools"
      intro="A Tool is the full popup. A Widget is the tile that opens it. The Lab Overview ships 13 Tools, each tile has one or more visual variants, and the Tools launcher in the header opens any Tool without you needing a pinned tile for it. This page walks the full catalog and the variant system."
    >
      {/* TODO screenshot agent: capture the + Add widget palette open over the canvas.
          Route: /lab-overview (edit mode on, palette open)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture; palette panel mounted showing every Tool plus variants
          Save to: frontend/public/wiki/screenshots/lab-overview-widget-palette.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-overview-widget-palette.png"
        alt="The Lab Overview widget palette open over the canvas, listing every Tool with their tile variants."
        caption="The + Add widget palette. Each card shows one Tool plus the available tile variants (small, medium, large) you can pin to the canvas."
      />

      <h2>The 13 Tools</h2>
      <p>
        Each Tool is the canonical popup for one subject. Clicking any of its
        tiles, or picking it from the Tools launcher in the header, opens the
        same surface. They are the heart of the Lab Overview, the rest of the
        page is just how you reach them.
      </p>
      <ul>
        <li>
          <strong>Announcements.</strong> Pinned and recent announcements for
          the whole lab. Read for everyone, write for Lab Heads (with an
          edit-session unlock). See{" "}
          <Link href="/wiki/features/lab-inbox/announcements">
            Announcements
          </Link>.
        </li>
        <li>
          <strong>Comments.</strong> The lab-wide comment stream across tasks,
          notes, and purchases, with @-mention filtering and threaded replies.
          See{" "}
          <Link href="/wiki/features/lab-inbox/comments">Comments</Link>.
        </li>
        <li>
          <strong>Notes.</strong> Recently updated lab notes you have read
          access to. Click a row to open the note popup.
        </li>
        <li>
          <strong>Experiments.</strong> The lab-wide experiment list grouped
          by member, with each row clicking out to the experiment popup.
        </li>
        <li>
          <strong>Purchases.</strong> The pending-approval queue, funding-bar
          summaries, and the burn-rate trend. Has three tile variants
          (described below).
        </li>
        <li>
          <strong>Metrics.</strong> Cross-lab counts: total active tasks,
          purchases pending, recent shared notes, and so on.
        </li>
        <li>
          <strong>Daily tasks.</strong> Today&apos;s tasks across every member.
          Pinnable to the sidebar as a slim, always-visible variant.
        </li>
        <li>
          <strong>Lab activity.</strong> The rolling activity feed: who saved
          what, who marked what complete, who shared what.
        </li>
        <li>
          <strong>Recent activity.</strong> A focused, smaller-window view of
          lab activity for the snapshot canvas.
        </li>
        <li>
          <strong>PI actions.</strong> The Lab Head&apos;s soft-write console:
          pending approvals, flagged items, and the audit log. See{" "}
          <Link href="/wiki/features/lab-head/soft-write-actions">
            Soft-write actions
          </Link>.
        </li>
        <li>
          <strong>Member workload.</strong> Per-member counts of active tasks,
          overdue items, and flagged work, so you can see who is overloaded
          at a glance.
        </li>
        <li>
          <strong>Today&apos;s announcements.</strong> A leaner variant of
          Announcements that only surfaces what is pinned or posted today,
          good as a sidebar tile.
        </li>
        <li>
          <strong>Calendar.</strong> A popup view of today&apos;s and
          upcoming lab calendar events. Backs the{" "}
          <code>calendar-events-today</code> tile variant that shows the
          next chunk of events in a compact list. Pinning that variant is
          how the Home canvas&apos; default &quot;Today&apos;s events&quot;
          tile gets its data.
        </li>
      </ul>

      <h2>Widget variants (the iPhone-widgets model)</h2>
      <p>
        Some Tools come in more than one tile shape because the same data
        deserves different visual treatments depending on what you are
        glancing for. <code>LabPurchases</code> is the clearest example:
      </p>
      <ul>
        <li>
          <strong>Funding bars.</strong> A horizontal bar per funding account
          showing spent vs. budget. Good for &quot;how much grant is left.&quot;
        </li>
        <li>
          <strong>Burn rate.</strong> A small trend chart of weekly spend with
          a range selector (4w / 8w / 12w / 6mo). Good for &quot;are we
          accelerating.&quot;
        </li>
        <li>
          <strong>Pending count.</strong> A single big number plus the top few
          waiting items. Good for &quot;do I need to approve something right
          now.&quot;
        </li>
      </ul>
      <p>
        You pick a variant from the palette when you drag a widget onto the
        canvas. Multiple variants of the same Tool can co-exist on the page,
        each showing the same underlying data through a different lens. Click
        any of them and the expanded popup opens; some variants label their
        header with the variant name instead of the Tool&apos;s umbrella
        title, so the popup title matches the tile you clicked.
      </p>

      <Callout variant="tip" title="One Tool, many tiles">
        Think of variants as views, not separate widgets. If you change the
        time range on the burn-rate variant, that range applies to that tile
        only. The pending-count variant ignores it because pending-count does
        not have a time dimension.
      </Callout>

      <h3>When the popup title follows the tile</h3>
      <p>
        Most Tools host more than one sibling widget. The Daily Tasks Tool,
        for example, has four tiles that share the same body: an Overdue
        slice, a Today slice, an Upcoming slice, and a full-stack version
        that bundles all three. The popup body is identical no matter which
        tile you click, but each tile can label its popup header
        differently. That way the title in the popup chrome matches the
        tile you just clicked, so opening Upcoming tasks reads as Upcoming
        tasks rather than the Tool&apos;s broader umbrella name.
      </p>
      <p>
        Today four variants carry a per-tile header label:{" "}
        <code>calendar-events-today</code> shows &quot;Today&apos;s
        events&quot;, <code>sidebar-overdue</code> shows &quot;Overdue
        tasks&quot;, <code>sidebar-upcoming</code> shows &quot;Upcoming
        tasks&quot;, and <code>sidebar-daily-tasks</code> shows &quot;Daily
        tasks&quot;. The override is set per variant, so a Tool whose
        sibling tiles don&apos;t need their own header fall back to the
        Tool&apos;s umbrella title (the iPhone-widgets framing from
        above); every Lab Purchases variant, for instance, still opens a
        popup labelled &quot;Lab purchases&quot;.
      </p>

      <p>
        A handful of other Tools also ship in multiple variants beyond the
        canonical tile:
      </p>
      <ul>
        <li>
          <strong>Comments → comment-mentions.</strong> The same Comments
          stream, filtered to just @-mentions of you. Good for &quot;what
          requires my response.&quot;
        </li>
        <li>
          <strong>Experiments → experiments-ready-writeup.</strong> The
          Experiments list filtered to entries that are ready for a
          write-up (data captured, results section empty). Good for a
          PI&apos;s &quot;what needs my eye for publication.&quot;
        </li>
        <li>
          <strong>Lab activity → lab-activity-by-type.</strong> Splits the
          activity feed into today&apos;s tasks, notes, and purchases as
          three side-by-side columns instead of one rolling stream.
        </li>
        <li>
          <strong>Calendar → calendar-events-today.</strong> A compact
          today-only events list, the default Home widget variant.
        </li>
        <li>
          <strong>Daily tasks → sidebar variants.</strong> Daily tasks
          ships <code>sidebar-overdue</code>, <code>sidebar-today</code>,{" "}
          <code>sidebar-upcoming</code>, and a full-stack{" "}
          <code>sidebar-daily-tasks</code> variant for the customizable
          sidebar rail (Lab Heads only). All four are visually slim
          versions of the canvas tile.
        </li>
      </ul>

      <h2>The Tools launcher (header button)</h2>
      <p>
        The <strong>Tools</strong> button in the page header opens a flat menu
        of every Tool. Pick one and the canonical popup opens. The Tools
        launcher is the right path when you want a one-shot look at something
        you do not want pinned to the canvas. Audit log is a common example:
        most days you do not need a tile for it, but when you do want it, the
        launcher is one click away.
      </p>

      <h2>The + Add widget palette</h2>
      <p>
        The <strong>+ Add widget</strong> button lives in the canvas
        toolbar at the TOP of the canvas (NOT a gear icon, NOT at the
        bottom). Clicking it slides in a panel showing every available
        widget, grouped by Tool, with the tile variants listed beside each
        one. Drag a tile from the palette onto the canvas (or onto the
        sidebar rail) to pin it. The same palette is also the path to
        recover a widget you removed. Clicking +Add widget auto-flips the
        canvas into edit mode if it was off, so you can pin without
        manually toggling Edit layout first.
      </p>
      <p>
        Already-pinned widgets are marked in the palette so you can still pin
        a second copy of the same variant if you want (a vendor breakdown by
        burn-rate at one size and the same widget at another, for example).
      </p>

      <h2>Removing a widget</h2>
      <p>
        With edit mode on, hover a tile and a remove handle appears in the
        corner. Click it to unpin the widget. The Tool itself stays available
        from the Tools launcher and the palette; only this specific tile is
        gone. <strong>Reset to default</strong> restores the shipping layout
        in one click.
      </p>
    </WikiPage>
  );
}
