import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CalendarFeaturePage() {
  return (
    <WikiPage
      intro="A month, week, and day calendar for your conferences, deadlines, and meetings, with optional overlays from Google, Outlook, and iCloud."
    >
      <Screenshot
        src="/wiki/screenshots/calendar-month.png"
        alt="The Calendar page in month view, with native event blocks and the +New Event button in the top right."
      />

      <h2>The Calendar page</h2>
      <p>
        The Calendar page lays out your ResearchOS events on a grid
        alongside any read-only items pulled in from a linked Google,
        Outlook, or iCloud calendar. Both kinds of event render with a
        filled colored background. The text color flips between black and
        white automatically so the title stays readable regardless of
        which color a feed picks. External events also carry a small link
        icon in the corner, which is the visual cue that the event came
        from a linked calendar rather than from a ResearchOS write.
      </p>
      <p>
        The header strip holds the current date heading, prev/next arrows,
        a <strong>Today</strong> shortcut, and a{" "}
        <strong>month / week / day</strong> toggle. The two buttons on the
        far right are <strong>Linked Calendars</strong> (connect Google,
        Outlook, or paste an iCal URL) and <strong>+ New Event</strong>.
      </p>

      <h2>Switch views</h2>
      <ul>
        <li>
          <strong>Month</strong> is a 7-column grid of day cells. Each cell
          shows up to three events, and the rest collapse into a{" "}
          <code>+N more</code> count (a non-clickable label, not a link).
          Single-click a day to open a day-detail drawer listing every event
          on that date. Double-click to start a new event prefilled with that date.
        </li>
        <li>
          <strong>Week</strong> is a 7-day stack with an all-day strip
          across the top and an hourly time grid below. Click any empty
          15-minute slot in the grid to open the New Event popover
          prefilled with that date and time. A red &ldquo;now&rdquo; line
          tracks the current minute on today&apos;s column.
        </li>
        <li>
          <strong>Day</strong> shows the same hourly grid for a single day,
          also with a red &ldquo;now&rdquo; line tracking the current minute.
          Useful first thing in the morning, and roomy enough to show an
          event&apos;s location inline.
        </li>
      </ul>

      <Callout variant="info" title="Default view">
        The month/week/day toggle changes your view for the current session only.
        The change is ephemeral. When you reload the app, the calendar returns to
        its persisted startup view. To change that startup view, open{" "}
        <strong>Settings</strong> → <strong>View defaults</strong> and pick a
        different starting view. ResearchOS reads the setting from settings.json
        on load and hydrates the calendar to that view before rendering.
      </Callout>

      <h2>Create an event</h2>
      <Steps>
        <Step>
          Click <strong>+ New Event</strong> in the top right. You can also
          double-click a day in month view, or single-click an empty slot
          in week or day view, to open the popover prefilled with that
          date (and a 15-minute snapped start time when applicable).
        </Step>
        <Step>
          Fill in a <strong>Title</strong>, pick a <strong>Type</strong>{" "}
          (Conference, Deadline, Meeting, or Other), and set the start and
          end dates. Leaving both time fields blank makes it an all-day
          event.
        </Step>
        <Step>
          Optionally add a <strong>Location</strong>, a <strong>URL</strong>,
          a <strong>Color</strong> from the palette, and free-form{" "}
          <strong>Notes</strong>.
        </Step>
        <Step>
          Click <strong>Create Event</strong>. The block appears in the
          selected date(s) in whichever view is active.
        </Step>
      </Steps>

      <Callout variant="info" title="Default colors by type">
        If you don&apos;t pick a color, the event uses its type&apos;s
        default, which is purple for conferences, red for deadlines, blue for
        meetings, and gray for other.
      </Callout>

      <h2>Edit or delete an event</h2>
      <p>
        Click a ResearchOS event block to open its
        details popover. <strong>Edit</strong> swaps the popover into a
        form with every field, including a &ldquo;Clear times (make
        all-day)&rdquo; shortcut. <strong>Save</strong> writes the change.
        <strong> Delete</strong> removes the event after a confirmation.
      </p>

      <Callout variant="info" title="Mark as PTO day">
        The event create/edit modal includes a <strong>Mark as PTO day</strong>{" "}
        checkbox. Events flagged PTO display a badge on their chip in the
        calendar grid. ResearchOS also factors PTO days into streaks and project
        schedule calculations, so marking time off keeps your progress tracking
        accurate.
      </Callout>

      <h2>Linked calendars (Google, Outlook, iCloud)</h2>
      <Screenshot
        src="/wiki/screenshots/calendar-feeds-modal.png"
        alt="The Linked Calendars modal showing the Connected list at top and an iCal URL form below."
      />
      <p>
        Click <strong>Linked Calendars</strong> in the top right (or{" "}
        <strong>Manage</strong> in the sidebar) to open the modal. You can also
        navigate to <code>/calendar?addFeed=1</code> directly, which auto-opens
        the modal so you can share a deep-link that drops someone straight into
        the add-feed flow. The same iCal-URL flow works for all four providers.
      </p>
      <ul>
        <li>
          <strong>Google Calendar</strong> exposes a per-calendar{" "}
          <em>Secret address in iCal format</em> under Settings → Settings
          for my calendars. Copy that URL, paste it into the form.
        </li>
        <li>
          <strong>Outlook / Microsoft 365</strong> publishes a calendar
          from Settings → Calendar → Shared calendars → Publish a calendar.
          Copy the ICS link Outlook generates, paste it into the form.
        </li>
        <li>
          <strong>iCloud / Apple Calendar</strong> shares via Calendar app
          → right-click → Share Calendar → Public Calendar. Paste the{" "}
          <code>webcal://</code> URL as-is. ResearchOS rewrites it
          automatically.
        </li>
        <li>
          <strong>Other (any iCal URL)</strong> accepts any standard{" "}
          <code>.ics</code> feed URL, so you can add lab-managed or
          third-party calendars that aren&apos;t one of the three named providers.
        </li>
      </ul>
      <p>
        Every linked calendar gets a color in the sidebar legend. The Linked
        Calendars modal also has a per-feed <strong>color picker</strong> so
        you can recolor any feed to match your preferences without disconnecting
        and re-adding it. Toggle a feed on or off from either the modal or the
        legend. Remove a feed with the <strong>Remove</strong> link in the modal.
        Feeds refetch every 15 minutes. If a feed fails to fetch, an amber banner
        appears above the calendar grid with a <strong>Retry now</strong>{" "}
        button.
      </p>
      <p>
        Clicking a linked event opens a read-only popover with the title,
        time, location, and any notes the source calendar published. To
        edit a linked event, open it in its source app (Google Calendar,
        Outlook, Apple Calendar) and the change shows up in ResearchOS on
        the next 15-minute refresh.
      </p>
      <p>
        Want the deep-dive?{" "}
        <Link href="/wiki/integrations/calendar-feeds">Calendar Feeds</Link>{" "}
        walks through per-provider setup with screenshots.
      </p>

      <Callout variant="warning" title="iCal URLs are sensitive">
        A public iCal URL grants read access to every event on that
        calendar to anyone who has the link. ResearchOS only stores it in
        your private data folder, but treat the URL itself like a password.
      </Callout>

      <h2>Reminders</h2>
      <p>
        Reminders are a single global preference, set from the{" "}
        <strong>Reminders</strong> link at the top of the calendar
        sidebar. The modal lets you turn reminders on, pick how far ahead
        you want to be notified (anywhere from 1 minute to 1 day before),
        and optionally grant browser-notification permission for an
        OS-level popup.
      </p>
      <p>
        When a timed event&apos;s reminder fires, ResearchOS adds an entry
        to the bell inbox in the top bar. If you&apos;ve granted browser
        permission, it also raises a system notification you can click to
        jump back to the tab. All-day events don&apos;t produce reminders,
        since there&apos;s no obvious moment to fire on.
      </p>

      <Callout variant="warning" title="A tab has to be open">
        Reminders run in JavaScript inside an open ResearchOS tab. If
        every tab is closed at the moment the reminder is due, the
        real-time popup won&apos;t fire, but the reminder is still
        waiting in the bell inbox the next time you open the app.
      </Callout>

      <h2>The Calendar sidebar</h2>
      <p>
        On the Calendar page the usual left sidebar swaps in a
        calendar-specific one with two sections.
      </p>
      <ul>
        <li>
          <strong>Calendars</strong> lists ResearchOS events plus every
          linked feed, color-matched to the grid. Click a feed row to hide
          or show its events without disconnecting it. Click the color swatch
          on any row to recolor it, including the ResearchOS events row, so
          you can override the per-type defaults with one color for all your
          native events. The <strong>Reminders</strong> and{" "}
          <strong>Manage</strong> links sit at the top of this section.
        </li>
        <li>
          <strong>Upcoming</strong> shows the next 30 days, grouped by
          date (Today / Tomorrow / weekday + date) with up to 40 entries.
          Click any item to jump the main calendar to that day in day
          view.
        </li>
      </ul>
    </WikiPage>
  );
}
