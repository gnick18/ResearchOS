import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";
import { findWikiNode } from "@/lib/wiki/nav";

export default function SharedLabAccountsPage() {
  const node = findWikiNode("/wiki/shared-lab-accounts");
  const providers = node?.children ?? [];
  return (
    <WikiPage
      intro="One folder, shared across your whole lab. Everyone keeps their own data, and the PI's dashboard rolls it all up."
    >
      <Callout variant="info" title="Want to feel out the shared model first?">
        Open{" "}
        <Link href="/wiki/getting-started/demo-mode">Demo Mode</Link> for a
        no-setup preview. It seeds two researchers (alex and morgan) plus
        their PI (Mira) into one shared folder, so cross-user data and the
        PI rollup are already wired up for you to click around in.
      </Callout>

      <Callout variant="info" title="Lab accounts via ResearchOS cloud">
        If your lab uses ResearchOS cloud accounts, the PI creates a lab and
        invites members by email. Members accept and the lab covers their
        storage from the shared pool. No shared folder is required for this
        path. See{" "}
        <Link href="/wiki/getting-started/accounts">Accounts and tiers</Link>{" "}
        for the invite and join flow. The shared-folder setup below is the
        alternative for labs that prefer to manage their own sync through
        OneDrive, Dropbox, Google Drive, or iCloud.
      </Callout>

      <h2>How it works</h2>
      <p>
        Put your ResearchOS folder inside a cloud-synced folder (e.g., OneDrive,
        Google Drive, Dropbox, or iCloud). Every lab member points ResearchOS at
        that <strong>same</strong> folder on their own computer. Inside the
        folder, each member picks a different username, so their data lives at{" "}
        <code>users/sarah/</code>, <code>users/grant/</code>, and so on.
      </p>
      <p>
        The cloud provider handles syncing files between machines. ResearchOS
        has no idea any of this is happening, it just reads and writes JSON
        files like normal.
      </p>

      <Callout variant="danger" title="The one rule, keep the folder available offline">
        ResearchOS NEEDS to read and write the folder directly on disk. If your
        cloud provider keeps the folder &quot;online only&quot; (i.e., a
        placeholder file that downloads on demand), writes will fail or be
        silently dropped. EVERY member needs to flip the &quot;always keep
        local&quot; switch for the lab folder on EVERY laptop they use
        ResearchOS from.
      </Callout>

      <h2>Setup steps (every member runs these once)</h2>
      <Steps>
        <Step>
          Install the cloud provider&apos;s <strong>desktop app</strong> (not
          just the website). OneDrive on Windows is pre-installed. Drive for
          desktop, Dropbox, and iCloud Drive each ship as a separate download.
        </Step>
        <Step>
          One person creates an empty folder named e.g.{" "}
          <code>LabName-ResearchOS</code> inside the synced area, then shares it
          with the rest of the lab via the cloud provider&apos;s normal share
          flow.
        </Step>
        <Step>
          Each member accepts the share and confirms the folder is now visible
          on their laptop&apos;s filesystem (Finder / Explorer).
        </Step>
        <Step>
          Each member follows their provider&apos;s instructions below to make
          the folder <strong>always available offline</strong>.
        </Step>
        <Step>
          Each member opens ResearchOS, clicks <strong>Open a folder</strong>,
          and picks that shared folder.
        </Step>
        <Step>
          On the user-picker, each member clicks <strong>Create New User</strong> and
          types their own username.
        </Step>
      </Steps>

      <h2>Pick your cloud provider</h2>
      <div className="grid gap-3 not-prose mt-3 sm:grid-cols-2">
        {providers.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="block rounded-lg border border-border hover:border-border hover:bg-surface-sunken px-5 py-4 transition-colors"
          >
            <div className="font-semibold text-foreground">{p.label}</div>
            {p.blurb ? (
              <div className="mt-1 text-body text-foreground-muted">{p.blurb}</div>
            ) : null}
          </Link>
        ))}
      </div>

      <h2>Verify the folder is local</h2>
      <p>
        Before you start using ResearchOS, open the shared folder in Finder
        (macOS) or Explorer (Windows) and confirm:
      </p>
      <ul>
        <li>
          Files show as fully downloaded (i.e., no cloud icon, no &quot;online
          only&quot; badge, no &quot;available when online&quot; tag).
        </li>
        <li>
          You can open a sample file with the network disconnected.
        </li>
        <li>
          The folder&apos;s &quot;Size on disk&quot; in its properties dialog is
          non-zero and roughly matches the &quot;Size&quot;.
        </li>
      </ul>

      <Callout variant="tip" title="The PI sees the lab roll-up">
        Once everyone is set up, the PI sees a customizable dashboard
        at <code>/lab-overview</code> with widgets for cross-lab activity,
        purchases, member workload, announcements, and more. See{" "}
        <Link href="/wiki/features/lab-overview">Lab Overview</Link>. If you
        only want one labmate&apos;s work surfaced on your own Home page
        (rather than the whole lab), they can share an individual project
        or task with you instead; see{" "}
        <Link href="/wiki/features/home">Home &amp; Projects</Link>.
      </Callout>

      <h2>Pitfalls to avoid</h2>
      <ul>
        <li>
          <strong>Don&apos;t put the folder in two different cloud
          providers.</strong> Pick one. Stacking OneDrive and Dropbox on the
          same folder corrupts JSON files when both try to write.
        </li>
        <li>
          <strong>Don&apos;t use the same username on two laptops.</strong> If
          Sarah signs in as <code>sarah</code> on her laptop and also{" "}
          <code>sarah</code> on a shared lab computer at the same time, the two
          ResearchOS sessions will overwrite each other&apos;s files.
        </li>
        <li>
          <strong>Don&apos;t edit files outside ResearchOS while the app is
          open.</strong> The app caches data in memory, so external edits
          won&apos;t be picked up until you reload the page.
        </li>
      </ul>
    </WikiPage>
  );
}
