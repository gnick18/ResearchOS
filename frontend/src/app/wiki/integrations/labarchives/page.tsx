import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function LabArchivesIntegrationPage() {
  return (
    <WikiPage
      title="LabArchives"
      intro="Bring notebooks out of LabArchives and into ResearchOS as native, file-on-disk tasks — and optionally let the importer pull down the inline images that LabArchives keeps in the cloud."
    >
      <h2>The shape of the integration</h2>
      <p>
        LabArchives and ResearchOS sit at opposite ends of a hand-off, not
        in a live sync. LabArchives is your ELN of record while you&apos;re
        running experiments; ResearchOS is where you bring those notebooks
        once you want them on disk in a structured form. There&apos;s no
        two-way connection, and ResearchOS never writes back to
        LabArchives.
      </p>
      <p>
        The integration has two pieces, each surfaced under{" "}
        <strong>Settings → LabArchives</strong>:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          <strong>Import from LabArchives</strong> — the bulk path. You
          download an Offline Notebook ZIP from LabArchives and feed it to
          the import wizard. Every notebook page becomes a ResearchOS task;
          every folder becomes a project you can map to your existing
          project list. No credentials, works offline.
        </li>
        <li>
          <strong>Connect to LabArchives</strong> — an optional, per-user
          API connection. Once connected, the import wizard can{" "}
          <em>also</em> fetch the inline images that aren&apos;t in the
          offline ZIP (more on that below) and write them into your notes
          alongside the rest.
        </li>
      </ul>

      <h2 id="why-connect">Why you might want to connect your account</h2>
      <p>
        LabArchives stores inline images in your notebook page two
        different ways. The legacy path, internally called <em>Form-A</em>,
        embeds the image as a binary file inside the page&apos;s entry.
        The newer path, <em>Form-B</em>, uploads the image to
        LabArchives&apos; cloud and leaves only a URL behind in the entry
        body.
      </p>
      <p>
        When you generate an offline export ZIP, only the Form-A images
        come along. The Form-B URLs are still in the entry text, but the
        image bytes themselves were never bundled. In a typical recent
        notebook that&apos;s roughly half the inline images.
      </p>
      <p>
        If you import the offline ZIP without connecting your account, the
        wizard writes a <code>missing-…</code> placeholder for each
        Form-B image. Your notes still come across; the images at those
        URLs simply aren&apos;t there. You can clean them up later by
        clicking a broken image and choosing <em>Remove reference</em>.
      </p>
      <p>
        If you <em>do</em> connect your account before the apply step, the
        wizard takes those Form-B URLs, calls the LabArchives API for each
        one, downloads the bytes into your task&apos;s{" "}
        <code>notes/Files/</code> folder, and rewrites the markdown to
        point at the local copy. Same result as if every image had been
        Form-A in the first place.
      </p>

      <Callout variant="tip" title="Run the import without connecting first">
        It&apos;s fine to skip the connection on the first pass — the
        wizard offers a Skip button. Form-B images become placeholders,
        which is sometimes what you want (e.g., you&apos;re archiving
        text-only notebooks). You can always re-import or use the
        broken-image popup to clean up.
      </Callout>

      <h2 id="exporting-from-labarchives">
        Exporting an Offline Notebook ZIP from LabArchives
      </h2>
      <p>
        The ZIP that ResearchOS imports is LabArchives&apos; built-in
        Offline Notebook export. Both pieces of the integration depend on
        having this file — the import obviously, but also the connection,
        since the API client uses notebook + page identifiers it learned
        from the ZIP to look up images.
      </p>
      <Steps>
        <Step>
          Open the notebook you want to export in LabArchives on the web.
        </Step>
        <Step>
          Click <strong>More</strong> in the top toolbar →{" "}
          <strong>Offline Notebook</strong>. (LabArchives sometimes labels
          this <em>Export Notebook</em> or <em>Backup Notebook</em>
          depending on your institution&apos;s build.)
        </Step>
        <Step>
          Wait. Large notebooks take minutes to assemble; LabArchives emails
          you when the ZIP is ready.
        </Step>
        <Step>
          Download the ZIP from the email link. Don&apos;t unzip it —
          ResearchOS reads the raw archive.
        </Step>
      </Steps>

      <h2 id="import">Running the import</h2>
      <Steps>
        <Step>
          Go to <strong>Settings → LabArchives</strong> and click{" "}
          <strong>Open import…</strong> on the <em>Import from LabArchives</em>{" "}
          card.
        </Step>
        <Step>
          Drag the Offline Notebook ZIP into the upload step. The wizard
          parses the bundle and surfaces a preview of pages, folders, and
          inline images.
        </Step>
        <Step>
          On the <strong>Pick format</strong> step, leave the default
          (Offline Notebook). PDF and Chrome-print formats are stubbed for a
          later version.
        </Step>
        <Step>
          On the <strong>Preview</strong> step, glance through the page
          list and confirm the entry counts look right.
        </Step>
        <Step>
          On the <strong>Project mapping</strong> step, point each
          LabArchives folder at one of your existing ResearchOS projects, or
          let the wizard create a new project named{" "}
          <code>&lt;folder&gt; (imported)</code>.
        </Step>
        <Step>
          If the wizard detected Form-B images AND your deployment has the
          LabArchives integration configured AND you&apos;re not in demo
          mode, a <strong>Fetch images</strong> step appears here. Either
          click <strong>Sign in to LabArchives</strong> and then{" "}
          <strong>Fetch N images</strong>, or click <strong>Skip for now</strong>{" "}
          to leave them as placeholders.
        </Step>
        <Step>
          The <strong>Apply</strong> step writes everything to disk. When
          it&apos;s finished, the <strong>Done</strong> step lists what
          landed where.
        </Step>
      </Steps>

      <Callout variant="info" title="What ends up on disk">
        Each notebook page becomes a directory under{" "}
        <code>users/&lt;you&gt;/results/task-&lt;id&gt;/</code> with a{" "}
        <code>notes.md</code> body, a <code>notes/Files/</code> folder for
        attachments, a <code>notes/Images/</code> folder for inline images,
        and an <code>_import_source.json</code> for provenance. Tasks are
        marked complete, with <code>task_type = &quot;experiment&quot;</code>{" "}
        and <code>start_date</code> set to the page&apos;s newest entry
        timestamp.
      </Callout>

      <h2 id="connecting-your-account">Connecting your LabArchives account</h2>
      <p>
        Connecting is one click from <strong>Settings → LabArchives →
        Connect to LabArchives</strong>. ResearchOS opens a popup pointed
        at <code>signin.labarchives.com</code>, you sign in with your
        usual LabArchives email and password, and the popup hands the
        resulting user identifier back. After that, ResearchOS stores
        that identifier in your data folder at{" "}
        <code>users/&lt;you&gt;/_labarchives.json</code> and the{" "}
        <em>Connect to LabArchives</em> card flips to a green{" "}
        <em>Connected as …</em> state with a Disconnect button.
      </p>
      <p>
        The connection is per-user (different ResearchOS folder users can
        connect to different LabArchives accounts) and per-folder (it
        lives in the data folder, not the browser, so it travels with the
        folder if you sync via OneDrive or similar).
      </p>

      <Callout variant="warning" title="The connect button is greyed out">
        That means the deployment you&apos;re using doesn&apos;t have the
        institutional API credentials set yet. The import still works;
        the image rehydration step just isn&apos;t reachable. See the{" "}
        <strong>Setup for deployers</strong> section below — you may need
        to ask whoever runs the ResearchOS deployment to configure it.
      </Callout>

      <h2 id="deployer-setup">Setup for deployers</h2>
      <p>
        Unlike the calendar feeds or Telegram bot, LabArchives uses{" "}
        <strong>institutional API credentials</strong> — a single{" "}
        <code>access_key_id</code> + <code>access_password</code> pair
        issued by LabArchives Support to your institution. Every API
        request ResearchOS makes on behalf of any user is signed with
        that pair (HMAC-SHA1 over the URL and a timestamp). Users still
        sign in with their own LabArchives email and password; the
        institutional pair just authorizes the application itself.
      </p>

      <h3>Request institutional credentials</h3>
      <p>
        Email LabArchives Support at <code>support@labarchives.com</code> with
        the subject &quot;API access request&quot;. Mention your
        institution and the integration name (ResearchOS). They&apos;ll
        issue an <code>access_key_id</code> + <code>access_password</code>{" "}
        pair, plus the right regional API endpoint (typically{" "}
        <code>api.labarchives.com</code> for US,{" "}
        <code>aueuapi.labarchives.com</code> for AU/EU,{" "}
        <code>auapi.labarchives.com</code> for AU).
      </p>
      <p>
        More detail in the official{" "}
        <a
          href="https://mynotebook.labarchives.com/share/LabArchives%2520API/MC4wfDI3LzAvVHJlZU5vZGUvMjQzMzE3ODYzM3wwLjA="
          target="_blank"
          rel="noopener noreferrer"
        >
          LabArchives API knowledge base
        </a>
        .
      </p>

      <h3>Configure the environment</h3>
      <p>
        Set three environment variables on the deployment (Vercel project
        env, or <code>frontend/.env.local</code> for self-host /
        development):
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          <code>LABARCHIVES_ACCESS_KEY_ID</code> — the access key id from
          Support.
        </li>
        <li>
          <code>LABARCHIVES_ACCESS_PASSWORD</code> — the access password from
          Support. <strong>Server-only.</strong> Never prefix with{" "}
          <code>NEXT_PUBLIC_</code> — that would leak it into the browser
          bundle.
        </li>
        <li>
          <code>NEXT_PUBLIC_LABARCHIVES_ENABLED=1</code> — public flag the
          UI reads to decide whether to surface the Connect button.
        </li>
      </ul>
      <p>
        Optional, for non-US institutions:{" "}
        <code>LABARCHIVES_API_BASE_URL=https://aueuapi.labarchives.com/api</code>{" "}
        (or your assigned regional endpoint). Defaults to{" "}
        <code>https://api.labarchives.com/api</code> when unset.
      </p>
      <p>
        Restart the dev server (or trigger a redeploy in production) so the
        new env vars are picked up. The Settings → LabArchives section will
        flip from amber &quot;not configured&quot; to green{" "}
        <em>Integration is configured</em>.
      </p>

      <Callout variant="danger" title="Don't commit the credentials">
        The access password is the application-level secret for every
        ResearchOS user at your institution. Treat it like a deploy key —
        keep it out of git, paste it directly into the platform&apos;s env
        UI, rotate it if a deployment is decommissioned.
      </Callout>

      <h3>Smoke-test the integration</h3>
      <Steps>
        <Step>
          Open a ResearchOS user that has a real folder (not demo mode).
        </Step>
        <Step>
          Go to <strong>Settings → LabArchives → Connect to LabArchives</strong>{" "}
          and click <strong>Connect</strong>. A popup opens at the
          LabArchives sign-in page.
        </Step>
        <Step>
          Sign in with a LabArchives user account at your institution. The
          popup closes and the row flips to{" "}
          <em>Connected as &lt;your name&gt;</em>.
        </Step>
        <Step>
          Open the import wizard, drop in an Offline Notebook ZIP that you
          know contains Form-B images, and run through to the{" "}
          <strong>Fetch images</strong> step. The progress bar should tick
          through one image per request.
        </Step>
        <Step>
          On Done, open one of the freshly created tasks and confirm the
          previously-Form-B images render inline (rather than as broken
          placeholders).
        </Step>
      </Steps>

      <Callout variant="info" title="How signing works under the hood">
        Every server-side request to the LabArchives API attaches three
        query params: <code>akid</code> (your access key id),{" "}
        <code>expires</code> (an epoch-ms timestamp), and{" "}
        <code>sig</code> (an HMAC-SHA1 of the URL + expires, keyed by your
        access password, base64-encoded). LabArchives validates that the
        signature matches and that the expiry is in the future, then
        responds. The signing math lives in{" "}
        <code>frontend/src/lib/labarchives/sign.ts</code> and mirrors the
        published Python and JavaScript reference clients.
      </Callout>

      <h2>What stays private</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          The institutional access password lives in server-side env vars
          only. The signing happens on the Next.js server route, so the
          secret never ends up in the browser bundle.
        </li>
        <li>
          Per-user state on disk is the <code>uid</code> string LabArchives
          returns from <code>users/user_access_info</code> — not a
          password, not a long-lived OAuth token. Stored in plain JSON at{" "}
          <code>users/&lt;you&gt;/_labarchives.json</code> alongside your
          name and email for display.
        </li>
        <li>
          ResearchOS only calls the LabArchives API during an active
          import. There is no background polling.
        </li>
      </ul>
    </WikiPage>
  );
}
