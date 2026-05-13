import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CalendarFeaturePage() {
  return (
    <WikiPage
      intro="Month, week, and day views of your tasks, with optional read-only overlays from Google, Outlook, and iCloud."
    >
      <Screenshot
        src="/wiki/screenshots/calendar-month.png"
        alt="The Calendar page in month view with task blocks and external feed events."
      />

      <h2>Switch views</h2>
      <ul>
        <li>
          <strong>Month</strong> — a grid of days with task blocks per day.
        </li>
        <li>
          <strong>Week</strong> — a 7-day stack with hourly slots.
        </li>
        <li>
          <strong>Day</strong> — focus mode for one day at a time. Useful
          first thing in the morning.
        </li>
      </ul>

      <h2>Create an event</h2>
      <Steps>
        <Step>
          Click any empty slot in week or day view. A quick-add popover opens.
        </Step>
        <Step>
          Type a title. Optionally pick a project (which inherits its color)
          and set a reminder time.
        </Step>
        <Step>
          Click <strong>Create</strong>. The event appears in the slot and is
          saved under <code>users/&lt;you&gt;/events/</code>.
        </Step>
      </Steps>

      <h2>External calendar feeds</h2>
      <p>
        Click <strong>Manage Feeds</strong> (top-right) to subscribe to ICS
        URLs from Google Calendar, Outlook, iCloud, or your university. Feed
        events appear faded behind your ResearchOS tasks and are read-only.
        See{" "}
        <Link href="/wiki/integrations/calendar-feeds">External Calendar
        Feeds</Link> for the setup steps.
      </p>

      <Callout variant="tip" title="Reminders">
        Toggle the bell on any event in the popover to schedule a desktop
        notification. The notification fires only while ResearchOS is open in
        a tab.
      </Callout>
    </WikiPage>
  );
}
