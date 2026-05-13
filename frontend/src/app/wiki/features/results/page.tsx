import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ResultsFeaturePage() {
  return (
    <WikiPage
      intro="The Results tab is a board of every task you've completed (or flagged with a deviation log), grouped by project, with a quick way to write up what the experiment showed."
    >
      <Screenshot
        src="/wiki/screenshots/results-list.png"
        alt="The Results page showing project-grouped cards of completed tasks with status pills."
        caption="The Results page: every result-worthy task as a card, grouped by project."
      />

      <h2>What you see on this page</h2>
      <p>
        The page is a grid of cards, one per task. Each card shows the
        task&apos;s name, its start date and duration, a few status pills
        (<em>Notes</em>, <em>N files</em>, <em>Deviations</em>, or{" "}
        <em>No results yet</em>), and any tags. Cards are grouped by project,
        with each project&apos;s name in its own color along the top.
      </p>
      <p>
        Along the top of the page is a row of project filter chips. Click a
        chip to hide that project&apos;s cards; click again to bring them
        back. The filter persists per-browser, so the same view comes back
        the next time you open the page.
      </p>
      <p>
        Only tasks that are either <strong>complete</strong> or carry a{" "}
        <strong>deviation log</strong> appear here. That keeps the page
        focused on tasks that have something to write up. To make a task
        show up, mark it complete on the Gantt or in its popup, or log a
        deviation while you&apos;re running it.
      </p>

      <h2>Filling in a task&apos;s results</h2>
      <Screenshot
        src="/wiki/screenshots/results-tab.png"
        alt="The Results tab inside the task detail popup with an image gallery and markdown editor."
        caption="Clicking a card opens the task popup straight on the Results tab."
      />
      <Steps>
        <Step>
          Click a card. The task detail popup opens with the{" "}
          <strong>Results</strong> tab already selected.
        </Step>
        <Step>
          Drop images into the editor or click the upload button. They land
          in the task&apos;s results folder and appear in the gallery / image
          strip.
        </Step>
        <Step>
          Write a short summary of what the experiment showed in the markdown
          editor. Same editor as everywhere else in the app, so the keyboard
          shortcuts and three modes from{" "}
          <Link href="/wiki/features/markdown-editor">The Markdown Editor</Link>{" "}
          apply.
        </Step>
        <Step>
          Close the popup. The card&apos;s pills update with the new file
          count and a <em>Notes</em> badge.
        </Step>
      </Steps>

      <h2>Lab notes vs results</h2>
      <p>
        The same task has two write-up surfaces:
      </p>
      <ul>
        <li>
          The <strong>Lab Notes</strong> tab inside the popup is for the
          during-the-run record — running observations, sub-task ticks, the
          deviation log, photos you took at the bench.
        </li>
        <li>
          The <strong>Results</strong> tab (this page&apos;s entry point) is
          for the final outputs — the gel image you want in a paper, the
          plot for a thesis chapter, the short summary of what the experiment
          showed.
        </li>
      </ul>
      <p>
        Both live on the same task and both write into the same per-task
        folder on disk. You can flip between the two tabs anytime in the
        popup.
      </p>

      <Callout variant="tip" title="Pair with PDF export">
        Once notes and results are written, open the experiment and use{" "}
        <Link href="/wiki/features/experiments">Export → PDF</Link>. The PDF
        bundles both halves into a single printable document for thesis
        chapters and IRB filings.
      </Callout>
    </WikiPage>
  );
}
