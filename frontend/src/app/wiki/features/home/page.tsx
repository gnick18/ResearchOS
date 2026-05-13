import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function HomeFeaturePage() {
  return (
    <WikiPage
      intro="The Home tab is your project hub. Every project gets a card with its color, tags, and task count."
    >
      <Screenshot
        src="/wiki/screenshots/home-projects.png"
        alt="Home page showing several colored project cards and the New Project button."
        caption="The Home page after creating a few projects."
      />

      <h2>What a project is</h2>
      <p>
        A <strong>project</strong> is a colored card on the Home page. Every
        task you create — an experiment, a purchase, a list item — gets filed
        under one project. Click a card and the project&apos;s detail popup
        opens, where you can rename, recolor, retag, or archive it.
      </p>
      <p>
        The color you pick for a project follows it everywhere: it&apos;s the
        bar color on the <Link href="/wiki/features/gantt">Gantt</Link>, the
        badge color in <Link href="/wiki/features/lab-mode">Lab Mode</Link>,
        and the overlay color on the calendar. Pick distinct colors for active
        projects early so a busy Gantt stays readable.
      </p>
      <p>
        Each labmate has their own set of projects. You don&apos;t see each
        other&apos;s cards on the Home page, but Lab Mode rolls everyone&apos;s
        up.
      </p>

      <h2>Create a project</h2>
      <Steps>
        <Step>
          Click <strong>New Project</strong> at the top of the Home page.
        </Step>
        <Step>
          Type a name, pick a color, and optionally add tags (comma-separated).
        </Step>
        <Step>
          Toggle <strong>Weekend active</strong> on if work on this project
          spills into weekends. The Gantt respects this setting when shifting
          dates around dependencies.
        </Step>
        <Step>
          Click <strong>Create</strong>. The project appears in the active
          grid.
        </Step>
      </Steps>

      <h2>Reorder, archive, edit</h2>
      <Screenshot
        src="/wiki/screenshots/home-project-popup.png"
        alt="A project detail popup open over the Home page with the rename and color controls visible."
        caption="Clicking a card opens the project detail popup, where you can rename, recolor, retag, or archive."
      />
      <ul>
        <li>
          <strong>Drag a card</strong> to a new position. The order is per-user
          and persists across sessions.
        </li>
        <li>
          <strong>Click a card</strong> to open the project detail popup. From
          there you can rename it, change its color, edit tags, or archive it.
        </li>
        <li>
          Archived projects move to the <strong>Archived</strong> section below
          the active grid. They keep all their tasks, so nothing is deleted.
        </li>
      </ul>

      <Callout variant="tip" title="Color is visual grouping everywhere">
        The color you pick here drives every project bar on the Gantt, every
        badge in Lab Mode, and the calendar overlay. Pick distinct colors
        early so the Gantt stays readable as the project count grows.
      </Callout>
    </WikiPage>
  );
}
