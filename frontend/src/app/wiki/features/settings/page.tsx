import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function SettingsFeaturePage() {
  return (
    <WikiPage
      intro="Your profile, password, preferences, and folder management. Reach it via the gear icon in the top-right of the header."
    >
      <Screenshot
        src="/wiki/screenshots/settings.png"
        alt="The Settings page with Profile, Preferences, and Data Management sections."
      />

      <h2>Profile</h2>
      <ul>
        <li>
          <strong>User color</strong> — picks the tint used for your bars in
          Lab Mode and (optionally) for the header gradient.
        </li>
        <li>
          <strong>Set / change password</strong> — adds a PBKDF2-hashed
          password gate on the user-picker. See{" "}
          <Link href="/wiki/getting-started/creating-a-user">Creating a User</Link>.
        </li>
        <li>
          <strong>Colored header</strong> — when on, the app header takes a
          gradient based on your user color. Off → classic white header.
        </li>
      </ul>

      <h2>Preferences</h2>
      <ul>
        <li>
          <strong>Default landing tab</strong> — the page ResearchOS jumps to
          when you sign in.
        </li>
        <li>
          <strong>Gantt default view</strong> — 1 week through All time.
        </li>
        <li>
          <strong>Calendar default view</strong> — month, week, or day.
        </li>
        <li>
          <strong>Tab visibility</strong> — hide tabs you don&apos;t use.
          Home is always shown so you have a guaranteed safe landing.
        </li>
        <li>
          <strong>Sidebar options</strong> — toggle the daily tasks sidebar,
          show external calendar events alongside tasks, set the event horizon
          in days.
        </li>
      </ul>

      <h2>Data Management</h2>
      <ul>
        <li>
          <strong>Current folder</strong> — the name of the connected folder.
        </li>
        <li>
          <strong>Disconnect / Pick Different Folder</strong> — drops the
          current handle and reopens the folder picker. Your data on disk is
          untouched.
        </li>
        <li>
          <strong>Report a bug</strong> — opens a modal that captures app state
          for the developers.
        </li>
      </ul>

      <Callout variant="info" title="Settings are per-user, per-folder">
        Each user&apos;s preferences live in{" "}
        <code>users/&lt;you&gt;/settings.json</code>. Switching users loads
        their settings; switching folders gives you a clean slate.
      </Callout>
    </WikiPage>
  );
}
