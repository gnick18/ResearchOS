import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function HomeFeaturePage() {
  return (
    <WikiPage
      title="Where you land"
      intro="Opening ResearchOS drops you straight into the surface that fits your role. There's no separate home dashboard to build or maintain. A lab member or solo researcher lands on the Workbench, opened to a grid of their projects. A lab head lands on the curated Lab Overview. The root URL is just a router that sends you to the right place."
    >
      <h2>The root URL is a router, not a page</h2>
      <p>
        ResearchOS used to open on a customizable widget dashboard at{" "}
        <code>/</code>, a canvas of tiles you pinned, dragged, and rearranged.
        That dashboard is gone. The root URL now renders nothing of its own. It
        signs you in, handles any deep link you arrived with (e.g. a task or
        project link someone shared), and then forwards you to the surface that
        owns your account type.
      </p>
      <ul>
        <li>
          A <strong>lab member</strong> or <strong>solo researcher</strong>{" "}
          lands on the <Link href="/wiki/features/experiments">Workbench</Link>,
          opened to its <strong>Projects</strong> grid.
        </li>
        <li>
          A <strong>lab head (PI)</strong> lands on the{" "}
          <Link href="/wiki/features/lab-overview">Lab Overview</Link>, the
          fixed curated page that rolls up the whole lab.
        </li>
      </ul>
      <Callout variant="info" title="No dashboard to curate">
        There&apos;s no add-widget palette, no drag-to-arrange canvas, and no
        per-user dashboard layout to keep in sync anymore. Everyone gets one
        designed landing surface for their role, and the same{" "}
        <Link href="/wiki/features/experiments">Daily Tasks sidebar</Link> runs
        alongside it.
      </Callout>

      <h2>Members land on the Projects grid</h2>
      <p>
        For a member or solo researcher, the landing surface is the Workbench
        with its <strong>Projects</strong> tab selected. The grid shows a card
        per project with the project&apos;s color dot, a percent-complete progress
        bar, and small count chips (experiments, list tasks, and sequences once
        you have any). Click a card to open that project (see{" "}
        <Link href="/wiki/features/projects">Project Surface</Link> for the
        Overview, Results, Methods, Goals, and Activity walkthrough). The
        Workbench&apos;s other tabs (Experiments, Notes, Lists) sit alongside
        Projects in the same view. A <strong>Check-ins</strong> tab also appears
        for anyone in at least one active 1:1; a lab head always sees it.
      </p>

      <Screenshot
        src="/wiki/screenshots/home-workbench-projects-grid.png"
        alt="The Workbench Projects grid showing several project cards, each with a color dot, project name, percent-complete progress bar, and count chips for experiments and tasks."
        caption="Members and solo researchers land here: the Workbench Projects grid."
      />

      <h2>Create a project</h2>
      <p>
        The <strong>New Project</strong> button lives on the Projects grid. It
        opens the same create modal everywhere a project can be started.
      </p>
      <Steps>
        <Step>
          Open the <strong>Projects</strong> tab on the{" "}
          <Link href="/wiki/features/experiments">Workbench</Link> (it&apos;s where
          you already are when you land).
        </Step>
        <Step>
          Click <strong>New Project</strong>, pick a color from the swatch, and
          type a name (e.g. <em>CRISPR Gene Editing Study</em>).
        </Step>
        <Step>
          Press <strong>Create</strong>. The modal closes and leaves you right
          where you were, with the new card already in the grid (creating a
          project doesn&apos;t jump you into it). The project&apos;s color then carries
          through everywhere it appears, like the bar on the Gantt.
        </Step>
      </Steps>
      <Callout variant="tip" title="Color is visual grouping everywhere">
        The color you pick follows the project across the whole app, the bar on
        the <Link href="/wiki/features/gantt">Gantt</Link>, the dot on the
        project card, and the overlay on the calendar. Pick distinct colors
        early so a busy Gantt stays readable as your project count grows.
      </Callout>

      <h2>Shared projects appear here too</h2>
      <p>
        When a labmate shares a project with you, it surfaces in your Projects
        grid alongside your own. The card reads the same as any other, with its
        color, progress, and count chips. Whether your edits save back
        depends on the permission the owner granted. Edit permission writes to
        their copy, view permission is read-only. See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for the full permission model.
      </p>
      <Callout variant="info" title="Want a lab-wide roll-up?">
        Sharing a single project is the right tool when one labmate wants to
        follow along on one specific project. For a single surface that rolls
        up every member&apos;s activity, today&apos;s events, and pending approvals at
        once, a PI uses the curated{" "}
        <Link href="/wiki/features/lab-overview">Lab Overview</Link> instead.
      </Callout>
    </WikiPage>
  );
}
