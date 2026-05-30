import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function HomeFeaturePage() {
  return (
    <WikiPage
      intro="Your landing page at / is one customizable widget dashboard. You pin the summaries you care about, drag them into the order you want, and click any tile to open its full story. There is no fixed layout to fight: the dashboard is whatever you make it."
    >
      <Screenshot
        src="/wiki/screenshots/home-dashboard.png"
        alt="The unified dashboard at /, showing the account-aware widget canvas with the Add widget, Edit layout, Reset, and Tools toolbar above the pinned snapshot tiles (Projects Overview seeded at the top)."
        caption="The unified dashboard at /. One account-aware widget canvas: pin the snapshot tiles you care about, drag them into order, and click any tile to open its full view."
      />

      <h2>One page, two names</h2>
      <p>
        There used to be two separate landing pages: a Home page with a
        hardcoded grid of project cards, and a Lab Overview dashboard for
        PIs. They are now a single surface that lives at <code>/</code>.
        Which name you see in the sidebar depends on your account type. A
        solo researcher or a lab member sees it labelled{" "}
        <strong>Home</strong>. A lab head (PI) sees the exact same page
        labelled <strong>Lab Overview</strong>. The label follows the same
        account-aware pattern as the &ldquo;Links&rdquo; vs &ldquo;Lab
        Links&rdquo; nav entry: one route, one mental model, a name that
        matches who is looking at it.
      </p>
      <p>
        The page itself is nothing but widgets. There is no fixed section
        bolted to the top of it anymore. Everything you see is a tile you
        pinned (or that came pinned by default), and everything is yours to
        rearrange or remove.
      </p>
      <Callout variant="info" title="Where the project grid went">
        The old hardcoded &ldquo;Research Project Overview&rdquo; grid no
        longer exists as a fixed block. Your projects live in the{" "}
        <strong>Projects Overview</strong> widget instead, which ships
        pinned at the top of a fresh dashboard. Nothing is lost: that widget
        carries the same at-a-glance project cards <em>and</em> the inline
        New Project button the grid used to own.
      </Callout>

      <h2>The dashboard is a canvas of tiles</h2>
      <p>
        The mental model is closer to a phone home screen than a tab. Each
        widget renders as a small <strong>snapshot tile</strong> in the grid:
        a compact, glanceable summary. Click a tile and it opens into a full
        popup with the complete picture. Pin the things you want to glance at
        every morning, click in only when you need the detail. A fresh
        dashboard starts with a small, sensible default set rather than a
        blank page, so there is always something useful to look at on day
        one.
      </p>
      <p>
        For the deeper reference on how tiles, popups, and the widget catalog
        work (the same vocabulary this dashboard uses), see{" "}
        <Link href="/wiki/features/lab-overview/snapshot-tiles-and-expanded-views">
          Snapshot Tiles and Expanded Views
        </Link>{" "}
        and the full{" "}
        <Link href="/wiki/features/lab-overview/widgets-and-tools">
          Widgets and Tools
        </Link>{" "}
        catalog.
      </p>

      <h2>The Projects Overview widget</h2>
      <p>
        This is the widget that replaces the old project grid, and it is
        seeded at the top of every new dashboard. The tile shows your top
        projects with their color dot, a percent-complete progress bar, and
        the open-task count. Open the tile and you get the full grid: a card
        per project with the project color, a progress bar, and an{" "}
        <strong>Active / Overdue / Upcoming</strong> counts row (Overdue
        turns red when there is anything overdue), plus the open-task total.
        Click any card to jump straight to that project&apos;s dedicated
        route (see{" "}
        <Link href="/wiki/features/projects">Project Surface</Link> for the
        Overview, Results, Methods, Goals, and Activity walkthrough).
      </p>
      <p>
        The popup also carries an inline <strong>New Project</strong> button.
        Click it, pick a color, type a name, and the project appears
        everywhere at once: in this widget, in the Gantt, in the project
        sidebar. You never have to leave the dashboard to start a project.
      </p>
      <Callout variant="info" title="My projects vs Lab projects">
        For a PI, the Projects Overview tile carries a{" "}
        <strong>My projects / Lab projects</strong> toggle. &ldquo;My&rdquo;
        scope shows only your own work; &ldquo;Lab&rdquo; scope rolls up
        every member&apos;s projects you are allowed to see. Solo and member
        accounts always see &ldquo;My&rdquo; scope (the toggle is PI-only),
        and the privacy gate is strict either way: a project shared with
        someone else never appears unless you are the owner, a PI, or it was
        shared with you.
      </Callout>

      <h2>The Single Project widget</h2>
      <p>
        When you want one specific project front and center, pin the{" "}
        <strong>Single Project</strong> widget and choose a project for it.
        The tile then reads like one of the old Home cards: the project color
        and name, a percent-complete progress bar, and the same{" "}
        <strong>Active / Overdue / Upcoming</strong> counts row with the
        open-task total. A pinned tile clicks straight through to the full
        project page. It is the natural choice for a PI keeping a close eye on
        one member&apos;s project, but anyone can pin their own.
      </p>

      <h2>Add, arrange, and reset</h2>
      <p>
        The dashboard toolbar runs along the top edge of the page, next to
        the heading. It holds the layout controls:
      </p>
      <ul>
        <li>
          <strong>+ Add widget</strong> opens the palette of every widget
          you are allowed to pin. Clicking it flips the dashboard into edit
          mode if it was off, then opens the palette. Drag a tile from the
          palette onto the canvas to pin it.
        </li>
        <li>
          <strong>Edit layout</strong> toggles edit mode. With it on, tiles
          gain drag handles. Drag a tile to a new spot and the grid reflows;
          your order is saved per user.
        </li>
        <li>
          <strong>Reset</strong> wipes your custom arrangement and restores
          the default layout for your account type. It is a sibling button to
          Add widget and Edit layout, not a menu item.
        </li>
        <li>
          <strong>Tools</strong> opens any tool popup directly, without
          pinning it. Useful for a one-shot look at something you do not want
          taking up permanent space on the canvas.
        </li>
      </ul>
      <p>
        Your arrangement persists in your settings sidecar under the single{" "}
        <code>dashboard_layout</code> field. There is no longer a separate
        Home layout and Lab Overview layout to keep in sync: it is one saved
        layout for the one page.
      </p>

      <h2>Create a new project</h2>
      <Steps>
        <Step>
          Open the <strong>Projects Overview</strong> tile (it sits at the
          top of a fresh dashboard).
        </Step>
        <Step>
          Click <strong>New Project</strong> in the popup, pick a color from
          the swatch, and type a name (e.g. <em>CRISPR Gene Editing
          Study</em>).
        </Step>
        <Step>
          Press <strong>Create</strong> (or Enter). The card appears in the
          widget immediately, and the project shows up in the Gantt and the
          project sidebar too.
        </Step>
      </Steps>
      <Callout variant="tip" title="Color is visual grouping everywhere">
        The color you pick follows the project across the whole app: the bar
        on the <Link href="/wiki/features/gantt">Gantt</Link>, the dot in the
        Projects Overview and Single Project tiles, and the overlay on the
        calendar. Pick distinct colors early so a busy Gantt stays readable
        as your project count grows.
      </Callout>

      <h2>PIs see additional lab widgets</h2>
      <p>
        The dashboard is account-aware in what it can show, not just in its
        label. For a solo researcher or a member, the widget palette is the
        personal set: your projects, your upcoming tasks, your calendar
        events, announcements, comments. For a lab head, the palette opens up
        to the dense lab-aggregation widgets that roll up the whole lab:
        cross-lab activity, every member&apos;s projects via the Lab scope of
        Projects Overview, lab-wide announcements and comments, and the rest
        of the PI catalog. A PI&apos;s fresh dashboard also seeds a richer
        default set than a member&apos;s.
      </p>
      <Callout variant="info" title="New widgets do not auto-pin">
        The dashboard is user-curated. If a new widget variant ships, it
        appears in the palette but does not automatically land on your canvas.
        Add it from <strong>+ Add widget</strong> when you want it. So if a
        newly-shipped widget does not show up on its own, that is why: pin it
        yourself.
      </Callout>

      <h2>Shared projects appear here too</h2>
      <p>
        When a labmate shares a project with you, it surfaces inside the{" "}
        <strong>Projects Overview</strong> widget alongside your own (and, for
        a PI in Lab scope, the project is tagged with the owner&apos;s
        avatar). The card reads the same as any other: color, progress, the
        Active / Overdue / Upcoming counts. The tasks shown are the{" "}
        <em>owner&apos;s</em> tasks for that project, the same ones they see.
        Whether your edits save back depends on the permission the owner
        granted: edit permission writes to their copy, view permission is
        read-only. See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for the full permission model.
      </p>
      <Callout variant="tip" title="Want a lab-wide roll-up?">
        Sharing a single project is the right tool when one labmate wants to
        follow along on one specific project. For a single surface that rolls
        up every member&apos;s projects, tasks, and announcements at once, a
        PI uses this same dashboard with the lab widgets pinned (which is why
        it is labelled <strong>Lab Overview</strong> for them).
      </Callout>
    </WikiPage>
  );
}
