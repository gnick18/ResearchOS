import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CalendarOAuthSetupPage() {
  return (
    <WikiPage
      title="Calendar OAuth Setup (for deployers)"
      intro="One-time setup that turns the 'Connect Google Calendar' / 'Connect Outlook' buttons on for every user of your ResearchOS deployment."
    >
      <Callout variant="info" title="Who needs to read this?">
        Only the person who deploys ResearchOS (i.e. owns the Vercel project,
        or runs the local dev server). End users get a one-click connect
        experience once these env vars are set — they never touch any of
        this.
      </Callout>

      <h2>What you&apos;re setting up</h2>
      <p>
        ResearchOS uses real OAuth (PKCE flow) for Google Calendar and
        Microsoft Outlook so users can read <em>and edit</em> events from
        ResearchOS. That requires a one-time registration with each provider
        plus a few env vars in your deployment. Apple/iCloud stays
        ICS-only — Apple doesn&apos;t expose a write API to third parties.
      </p>

      <p>
        Total time: <strong>~20–30 minutes</strong>, mostly waiting for forms
        to load. Completely free.
      </p>

      <Callout variant="warning" title="Skip Google entirely if…">
        …you don&apos;t want to deal with Google&apos;s OAuth-app review. The{" "}
        <code>calendar.events</code> scope is &ldquo;restricted&rdquo; — an
        unverified app shows a warning screen on first sign-in and is capped
        at 100 testers. For a closed lab that&apos;s usually fine. If you
        plan to ship publicly to thousands of users, Google requires a paid
        CASA security audit. Outlook has no equivalent gate at the same
        scale, so you can ship Outlook alone if you prefer.
      </Callout>

      <h2>Step 1 · Register a Google OAuth client</h2>
      <Steps>
        <Step>
          Open{" "}
          <a
            href="https://console.cloud.google.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            console.cloud.google.com
          </a>{" "}
          and create a new project (or pick an existing one).
        </Step>
        <Step>
          Sidebar → <strong>APIs &amp; Services</strong> →{" "}
          <strong>Library</strong> → search &ldquo;Google Calendar API&rdquo;
          → <strong>Enable</strong>.
        </Step>
        <Step>
          Sidebar → <strong>APIs &amp; Services</strong> →{" "}
          <strong>OAuth consent screen</strong>. Fill in app name (e.g.
          &ldquo;ResearchOS&rdquo;), user support email, and developer email.
          Pick <strong>External</strong> as the user type. Save and continue
          through the scope screens (you don&apos;t need to add anything; the
          app will request scopes at runtime). Add your own Google account as
          a test user.
        </Step>
        <Step>
          Sidebar → <strong>APIs &amp; Services</strong> →{" "}
          <strong>Credentials</strong> → <strong>Create credentials</strong> →{" "}
          <strong>OAuth client ID</strong> →{" "}
          <strong>Web application</strong>.
        </Step>
        <Step>
          Under <strong>Authorized redirect URIs</strong>, add{" "}
          <em>both</em> of these (one OAuth client carries them all so
          localhost dev and production share credentials):
          <ul className="list-disc pl-6 mt-1 space-y-0.5">
            <li>
              <code>https://YOUR-DEPLOYMENT.vercel.app/api/auth/google/callback</code>
            </li>
            <li>
              <code>http://localhost:3000/api/auth/google/callback</code>
            </li>
          </ul>
        </Step>
        <Step>
          Click <strong>Create</strong>. Copy the <strong>Client ID</strong>{" "}
          and <strong>Client secret</strong> — you&apos;ll paste them into
          Vercel in Step 3.
        </Step>
      </Steps>

      <h2>Step 2 · Register a Microsoft / Outlook OAuth client</h2>
      <Steps>
        <Step>
          Open{" "}
          <a
            href="https://entra.microsoft.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            entra.microsoft.com
          </a>{" "}
          → <strong>Applications</strong> →{" "}
          <strong>App registrations</strong> → <strong>New registration</strong>.
        </Step>
        <Step>
          Name: &ldquo;ResearchOS&rdquo;. Supported account types:{" "}
          <strong>
            Accounts in any organizational directory and personal Microsoft
            accounts
          </strong>{" "}
          (so work, school, and personal Outlook can all sign in).
        </Step>
        <Step>
          Under <strong>Redirect URI</strong>, pick <strong>Web</strong> and
          add{" "}
          <code>https://YOUR-DEPLOYMENT.vercel.app/api/auth/microsoft/callback</code>.
          Save the app, then on its overview page →{" "}
          <strong>Authentication</strong> → add a second redirect URI for{" "}
          <code>http://localhost:3000/api/auth/microsoft/callback</code>.
        </Step>
        <Step>
          Left nav → <strong>API permissions</strong> →{" "}
          <strong>Add a permission</strong> → <strong>Microsoft Graph</strong>{" "}
          → <strong>Delegated permissions</strong> → tick{" "}
          <code>Calendars.ReadWrite</code> → <strong>Add</strong>.
        </Step>
        <Step>
          Left nav → <strong>Certificates &amp; secrets</strong> →{" "}
          <strong>New client secret</strong>. Pick an expiry (24 months is
          the max). <strong>Copy the secret value immediately</strong> —
          Microsoft shows it once, then hides it forever.
        </Step>
        <Step>
          Back on the app overview, copy the{" "}
          <strong>Application (client) ID</strong>. You now have both the
          client id and the client secret.
        </Step>
      </Steps>

      <h2>Step 3 · Add the env vars to Vercel</h2>
      <Steps>
        <Step>
          Open your Vercel project → <strong>Settings</strong> →{" "}
          <strong>Environment Variables</strong>.
        </Step>
        <Step>
          Add these six (apply to <strong>Production</strong>,{" "}
          <strong>Preview</strong>, and <strong>Development</strong> unless
          you only want one):
          <ul className="list-disc pl-6 mt-2 space-y-0.5 font-mono text-[13px]">
            <li>GOOGLE_OAUTH_CLIENT_ID = (your Google client id)</li>
            <li>GOOGLE_OAUTH_CLIENT_SECRET = (your Google client secret)</li>
            <li>NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED = 1</li>
            <li>MICROSOFT_OAUTH_CLIENT_ID = (your Microsoft client id)</li>
            <li>
              MICROSOFT_OAUTH_CLIENT_SECRET = (your Microsoft client secret)
            </li>
            <li>NEXT_PUBLIC_MICROSOFT_OAUTH_ENABLED = 1</li>
          </ul>
        </Step>
        <Step>
          Click <strong>Save</strong>. Vercel triggers a redeploy
          automatically; once it&apos;s live, the &ldquo;Connect&rdquo;
          buttons in the Linked Calendars modal stop saying &ldquo;Not
          configured&rdquo;.
        </Step>
      </Steps>

      <Callout variant="tip" title="Local dev too">
        If you also run <code>npm run dev</code> locally, drop the same six
        variables into <code>frontend/.env.local</code>. Restart the dev
        server and the local site picks them up. Same OAuth client carries
        both redirect URIs (localhost + Vercel), so you don&apos;t need two
        registrations.
      </Callout>

      <h2>Step 4 · Verify</h2>
      <Steps>
        <Step>
          Open your deployed site → Calendar → <strong>Linked Calendars</strong>.
        </Step>
        <Step>
          The Google and Outlook cards should show a blue{" "}
          <strong>Connect</strong> button (no longer the gray &ldquo;Not
          configured&rdquo; notice).
        </Step>
        <Step>
          Click <strong>Connect</strong> → sign in → consent. You should land
          back in the modal with your account email shown and a checkbox
          list of your calendars.
        </Step>
      </Steps>

      <h2>Where data ends up</h2>
      <p>
        OAuth tokens live in the user&apos;s own data folder at{" "}
        <code>users/[username]/_calendar-oauth.json</code> — they never sit
        on a ResearchOS server. The first time the user connects, the file is
        also added to the data folder&apos;s <code>.gitignore</code> so a
        refresh token never accidentally lands in a git repo.
      </p>

      <h2>Troubleshooting</h2>
      <h3>&ldquo;redirect_uri_mismatch&rdquo; on Google sign-in</h3>
      <p>
        The redirect URI in the OAuth client doesn&apos;t exactly match the
        one ResearchOS sends. The URI is{" "}
        <code>{`${"<your-deploy-origin>"}/api/auth/google/callback`}</code>,
        no trailing slash. Check the &ldquo;Authorized redirect URIs&rdquo;
        list in Google Cloud Console matches your deployment URL exactly,
        including <code>https</code> vs <code>http</code> and the port for
        localhost.
      </p>

      <h3>Google shows &ldquo;Google hasn&apos;t verified this app&rdquo;</h3>
      <p>
        Expected for an unverified app on a sensitive scope. Click{" "}
        <strong>Advanced</strong> → <strong>Go to ResearchOS (unsafe)</strong>.
        Until you complete brand verification, the warning persists and
        access is capped at 100 test users.
      </p>

      <h3>&ldquo;Outlook didn&apos;t return a refresh token&rdquo;</h3>
      <p>
        Make sure the requested scope list includes{" "}
        <code>offline_access</code> (ResearchOS does this for you; the
        warning means the user clicked through without granting it). The fix
        is reconnect — the consent screen will list offline access again.
      </p>
    </WikiPage>
  );
}
