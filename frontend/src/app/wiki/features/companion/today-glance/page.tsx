import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function CompanionTodayGlancePage() {
  return (
    <WikiPage
      title="Today glance"
      intro="Pull down on the Companion to see what is on for today. It lists the tasks scheduled now, anything overdue, and what is coming up. It is a quick read of your day pulled from the laptop, so you can check whether you have a culture to split or a timer to start without opening your computer."
    >
      <p>
        At the bench you rarely need your whole project plan. You need to know
        the next thing, whether something slipped, and what is around the corner.
        The today glance gives you exactly that and nothing more. It is a short,
        scannable list you reach with a pull-down, kept current by the laptop so
        what you see on the phone matches what your notebook knows.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-today.png"
        alt="The Companion Notebook tab on a phone with the today glance pulled down, listing scheduled tasks, an overdue item, and upcoming items in three groups."
        caption="The today glance pulled down on the Notebook tab, grouped into overdue, today, and upcoming."
      />
      {/* SCREENSHOT: Companion Notebook tab with the today glance expanded,
          showing overdue / today / upcoming groups. Capture from the dev-client.
          Save to frontend/public/wiki/screenshots/companion-today.png */}

      <h2>What the glance shows</h2>
      <p>
        The glance is organized the way a working day actually breaks down, so
        the thing demanding attention is at the top and the rest is context.
      </p>
      <ul>
        <li>
          <strong>Overdue.</strong> Tasks whose date has already passed, surfaced
          first so nothing quietly slips.
        </li>
        <li>
          <strong>Today.</strong> What is scheduled for the current day, the core
          of the list.
        </li>
        <li>
          <strong>Upcoming.</strong> What is on the near horizon, so you can see
          what is coming before it arrives.
        </li>
      </ul>

      <h2>How it stays current</h2>
      <p>
        The phone does not compute your schedule. The laptop does, then publishes
        a sealed today snapshot, a small bundle of today&apos;s tasks plus the
        overdue and upcoming items. The phone pulls that snapshot and unseals it
        with its own key. Because the snapshot is sealed end-to-end, the relay
        passes it along without ever being able to read your task list, and the
        glance on the phone reflects whatever the laptop last published.
      </p>

      <Callout variant="info" title="Where it lives and how to turn it off">
        The glance is a collapsible pull-down on the Notebook tab, and it is on
        by default because most people want the quick read. If you would rather
        not see it, you can toggle it off in Settings, and the Notebook tab goes
        back to a clean start.
      </Callout>

      <p>
        The today glance is the read-only counterpart to planning you do on the
        laptop. The schedule itself is built and edited there, on the{" "}
        <Link href="/wiki/features/calendar">calendar</Link> and across your
        projects, and the glance is simply that plan, delivered to your hand at
        the bench.
      </p>
    </WikiPage>
  );
}
