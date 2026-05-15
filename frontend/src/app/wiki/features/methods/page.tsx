import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function MethodsFeaturePage() {
  return (
    <WikiPage
      title="Methods Library"
      intro="Reusable protocols (markdown, PDF, or PCR) organized into categories and attached to experiments as tabs."
    >
      <Screenshot
        src="/wiki/screenshots/methods-library.png"
        alt="The Methods page showing categories of method cards, with type pills marking PDF, PCR, and markdown."
        caption="The Method Library: cards grouped under category headings, with type pills on each card."
      />

      <TryInDemo href="/methods">Try methods in the demo</TryInDemo>

      <h2>What you see on the page</h2>
      <p>
        The Method Library page lists every protocol you and your lab have
        saved, grouped under category headings (e.g., &quot;Molecular
        Biology&quot;, &quot;Imaging&quot;). Each method is a card with its
        name, a type pill (Markdown, PDF, or PCR), and any tags you added.
        Click a card to open the method in a popup with the editor on the
        left and a sidebar listing every experiment that currently uses it
        on the right.
      </p>
      <p>
        Two buttons sit in the top-right of the page:{" "}
        <strong>+ New Category</strong> creates an empty category heading you
        can drag methods into later, and <strong>+ New Method</strong> opens
        the create-method modal.
      </p>

      <h2>Markdown, PDF, and PCR methods</h2>
      <p>
        The create-method modal opens with a <strong>Method Format</strong>{" "}
        toggle at the top. Each format gets its own viewer when the method is
        opened, and its own icon on experiment tabs.
      </p>
      <ul>
        <li>
          <strong>Markdown</strong> (📄) is the default. You write the
          protocol in the same markdown editor used for lab notes and
          results, with toolbars, image drag-drop, and live preview. See{" "}
          <Link href="/wiki/features/markdown-editor">The Markdown Editor</Link>{" "}
          for the full shortcut set.
        </li>
        <li>
          <strong>PDF</strong> (📕) lets you upload an existing protocol PDF
          (a kit insert, a published paper). PDFs render in an iframe and
          can&apos;t be edited inline.
        </li>
        <li>
          <strong>PCR</strong> (🧬) opens a structured thermal-gradient
          editor and reaction-recipe table instead of a markdown editor.
          Full details on the dedicated{" "}
          <Link href="/wiki/features/pcr">PCR Reaction Builder</Link> page.
        </li>
      </ul>

      <h2>Create a method</h2>
      <Steps>
        <Step>
          Click <strong>+ New Method</strong>. Pick the format (Markdown,
          PDF, or PCR) and give it a name. The <strong>Folder
          (optional)</strong> field autocompletes against existing
          categories (the page-level headings) so methods drop into the
          right bucket.
        </Step>
        <Step>
          Fill in the body: write markdown, upload a PDF, or build a PCR
          gradient and recipe. For markdown methods you can drag images and
          attachment files directly into the editor.
        </Step>
        <Step>
          Click <strong>Create Method</strong>. The new card lands in its
          category on the Method Library page and is immediately available
          to attach to experiments.
        </Step>
      </Steps>

      <h2>Categories and drag-to-organize</h2>
      <p>
        Categories are flat (no sub-folders). To move a method into a
        different category, grab its card by the ⋮⋮ handle and drop it on
        another category heading. The drop target highlights blue while you
        hover. Drop a card on the &quot;Drop here to move to
        Uncategorized&quot; bar at the top to clear its category.
      </p>
      <p>
        Use <strong>+ New Category</strong> to set up an empty bucket before
        you have anything to put in it. Empty categories persist in your
        browser until at least one method lives there or you remove it.
      </p>

      <h2>Public versus private</h2>
      <p>
        Every method is private to you by default. Two ways to make a method
        visible to everyone in the lab folder:
      </p>
      <ul>
        <li>
          Tick <strong>Make this method public</strong> in the create-method
          modal.
        </li>
        <li>
          Open an existing method and click the <strong>🔒 Private</strong>{" "}
          pill in the header. That opens a share popup with a
          public-visibility toggle and a green confirmation message when
          you flip it. The pill itself updates to <strong>🌐 Public</strong>{" "}
          once saved.
        </li>
      </ul>
      <p>
        Public methods show a green <strong>Public</strong> badge on their
        card and appear in every user&apos;s library. Once a markdown method
        is public the inline Edit button disappears for everyone (including
        the creator) and the body becomes read-only. To change a published
        protocol, flip it back to Private from the share popup, edit, then
        republish. Other users can always attach a public method to their
        experiments and record their own variations.
      </p>

      <h2>Attach a method to an experiment</h2>
      <p>
        Inside an experiment popup, methods appear as a row of browser-style
        tabs at the top of the Methods area. Click the <strong>+</strong>{" "}
        button on the tab bar to open the method picker.
      </p>
      <p>
        The picker has a search box at the top (search by name or
        <code>#tag</code>), a <strong>Recently used in this project</strong>{" "}
        section pinned to the top, and a folder-grouped list below. Hover or
        arrow through entries to preview the method body in the right pane,
        then press Enter or click to attach.
      </p>

      <h2>Recording variations on a single experiment</h2>
      <p>
        When you open a method tab on an experiment, the amber{" "}
        <strong>Variation Notes</strong> bar sits at the top. Expand it and
        click <strong>+ Add Note</strong> to add a timestamped{" "}
        <code>### Variation</code> entry where you can describe what you did
        differently for this run (e.g., &quot;halved the elongation time&quot;,
        &quot;substituted Q5 for Phusion&quot;). Each entry gets its own
        delete button on hover.
      </p>
      <p>
        For <strong>PCR methods</strong>, you can also edit the thermal
        gradient or recipe table directly inside the experiment tab. The
        first edit captures a snapshot onto that experiment, so the original
        protocol in the library stays untouched. A <strong>Reset to
        Method</strong> button reverts the experiment&apos;s copy back to
        the library version whenever you want.
      </p>
      <p>
        Markdown and PDF methods don&apos;t copy the body onto the
        experiment. The Variation Notes panel is the only place where
        per-experiment changes are recorded for those formats.
      </p>

      <Callout variant="tip" title="Search before you write">
        The picker&apos;s search box matches names and tags (prefix with{" "}
        <code>#</code> to search tags only). Many labs end up with five
        slightly different copies of the same protocol. A quick search
        prevents that.
      </Callout>
    </WikiPage>
  );
}
