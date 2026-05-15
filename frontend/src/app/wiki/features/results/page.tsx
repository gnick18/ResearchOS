import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function ResultsFeaturePage() {
  return (
    <WikiPage
      title="Where results live now"
      intro="ResearchOS used to have a standalone Results page that listed every completed (or deviated) task, grouped by project. That page was retired — completed work surfaces in three places now, each closer to the context where the work happens."
    >
      <Callout variant="info" title="Old bookmarks still work">
        Visiting <code>/results</code> now redirects to{" "}
        <Link href="/wiki/features/experiments">Workbench</Link>, where the
        bulk of the old page&apos;s content lives. No data moved on disk —
        every task&apos;s <code>results.md</code>, <code>notes.md</code>, and
        per-task <code>Files/</code> + <code>Images/</code> folders stay
        exactly where they were.
      </Callout>

      <h2>Completed experiments → Workbench &ldquo;Earlier&rdquo;</h2>
      <p>
        Experiments that you&apos;ve marked complete (or that carry a
        deviation log) now collect in the <strong>Earlier</strong> archive
        section at the bottom of the{" "}
        <Link href="/wiki/features/experiments">Workbench</Link> page. They
        keep all the same write-up affordances: clicking a card opens the
        task detail popup with the Results tab selected, where you fill in
        the markdown summary and drop in images.
      </p>

      <h2>Completed purchases → Purchases &ldquo;Earlier&rdquo;</h2>
      <p>
        Finished purchase orders fold into the <strong>Earlier</strong>{" "}
        accordion at the bottom of the{" "}
        <Link href="/wiki/features/purchases">Purchases</Link> page. The
        accordion stays collapsed by default so the active orders dominate
        the view; click to expand and the historical buys appear with the
        same per-row layout as the live ones.
      </p>

      <h2>Per-project completed work → project popup</h2>
      <p>
        Open any project from the{" "}
        <Link href="/wiki/features/home">Home</Link> page and the project
        detail popup now carries a <strong>Recently completed</strong> line
        that surfaces the last 30 days of completed work for that project,
        across every task type. It&apos;s the fastest way to answer
        &ldquo;what did we finish on this project this month?&rdquo; without
        leaving the project&apos;s own context.
      </p>

      <Callout variant="tip" title="Why the page was retired">
        The standalone Results page was a fourth surface that mostly
        duplicated work the per-feature pages were already doing better.
        Folding completion into Workbench, Purchases, and the project popup
        keeps each &ldquo;earlier&rdquo; view closer to the live work it
        belongs to, instead of forcing one cross-cutting tab to do the job
        for all of them.
      </Callout>
    </WikiPage>
  );
}
