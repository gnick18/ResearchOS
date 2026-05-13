import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CalendarFeedsIntegrationPage() {
  return (
    <WikiPage
      title="External Calendar Feeds"
      intro="Overlay read-only events from Google, Outlook, iCloud, or your university on the ResearchOS calendar."
    >
      <Screenshot
        src="/wiki/screenshots/calendar-feeds-modal.png"
        alt="The Manage Feeds modal with a list of subscribed ICS URLs."
      />

      <h2>What it does</h2>
      <p>
        ResearchOS subscribes to <strong>ICS feed URLs</strong> — the same
        public URLs that Apple Calendar, Outlook, and Thunderbird use. Events
        from those feeds show up faded on the Calendar page so you can plan
        around them. They cannot be edited from ResearchOS.
      </p>

      <h2>Add a feed</h2>
      <Steps>
        <Step>
          On the Calendar page, click <strong>Manage Feeds</strong> (top-right).
        </Step>
        <Step>
          Paste the ICS URL, give it a name and a color, and click{" "}
          <strong>Add</strong>.
        </Step>
        <Step>
          The feed&apos;s events appear on the Calendar within a few seconds.
        </Step>
      </Steps>

      <h2>Where to find ICS URLs</h2>
      <h3>Google Calendar</h3>
      <ol className="list-decimal pl-6 space-y-1">
        <li>Open <code>calendar.google.com</code> on the web.</li>
        <li>
          Click the gear → <strong>Settings</strong>. Pick the calendar in
          the left sidebar.
        </li>
        <li>
          Scroll to <strong>Integrate calendar</strong>. Copy the{" "}
          <strong>Secret address in iCal format</strong> for private feeds,
          or the <strong>Public address in iCal format</strong> if the
          calendar is public.
        </li>
      </ol>

      <h3>Outlook (Microsoft 365)</h3>
      <ol className="list-decimal pl-6 space-y-1">
        <li>Open <code>outlook.live.com</code> or <code>outlook.office.com</code>.</li>
        <li>
          Settings → Calendar → <strong>Shared calendars</strong>.
        </li>
        <li>
          Under <strong>Publish a calendar</strong>, publish your calendar and
          copy the <strong>ICS</strong> link.
        </li>
      </ol>

      <h3>iCloud Calendar</h3>
      <ol className="list-decimal pl-6 space-y-1">
        <li>Open the Calendar app on a Mac.</li>
        <li>
          Right-click a calendar in the sidebar → <strong>Share Calendar</strong>.
        </li>
        <li>
          Tick <strong>Public Calendar</strong> and copy the{" "}
          <code>webcal://</code> URL. Paste it into ResearchOS as{" "}
          <code>https://</code> — both work.
        </li>
      </ol>

      <h3>University / institutional calendars</h3>
      <p>
        Most university course-schedule and seminar-series tools expose ICS
        feeds. Look for <strong>Subscribe</strong>, <strong>iCal</strong>, or{" "}
        <strong>Add to calendar</strong> options on the page.
      </p>

      <Callout variant="warning" title="Secret URLs are sensitive">
        A &quot;Secret address in iCal format&quot; from Google contains every
        event title in your calendar. Anyone with the URL can read it. Don&apos;t
        paste it into a shared lab folder if you wouldn&apos;t share the URL
        directly.
      </Callout>

      <Callout variant="info" title="Feeds refresh in the background">
        ResearchOS re-fetches each feed every few minutes while the app is
        open. If an event you just added in Google doesn&apos;t show up
        immediately, give it a minute, or reload the page.
      </Callout>
    </WikiPage>
  );
}
