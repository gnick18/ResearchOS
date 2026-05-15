import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function NotificationsFeaturePage() {
  return (
    <WikiPage
      title="Notifications & Inbox"
      intro="The bell, the Telegram inbox, and event reminders. All three live in the app shell, so you see new things wherever you're working."
    >
      <Screenshot
        src="/wiki/screenshots/notifications.png"
        alt="The notification bell with a count badge and the Inbox pill button beside it in the top-right of the app header."
        caption="The bell and the Inbox pill sit together in the top-right of the header, next to the help and settings icons."
      />

      <h2>What you&apos;ll see and where</h2>
      <p>
        ResearchOS shows you new things in three places:
      </p>
      <ul>
        <li>
          <strong>The bell</strong> in the top-right of the header collects
          everything someone shared with you (tasks, methods, projects),
          calendar reminders that have fired, and shift alerts when another
          lab member reschedules a shared task. A red count badge appears
          when there are unread items.
        </li>
        <li>
          <strong>The Inbox pill</strong>, right next to the bell, opens a
          centered modal of Telegram photos waiting to be filed into an
          experiment. The pill turns amber and shows a count when photos are
          waiting.
        </li>
        <li>
          <strong>An inbox toast</strong> appears at the bottom-right corner
          the moment a new Telegram photo arrives, so you can file it in one
          click without hunting for the modal.
        </li>
      </ul>

      <h2>The bell</h2>
      <p>
        Click the bell to drop down a list of notifications. Each row is one
        of three kinds:
      </p>
      <ul>
        <li>
          <strong>Shared with you.</strong> When another lab member shares a
          task, method, or project with you, a row appears here showing who
          shared it, what it was, and whether you got view or edit access.
        </li>
        <li>
          <strong>Event reminder.</strong> When a calendar reminder you set up
          fires (see below), a row lands here with the event title, the time
          it starts, and how many minutes you asked to be warned in advance.
        </li>
        <li>
          <strong>Shift alert.</strong> When another lab member with edit
          access reschedules a task you also have access to, a row appears
          reading <em>&ldquo;Alex shifted PCR optimization by +3d&rdquo;</em>{" "}
          with the old and new start dates underneath. The amber delta covers
          start-date moves and, when start and end shifted by different
          amounts, the end-date move is shown on the second line. Use it to
          keep tabs on a shared schedule without watching the Gantt all day.
        </li>
      </ul>
      <Screenshot
        src="/wiki/screenshots/notifications-shift-alert.png"
        alt="A shift-alert row in the bell dropdown reading 'Alex shifted PCR optimization by +3d', with old and new start dates underneath, and View task and Ignore buttons."
        caption="Shift-alert row in the bell. The amber delta is the headline. View task jumps to the new start date on the calendar, Ignore dismisses the row."
      />
      <p>
        Clicking anywhere on a row marks it as read but doesn&apos;t go
        anywhere. Reminder rows have an extra <strong>Open in calendar →</strong>{" "}
        link that jumps the calendar to the day of the event and closes the
        dropdown. Shift-alert rows have <strong>View task →</strong> (jumps
        the calendar to the new start date and closes the dropdown) and{" "}
        <strong>Ignore</strong> (removes the row without touching anything
        else). Every row also has a small <strong>×</strong> on the right to
        dismiss it outright.
      </p>
      <p>
        At the top of the dropdown, <strong>Mark all read</strong> clears the
        unread badge without removing anything. <strong>Clear read</strong>{" "}
        removes the rows you&apos;ve already acknowledged, and{" "}
        <strong>Clear all</strong> empties the list (with a confirm prompt so
        you don&apos;t lose unread items by accident).
      </p>
      <p>
        The bell rechecks for new notifications every 30 seconds while the app
        is open. When something fires inside this tab (e.g., a calendar
        reminder), the badge updates immediately rather than waiting for the
        next poll. Shift alerts are different: another lab member writes them
        into your shared folder as sidecar files, so the bell scans for new
        ones once when the app loads. Closing and reopening the tab (or
        refreshing) is the cue that picks them up.
      </p>

      <h2>The Inbox modal</h2>
      <p>
        The Inbox pill in the header counts photos sitting in your Telegram
        inbox folder. Click it to open the Inbox modal, a centered popup over
        the rest of the app. Each row shows a thumbnail, the caption you sent
        with the photo, the original filename, and the time it arrived.
      </p>
      <Screenshot
        src="/wiki/screenshots/telegram-inbox.png"
        alt="The Inbox modal showing waiting Telegram photos with thumbnails, captions, timestamps, and per-row Move and Delete buttons."
        caption="Open the Inbox to see waiting photos. Each row has a Move-to-active and Delete button, and clicking the row opens an editor for the caption and filename."
      />
      <p>
        Each row has these actions on the right:
      </p>
      <ul>
        <li>
          <strong>Move to active.</strong> Sends the photo into the experiment
          whose popup is currently open. The button is disabled until you open
          an experiment popup, with a tooltip explaining why.
        </li>
        <li>
          <strong>⋯ (more actions).</strong> A small ellipsis button that only
          fades in when you hover the row. Clicking it opens the same menu as
          right-click, anchored under the button: <em>Send to task&hellip;</em>,{" "}
          <em>Move to active</em>, and <em>Delete</em>.
        </li>
        <li>
          <strong>Delete.</strong> Removes the photo from the inbox folder
          (with a confirm prompt).
        </li>
      </ul>
      <p>
        Clicking a single row opens an image editor where you can rename the
        file, edit the caption, see when it was received, and either move it to
        the active experiment or delete it.
      </p>

      <h3>Filing a batch with multi-select</h3>
      <p>
        For a stack of photos that all belong to the same experiment, the
        modal supports multi-select so you don&apos;t have to file them one at
        a time:
      </p>
      <ul>
        <li>
          <strong>Shift-click</strong> a second row to select the contiguous
          range from your last anchor row to this one.
        </li>
        <li>
          <strong>Cmd-click</strong> (or <strong>Ctrl-click</strong> on
          Windows / Linux) to toggle individual rows in and out of the
          selection without disturbing the rest.
        </li>
        <li>
          Selected rows pick up a blue border and a blue ring so you can see
          the group at a glance. Clicking the empty area of the modal clears
          the selection.
        </li>
      </ul>
      <p>
        With one or more rows selected, <strong>right-click any selected
        row</strong> (or click the <strong>⋯</strong> button) to open a
        context menu. The top item reads <strong>Send to task&hellip;</strong>{" "}
        for a single row and <strong>Send N items to task&hellip;</strong>{" "}
        when multiple are selected. Picking it opens the{" "}
        <strong>Send to task picker</strong>, a searchable list of your
        experiments. Choose one and the whole batch moves into that task at
        once.
      </p>
      <Screenshot
        src="/wiki/screenshots/telegram-inbox-multiselect.png"
        alt="The Inbox modal with three rows selected (blue borders) and the right-click context menu showing Send 3 items to task, Move to active, and Delete."
        caption="Shift-click or Cmd-click to select multiple inbox photos, then right-click for the batch menu. The label updates to reflect how many items will be sent."
      />
      <p>
        If any filename in the batch collides with an existing image in the
        destination task, the duplicate-resolution dialog pops up for each
        collision so you can <strong>Rename</strong>, <strong>Replace</strong>,
        or <strong>Cancel</strong> per item. Non-colliding items go through
        without interruption. When the batch finishes, a green toast in the
        bottom-right corner of the modal confirms how many items landed in the
        target task.
      </p>
      <Callout variant="tip" title="Right-click a single row to skip the active-experiment dance">
        Right-click any inbox row (no multi-select needed) and pick{" "}
        <strong>Send to task&hellip;</strong> to send that one photo to any
        experiment, even one you don&apos;t have open. It&apos;s the fastest
        way to file a photo into the right experiment without first opening
        that experiment&apos;s popup.
      </Callout>

      <h2>The bottom-right toast</h2>
      <p>
        The moment a new photo arrives in your Telegram inbox, a toast appears
        in the bottom-right corner with a thumbnail, the caption, and a one-click
        action. If an experiment popup is open, the action is{" "}
        <strong>File here</strong>, which moves the photo straight into that
        experiment. If nothing&apos;s open, the action is{" "}
        <strong>Open inbox</strong>, which pops the Inbox modal so you can sort
        it manually.
      </p>
      <p>
        Toasts auto-dismiss after about 12 seconds, and any photo you file or
        delete elsewhere also drops out of the toast queue automatically. The
        small <strong>✕</strong> on a toast just dismisses the notification, the
        photo stays in the inbox until you act on it.
      </p>
      <Callout variant="tip" title="The toast is your fastest path to filing">
        If a photo lands while you&apos;re working in an experiment, the toast
        lets you attach it in one click without opening the Inbox modal at all.
      </Callout>

      <h2>Event reminders</h2>
      <p>
        Reminders are a single setting that applies to every timed event on
        your calendar. Open the <strong>Calendar</strong> page and click{" "}
        <strong>Reminders</strong> at the top of the left sidebar. The popup
        has:
      </p>
      <ul>
        <li>
          A master <strong>Enable reminders</strong> checkbox.
        </li>
        <li>
          A <strong>Remind me</strong> dropdown for how far in advance to fire
          (1 minute, 5, 10, 15, 30, 1 hour, 2 hours, or 1 day before).
        </li>
        <li>
          A button to grant your browser permission to show OS-level popups,
          plus a <strong>Send test</strong> link once it&apos;s granted.
        </li>
      </ul>
      <p>
        With reminders on, every timed event in the next 24 hours is queued.
        When the chosen lead time hits, a row appears in the bell and (if
        you&apos;ve granted browser permission) an OS notification pops on top
        of whatever you&apos;re doing. All-day events don&apos;t produce
        reminders, since there&apos;s no obvious moment to fire them at.
      </p>

      <Callout variant="warning" title="Reminders need a tab open">
        Because ResearchOS has no server, reminders only fire while a
        ResearchOS tab is open in your browser. If you close every tab, the
        in-app row still appears the next time you open the app, but no live
        OS popup will go off in the meantime. For phone-side or
        always-on-but-laptop-asleep reminders, link your external calendar
        instead, see{" "}
        <Link href="/wiki/integrations/calendar-feeds">Calendar Feeds</Link>.
      </Callout>
      <p>
        Reminder settings, the bell history, and the Telegram inbox are all
        per-user. If you share a folder with the rest of your lab, everyone
        has their own bell, their own inbox, and their own reminder
        preferences.
      </p>
    </WikiPage>
  );
}
