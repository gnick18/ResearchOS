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

      <h2>What an experiment is here</h2>
      <p>
        An <strong>experiment</strong> is just a task with{" "}
        <code>task_type: &quot;experiment&quot;</code>. What sets it apart is
        what hangs off it: a markdown notes body, an attached image strip, one
        or more attached methods (snapshotted at attach time), an optional
        deviation log, and a separate Results folder for the final outputs.
      </p>
      <p>
        That split is intentional. The three concepts live in three different
        places on disk and they each have a different job:
      </p>
      <ul>
        <li>
          <strong>Lab Notes</strong> (this tab) is the <em>during-the-run</em>{" "}
          record. Live notes, sub-tasks, deviation log, image strip.
        </li>
        <li>
          <Link href="/wiki/features/methods">Methods</Link> is the{" "}
          <em>reusable protocol library</em>. Edit a method once and every
          future experiment can attach it.
        </li>
        <li>
          <Link href="/wiki/features/results">Results</Link> is the{" "}
          <em>final-output</em> folder for the experiment (i.e., gels, blots,
          plots, write-up). Lives at{" "}
          <code>users/&lt;you&gt;/results/task-&lt;id&gt;/</code>.
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
          The editor is markdown with live preview. Use{" "}
          <strong>Cmd / Ctrl + B</strong> for bold,{" "}
          <strong>Cmd / Ctrl + I</strong> for italic, and the toolbar for
          headings, lists, and inline code.
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
