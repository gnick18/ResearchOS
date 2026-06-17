import Link from "next/link";
import type { ReactNode } from "react";
import Callout from "@/components/wiki/Callout";
import WikiPage from "@/components/wiki/WikiPage";

function Yes({ children }: { children?: ReactNode }) {
  return (
    <span>
      <strong className="text-emerald-700 dark:text-emerald-300">Yes</strong>
      {children ? <span className="text-foreground-muted">. {children}</span> : null}
    </span>
  );
}

function No({ children }: { children?: ReactNode }) {
  return (
    <span>
      <strong className="text-rose-700">No</strong>
      {children ? <span className="text-foreground-muted">. {children}</span> : null}
    </span>
  );
}

function Partial({ children }: { children?: ReactNode }) {
  return (
    <span>
      <strong className="text-amber-700 dark:text-amber-300">Partial</strong>
      {children ? <span className="text-foreground-muted">. {children}</span> : null}
    </span>
  );
}

function ComingSoon() {
  return (
    <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 text-meta font-semibold px-2 py-0.5 align-middle">
      Coming soon
    </span>
  );
}

export default function LabArchivesComparisonPage() {
  return (
    <WikiPage
      intro="An honest side-by-side. LabArchives is the incumbent most academic labs are leaving, so it is the right thing to measure against. ResearchOS wins decisively on data ownership and cost. LabArchives is still ahead on a few specific things, and this page says so plainly."
    >
      <h2>Who each one is for</h2>
      <p>
        <strong>LabArchives</strong> is a hosted, cloud ELN sold per seat. You
        trade money and data custody for managed backups, security
        certifications, and turnkey institutional administration. It suits
        labs that want a vendor to hold the data and an IT department that
        wants a certified cloud contract.
      </p>
      <p>
        <strong>ResearchOS</strong> is a free, open-source, local-first ELN.
        Your data is a folder of open files on your own disk, shared across a
        lab through whatever cloud drive you already pay for. It suits labs
        that want to own their data outright, avoid per-seat fees, and keep
        unpublished work off a vendor server.
      </p>

      <div className="my-5 overflow-x-auto not-prose">
        <table className="w-full text-body border-collapse">
          <thead>
            <tr className="bg-surface-sunken border-b border-border text-foreground">
              <th className="text-left px-3 py-2 font-semibold w-[26%]">
                Capability
              </th>
              <th className="text-left px-3 py-2 font-semibold w-[37%]">
                ResearchOS
              </th>
              <th className="text-left px-3 py-2 font-semibold w-[37%]">
                LabArchives (Professional)
              </th>
            </tr>
          </thead>
          <tbody className="text-foreground [&>tr]:border-b [&>tr]:border-border [&>tr>td]:px-3 [&>tr>td]:py-2 [&>tr>td]:align-top">
            <tr>
              <td>
                <strong>Price</strong>
              </td>
              <td>
                <Yes>Free and open source.</Yes>
              </td>
              <td>
                Free tier (2 notebooks, 1 GB). Professional is $330 academic
                or $575 corporate, per user per year.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Where data lives</strong>
              </td>
              <td>
                A folder on your own machine. No vendor database ever holds
                it.
              </td>
              <td>On LabArchives&apos; cloud servers.</td>
            </tr>
            <tr>
              <td>
                <strong>File formats</strong>
              </td>
              <td>
                Plain JSON, markdown, and your original image and PDF
                files, all open. Readable without ResearchOS.
              </td>
              <td>
                Proprietary cloud store. You read it through their app or via
                export.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Data ownership / lock-in</strong>
              </td>
              <td>
                <Yes>You own the folder outright. Nothing to escape.</Yes>
              </td>
              <td>
                You can export, but the live copy is theirs while you pay.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Audit trail</strong>
              </td>
              <td>
                <Yes>
                  Append-only PI audit log plus soft-delete Trash with a
                  recovery window.
                </Yes>
              </td>
              <td>
                <Yes>Complete activity and revision history.</Yes>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Per-entry edit history with revert</strong>
              </td>
              <td>
                <Partial>
                  Ships on notes, tasks, experiments (Lab Notes and Results),
                  projects, and sequences, each with a restore button.
                  Standalone library methods are not separately versioned yet.
                </Partial>
              </td>
              <td>
                <Yes>Full revision history on every entry.</Yes>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Sharing and permissions</strong>
              </td>
              <td>
                <Yes>
                  Per-record read or edit, whole-lab option, PI view-all.
                </Yes>
              </td>
              <td>
                <Yes>Notebook and folder-level roles and permissions.</Yes>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Export</strong>
              </td>
              <td>
                <Yes>
                  PDF, self-contained HTML, and raw re-importable ZIP. Single
                  or bulk.
                </Yes>
              </td>
              <td>
                <Yes>PDF and offline-notebook export.</Yes>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Repository deposit and DOI</strong>
              </td>
              <td>
                <Partial>
                  Guided deposit prefills the metadata, bundles the data, and
                  opens the repository&apos;s upload page, where the repository
                  mints the DOI.
                </Partial>
                <ComingSoon />
              </td>
              <td>
                <Yes>
                  Built-in Figshare export and direct DOI publishing.
                </Yes>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Structured grant / ORCID metadata</strong>
              </td>
              <td>
                <Yes>Dedicated ORCID + funder/award fields.</Yes>
              </td>
              <td>
                <Yes>Dedicated metadata fields.</Yes>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Security certifications</strong>
              </td>
              <td>
                <No>
                  None; local-first by design, with a published security
                  audit instead.
                </No>
              </td>
              <td>
                <Yes>FedRAMP, SOC 2 Type 2, ISO 27001, 21 CFR Part 11.</Yes>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Managed backups</strong>
              </td>
              <td>
                You rely on your own cloud drive or backup routine.
              </td>
              <td>
                <Yes>Vendor-managed backup and record retention.</Yes>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Browser support</strong>
              </td>
              <td>
                Chrome or Edge (needs the File System Access API).
              </td>
              <td>
                <Yes>Any modern browser.</Yes>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Lab-specialized tools</strong>
              </td>
              <td>
                <Yes>
                  Visual PCR editor, LC gradients, plate layouts,
                  cell-culture schedules, Gantt, purchasing and funding.
                </Yes>
              </td>
              <td>
                Widgets and third-party integrations (SnapGene, GraphPad
                Prism).
              </td>
            </tr>
            <tr>
              <td>
                <strong>Migrating in</strong>
              </td>
              <td>
                <Yes>
                  Imports a LabArchives Offline Notebook ZIP directly.
                </Yes>
              </td>
              <td>Not applicable.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Where ResearchOS wins</h2>
      <ul>
        <li>
          <strong>You own your data, in open formats, forever.</strong> The
          single biggest difference. Your work is plain files on your disk,
          not rows in a vendor database. NIH&apos;s repository guidance prizes
          exactly this kind of portability and non-proprietary format.
        </li>
        <li>
          <strong>No per-seat fees.</strong> A ten-person lab on LabArchives
          Professional is several thousand dollars a year, every year.
          ResearchOS has no fixed per-seat license and no paywalled local
          features. Every local feature is free, and the cloud services are
          pay-for-what-you-use, a base fee plus usage at a fair markup, with
          storage at roughly cost. Self-hosting is always free.
        </li>
        <li>
          <strong>Unpublished research never leaves your control.</strong> No
          vendor server holds your pre-publication data. For sensitive or
          competitive work, that is a real advantage, not a checkbox.
        </li>
        <li>
          <strong>Built for bench work.</strong> The visual PCR editor, plate
          layouts, LC gradients, cell-culture schedules, Gantt scheduling,
          and lab purchasing are first-class, not bolt-ons.
        </li>
        <li>
          <strong>Switching in is easy.</strong> ResearchOS imports your{" "}
          <Link href="/wiki/features/import-from-eln">
            LabArchives Offline Notebook ZIP
          </Link>{" "}
          directly, so you are not retyping years of notebooks.
        </li>
      </ul>

      <h2>Where LabArchives is still ahead</h2>
      <p>
        Saying otherwise would not survive a demo, so here it is straight.
      </p>
      <ul>
        <li>
          <strong>Fully automated one-click deposit.</strong> Built-in Figshare
          export and direct DOI minting from inside the app. ResearchOS has a{" "}
          <em>guided</em> deposit today (it prefills the metadata, bundles the
          data, and opens the repository&apos;s upload page where the DOI is
          minted), and the fully automated one-click publish is coming. See{" "}
          <Link href="/wiki/compliance/depositing-to-a-repository">
            Depositing to a repository
          </Link>
          .
        </li>
        <li>
          <strong>Complete per-entry revision history.</strong> ResearchOS now
          ships per-entry version history with a restore button on notes,
          tasks, experiments (both Lab Notes and Results), projects, and
          sequences, and an experiment also tracks per-method protocol
          deviations as it changes,
          so the gap here is narrow. LabArchives still covers every record
          type, while ResearchOS does not yet version standalone library method
          records.
        </li>
        <li>
          <strong>Security certifications.</strong> FedRAMP, SOC 2, ISO
          27001, and 21 CFR Part 11. If your institution mandates a certified
          cloud vendor, this is decisive, and ResearchOS does not compete
          here by design.
        </li>
        <li>
          <strong>Managed backups and any-browser access.</strong> The
          vendor handles redundancy, and there is no File System Access API
          browser requirement.
        </li>
      </ul>

      <Callout variant="tip" title="The honest bottom line">
        If your priorities are owning your data in open formats, eliminating
        per-seat cost, and keeping unpublished work off a vendor server,
        ResearchOS is the better choice and supports your NIH DMS compliance
        fully (see{" "}
        <Link href="/wiki/compliance/nih-data-management">
          NIH Data Management &amp; Sharing
        </Link>
        ). If your institution requires a certified cloud vendor, managed
        backups, or one-click DOI publishing as non-negotiables, LabArchives
        still wins on those specific points. Neither tool is &ldquo;NIH
        certified,&rdquo; because no such certification exists.
      </Callout>
    </WikiPage>
  );
}
