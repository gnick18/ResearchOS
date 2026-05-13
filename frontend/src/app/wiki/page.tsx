import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
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
          and use each feature. Most users only need the first two sections —{" "}
          <strong>Getting Started</strong> and <strong>Shared Lab Accounts</strong> —
          to be productive.
        </>
      }
    >
      <h2>60-second tour</h2>
      <p>
        ResearchOS is a single-page research-management app. It reads and writes
        directly to a folder on your computer — there is no server, no account,
        and no sign-up. Your data lives in plain JSON files you fully own.
      </p>
      <ol className="my-4 list-decimal pl-6 space-y-2.5 text-gray-800 leading-relaxed marker:text-gray-500 marker:font-semibold">
        <li>
          Open ResearchOS in <strong>Chrome, Edge, or Brave</strong>. Other browsers
          can&apos;t read local folders yet.
        </li>
        <li>
          Click <strong>Connect Folder</strong> and pick (or create) an empty folder
          on your disk. This is your ResearchOS folder.
        </li>
        <li>
          Pick a username — your data lives under{" "}
          <code>users/&lt;your-name&gt;/</code> inside that folder. You can set an
          optional password to gate access on a shared machine.
        </li>
        <li>
          Start adding projects, tasks, methods, and experiments. Everything syncs
          to disk immediately.
        </li>
      </ol>

      <Callout variant="tip" title="Sharing a folder with your lab?">
        Read{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link> first.
        Putting the ResearchOS folder inside OneDrive, Google Drive, Dropbox, or
        iCloud lets multiple lab members use the same folder — but you must
        configure it to <strong>stay downloaded locally</strong>, or ResearchOS
        won&apos;t be able to read and write reliably.
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
          On the folder-connect screen, look for the <em>New here?</em> link to
          jump straight to the setup guide.
        </li>
        <li>
          Use <strong>Ctrl</strong>+<strong>F</strong> /{" "}
          <strong>Cmd</strong>+<strong>F</strong> to search within a wiki page.
        </li>
      </ul>
    </WikiPage>
  );
}
