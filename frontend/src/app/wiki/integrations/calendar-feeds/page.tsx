import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CalendarFeedsIntegrationPage() {
  return (
    <WikiPage
      title="External Calendar Feeds"
      intro="Overlay events from Google, Outlook, iCloud, or any public iCal URL on the ResearchOS calendar. Read-only, so you can plan around them without ResearchOS ever writing back to the source."
    >
      <Screenshot
        src="/wiki/screenshots/calendar-feeds-modal.png"
        alt="The Linked Calendars panel with a connected ICS subscription and the paste-a-URL form."
      />

      <h2>What it does</h2>
      <p>
        Each linked calendar shows its events on the Calendar page in the
        color you pick, sitting alongside ResearchOS tasks and events.
        Clicking an event opens a popup with the title, time, and any
        location or notes the source calendar published.
      </p>
      <p>
        This page only covers the paste-a-URL flow, where you copy a
        public ICS link out of Google, Outlook, or iCloud and ResearchOS
        re-reads it on a timer. The events are read-only. If you want to
        drag, retitle, or delete events from inside ResearchOS, use the{" "}
        <strong>Connect</strong> button for Google or Outlook on the same
        panel and follow the{" "}
        <a href="/wiki/integrations/calendar-oauth">Calendar OAuth Setup</a>{" "}
        page instead.
      </p>

      <h2>Open the Linked Calendars panel</h2>
      <p>
        Go to the <strong>Calendar</strong> page. The{" "}
        <strong>Linked Calendars</strong> button sits top-right, next to{" "}
        <strong>+ New Event</strong>. A small blue badge on the button
        counts how many subscriptions are currently turned on.
      </p>

      <h2>Add a calendar by ICS URL</h2>
      <Steps>
        <Step>
          Click <strong>Linked Calendars</strong>, then scroll the panel
          down to <strong>Or paste a public iCal / ICS URL</strong>.
        </Step>
        <Step>
          Pick the source from the <strong>Provider</strong> dropdown
          (iCloud / Apple Calendar, Google Calendar (ICS), Outlook /
          Office 365 (ICS), or Other).
        </Step>
        <Step>
          Type a <strong>Label</strong> (this is what shows up on the
          Calendar page) and click one of the 10 swatches under{" "}
          <strong>Color</strong>.
        </Step>
        <Step>
          Paste the URL into the <strong>ICS URL</strong> field and click{" "}
          <strong>Add Calendar</strong>. The button shows{" "}
          <strong>Testing&hellip;</strong> while ResearchOS fetches the
          feed to confirm it parses.
        </Step>
        <Step>
          If the feed parses but contains no events within a ±2-year
          window of today, you'll get a confirmation dialog before the
          subscription saves. That's the normal case for stale or empty
          calendars.
        </Step>
      </Steps>

      <Callout variant="tip" title="webcal:// is fine">
        Paste a <code>webcal://</code> URL exactly as iCloud (or any other
        client) gives it to you. The server proxy rewrites it to{" "}
        <code>https://</code> automatically before fetching.
      </Callout>

      <h2>Where to copy the ICS URL from</h2>
      <p>
        Inside the panel, the <strong>Where do I find this URL?</strong>{" "}
        link expands a per-provider checklist that matches whichever
        Provider you have selected. The summaries below are the same
        steps in long form.
      </p>

      <h3>Google Calendar</h3>
      <ol className="list-decimal pl-6 space-y-1">
        <li>Open <code>calendar.google.com</code> in a desktop browser.</li>
        <li>
          Click the gear &rarr; <strong>Settings</strong> &rarr;{" "}
          <strong>Settings for my calendars</strong>.
        </li>
        <li>Pick the calendar you want to share in the sidebar.</li>
        <li>
          Copy <strong>Secret address in iCal format</strong> for a
          private calendar, or <strong>Public address in iCal format</strong>{" "}
          if the calendar is already public.
        </li>
      </ol>

      <h3>Outlook / Microsoft 365</h3>
      <ol className="list-decimal pl-6 space-y-1">
        <li>
          Open Outlook on the web &rarr; <strong>Settings</strong> &rarr;{" "}
          <strong>Calendar</strong> &rarr;{" "}
          <strong>Shared calendars</strong>.
        </li>
        <li>
          Under <strong>Publish a calendar</strong>, pick the calendar,
          choose <strong>Can view all details</strong>, and click{" "}
          <strong>Publish</strong>.
        </li>
        <li>Copy the <strong>ICS</strong> link Outlook generates.</li>
      </ol>

      <h3>iCloud / Apple Calendar</h3>
      <ol className="list-decimal pl-6 space-y-1">
        <li>
          Open the Calendar app on macOS, or sign in to{" "}
          <code>iCloud.com</code> in a browser.
        </li>
        <li>
          Right-click the calendar in the sidebar &rarr;{" "}
          <strong>Share Calendar</strong> &rarr;{" "}
          <strong>Public Calendar</strong>.
        </li>
        <li>
          Copy the share link. It starts with <code>webcal://</code>,
          which is fine to paste as-is.
        </li>
      </ol>

      <h3>Any other public iCal feed</h3>
      <p>
        Pick <strong>Other (any public iCal URL)</strong> in the Provider
        dropdown. That covers university course schedules, lab seminar
        series, conference timetables, sports schedules, anything that
        ends in <code>.ics</code> or starts with <code>webcal://</code>.
      </p>

      <Callout variant="warning" title="Secret URLs leak your whole calendar">
        Google's <em>Secret address in iCal format</em> grants read access
        to every event title, time, and note in that calendar to anyone
        who has the URL. Treat it like a password (e.g., don't paste it
        into Slack, a public repo, or a shared notes doc). ResearchOS
        keeps the URL in your private data folder.
      </Callout>

      <h2>After a calendar is connected</h2>
      <p>
        Each subscription becomes a row in the <strong>Connected</strong>{" "}
        list at the top of the panel. The row shows:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          The label you gave it, plus a small uppercase tag with the
          provider type.
        </li>
        <li>The full ICS URL, truncated to one line.</li>
        <li>
          A <strong>Last synced</strong> timestamp once ResearchOS has
          fetched the feed at least once.
        </li>
        <li>
          A 5-swatch color strip on the left edge of the row. Click any
          swatch to recolor that calendar's events on the grid.
        </li>
        <li>
          An <strong>On</strong> / <strong>Off</strong> checkbox to hide
          a calendar's events without removing the subscription.
        </li>
        <li>
          A red <strong>Remove</strong> link to drop the subscription. A
          confirmation dialog reminds you that ResearchOS events aren't
          touched.
        </li>
      </ul>

      <h2>How often feeds refresh</h2>
      <p>
        ResearchOS refetches each feed at most once every 15 minutes per
        browser session. The fetch goes through a small server proxy
        (the same Vercel function that bypasses CORS for Google, Outlook,
        and iCloud), and the proxy caches the response on its own edge
        cache for another 15 minutes. Back-to-back page loads don't
        hammer the source calendar's servers as a result.
      </p>
      <p>
        If you just added an event in the source calendar and want it on
        the ResearchOS grid right now, hard-refresh the browser tab or
        wait out the 15-minute window.
      </p>

      <h2>What URLs the server proxy will fetch</h2>
      <p>
        The proxy is the small server endpoint that fetches each ICS URL
        on your behalf, because browsers can't fetch{" "}
        <code>calendar.google.com</code> directly (Google doesn't set the
        right CORS headers). The proxy refuses a few classes of URL
        outright so it can't be used to scan internal infrastructure:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          Anything that isn't <code>http://</code> or <code>https://</code>{" "}
          (so no <code>file://</code>, no <code>ftp://</code>). The{" "}
          <code>webcal://</code> prefix is rewritten to{" "}
          <code>https://</code> first, so iCloud URLs still work.
        </li>
        <li>
          <code>localhost</code> and the loopback range{" "}
          <code>127.0.0.0/8</code>.
        </li>
        <li>
          Private IPv4 ranges: <code>10.0.0.0/8</code>,{" "}
          <code>172.16.0.0/12</code>, <code>192.168.0.0/16</code>.
        </li>
        <li>
          Link-local <code>169.254.0.0/16</code> and the IPv6 equivalents{" "}
          (<code>fe80::/10</code>, <code>fc00::/7</code>,{" "}
          <code>::1</code>).
        </li>
        <li>
          Responses that don't start with <code>BEGIN:VCALENDAR</code>.
          This catches the case where a calendar share URL redirects to
          an HTML sign-in page instead of returning iCal text.
        </li>
      </ul>
      <p>
        If a paste fails with one of those errors, double-check that the
        URL is the public ICS variant of the calendar (not the regular
        web-app share link).
      </p>

      <h2>Recurring events</h2>
      <p>
        Repeating events (e.g., a weekly seminar) are expanded into one
        chip per occurrence inside a ±2-year window around today. That
        keeps a 20-year-long daily recurrence from spawning ~7,300 chips
        on the grid. If you scroll the calendar more than two years
        backward or forward, repeating events from external feeds will
        stop showing up until you refresh the page from a closer date.
      </p>

      <h2>Want to edit Google or Outlook events from ResearchOS?</h2>
      <p>
        The same panel has a <strong>Connect</strong> button for Google
        and Outlook accounts above the paste-a-URL form. That path uses
        OAuth instead of an ICS URL and lets you reschedule, retitle,
        and delete events without leaving ResearchOS. It needs a
        one-time setup on the deployment (an OAuth client registered
        against Google or Microsoft). See{" "}
        <a href="/wiki/integrations/calendar-oauth">Calendar OAuth Setup</a>{" "}
        for the full walkthrough.
      </p>
      <p>
        Apple doesn't expose a comparable write API, so iCloud calendars
        stay read-only no matter which method you use.
      </p>
    </WikiPage>
  );
}
