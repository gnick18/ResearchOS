import Link from "next/link";
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
        A <strong>method</strong> is a markdown protocol you save once and
        reuse across experiments — a DNA extraction, a gel-run recipe, a
        buffer mix. The folder tree on the left of the page is your library
        of them. Click a name to open its markdown body in the editor on the
        right.
      </p>
      <p>
        When you attach a method to an experiment, ResearchOS copies its
        volumes, temperatures, and durations onto that experiment. You can
        tweak those copied values for the run (the experiment then carries
        its own variation), and the original method stays as-is for the
        next time someone attaches it.
      </p>
      <p>
        Methods saved in the <strong>Shared</strong> folder appear in
        everyone&apos;s library. Methods under your own user are private to
        you.
      </p>

      <h2>Create a method</h2>
      <Steps>
        <Step>
          Click <strong>New Method</strong>. Pick a folder (or leave it at the
          root) and a name.
        </Step>
        <Step>
          Write the protocol in markdown. Embed images by dragging them in or
          using the toolbar. The body uses the same editor as experiments and
          notes, with three modes and a full shortcut set, documented on{" "}
          <Link href="/wiki/features/markdown-editor">The Markdown Editor</Link>.
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

      <h2>Variations stay on the experiment</h2>
      <p>
        After you attach a method, any edits you make to volumes,
        temperatures, or durations inside the experiment popup change only
        that experiment&apos;s copy. The original method in the library
        doesn&apos;t move. The next experiment that attaches the same method
        gets the unedited version, plus a fresh chance to vary.
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
