import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ResultsFeaturePage() {
  return (
    <WikiPage
      intro="A per-task folder for the final outputs of an experiment (e.g., gels, blots, write-ups)."
    >
      <Screenshot
        src="/wiki/screenshots/results-editor.png"
        alt="The Results page with an image gallery and notes editor side-by-side."
        caption="The Results page is a gallery on the left and a markdown summary on the right."
      />

      <h2>What Results is for</h2>
      <p>
        Lab notes are where you record <em>what happened during the run</em>:
        running observations, sub-tasks, deviation log. Results is where the{" "}
        <em>final outputs</em> go: the gel image you want in a paper, the
        plot for a thesis chapter, the short write-up of what the experiment
        showed. Each experiment has its own Results page reached from the
        task popup.
      </p>
      <p>
        The page is a two-pane layout — a gallery of result images on the
        left and a markdown editor on the right. Drag images into the gallery
        or click the upload button, then write the summary in the editor.
      </p>

      <h2>Open the Results editor</h2>
      <Steps>
        <Step>
          Open the task you want to record results for, then click{" "}
          <strong>Open Results</strong> in its side panel. The Results editor
          for that task opens. You can also reach it by clicking the task on
          the Results tab.
        </Step>
        <Step>
          Drag images into the gallery, or click the upload button.
        </Step>
        <Step>
          Write a results summary in the markdown editor on the right. It&apos;s
          the same editor used everywhere else in the app, with three modes
          and a full set of keyboard shortcuts. See{" "}
          <Link href="/wiki/features/markdown-editor">The Markdown Editor</Link>{" "}
          for details.
        </Step>
      </Steps>

      <Callout variant="tip" title="Pair with PDF export">
        Once results and notes are written, jump back to the experiment
        editor and use{" "}
        <Link href="/wiki/features/experiments">Export → PDF</Link>. The PDF
        pulls in the results gallery automatically.
      </Callout>
    </WikiPage>
  );
}
