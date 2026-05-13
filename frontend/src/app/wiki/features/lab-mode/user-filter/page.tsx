import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabModeUserFilterPage() {
  return (
    <WikiPage
      title="The user filter"
      intro="A floating chip in the bottom-right corner that decides whose data shows up on every Lab Mode tab. Click it to open the picker; click the arrow on a user to open their dashboard."
    >
      <Screenshot
        src="/wiki/screenshots/lab-mode-user-filter.png"
        alt="The user filter chip expanded into a picker showing each lab member as a colored chip."
        caption="Click the chip to expand it. Each user shows up as a colored tile — selected ones are filled, deselected ones are washed out."
      />

      <h2>What it controls</h2>
      <p>
        Every Lab Mode tab — Activity, GANTT, Experiments, Purchases,
        Roadmaps, Methods, Notes, Search — pulls from the same set of selected
        users. The chip is the one place you change that selection. Toggling a
        user off here makes their rows disappear from all tabs at once.
      </p>
      <p>
        The first time you load Lab Mode in a browser, every user in the
        folder is selected by default. After that, your selections stick per
        browser. If someone joins the lab later, they don&apos;t get
        auto-added — they show up in the picker as deselected, waiting for you
        to click them in.
      </p>

      <h2>Opening and using the picker</h2>
      <p>
        Click the chip and a panel pops up above it. Inside the panel:
      </p>
      <ul>
        <li>
          <strong>Each user is a colored tile</strong> with their avatar and
          username. Selected users get a solid color fill in their user color.
          Deselected ones are washed out at low opacity so the panel still
          tells you at a glance who&apos;s on the team.
        </li>
        <li>
          <strong>Click a tile</strong> to flip it on or off. The other tabs
          re-render right away.
        </li>
        <li>
          <strong>Click the small arrow on a tile</strong> to open that user&apos;s
          detail panel without leaving the current tab. (More on that below.)
        </li>
        <li>
          <strong>Select All / Deselect All</strong> sits in the top-right of
          the picker for quick reset.
        </li>
        <li>
          A footer line tells you <em>{`{n}`} of {`{total}`} users selected</em>.
        </li>
      </ul>
      <p>
        Click anywhere outside the panel to close it. The chip itself can also
        be dragged anywhere on the screen — handy if it&apos;s covering
        something on a small display. Its position is saved per browser.
      </p>

      <h2>The per-user detail panel</h2>
      <p>
        Clicking the arrow on a user tile (or any avatar in Activity, Methods,
        or Roadmaps) opens a slide-out panel on the right side of the screen.
        It&apos;s a one-page snapshot of just that person, useful when you
        want to drill into &quot;what is Alex up to?&quot; without leaving the
        current tab.
      </p>
      <p>The panel layout, top to bottom:</p>
      <ul>
        <li>
          <strong>Header</strong> — large avatar, username, and a &quot;Member
          since&quot; line if their join date is on file.
        </li>
        <li>
          <strong>Stat grid</strong> — Active projects, Experiments
          (done/total), Completion percentage, Total spent.
        </li>
        <li>
          <strong>Active experiments</strong> — experiments running today,
          sorted by end date. Click any row to open its task popup.
        </li>
        <li>
          <strong>Recently completed</strong> — experiments and purchases
          finished in the last 30 days, newest first.
        </li>
        <li>
          <strong>Top funding accounts</strong> — the top five accounts by
          total spend for this user, if there are any. A quick read on which
          grants the person is drawing from.
        </li>
        <li>
          <strong>Recent shared notes</strong> — shared notes updated in the
          last 30 days.
        </li>
      </ul>
      <p>
        Press <strong>Esc</strong> or click the backdrop to close the panel.
      </p>

      <Callout variant="tip" title="Filter and detail are different tools">
        The filter toggle decides what every tab shows. The detail panel
        opens a focused view of one person without changing what the rest of
        the page is showing. You can have one or two users selected in the
        filter and still pop open a different user&apos;s detail panel for a
        quick look.
      </Callout>

      <h2>Things to know</h2>
      <ul>
        <li>
          New users you add to the folder later don&apos;t get auto-selected.
          Open the picker after creating them and click them in.
        </li>
        <li>
          The chip position and the selection are stored in the
          browser&apos;s local storage. Switching browsers or clearing site
          data resets both.
        </li>
        <li>
          The chip can&apos;t leave the viewport — drag it to the edge and
          it&apos;ll snap inside the available area.
        </li>
      </ul>

      <h2>Related pages</h2>
      <ul>
        <li>
          <Link href="/wiki/features/lab-mode">Lab Mode overview</Link> — the
          big picture and what each tab is for.
        </li>
        <li>
          <Link href="/wiki/features/lab-mode/activity">Activity</Link> — the
          page where avatar clicks open the detail panel the most often.
        </li>
        <li>
          <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link> —
          how to get multiple users into the folder in the first place so the
          filter has something to do.
        </li>
      </ul>
    </WikiPage>
  );
}
