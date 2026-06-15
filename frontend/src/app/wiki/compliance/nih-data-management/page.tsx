import Link from "next/link";
import Callout from "@/components/wiki/Callout";
import WikiPage from "@/components/wiki/WikiPage";

export default function NihDataManagementPage() {
  return (
    <WikiPage
      intro="Vendors advertise &ldquo;NIH Data Management & Sharing support&rdquo; like it is a certificate they bought. It is not. This page explains what the policy actually requires, why no electronic notebook is &ldquo;NIH certified,&rdquo; and exactly how ResearchOS supports your compliance."
    >
      <h2>There is no such thing as a certified ELN</h2>
      <p>
        The NIH Data Management and Sharing (DMS) Policy, in effect since
        January 25 2023, binds <strong>researchers and institutions</strong>{" "}
        that receive NIH funding. It does not bind software. There is no NIH
        program that audits, licenses, or certifies an electronic lab
        notebook, and there is no badge a tool can earn. When LabArchives or
        anyone else lists &ldquo;NIH Data Management Mandates &amp; Sharing
        support&rdquo; as a feature, that is a marketing claim that decodes
        to one honest sentence. <em>Our features help your researchers do
        the things NIH expects of them.</em>
      </p>
      <Callout variant="info" title="So what are universities actually paying for?">
        Not a DMS certificate. The enterprise price tag buys security
        certifications (FedRAMP, SOC 2, ISO 27001, 21 CFR Part 11), hosted
        backups, institutional administration, and brand trust. The
        &ldquo;NIH selected LabArchives&rdquo; line you may have seen refers
        to NIH&apos;s <em>intramural</em> program (NIH&apos;s own internal
        scientists), won through federal procurement on the strength of
        FedRAMP. A grantee lab at a university does not need any of that to
        comply with the DMS Policy.
      </Callout>
      <p>
        Compliance is something a researcher does, not something a tool is.
        You comply by writing a Data Management and Sharing Plan with your
        grant application and then following it. The notebook is where the
        work that the plan describes actually happens. Any ELN with the
        right features can legitimately say it supports the policy, and
        ResearchOS has those features.
      </p>

      <h2>What the policy actually asks for</h2>
      <p>NIH expects funded investigators to do three things.</p>
      <ul>
        <li>
          <strong>Plan and budget</strong> for managing and sharing
          scientific data, before the work starts.
        </li>
        <li>
          <strong>Write a DMS Plan</strong> (a two-page document) and submit
          it with the funding application.
        </li>
        <li>
          <strong>Implement the plan</strong> by managing the data rigorously
          during the project, then share it no later than publication or the
          end of the award, whichever comes first.
        </li>
      </ul>
      <Callout variant="tip" title="NIH does not want your lab notebook">
        This is the part most vendor pages bury. NIH explicitly says
        investigators are <strong>not</strong> expected to share laboratory
        notebooks, preliminary analyses, drafts, or communications. What you
        share is a <strong>curated dataset</strong>, deposited into an
        appropriate repository. So a notebook&apos;s real job is twofold. It
        manages the data well while you work, and it produces a clean, portable
        export you can hand to a repository when it is time to share. That
        plays directly to how ResearchOS stores everything.
      </Callout>

      <h2>How ResearchOS supports it</h2>
      <p>
        ResearchOS supports all three expectations. The same plan / create /
        implement structure other ELN vendors use to map their features to
        the policy applies here, with the bonus that your data lives in open
        formats on your own disk the entire time.
      </p>

      <h3>1. Plan and budget</h3>
      <p>
        Use separate projects to model how each grant&apos;s data will be
        organized, and reusable methods and templates so the whole lab
        captures data the same way from day one. Planning the structure up
        front is most of what a DMS Plan&apos;s data-organization section
        asks you to describe.
      </p>

      <h3>2. Create the DMS Plan</h3>
      <p>
        The plan itself is a short document built against NIH&apos;s required
        format. Most institutions point researchers at the free{" "}
        <a href="https://dmptool.org" target="_blank" rel="noopener noreferrer">
          DMPTool
        </a>
        , which has the official NIH template built in. Draft it there, then
        keep the finished plan in ResearchOS as a note or attachment
        alongside the project it governs, so the plan and the data it
        describes live together.
      </p>

      <h3>3. Implement the plan</h3>
      <p>
        This is where the day-to-day work lives, and where ResearchOS is
        strongest. The table below maps what the policy and NIH&apos;s{" "}
        <em>Desirable Characteristics of Data Repositories</em> guidance
        expect against the ResearchOS feature that delivers it.
      </p>

      <div className="my-5 overflow-x-auto not-prose">
        <table className="w-full text-body border-collapse">
          <thead>
            <tr className="bg-surface-sunken border-b border-border text-foreground">
              <th className="text-left px-3 py-2 font-semibold w-1/2">
                What the policy expects
              </th>
              <th className="text-left px-3 py-2 font-semibold w-1/2">
                How ResearchOS supports it
              </th>
            </tr>
          </thead>
          <tbody className="text-foreground [&>tr]:border-b [&>tr]:border-border [&>tr>td]:px-3 [&>tr>td]:py-2 [&>tr>td]:align-top">
            <tr>
              <td>
                <strong>Provenance and integrity.</strong> A trustworthy
                record of who did what, when.
              </td>
              <td>
                Append-only PI audit log (
                <Link href="/wiki/features/lab-head/audit-log">
                  _pi_audit.json
                </Link>
                ), per-task Lab Notes and Results stamped with owner and
                time, and soft-delete{" "}
                <Link href="/wiki/features/trash">Trash</Link> with a
                recovery window instead of instant destruction.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Organization and description.</strong> Data grouped
                and described well enough to find and reuse.
              </td>
              <td>
                Projects, tasks, and a reusable{" "}
                <Link href="/wiki/features/methods">Methods library</Link>{" "}
                (PCR, LC gradients, plate layouts, cell-culture schedules),
                plus tags and{" "}
                <Link href="/wiki/features/search">filter-driven search</Link>{" "}
                across your projects.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Access control during the project.</strong> Decide
                who can see and edit what.
              </td>
              <td>
                Per-record{" "}
                <Link href="/wiki/features/sharing-and-permissions">
                  sharing
                </Link>{" "}
                with read or edit levels, a whole-lab option, PI view-all,
                and a password-gated edit session fronting every PI write.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Open, non-proprietary formats.</strong> Data that
                outlives the tool that made it.
              </td>
              <td>
                Everything is written to a folder on your machine as plain
                JSON, markdown, and your original image and PDF files. No
                proprietary container, no vendor database. See{" "}
                <Link href="/wiki/security">Security</Link>.
              </td>
            </tr>
            <tr>
              <td>
                <strong>A shareable package.</strong> A clean bundle you can
                deposit when it is time to share.
              </td>
              <td>
                One-click export of any experiment, or many at once from
                Search, as a print-ready PDF, a self-contained HTML bundle,
                or a raw re-importable ZIP. Images and attachments travel
                with it.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Oversight.</strong> A named person responsible for
                data management.
              </td>
              <td>
                The <Link href="/wiki/features/lab-head">PI role</Link>, with
                soft-write approvals, flags, and the audit trail that records
                them.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Where your data actually gets shared</h2>
      <p>
        The DMS Plan names a repository, and that repository is where sharing
        happens, not the notebook. NIH does not mandate a specific one. It
        publishes <em>Desirable Characteristics of Data Repositories</em>{" "}
        (persistent identifiers, long-term stewardship, curation, clear reuse
        terms) and expects you to pick one that fits your data, either a
        domain-specific repository where one exists, or a generalist
        repository such as Zenodo, Figshare, Dryad, or Vivli otherwise.
      </p>
      <p>
        ResearchOS gets you to that handoff cleanly with a{" "}
        <strong>guided deposit</strong> dialog. You pick the repository (Zenodo,
        Figshare, or another of your choice), and ResearchOS prefills the
        deposit metadata in the DataCite shape repositories expect (title,
        creator with ORCID, abstract, license, keywords, and the funder and
        award pulled from the grant you linked), bundles the curated data, and
        opens that repository&apos;s own upload page so you drop the bundle in and
        the repository mints the DOI. Because your ResearchOS data is already in
        open formats, there is nothing to unpack or convert first. See{" "}
        <Link href="/wiki/compliance/depositing-to-a-repository">
          Depositing to a repository
        </Link>{" "}
        for the step-by-step.
      </p>

      <h2>Honest limits worth knowing about</h2>
      <p>
        ResearchOS supports your DMS compliance, and it is honest about where
        a feature is a manual step rather than a built-in one. None of these
        block compliance, but you should know them before you write your
        plan.
      </p>
      <Callout variant="info" title="Guided deposit now, one-click coming soon">
        ResearchOS has a <strong>guided deposit</strong> dialog today. It
        prefills your DataCite-shaped metadata, bundles the data, and opens the
        repository&apos;s own upload page, where the repository mints the DOI.
        What is not shipped yet is the <strong>fully automated one-click</strong>{" "}
        path, where ResearchOS publishes straight to Zenodo from the browser and
        the DOI comes back without you leaving the app. That is Phase 2. For now
        you finish the last step on the repository&apos;s page, so the deposit is
        guided rather than one-click.
      </Callout>
      <Callout variant="info" title="Per-entry version history with restore ships today">
        Alongside the append-only PI audit log and soft-delete Trash,
        ResearchOS now keeps a full per-record version history with a restore
        button and a 24-hour undo on notes, tasks, projects, and Results. You
        can browse prior versions, see who changed what, and roll an entry
        back. See{" "}
        <Link href="/wiki/features/version-history">Version history</Link>.
        The one remaining gap is standalone library Methods (the reusable
        protocol records in your Methods library), which do not yet have
        per-version history. If your plan requires a complete versioned history
        of your method library, account for that narrower gap now.
      </Callout>
      <Callout variant="info" title="Structured grant and ORCID fields feed the deposit">
        ResearchOS has first-class fields for your ORCID iD (on your profile) and
        for funder and award numbers (on each funding account), named to match
        the DataCite schema a DOI deposit uses. The guided deposit dialog reads
        them automatically and prefills the metadata for you, so you confirm the
        details rather than retyping them at upload time. The remaining piece is
        the one-click publish that finishes the deposit without leaving the app.
      </Callout>
      <Callout variant="warning" title="No third-party security certifications">
        ResearchOS holds no FedRAMP, SOC 2, ISO 27001, or 21 CFR Part 11
        attestation. Its security posture is different by design, a
        local-first app with no vendor database to certify (see{" "}
        <Link href="/wiki/security">Security</Link>). That is the right
        trade-off for many labs, but if your institution requires a certified
        cloud vendor, ask them which attestation they need.
      </Callout>

      <h2>The official sources</h2>
      <p>
        Do not anchor a compliance decision to a vendor blog (including this
        one). The primary sources are short and readable.
      </p>
      <ul>
        <li>
          <a
            href="https://grants.nih.gov/policy-and-compliance/policy-topics/sharing-policies/dms/policy-overview"
            target="_blank"
            rel="noopener noreferrer"
          >
            NIH DMS Policy overview
          </a>{" "}
          and the policy hub at{" "}
          <a href="https://sharing.nih.gov" target="_blank" rel="noopener noreferrer">
            sharing.nih.gov
          </a>
          .
        </li>
        <li>
          <a
            href="https://grants.nih.gov/grants/guide/notice-files/NOT-OD-21-013.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            NOT-OD-21-013
          </a>{" "}
          is the Final NIH Policy itself.
        </li>
        <li>
          <a
            href="https://grants.nih.gov/grants/guide/notice-files/NOT-OD-21-014.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            NOT-OD-21-014
          </a>{" "}
          lists the required elements of a DMS Plan. This is the real checklist.
        </li>
        <li>
          <a
            href="https://grants.nih.gov/grants/guide/notice-files/NOT-OD-21-016.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            NOT-OD-21-016
          </a>{" "}
          covers desirable characteristics of data repositories.
        </li>
      </ul>
      <p>
        Wondering how ResearchOS stacks up against the tool most labs are
        leaving? See{" "}
        <Link href="/wiki/compliance/labarchives-comparison">
          ResearchOS vs LabArchives
        </Link>
        .
      </p>
    </WikiPage>
  );
}
