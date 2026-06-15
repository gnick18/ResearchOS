import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function CompanionTodayGlancePage() {
  return (
    <WikiPage
      title="Today glance"
      intro="Open the Today panel on the Notebook tab to see what is on for today. It shows three stat tiles and a grouped task list drawn from your laptop schedule, so you can check whether you have a culture to split or a timer to start without opening your computer."
    >
      <p>
        At the bench you rarely need your whole project plan. You need to know
        the next thing, whether something slipped, and what is around the corner.
        The Today panel gives you exactly that and nothing more. It is a
        full-screen overlay you open from the Notebook tab header, kept current
        by the laptop so what you see on the phone matches what your notebook
        knows.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-today-panel.png"
        alt="The TodayPanel overlay on a phone, showing three stat tiles (Today count, Overdue count, Coming up count), then grouped color-ticked task rows for overdue, today, and upcoming items, with a drag handle at the bottom."
        caption="The Today panel opens as a full-screen overlay from the Notebook tab header. Three stat tiles at the top, grouped task rows below, drag handle to dismiss."
      />

      <h2>How to open it</h2>
      <p>
        The Today panel is opened by the <strong>Today</strong> button in the
        Notebook tab&apos;s header. When any tasks are due or overdue, the button
        shows an amber count badge so you can see at a glance that something needs
        attention. Tapping the button slides the panel down over the screen. It is
        not a pull-down of the Notebook body content; it is a separate overlay.
      </p>
      <p>
        Dismiss the panel by tapping the scrim behind it, swiping down from the
        grab handle at the bottom, or tapping the handle itself.
      </p>

      <h2>What the panel shows</h2>
      <p>
        The panel opens with three stat tiles across the top, then drops into
        grouped task rows.
      </p>
      <ul>
        <li>
          <strong>Today.</strong> The count of tasks scheduled for the current
          day, shown in sky blue.
        </li>
        <li>
          <strong>Overdue.</strong> The count of tasks whose date has already
          passed, surfaced in red so nothing quietly slips.
        </li>
        <li>
          <strong>Coming up.</strong> The count of tasks on the near horizon,
          in amber, so you can see what is arriving before it does.
        </li>
      </ul>
      <p>
        Below the tiles, tasks are grouped the same way: overdue rows at the top
        in red, today&apos;s rows in blue, and upcoming rows in amber. Each row
        shows the task name and a right-aligned label (overdue tasks say
        &quot;Overdue&quot;, today&apos;s tasks show their type, upcoming tasks
        show a short date like &quot;Jun 16&quot;).
      </p>

      <h2>How it stays current</h2>
      <p>
        The phone does not compute your schedule. The laptop does, then publishes
        a sealed today snapshot, a small bundle of today&apos;s tasks plus the
        overdue and upcoming items. The phone pulls that snapshot and unseals it
        with its own key. Because the snapshot is sealed end-to-end, the relay
        passes it along without ever being able to read your task list, and the
        panel on the phone reflects whatever the laptop last published.
      </p>
      <p>
        The Home tab also surfaces a Today card with the same data, so you see
        your schedule the moment you open the app without navigating to the
        Notebook tab first.
      </p>

      <Callout variant="info" title="The Today button is on the Notebook tab, not the Home tab">
        The amber badge and the Today panel button live in the header of the
        Notebook tab. The Home tab shows an inline Today card instead (a static
        list inside the scrollable home surface). If you want the full overlay
        with stat tiles, go to the Notebook tab and tap Today in the header.
      </Callout>

      <Callout variant="tip" title="Turn it off if you prefer a cleaner Notebook tab">
        The Today panel is on by default because most people want the quick read.
        If you would rather not see the Today button on the Notebook tab, you can
        toggle &quot;Show Today&quot; off in the phone&apos;s Settings, and the
        button and its overlay are removed entirely.
      </Callout>

      <p>
        The today glance is the read-only counterpart to planning you do on the
        laptop. The schedule itself is built and edited there, on the{" "}
        <Link href="/wiki/features/calendar">calendar</Link> and across your
        projects, and the panel is simply that plan, delivered to your hand at
        the bench.
      </p>
    </WikiPage>
  );
}
