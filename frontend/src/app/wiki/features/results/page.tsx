import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function ResultsFeaturePage() {
  return (
    <WikiPage
      intro="A per-task folder for the final outputs of an experiment (e.g., gels, blots, write-ups)."
    >
      <Screenshot
        src="/wiki/screenshots/results-editor.png"
        alt="The Results page with an image gallery and notes editor side-by-side."
      />

      <h2>Why it&apos;s separate from experiment notes</h2>
      <p>
        Experiment notes capture <em>what happened during the run</em>. Results
        capture <em>what came out</em>. Keeping them apart means you can write
        up a paper without sifting through every variation log, and your
        results live in a predictable place on disk (i.e.,{" "}
        <code>users/&lt;you&gt;/results/task-&lt;id&gt;/</code>).
      </p>

      <h2>How to use it</h2>
      <ul>
        <li>
          Open a task and click <strong>Open Results</strong> in the side
          panel, or click the task on the Results tab.
        </li>
        <li>
          Drag images into the gallery, or use the upload button.
        </li>
        <li>
          Write a results summary in the markdown editor. Same editor as
          experiments, which supports inline images, headings, and tables.
        </li>
      </ul>

      <Callout variant="tip" title="Pair with PDF export">
        Once results and notes are written, jump back to the experiment editor
        and use{" "}
        <Link href="/wiki/features/experiments">Export → PDF</Link>. The PDF
        pulls in the results gallery automatically.
      </Callout>
    </WikiPage>
  );
}
