import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabModeFeaturePage() {
  return (
    <WikiPage
      title="Lab Mode"
      intro="A single view that aggregates tasks, projects, methods, and purchases across every user in the folder."
    >
      <Screenshot
        src="/wiki/screenshots/lab-mode.png"
        alt="Lab Mode with the activity feed open and a combined Gantt below it."
        caption="Lab Mode aggregates across every user in the folder."
      />

      <h2>What Lab Mode shows you</h2>
      <p>
        Normally you only see your own projects, tasks, methods, and
        purchases. Lab Mode is the view where you see <em>everyone&apos;s</em>{" "}
        at once — every active experiment in the lab, every method anyone has
        written, every purchase against every funding account.
      </p>
      <p>
        The header turns into a row of tabs (Activity, Gantt, Experiments,
        Methods, Purchases, Roadmaps, Notes), each one showing the combined
        view for that area. Bars and badges are tinted by user color rather
        than project color so you can tell at a glance whose work you&apos;re
        looking at.
      </p>
      <p>
        If you&apos;re the only person in the folder, Lab Mode still works,
        you&apos;ll just be the only contributor in every list. It earns its
        keep once two or more labmates share the same folder.
      </p>

      <h2>Get to Lab Mode</h2>
      <ul>
        <li>
          Click the <strong>Lab</strong> tab in the header.
        </li>
        <li>
          Or, on the user-picker, sign in as the special user{" "}
          <code>lab</code>. That user auto-redirects to Lab Mode.
        </li>
      </ul>

      <h2>The tabs inside Lab Mode</h2>
      <Screenshot
        src="/wiki/screenshots/lab-mode-activity.png"
        alt="The Activity feed in Lab Mode showing a chronological list of changes with contributor names."
        caption="The Activity feed lists every change across the lab, with the contributor's name and a timestamp."
      />
      <ul>
        <li>
          <strong>Activity</strong> is a chronological feed of every change
          (e.g., new task, completed experiment, edited method) with the
          contributor&apos;s name and timestamp.
        </li>
        <li>
          <strong>Gantt</strong> is one combined timeline with every
          user&apos;s bars overlaid. Bars are tinted by user color, not
          project color.
        </li>
        <li>
          <strong>Experiments</strong>, <strong>Methods</strong>,{" "}
          <strong>Purchases</strong>, <strong>Roadmaps</strong>, and{" "}
          <strong>Notes</strong> are flat lists across all users, with each
          row attributed to its owner.
        </li>
      </ul>

      <h2>Filter by user</h2>
      <p>
        Click the user-filter button to toggle which users are included. Hide
        teammates you don&apos;t need to see. The filter persists per
        browser.
      </p>

      <Callout variant="tip" title="Shared lab account setup first">
        Lab Mode only has data to aggregate if multiple users share the same
        folder. If you haven&apos;t set that up yet, read{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>.
      </Callout>
    </WikiPage>
  );
}
