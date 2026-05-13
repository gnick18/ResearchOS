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
      />

      <h2>How to get there</h2>
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
          <strong>Notes</strong> are flat lists across all users, with each row
          attributed to its owner.
        </li>
      </ul>

      <h2>Filtering by user</h2>
      <p>
        Click the user-filter button to toggle which users are included. Hide
        teammates you don&apos;t need to see. The filter persists per browser.
      </p>

      <Callout variant="tip" title="Shared lab account setup first">
        Lab Mode only has data to aggregate if multiple users share the same
        folder. If you haven&apos;t set that up yet, read{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>.
      </Callout>
    </WikiPage>
  );
}
