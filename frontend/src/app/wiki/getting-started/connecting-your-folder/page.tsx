import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ConnectingYourFolderPage() {
  return (
    <WikiPage
      intro="Pick a folder on your disk. ResearchOS will read and write JSON files inside it (no cloud, no upload). On a brand-new visit, BeakerBot waves at you from the upper-right and offers an optional 3-minute walkthrough you can take before linking anything."
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
        src="/wiki/screenshots/folder-connect.png"
        alt="The folder-link screen with a single Link a folder card in the center, BeakerBot waving from the upper-right with a Take the 3-minute walkthrough button, an Explore demo in browser link below the card, and the RISE credentials stamp in the bottom-right corner."
        caption="The first screen you see on a fresh install. One centered Link a folder card, BeakerBot's optional walkthrough nudge in the upper-right, and the RISE credentials stamp pinned bottom-right."
      />

      <h2>Why there is one card, not two</h2>
      <p>
        ResearchOS works against a real folder on your disk, and Chrome&apos;s
        File System Access API can only ever <em>open</em> a folder you point it
        at. It cannot <em>create</em> a folder from the picker dialog (the OS
        picker blocks the parent locations a new-folder flow would need, even the
        Documents root). An earlier version of this screen had a separate
        &ldquo;Create New Folder&rdquo; card with a name field, but it dead-ended
        on that browser limitation, so the screen is now a single{" "}
        <strong>Link a folder</strong> card. Linking an existing ResearchOS
        folder and starting fresh both work the same way. You point at a folder
        that already exists on disk, and ResearchOS sets up an empty one
        automatically the first time you link it.
      </p>

      <h2>The page layout, at a glance</h2>
      <p>
        On a first visit, three things share this screen.
      </p>
      <ul>
        <li>
          <strong>The Link a folder card in the center</strong>: one card,
          titled <strong>Link a folder</strong>. It holds a short description,
          the &ldquo;Starting fresh? Make an empty folder first&rdquo;
          instructions, a drag-and-drop zone, and the{" "}
          <strong>Link Folder</strong> button. This is the whole folder flow.
          Link an existing folder or a brand-new empty one through the same card.
        </li>
        <li>
          <strong>BeakerBot in the upper-right</strong>: a small sky-blue
          beaker mascot waving at you. Below the mascot is a white speech
          bubble that explains the optional walkthrough, plus a button labeled{" "}
          <strong>Take the 3-minute walkthrough</strong>. Skip past it
          entirely if you already know what you want to do.
        </li>
        <li>
          <strong>The RISE credentials stamp in the bottom-right</strong>: a
          small badge that names the academic project this app was built under
          (a UW-Madison RISE grant). Pure authority signal; nothing to click.
        </li>
      </ul>
      <p>
        Below the card sit an{" "}
        <strong>Explore demo in browser</strong> button (it opens a seeded fake
        yeast lab at <code>/demo</code> so you can look around without linking
        anything) and a smaller <strong>Or download as a starter folder</strong>{" "}
        link for the same fake dataset as a real folder you can link.
      </p>

      <Callout variant="tip" title="The walkthrough is optional and doesn't link a folder">
        Clicking <strong>Take the 3-minute walkthrough</strong> opens a 4-beat
        modal (welcome, data security, folder choice, cloud provider). It
        runs the BeakerBot intro in slide form, then closes and returns you to
        this same picker. The modal never picks a folder for you. Returning
        users skip it entirely. See{" "}
        <em>The optional walkthrough modal</em>, below, for what each beat
        covers.
      </Callout>

      <h2>Starting fresh? Make an empty folder first</h2>
      <p>
        Because the picker can only open a folder that already exists, the card
        spells out a short make-it-yourself recipe under the heading{" "}
        <strong>Starting fresh? Make an empty folder first</strong>. Do this
        with your normal file manager (Finder on Mac, Explorer on Windows)
        before you click Link Folder.
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
          Click <strong>Link Folder</strong> below the recipe and select the
          folder you just made, not its top-level parent.
        </Step>
      </Steps>

      <h2>What you&apos;ll do</h2>
      <Steps>
        <Step>
          Link the folder. You have two equivalent ways. Click the{" "}
          <strong>Link Folder</strong> button to open your operating
          system&apos;s folder picker, or <strong>drag a folder directly onto
          the Link a folder card</strong>. The card highlights with a dashed
          blue border, and its hint text changes from &ldquo;Drop your folder
          here, or click below to pick&rdquo; to &ldquo;Release to link this
          folder&rdquo; as you drag over it. Release to connect. Both paths work
          for an existing ResearchOS folder and for a brand-new empty one.
        </Step>
        <Step>
          The browser asks for permission to read and write that folder. Click{" "}
          <strong>Allow on every visit</strong> so you don&apos;t get reprompted.
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
        different spot.</em>) with a <strong>Link a folder in Documents</strong>{" "}
        retry button. Make an empty subfolder inside one of those locations
        (like <code>Documents/ResearchOS</code>) and link that instead.
      </Callout>

      <h2>The optional walkthrough modal</h2>
      <p>
        The <strong>Take the 3-minute walkthrough</strong> button on the
        picker opens a small 4-beat modal that introduces the app before you
        commit to picking a folder. It is opt-in, not auto-fire. Brand-new
        users see the speech bubble&apos;s gentle nudge (&ldquo;New here? It
        is strongly recommended to take a short onboarding walkthrough (3
        minutes). Returning? Just take it from here.&rdquo;), and returning
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
          you to the picker; the folder link itself still happens through the
          Link a folder card.
        </li>
      </ol>
      <p>
        A small <strong>Skip</strong> link sits in the corner of every beat
        so you can bail back to the picker at any time. The modal does NOT
        write anything to disk and does NOT persist a &ldquo;seen&rdquo; flag;
        reopening it is a one-click decision you make each visit.
      </p>

      <Callout variant="tip" title="Already have data? Pick the same folder.">
        If you&apos;ve used ResearchOS before, point it at the same folder you
        used last time. Your projects, tasks, methods, and notes will load
        exactly as you left them.
      </Callout>

      <Callout variant="info" title="Just kicking the tires?">
        Skip the folder picker and visit{" "}
        <Link href="/wiki/getting-started/demo-mode">Demo Mode</Link> instead.
        It opens the app at <code>/demo</code> with a seeded fake yeast lab
        you can click around in. No folder, no install, edits disappear on
        reload.
      </Callout>

      <h2>What gets created inside the folder</h2>
      <p>
        ResearchOS creates a simple tree the first time you connect.
      </p>
      <pre className="my-3 rounded-lg bg-surface-sunken border border-border px-4 py-3 overflow-x-auto text-meta text-foreground font-mono leading-relaxed">{`your-folder/
├── users/
│   ├── <your-username>/
│   │   ├── projects/
│   │   ├── tasks/
│   │   ├── methods/
│   │   ├── notes/
│   │   ├── Images/
│   │   └── settings.json
│   └── public/        ← shared methods & protocols
└── lab/               ← shared funding accounts`}</pre>

      <p>
        Everything is plain JSON and plain image files. You can back up the
        folder by copying it, version-control it with git, or open it in Finder
        / Explorer at any time.
      </p>

      <h2>Reconnecting later</h2>
      <p>
        After your first connect, ResearchOS remembers the folder name via
        browser storage. On your next visit, instead of the Link a folder card
        you see a dedicated <strong>reconnect screen</strong>: it shows the
        folder name in a bold heading (<em>Reconnect to [your-folder]</em>)
        and a prominent <strong>Continue</strong> button that re-attaches
        without reopening the OS picker. A smaller{" "}
        <strong>Pick a different folder</strong> link below the button lets
        you switch to a different location if needed. The browser may show a
        one-time permission prompt the first time you reconnect after a
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
