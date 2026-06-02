import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { TryInDemo } from "@/components/wiki/TryInDemo";
import { WIKI_NAV } from "@/lib/wiki/nav";

export const metadata = {
  title: "ResearchOS Wiki",
  description: "Help and documentation for ResearchOS.",
};

export default function WikiLandingPage() {
  const sections = WIKI_NAV.filter((n) => n.children && n.children.length > 0);

  return (
    <WikiPage
      title="ResearchOS Wiki"
      intro={
        <>
          Everything you need to set up ResearchOS, share a folder with your lab,
          and use each feature. Most users only need the first two sections,{" "}
          <strong>Getting Started</strong> and <strong>Shared Lab Accounts</strong>,
          to be productive.
        </>
      }
    >
      <TryInDemo href="/">Explore the demo</TryInDemo>

      <Callout variant="tip" title="First time here? Read this first.">
        The wiki is big because the app is big.{" "}
        <Link href="/wiki/start-here">
          <strong>Start Here</strong>
        </Link>{" "}
        covers the 7 things worth knowing up front and how to navigate the
        rest of the wiki.
      </Callout>

      <h2>60-second tour</h2>
      <p>
        ResearchOS is a single-page research-management app that reads and writes
        directly to a folder on your computer. There&apos;s no server, no account,
        no sign-up. Your data lives in plain JSON files you fully own.
      </p>
      <ol className="my-4 list-decimal pl-6 space-y-2.5 text-gray-800 leading-relaxed marker:text-gray-500 marker:font-semibold">
        <li>
          Open ResearchOS in <strong>Chrome, Edge, or Brave</strong>. Other browsers
          can&apos;t read local folders yet.
        </li>
        <li>
          Click <strong>Link Folder</strong> to point ResearchOS at a folder
          on your disk. It can be an existing ResearchOS folder or a brand-new
          empty one you made first (Chrome cannot create a folder from the
          picker, so starting fresh means making an empty folder in your file
          manager, then linking it). For a quick intro first, BeakerBot offers
          an optional <strong>3-minute walkthrough</strong> button in the
          upper-right of this screen. It's a 4-beat modal that explains data
          security and folder choice. It does not link a folder for you. See{" "}
          <Link href="/wiki/getting-started/connecting-your-folder">
            Connecting Your Folder
          </Link>{" "}
          for the full breakdown.
        </li>
        <li>
          Pick a username. Your data lives under{" "}
          <code>users/&lt;your-name&gt;/</code> inside that folder. You can set an
          optional password to gate access on a shared machine.
        </li>
        <li>
          Once you sign in, BeakerBot&apos;s in-product welcome tour auto-starts
          on the empty account. (This is the longer hands-on tour, separate
          from the optional 3-minute walkthrough on the folder picker.) Click
          through to learn the major surfaces. See{" "}
          <Link href="/wiki/getting-started/welcome-wizard">Welcome Wizard</Link>{" "}
          for a breakdown of each step.
        </li>
        <li>
          Start adding projects, methods, experiments, and Gantt tasks. Everything
          syncs to disk immediately.
        </li>
      </ol>

      <Callout variant="tip" title="Sharing a folder with your lab?">
        Read{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link> first.
        Putting the ResearchOS folder inside OneDrive, Google Drive, Dropbox, or
        iCloud lets multiple lab members use the same folder, but you have to
        configure it to <strong>stay downloaded locally</strong>. If you don&apos;t,
        ResearchOS won&apos;t be able to read and write reliably.
      </Callout>

      <h2>Browse by section</h2>
      <div className="grid gap-4 sm:grid-cols-2 not-prose mt-3">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="block rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 px-5 py-4 transition-colors"
          >
            <div className="font-semibold text-gray-900">{section.label}</div>
            {section.blurb ? (
              <div className="mt-1 text-sm text-gray-600">{section.blurb}</div>
            ) : null}
            <div className="mt-2 text-xs text-gray-500">
              {section.children?.length ?? 0} pages
            </div>
          </Link>
        ))}
      </div>

      <h2>Where to find things</h2>
      <ul>
        <li>
          The <strong>?</strong> icon in the top-right of the app header always
          opens this wiki.
        </li>
        <li>
          On the folder-connect screen, look for the{" "}
          <em>New here? Read the setup guide</em> link, which goes to the{" "}
          <Link href="/wiki/getting-started/connecting-your-folder">
            Connecting Your Folder
          </Link>{" "}
          page.
        </li>
        <li>
          Use <strong>Ctrl</strong>+<strong>F</strong> /{" "}
          <strong>Cmd</strong>+<strong>F</strong> to search within a wiki page.
        </li>
        <li>
          Looking for security and privacy details? The{" "}
          <Link href="/wiki/security">Security</Link> page covers data storage,
          encryption, and what never leaves your machine. It does not appear in
          the section grid above because it has no sub-pages.
        </li>
      </ul>
    </WikiPage>
  );
}
