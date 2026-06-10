import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function DepositingToARepositoryPage() {
  return (
    <WikiPage
      title="Depositing to a repository"
      intro="When a funder asks you to share your data, you publish it to a public repository that mints a DOI. ResearchOS does the tedious part for you. It gathers your experiment into a download-ready bundle and prefills the repository's metadata form from the grant and ORCID details you already entered, so the deposit takes minutes instead of an afternoon."
    >
      <p>
        A DOI (a permanent, citable link) is what turns a folder of files into
        shareable, findable research. Repositories like Zenodo and Figshare mint
        that DOI for you when you upload a dataset and fill in a metadata form.
        The form is the slow part, since it wants a title, an author with an
        ORCID, an abstract, a license, keywords, and the funder and award number
        behind the work. ResearchOS already holds most of that, so the Deposit
        flow fills the form in for you and hands you a clean bundle to upload.
      </p>

      <Callout variant="info" title="How this fits the NIH policy">
        Depositing to a public repository is how you satisfy the sharing half of
        the NIH Data Management and Sharing Policy. For the full picture of what
        the policy requires and how ResearchOS supports it, see{" "}
        <Link href="/wiki/compliance/nih-data-management">
          NIH Data Management &amp; Sharing
        </Link>
        .
      </Callout>

      <h2>You always control the publish</h2>
      <p>
        This is the most important thing to understand about the Deposit flow.
        ResearchOS never publishes anything on your behalf and never talks to a
        repository for you. It builds the bundle and the metadata locally, in
        your browser, and hands them to you. The final upload and the final{" "}
        <strong>Publish</strong> button happen on the repository&apos;s own site,
        with your hands on the controls. The repository, not ResearchOS, mints
        the DOI.
      </p>
      <p>
        That means nothing leaves your machine until you decide to upload it, and
        nothing becomes public until you click Publish on the repository. There
        is no auto-publish, no background sync, and no surprise release of your
        data.
      </p>

      <Callout variant="tip" title="One-click publishing is coming, not here yet">
        A future Phase 2 will offer one-click browser-direct publishing to
        Zenodo, whose deposit API works straight from the browser. That is on the
        roadmap and is not shipped today. Everything described on this page is the
        guided path that ships now, where you finish the upload on the repository
        yourself.
      </Callout>

      <h2>Opening Deposit</h2>
      <p>
        You can deposit a single experiment or a whole project.
      </p>
      <ul>
        <li>
          <strong>From an experiment</strong>: open the experiment&apos;s detail
          popup and click the <strong>Deposit to a repository</strong> button in
          its header. The bundle is that one experiment.
        </li>
        <li>
          <strong>From a project</strong>: open the project and choose Deposit to
          bundle it as one dataset. The first step lets you multi-select which
          experiments and which notes go in (notes come from your full note
          list, since notes are not project-scoped). The bundle then holds each
          item exported on its own, one combined navigable PDF across everything,
          the raw re-importable bundle for each experiment, and a markdown
          rendering of each note.
        </li>
      </ul>

      <h2>The three steps</h2>
      <p>
        The Deposit dialog walks through curation, metadata review, and handoff.
      </p>
      <Steps>
        <Step>
          <p>
            <strong>Curate.</strong> Choose which sections and attachments go in
            the bundle, and pick the bundle format (a self-contained HTML page, a
            PDF, or the raw files). This reuses the same export pipeline that
            powers a normal experiment export, so the bundle looks exactly like
            the rest of ResearchOS&apos;s exports.
          </p>
        </Step>
        <Step>
          <p>
            <strong>Review the metadata.</strong> ResearchOS prefills a
            DataCite-shaped metadata record (the standard repositories speak) and
            shows it for you to check and edit. See the field list below.
          </p>
        </Step>
        <Step>
          <p>
            <strong>Hand off.</strong> Pick <strong>Zenodo</strong>,{" "}
            <strong>Figshare</strong>, or <strong>Other repository</strong>.
            ResearchOS downloads one archive (named{" "}
            <code>{"{name}"}-deposit.zip</code>) that holds your curated data and
            a <code>datacite.json</code> metadata file, then opens the
            repository&apos;s own upload page in a new tab. For Zenodo and
            Figshare that button jumps you straight to their new-upload form. You
            drag the archive in, copy the metadata fields into the form, and
            click Publish there to mint the DOI.
          </p>
        </Step>
      </Steps>

      <Screenshot
        src="/wiki/screenshots/deposit-metadata-review.png"
        alt="The Deposit dialog on its metadata review step, showing the prefilled title, a creator row with an ORCID, an editable abstract, a license picker, keyword chips, and a funding reference block listing the funder name and award number."
        caption="The metadata review step. Every field is prefilled from data you already entered and stays editable before you hand off."
      />
      {/* SCREENSHOT TODO: capture the Deposit dialog metadata review step with
       *  ?wikiCapture=1 against fixture data (a task whose project is linked to
       *  a funding account with award number + ORCID owner). Save to
       *  frontend/public/wiki/screenshots/deposit-metadata-review.png */}

      <h2>What gets prefilled</h2>
      <p>
        The metadata step starts from what ResearchOS already knows, so you
        mostly confirm rather than type.
      </p>
      <ul>
        <li>
          <strong>Title</strong>: the experiment title, or the project name for a
          project-level deposit.
        </li>
        <li>
          <strong>Creator with ORCID</strong>: your display name, with your ORCID
          attached as a name identifier when you have one on file.
        </li>
        <li>
          <strong>Abstract</strong>: seeded from your results, then notes, with
          the editing-history stamps stripped out. Fully editable.
        </li>
        <li>
          <strong>License</strong>: the one field you must set before handoff,
          since NIH expects shared data to carry a license and ResearchOS has
          none to fall back on. The two NIH-friendly defaults (CC-BY-4.0 and
          CC0-1.0) are surfaced first as recommended.
        </li>
        <li>
          <strong>Keywords</strong>: pulled from the experiment&apos;s tags.
        </li>
        <li>
          <strong>Funder and award number</strong>: read from the grant linked to
          the project, including the funder name, the funder ID and ID type, and
          the award number and title. These populate the DataCite{" "}
          <code>fundingReference</code> so the deposit carries the grant
          attribution funders expect. A project-level deposit goes further and
          lists multiple funders, the primary grant linked to the project plus
          any other grants that purchases in the project were charged to, deduped
          so the same grant never shows twice.
        </li>
      </ul>

      <Callout variant="info" title="Where the funder data comes from">
        The funder fields come from the funding account linked to your project.
        You enter those structured grant details (award number, funder name,
        funder ID, award title) once in the funding-accounts manager, then link a
        project to that grant. See{" "}
        <Link href="/wiki/features/purchases">Purchases &amp; Funding</Link> for
        how to set up the grant and the project-to-grant link.
      </Callout>

      <Callout variant="tip" title="The metadata mapping is test-covered">
        The translation from your ResearchOS data into the DataCite record is a
        pure, unit-tested function. Its tests assert the title, the creator
        ORCID, the funding reference, and the graceful fallbacks when a piece is
        missing, so the field mapping you see in the dialog is verified, not
        hand-wavy. That matters for a compliance artifact you are attaching your
        name to.
      </Callout>

      <h2>After the handoff</h2>
      <p>
        The deposit archive is a download. It is never written into your on-disk
        data folder and never becomes a new sidecar, so depositing leaves your
        project files untouched. Once the repository mints
        the DOI, copy it back into ResearchOS wherever you cite the dataset, and
        record it in your Data Management and Sharing Plan as your funder
        requires.
      </p>
    </WikiPage>
  );
}
