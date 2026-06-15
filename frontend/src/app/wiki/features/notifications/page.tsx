import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function NotificationsFeaturePage() {
  return (
    <WikiPage
      title="Notifications & Inbox"
      intro="The bell, the photo inbox, and event reminders. All three live in the app shell, so you see new things wherever you're working."
    >
      <Screenshot
        src="/wiki/screenshots/notifications.png"
        alt="The notification bell with a count badge and the Inbox pill button beside it in the top-right of the app header."
        caption="The bell and the Inbox pill sit together in the top-right of the header, next to the help and settings icons."
      />

      <h2>What you&apos;ll see and where</h2>
      <p>
        ResearchOS surfaces new things in three places.
      </p>
      <ul>
        <li>
          <strong>The bell</strong> in the top-right of the header collects
          everything that needs your attention. Things someone shared with you
          (tasks, methods, projects), calendar reminders that have fired, shift
          alerts when a labmate reschedules a shared task, @-mentions in
          comments, and (in a lab) announcements, task assignments, purchase
          approvals, flag-for-review notes, and purchase-order updates. A red
          count badge appears when there are unread items.
        </li>
        <li>
          <strong>The Inbox pill</strong>, right next to the bell, opens a
          centered modal with two tabs, <strong>Shared with me</strong> (items
          another ResearchOS user sent you across folders) and{" "}
          <strong>Photos</strong> (images waiting to be filed into an
          experiment). The pill turns amber and shows a count that sums both
          when anything is waiting.
        </li>
        <li>
          <strong>An inbox toast</strong> appears at the bottom-right corner
          the moment a new photo arrives, so you can file it in one click
          without hunting for the modal.
        </li>
      </ul>

      <h2>The bell</h2>
      <p>
        Click the bell to drop down a list of notifications. Rows come in
        several kinds, each with its own icon. The three most common are below,
        and the lab-specific kinds follow.
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
        <li>
          <strong>@-mentions.</strong> When someone @-mentions you by name in a
          comment, that mention surfaces here as its own row so a direct callout
          doesn&apos;t get lost in the ambient comment feed.
        </li>
        <li>
          <strong>Lab notifications.</strong> Inside a lab, the bell also fires
          for announcements, task assignments your PI hands you, purchase
          approvals, flag-for-review notes on your records, and purchase-order
          updates (someone asked you to order a supply, or yours was ordered).
          Each lands as its own row with a <strong>View →</strong> or{" "}
          <strong>Open →</strong> link to the right surface.
        </li>
      </ul>
      <Screenshot
        src="/wiki/screenshots/notifications-shift-alert.png"
        alt="A shift-alert row in the bell dropdown reading 'Alex shifted PCR optimization by +3d', with old and new start dates underneath, and View task and Ignore buttons."
        caption="Shift-alert row in the bell. The amber delta is the headline. View task jumps to the new start date on the calendar, Ignore dismisses the row."
      />
      <p>
        Clicking anywhere on an unread row marks it as read but doesn&apos;t go
        anywhere. Clicking a row that is already read is a no-op. Each row also
        has a <strong>blue pill with a checkmark</strong> on the right that marks
        just that one item as read, so you can silence a single notification
        without touching the rest. Reminder rows have an
        extra <strong>Open in calendar →</strong>{" "}
        link that jumps the calendar to the day of the event and closes the
        dropdown. Shift-alert rows have <strong>View task →</strong> (jumps
        the calendar to the new start date and closes the dropdown) and{" "}
        <strong>Ignore</strong> (removes the row without touching anything
        else). Every row also has a small <strong>×</strong> on the right to
        dismiss it outright.
      </p>
      <p>
        At the top of the dropdown, <strong>Mark all read</strong> clears the
        unread badge without removing anything. It only appears when at least
        one unread item exists. <strong>Clear read</strong>{" "}
        removes the rows you&apos;ve already acknowledged, and only appears
        when at least one read item is present. <strong>Clear all</strong> empties
        the list (with a confirm prompt so you don&apos;t lose unread items by accident).
      </p>
      <p>
        The bell rechecks for new notifications every 30 seconds while the app
        is open. When something fires inside this tab (e.g., a calendar
        reminder), the badge updates immediately rather than waiting for the
        next poll. Shift alerts work differently. Another lab member writes them
        into your shared folder as sidecar files, so the bell scans for new
        ones once when the app loads. Closing and reopening the tab (or
        refreshing) is the cue that picks them up.
      </p>

      <h2>The Inbox modal</h2>
      <p>
        Click the Inbox pill to open a centered popup with two tabs. The{" "}
        <strong>Shared with me</strong> tab holds items another ResearchOS user
        sent you across folders (see{" "}
        <Link href="/wiki/features/sharing-and-permissions">Sharing &amp; Permissions</Link>{" "}
        for that flow), and the <strong>Photos</strong> tab, covered below,
        holds images waiting to be filed. Each photo row shows a thumbnail, the caption, the
        original filename, and the time it arrived.
      </p>
      <Screenshot
        src="/wiki/screenshots/photo-inbox.png"
        alt="The Inbox modal showing waiting photos with thumbnails, captions, timestamps, and per-row Move and Delete buttons."
        caption="Open the Inbox to see waiting photos. Each row has a Move-to-active and Delete button, and clicking the row opens an editor for the caption and filename."
      />
      <p>
        Each row carries these actions on the right.
      </p>
      <ul>
        <li>
          <strong>Move to active.</strong> Sends the photo into whichever
          surface is currently open in ResearchOS, whether an experiment, a note,
          or (if both popups are open) a small dropdown lets you pick
          between them. The button is disabled when nothing is open, with
          a tooltip explaining why.
        </li>
        <li>
          <strong>⋯ (more actions).</strong> A small ellipsis button that only
          fades in when you hover the row. Clicking it opens the same menu as
          right-click, anchored under the button, with <em>Send to task&hellip;</em>,{" "}
          <em>Send to note&hellip;</em>, <em>Move to active</em>, and{" "}
          <em>Delete</em>.
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
        a time.
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
        context menu. The top two items read <strong>Send to task&hellip;</strong>{" "}
        and <strong>Send to note&hellip;</strong> for a single row, or{" "}
        <strong>Send N items to task&hellip;</strong> /{" "}
        <strong>Send N items to note&hellip;</strong> when multiple are
        selected. Picking either opens a searchable picker (experiments
        sorted by most-recent start date, or notes sorted by
        most-recently-updated). Choose a destination and the whole batch
        moves there at once. Note destinations append a markdown image
        link to the note&apos;s latest entry as each photo lands, so the
        photos surface inline next time you open the note.
      </p>
      <Screenshot
        src="/wiki/screenshots/photo-inbox-multiselect.png"
        alt="The Inbox modal with three rows selected (blue borders) and the right-click context menu showing Send 3 items to task, Move to active, and Delete."
        caption="Shift-click or Cmd-click to select multiple inbox photos, then right-click for the batch menu."
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
        The moment a new photo arrives in your inbox, a toast appears
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
        small <strong>close</strong> button on a toast just dismisses the notification, the
        photo stays in the inbox until you act on it.
      </p>
      <Callout variant="tip" title="The toast is your fastest path to filing">
        If a photo lands while you&apos;re working in an experiment, the toast
        lets you attach it in one click without opening the Inbox modal at all.
      </Callout>

      <h2>Notification routing matrix</h2>
      <p>
        All notification routing is configured in{" "}
        <strong>Settings, Notifications</strong>. The matrix has five categories
        (rows) and four channels (columns). Each cell is an independent toggle.
      </p>
      <p>
        The five categories map the 14 internal notification types into
        user-facing groups.
      </p>
      <ul>
        <li>
          <strong>Shared &amp; assigned to me.</strong> A task, method, or
          project shared with you, or a task assigned or flagged for your review.
        </li>
        <li>
          <strong>Comments &amp; mentions.</strong> Someone comments on your
          work or @-mentions you.
        </li>
        <li>
          <strong>Lab announcements.</strong> Your PI posts a lab-wide
          announcement.
        </li>
        <li>
          <strong>Purchases &amp; orders.</strong> An order you requested is
          placed or approved, or one is assigned to you.
        </li>
        <li>
          <strong>Reminders &amp; schedule changes.</strong> Calendar reminders,
          and when a shared task&apos;s date shifts.
        </li>
      </ul>
      <p>
        The four channels are as follows.
      </p>
      <ul>
        <li>
          <strong>Bell (in-app).</strong> The bell in the laptop header always
          collects every notification in its category. The bell toggle is stored
          for a future &quot;mute from bell&quot; feature but does not currently
          suppress the in-app store.
        </li>
        <li>
          <strong>Laptop.</strong> Desktop pop-ups from the browser while a
          ResearchOS tab is open. Requires browser notification permission.
        </li>
        <li>
          <strong>Phone.</strong> A push to your paired Companion phone. Requires
          a cloud account (solo users without an account never see this column).
          The laptop must be open and publishing to deliver the push.
        </li>
        <li>
          <strong>Email.</strong> An email to the verified address on your
          account. Requires a cloud account (same gate as Phone).
        </li>
      </ul>
      <p>
        The defaults shipped in the product are: Shared gets Bell, Laptop, and
        Phone on; Comments gets Bell and Laptop; Lab announcements gets Bell and
        Email; Purchases gets Bell only; Reminders gets Bell, Laptop, and Phone.
      </p>

      <Screenshot
        src="/wiki/screenshots/notifications-routing-matrix.png"
        alt="The Notifications section in Settings, showing a 5-row by 4-column matrix of category-channel toggles, with a Quiet hours section below it."
        caption="Settings, Notifications. Five categories, four channels. Phone and Email only show for cloud account users."
      />

      <h2>Quiet hours</h2>
      <p>
        Quiet hours silence the push channels (Laptop, Phone, Email) during a
        time window you set. The bell still collects while quiet. Options are a
        start time, an end time (the window handles overnight ranges where start
        is after end, such as 19:00 to 08:00), and an optional{" "}
        <strong>weekends quiet</strong> flag that silences Saturday and Sunday
        entirely. Quiet hours ship off by default; opt in to activate them.
      </p>

      <h2>Solo-user gating</h2>
      <p>
        Phone and Email are account-only channels. A solo user working without a
        cloud account never sees the Phone or Email columns in the matrix, and any
        stored preference for those channels is ignored at dispatch time. This
        keeps the settings surface simple for local-only setups and prevents
        confusing &quot;why did that not buzz my phone&quot; moments.
      </p>

      <h2>Phone Notifications screen</h2>
      <p>
        The Companion phone app has a dedicated <strong>Notifications</strong>{" "}
        screen (reachable from the Home tab header bell icon). It shows the
        notifications the laptop has routed to your phone channel as a synced
        list. Each row shows a category-tinted icon chip, an unread dot, the
        notification title, a one-line body, and a relative time.
      </p>
      <p>
        The list is fetched from a sealed &quot;notifications&quot; snapshot the
        laptop publishes while open. It is not a live OS push feed; it is a
        polled mirror of what the laptop has sent to the phone channel. Pull down
        to refresh. Read state is owned by the laptop bell, so the list mirrors
        the laptop&apos;s read state rather than tracking reads separately on the
        phone.
      </p>
      <p>
        Opening the Notifications screen also refreshes the phone&apos;s push
        token, covering a token rotation or a notification permission granted
        after pairing.
      </p>

      <Callout variant="info" title="The phone channel needs the laptop open">
        The laptop publishes the notifications snapshot while it is running and
        a ResearchOS tab is open. If the laptop is closed or the tab is shut, no
        new notifications appear on the phone until the laptop is open again.
        The phone list shows a &quot;Last synced&quot; timestamp so you can see
        how fresh the data is.
      </Callout>

      <h2>Lab Inbox and comments</h2>
      <p>
        The bell handles things you need to acknowledge directly, including the
        @-mentions and lab notifications above. The broader comment stream lives
        in a separate surface, the{" "}
        <Link href="/wiki/features/lab-inbox">Lab Inbox</Link>. The two are
        kept separate on purpose.
      </p>
      <ul>
        <li>
          <strong>The bell pings you</strong> for things you need to
          acknowledge, including @-mentions, shares, fired reminders, shift
          alerts, and lab notifications.
        </li>
        <li>
          <strong>The Lab Inbox is ambient.</strong> Comments people left on
          your tasks and notes appear there, alongside the lab-wide
          announcement stream and the @-mention filter.
        </li>
      </ul>
      <p>
        The split is by urgency. A direct @-mention lands in the bell so you do
        not miss a callout, while general comments on records you can read stay
        in the Lab Inbox only. See{" "}
        <Link href="/wiki/features/lab-inbox/comments">Comments</Link> for
        the threading and mention model.
      </p>

      <h2>Event reminders</h2>
      <p>
        Reminders are a single setting that applies to every timed event on
        your calendar. Open the <strong>Calendar</strong> page and click{" "}
        <strong>Reminders</strong> at the top of the left sidebar. The popup
        holds three things.
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
        Reminder settings, the bell history, and the photo inbox are all
        per-user. If you share a folder with the rest of your lab, everyone
        has their own bell, their own inbox, and their own reminder
        preferences.
      </p>
    </WikiPage>
  );
}
