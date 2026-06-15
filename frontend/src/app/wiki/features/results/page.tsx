import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function ResultsFeaturePage() {
  return (
    <WikiPage
      title="Where results live now"
      intro="ResearchOS used to have a standalone Results page that listed every completed task, grouped by project. That page was retired. Completed work now surfaces in three places, each closer to the context where the work happens."
    >
      <Callout variant="info" title="Old bookmarks still work">
        Visiting <code>/results</code> now redirects to{" "}
        <Link href="/wiki/features/experiments">Workbench</Link>, where the
        bulk of the old page&apos;s content lives. No data moved on disk,
        every task still lives at{" "}
        <code>users/&lt;owner&gt;/results/task-&lt;id&gt;/</code>. New file
        attachments land in per-tab subdirectories. Notes files go to{" "}
        <code>notes/Files/</code> and results files go to{" "}
        <code>results/Files/</code>, rather than a flat <code>Files/</code>{" "}
        folder at the task root.
      </Callout>

      <h2>Completed experiments → Workbench &ldquo;Earlier results&rdquo;</h2>
      <p>
        Experiments that you&apos;ve marked complete now collect in the
        Earlier results section at the bottom of the{" "}
        <Link href="/wiki/features/experiments">Workbench</Link> page, with
        the header rendered in uppercase as <strong>EARLIER RESULTS</strong>.
        They keep all the same write-up affordances. Clicking a card opens
        the task detail popup on its Details tab (the default for an
        experiment). Pick the Results tab there to fill in the markdown
        summary and drop in images.
      </p>
      <p>
        Because this archive grows for as long as you keep working, it paginates
        instead of dumping everything at once. The flat view shows a page of
        cards with a <strong>Show more</strong> button for the rest. The
        by-project view collapses each project group (tap a group to expand it)
        and caps a long group until you hit <strong>Show all</strong>.
      </p>
      <Screenshot
        src="/wiki/screenshots/workbench-earlier.png"
        alt="The Earlier results section at the bottom of the Workbench page, with completed experiment cards grouped by project."
        caption="The Earlier results section sits at the bottom of the Workbench. The project-grouping toggle in its header flips between flat and project-grouped views."
      />
      <Callout variant="info" title="Screenshot pending recapture">
        <code>workbench-earlier.png</code> is queued for recapture to reflect
        the current Workbench layout.
      </Callout>

      <h2>Completed purchases → Purchases unified scroll</h2>
      <p>
        Finished purchase orders appear inline in the{" "}
        <Link href="/wiki/features/purchases">Purchases</Link> chronological
        list alongside active orders, marked with a green dot and a{" "}
        <code> · Complete</code> text suffix. There is no separate Earlier
        section.
      </p>

      <h2>Per-project completed work → project Results gallery</h2>
      <p>
        Clicking a project card on the{" "}
        <Link href="/wiki/features/projects">Workbench Projects tab</Link> opens
        that project&apos;s detail popup (the deep link lives at{" "}
        <code>/workbench/projects/&lt;id&gt;</code>). Its{" "}
        <strong>Go to</strong> section has a <strong>Results</strong> doorway
        that opens a gallery of every result image for that project. This is
        the fastest way to review a project&apos;s result images without leaving
        its context.
      </p>

      <Callout variant="tip" title="Why the page was retired">
        The standalone Results page was a fourth surface that mostly
        duplicated work the per-feature pages were already doing better.
        Folding completion into Workbench, Purchases, and the project popup
        keeps each completion view closer to the live work it belongs to,
        instead of forcing one cross-cutting tab to do the job for all of
        them.
      </Callout>
    </WikiPage>
  );
}
