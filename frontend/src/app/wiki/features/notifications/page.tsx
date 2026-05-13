import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function NotificationsFeaturePage() {
  return (
    <WikiPage
      title="Notifications & Inbox"
      intro="The bell, the inbox tray, and event reminders in one place. All in the top-right of the header."
    >
      <Screenshot
        src="/wiki/screenshots/notifications.png"
        alt="The notification bell with a count badge and the inbox icon beside it in the header."
        caption="The bell and inbox icons sit together in the top-right of the header."
      />

      <h2>What you&apos;ll see and where</h2>
      <p>
        The top-right of the header has two icons sitting next to each other:
        a <strong>bell</strong> for notifications and an <strong>inbox</strong>{" "}
        for Telegram-arrived photos. Both can carry a small number badge when
        new things show up. A third surface, <strong>event reminders</strong>,
        is a browser notification that pops out from the OS itself when a
        calendar reminder fires. They cover different kinds of "new" but
        you&apos;ll learn the corners of the app from these three.
      </p>

      <h2>The bell</h2>
      <ul>
        <li>
          Counts unread notifications. Polls every 30 seconds while the app is
          open.
        </li>
        <li>
          Click to open the notification history. Notifications include items
          someone shared with you and event reminders fired by{" "}
          <strong>ReminderRunner</strong>.
        </li>
        <li>
          Click a notification to jump to the relevant task or event.
        </li>
      </ul>

      <h2>The inbox</h2>
      <p>
        Images sent via the Telegram bot land here as a small tray. Drag an
        image from the inbox into any experiment&apos;s notes to attach it.
        See <Link href="/wiki/integrations/telegram">Telegram Bot</Link>.
      </p>

      <h2>Event reminders</h2>
      <p>
        On the Calendar, set a reminder on any event (i.e., the bell button
        on the event popover). When the reminder time arrives and ResearchOS
        is open in a tab, a desktop notification fires. Browser notification
        permissions must be granted for this to work.
      </p>

      <Callout variant="warning" title="Reminders need the tab open">
        ResearchOS has no server, so reminders only fire while a tab is open.
        If you close the browser, reminders are skipped silently. Use the
        external calendar feed feature if you need reminders that work
        offline.
      </Callout>
    </WikiPage>
  );
}
