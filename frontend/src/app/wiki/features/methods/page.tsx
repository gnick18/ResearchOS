import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function MethodsFeaturePage() {
  return (
    <WikiPage
      title="Methods Library"
      intro="Reusable markdown protocols, organized into folders, sharable across the lab."
    >
      <Screenshot
        src="/wiki/screenshots/methods-library.png"
        alt="The Methods page showing a folder tree on the left and a markdown editor on the right."
      />

      <h2>Create a method</h2>
      <Steps>
        <Step>
          Click <strong>New Method</strong>. Pick a folder (or leave it at the
          root) and a name.
        </Step>
        <Step>
          Write the protocol in markdown. Embed images by dragging them in or
          using the toolbar.
        </Step>
        <Step>
          Save. The method appears in the folder tree on the left and is
          immediately available to attach to experiments.
        </Step>
      </Steps>

      <h2>Folders and sharing</h2>
      <ul>
        <li>
          <strong>Drag methods between folders</strong> to reorganize. Folders
          can be nested.
        </li>
        <li>
          Methods saved under the <strong>Shared</strong> folder are written
          to <code>users/public/methods/</code> and visible to every user in
          the lab folder. Personal methods live under your own user directory.
        </li>
      </ul>

      <h2>Variations on attach</h2>
      <p>
        When you attach a method to an experiment, ResearchOS captures a
        snapshot of the method&apos;s parameters (e.g., reagent volumes,
        temperatures, durations). You can then log <em>variations</em> on the
        experiment without touching the canonical method. The variation lives
        on the experiment, and the method stays clean for the next run.
      </p>

      <Callout variant="tip" title="Search before you write">
        Use the search box at the top of the Methods library to find existing
        protocols before authoring a new one. Many labs end up with five
        slightly different copies of the same protocol, and search prevents
        this.
      </Callout>
    </WikiPage>
  );
}
