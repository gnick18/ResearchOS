import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ExperimentsFeaturePage() {
  return (
    <WikiPage
      title="Experiments & Lab Notes"
      intro="The Lab Notes tab lists every experiment-type task with its notes, attached methods, and image strip."
    >
      <Screenshot
        src="/wiki/screenshots/experiments-list.png"
        alt="The Lab Notes page with experiment rows on the left and an editor on the right."
        caption="Every experiment across every project, with a quick-open editor."
      />

      <h2>What an experiment looks like</h2>
      <p>
        Each experiment is a tile in the Lab Notes list. Click a tile and a
        popup opens with everything for that experiment in one place:
        markdown notes, an image strip, attached methods and PCR protocols,
        sub-tasks, and a deviation log. The same popup is what opens when
        you click an experiment&apos;s bar on the Gantt or its row in
        search.
      </p>
      <p>
        Two things live near experiments but are separate tabs of their own:
      </p>
      <ul>
        <li>
          <Link href="/wiki/features/methods">Methods</Link> is the lab&apos;s
          reusable protocol library. Attach one to an experiment from the
          popup&apos;s side panel.
        </li>
        <li>
          <Link href="/wiki/features/results">Results</Link> is where the
          final outputs go (gels, blots, plots, the write-up). Each
          experiment has its own Results folder, opened from the same popup.
        </li>
      </ul>

      <h2>Open an experiment</h2>
      <Screenshot
        src="/wiki/screenshots/experiments-editor.png"
        alt="An open experiment editor with markdown notes on the left, image strip below, and method panel on the right."
        caption="An open experiment: notes on the left, image strip below, attached method and sub-tasks on the right."
      />
      <Steps>
        <Step>
          Click any experiment in the list. The detail editor opens to the
          right (or full-screen on narrow windows).
        </Step>
        <Step>
          The editor is markdown with live preview. The full shortcut set,
          the three modes (Edit / Hybrid / Preview), and the image-strip
          behaviors live on their own page:{" "}
          <Link href="/wiki/features/markdown-editor">The Markdown Editor</Link>.
        </Step>
        <Step>
          Drag images into the editor (or use the paperclip button) to attach
          them. They appear in the strip below the notes, and inline at the
          drop point if you drop them inside the text.
        </Step>
      </Steps>

      <h2>Attach methods and PCR protocols</h2>
      <p>
        Use the <strong>Attach Method</strong> and{" "}
        <strong>Attach PCR Protocol</strong> buttons in the side panel. Once
        attached, you can log <em>variations</em> for this run that override
        the base method&apos;s reagent volumes or temperatures without
        modifying the shared method itself. The variation lives on the
        experiment, and the canonical method stays clean for the next run.
      </p>

      <h2>Sub-tasks and the deviation log</h2>
      <ul>
        <li>
          <strong>Sub-tasks</strong> are small checklist items inside the
          experiment. Tick them off as you go, and counts roll up to the
          parent task.
        </li>
        <li>
          The <strong>deviation log</strong> is a freeform list of &quot;I had
          to change X mid-run&quot; entries. Each entry is timestamped. Use it
          when something went wrong and you don&apos;t want to lose the
          record.
        </li>
      </ul>

      <h2>Export to PDF</h2>
      <p>
        Click the <strong>Export</strong> menu in the experiment editor and
        choose <strong>PDF</strong>. The output bundles notes, image strip,
        attached method, and PCR protocol into a single printable document.
        Useful for thesis chapters and IRB filings.
      </p>

      <Callout variant="tip" title="Where results go">
        Final result images and write-ups go on the{" "}
        <Link href="/wiki/features/results">Results</Link> tab, which has a
        separate gallery and lives under{" "}
        <code>users/&lt;you&gt;/results/task-&lt;id&gt;/</code>.
      </Callout>
    </WikiPage>
  );
}
