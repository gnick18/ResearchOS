import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ConnectingYourFolderPage() {
  return (
    <WikiPage
      intro="Pick a folder on your disk. ResearchOS will read and write JSON files inside it (no cloud, no upload). On a brand-new visit, BeakerBot idles in the upper-right and offers an optional 3-minute walkthrough you can take before connecting anything."
    >
      <Callout variant="info" title="Chrome or Edge only">
        ResearchOS uses the File System Access API, which is only available in
        Chrome and Edge. Safari, Firefox, and Brave are not supported (Brave
        disables the API on purpose). See{" "}
        <Link href="/wiki/getting-started/browser-requirements">
          Browser Requirements
        </Link>{" "}
        for details.
      </Callout>

      <Screenshot
        src="/wiki/screenshots/folder-connect-current.png"
        alt="The Connect your folder screen with a dashed-border drop zone that reads Drag your data folder here, a Browse for a folder button below the divider, and an idle BeakerBot with a speech bubble and Take the 3-minute walkthrough button in the upper-right."
        caption="The Connect your folder screen. Drag a folder into the drop zone or use the Browse for a folder button. The old folder-connect.png depicts the retired single-card layout."
      />

      <h2>Why there is no separate &ldquo;create folder&rdquo; option</h2>
      <p>
        ResearchOS works against a real folder on your disk, and Chrome&apos;s
        File System Access API can only ever <em>open</em> a folder you point it
        at. It cannot <em>create</em> a folder from the picker dialog (the OS
        picker blocks the parent locations a new-folder flow would need, even the
        Documents root). An earlier version of this screen had a separate
        &ldquo;Create New Folder&rdquo; card with a name field, but it dead-ended
        on that browser limitation. Connecting an existing ResearchOS folder and
        starting fresh both work the same way through the drop zone. You point at
        a folder that already exists on disk, and ResearchOS sets up its structure
        automatically the first time you connect it.
      </p>

      <h2>The page layout, at a glance</h2>
      <p>
        The screen is titled <strong>Connect your folder</strong>. On a first
        visit, three things share it.
      </p>
      <ul>
        <li>
          <strong>The drop zone in the center</strong>: a dashed-border card
          with the heading <strong>Drag your data folder here</strong>. Below a
          short divider sits the <strong>Browse for a folder</strong> button for
          users who prefer the OS picker. Connecting an existing ResearchOS
          folder and starting fresh both use this same zone.
        </li>
        <li>
          <strong>BeakerBot in the upper-right</strong>: a small sky-blue beaker
          mascot in idle pose (not waving). Below the mascot is a speech bubble
          with a brief nudge, plus a button labeled{" "}
          <strong>Take the 3-minute walkthrough</strong>. Skip past it entirely
          if you already know what you want to do.
        </li>
        <li>
          <strong>The credentials stamp in the bottom-right</strong>: a
          small badge that names the academic project this app grew out of
          (a UW-Madison Distinguished Research Fellowship). Pure authority
          signal; nothing to click.
        </li>
      </ul>
      <p>
        Want to look around before committing a folder? The seeded fake yeast
        lab (browse it in the app, or download it as a real starter folder you
        can link) is accessible from the welcome page and via the{" "}
        <code>/demo</code> URL. See{" "}
        <Link href="/wiki/getting-started/demo-mode">Demo Mode</Link>.
      </p>

      <Callout variant="tip" title="The walkthrough is optional and doesn't connect a folder">
        Clicking <strong>Take the 3-minute walkthrough</strong> opens a 4-beat
        modal (welcome, data security, folder choice, cloud provider). It
        runs the BeakerBot intro in slide form, then closes and returns you to
        this same connect screen. The modal never connects a folder for you.
        Returning users skip it entirely. See{" "}
        <em>The optional walkthrough modal</em>, below, for what each beat
        covers.
      </Callout>

      <h2>Starting fresh? Make an empty folder first</h2>
      <p>
        Because the picker can only open a folder that already exists, you make
        the folder yourself first. Do this with your normal file manager (Finder
        on Mac, Explorer on Windows) before you click Browse for a folder.
      </p>
      <Steps>
        <Step>
          Open your file manager and make a <strong>new</strong> folder anywhere
          you like (Documents/ResearchOS works well).{" "}
          <strong>IMPORTANT</strong>: Chrome blocks the Desktop, Documents, and
          Downloads folders themselves, but a folder you make <em>inside</em>{" "}
          any of them works fine.
        </Step>
        <Step>
          Name it something like <code>ResearchOS</code>.
        </Step>
        <Step>
          Click <strong>Browse for a folder</strong> and select the folder you
          just made, not its top-level parent.
        </Step>
      </Steps>

      <h2>What you&apos;ll do</h2>
      <Steps>
        <Step>
          Connect the folder. You have two equivalent ways. Click{" "}
          <strong>Browse for a folder</strong> to open your operating
          system&apos;s folder picker, or <strong>drag a folder directly onto
          the drop zone</strong>. The zone highlights with a blue dashed border
          and the heading changes from &ldquo;Drag your data folder here&rdquo;
          to &ldquo;Release to connect this folder&rdquo; as you drag over it.
          Release to connect. Both paths work for an existing ResearchOS folder
          and for a brand-new empty one.
        </Step>
        <Step>
          The browser asks for permission to read and write that folder. Click{" "}
          <strong>Allow</strong>. Chrome remembers the grant until you clear the
          site&apos;s data, so you won&apos;t get reprompted every time (you may
          see it once more after a browser restart).
        </Step>
        <Step>
          ResearchOS initializes the folder structure (e.g., <code>users/</code>,{" "}
          <code>lab/</code>) the first time you link an empty folder, then shows
          the user-picker screen. After you pick or create a username, you land
          in the app and can start working right away.
        </Step>
      </Steps>

      <Callout variant="warning" title="If Chrome refuses the folder you picked">
        If Chrome says a folder &ldquo;contains system files&rdquo; after you
        pick it, that is its block on sensitive locations. The top-level
        Desktop, Documents, Downloads, and home folders are off limits. The
        picker shows a recovery popup (<em>That folder can&apos;t be used. Pick a
        different spot.</em>) with a retry button. Make an empty subfolder inside
        one of those locations (like <code>Documents/ResearchOS</code>) and
        connect that instead.
      </Callout>

      <h2>The optional walkthrough modal</h2>
      <p>
        The <strong>Take the 3-minute walkthrough</strong> button on the
        connect screen opens a small 4-beat modal that introduces the app
        before you commit to connecting a folder. It is opt-in, not auto-fire.
        Brand-new users see the speech bubble&apos;s gentle nudge (&ldquo;New
        here? It is strongly recommended to take a short onboarding walkthrough
        (3 minutes). Returning? Just take it from here.&rdquo;), and returning
        users ignore it entirely. Here is what the four beats cover.
      </p>
      <ol>
        <li>
          <strong>Welcome.</strong> BeakerBot waves and gives you a two-sentence
          pitch for ResearchOS. There is also a small heart easter egg if you
          click the mascot.
        </li>
        <li>
          <strong>Data security.</strong> The core promise is that your data
          NEVER leaves your computer. No upload, no central server, no telemetry
          on your research. See <Link href="/wiki/security">Security</Link> for
          the full story.
        </li>
        <li>
          <strong>Folder choice.</strong> Local (recommended for solo) or
          cloud-synced (for cross-device or multi-person lab). Local skips
          the next beat and closes the modal; cloud advances to beat 4.
        </li>
        <li>
          <strong>Cloud provider.</strong> Picks the cloud you want to host
          the folder in (OneDrive, Google Drive, Dropbox, Box, iCloud) and
          links you to the per-provider setup guide. Closing the modal returns
          you to the connect screen; the folder connection itself still happens
          through the drop zone.
        </li>
      </ol>
      <p>
        A small <strong>Skip</strong> link sits in the corner of every beat
        so you can bail back to the picker at any time. The modal does NOT
        write anything to disk and does NOT persist a &ldquo;seen&rdquo; flag;
        reopening it is a one-click decision you make each visit.
      </p>

      <Callout variant="tip" title="Already have data? Connect the same folder.">
        If you&apos;ve used ResearchOS before, point it at the same folder you
        used last time. Your projects, tasks, methods, and notes will load
        exactly as you left them.
      </Callout>

      <Callout variant="info" title="Just kicking the tires?">
        Skip the folder connection and visit the demo instead. The welcome page
        has a button to open the app at <code>/demo</code> with a seeded fake
        yeast lab you can click around in, or you can navigate to{" "}
        <code>/demo</code> directly. No folder, no install, edits disappear on
        reload. See <Link href="/wiki/getting-started/demo-mode">Demo Mode</Link>.
      </Callout>

      <h2>What gets created inside the folder</h2>
      <p>
        ResearchOS creates a simple tree the first time you connect.
      </p>
      <pre className="my-3 rounded-lg bg-surface-sunken border border-border px-4 py-3 overflow-x-auto text-meta text-foreground font-mono leading-relaxed">{`your-folder/
└── users/
    ├── <your-username>/
    │   ├── projects/
    │   ├── tasks/
    │   ├── methods/
    │   ├── notes/
    │   ├── Images/
    │   └── ...more         ← a folder per data type
    ├── public/            ← shared methods & protocols
    └── lab/               ← shared funding accounts`}</pre>

      <p>
        That tree is trimmed for readability. Each kind of record (events,
        goals, dependencies, purchases, and a few others) gets its own
        subfolder under your username, plus small counter files ResearchOS uses
        to hand out IDs. You don&apos;t edit those by hand. Everything is plain
        JSON and plain image files, so you can back up the folder by copying it,
        version-control it with git, or open it in Finder / Explorer at any
        time.
      </p>

      <h2>Reconnecting later</h2>
      <p>
        After your first connect, ResearchOS remembers the folder handle via
        browser storage and reconnects to it silently whenever Chrome still
        holds the permission, so most return visits drop you straight back into
        your data with no picker and no extra click. When the start screen does
        appear for a returning user, it greets you with{" "}
        <strong>Welcome back</strong> and an <strong>Open your folder</strong>{" "}
        button that re-opens the picker on the same location. The browser may
        show a one-time permission prompt the first time you reconnect after a
        browser restart.
      </p>

      <Callout variant="warning" title="Clearing site data disconnects you">
        If you clear the site&apos;s data (e.g., browser settings → clear data),
        the folder handle is wiped. Your data on disk is untouched. You just
        have to pick the folder again next time you open ResearchOS.
      </Callout>

      <h2>Setting up a shared lab folder</h2>
      <p>
        If multiple people in your lab should share one folder, put the folder
        inside OneDrive, Google Drive, Dropbox, or iCloud, and follow{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>. The
        critical step is making sure the folder is{" "}
        <strong>always available offline</strong> on every member&apos;s laptop.
      </p>
    </WikiPage>
  );
}
