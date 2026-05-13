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
        caption="The Methods library: folder tree on the left, markdown editor on the right."
      />

      <h2>What a method is</h2>
      <p>
        A <strong>method</strong> is a saved markdown protocol that lives in
        your library and can be attached to any experiment. Think of it as the
        clean, canonical version of how to do X (e.g., a DNA extraction, a
        gel-run protocol, a buffer recipe).
      </p>
      <p>
        Methods are <em>snapshot-on-attach</em>. When you attach a method to
        an experiment, ResearchOS captures the method&apos;s parameters
        (reagent volumes, temperatures, durations) onto that experiment. You
        can then log per-run variations on the experiment without touching the
        canonical method. The next experiment that attaches the same method
        still gets the clean original.
      </p>
      <p>
        Methods can be private (under your user) or shared lab-wide (in the{" "}
        <strong>Shared</strong> folder, which writes to{" "}
        <code>users/public/methods/</code>).
      </p>

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

      <h2>Variations live on the experiment</h2>
      <p>
        Once a method is attached to an experiment, edits to volumes,
        temperatures, or durations stay on that experiment&apos;s copy. The
        underlying method file is untouched. This is the whole point of the
        library: one source of truth for the protocol, room to record what
        actually happened on each run.
      </p>

      <Callout variant="tip" title="Search before you write">
        Use the search box at the top of the library to find existing
        protocols before authoring a new one. Many labs end up with five
        slightly different copies of the same protocol, and a quick search
        prevents that.
      </Callout>
    </WikiPage>
  );
}
