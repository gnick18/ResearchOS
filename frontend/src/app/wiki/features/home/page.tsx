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
          spills into weekends. The Gantt chart respects this setting when
          shifting dates.
        </Step>
        <Step>
          Click <strong>Create</strong>. The project appears in the active grid.
        </Step>
      </Steps>

      <h2>Re-order, archive, edit</h2>
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

      <Callout variant="tip" title="Color = visual grouping everywhere">
        The color you pick here drives every project bar on the Gantt, every
        badge in Lab Mode, and the calendar overlay. Pick distinct colors
        early.
      </Callout>
    </WikiPage>
  );
}
